"""Atom Home — universal household panel for Home Assistant.

Registers a custom sidebar panel served from this integration's `frontend/` folder and a small
WebSocket API that stores the house configuration (which devices to show, names, rooms, buttons)
in Home Assistant's `.storage`. Reading is open to every signed-in user; writing requires an admin.
"""
from __future__ import annotations

import base64
import binascii
import json
import logging
import re
import secrets
from pathlib import Path

import voluptuous as vol
from homeassistant.components import panel_custom, websocket_api
from homeassistant.components.http import HomeAssistantView, StaticPathConfig
from homeassistant.config_entries import ConfigEntry
from homeassistant.core import HomeAssistant, callback
from homeassistant.helpers.storage import Store
from aiohttp import web

from .const import (
    DOMAIN, FRONTEND_FILE, MAX_CONFIG_BYTES, MAX_PHOTO_BYTES, PANEL_ICON, PANEL_TITLE, PANEL_URL_PATH, PHOTOS_DIR, PHOTOS_URL, STATIC_URL, STORAGE_KEY, STORAGE_VERSION,
)

_LOGGER = logging.getLogger(__name__)
FRONTEND_DIR = Path(__file__).parent / "frontend"


def _version() -> str:
    try:
        return json.loads((Path(__file__).parent / "manifest.json").read_text(encoding="utf-8")).get("version", "0")
    except (OSError, ValueError):
        return "0"


BUNDLE_URL = "/atom_home/bundle.js"
LOADER_URL = "/atom_home/loader.js"
META_URL = "/atom_home/meta"
# The loader is what the panel registers as module_url. It asks the integration which bundle is current (a cache-busting query
# defeats proxies such as Cloudflare that rewrite Cache-Control) and imports the bundle under a URL unique to that build.
LOADER_JS = """const r = await fetch('/atom_home/meta?t=' + Date.now(), { cache: 'no-store', credentials: 'same-origin' }).catch(() => null);
const m = r && r.ok ? await r.json().catch(() => ({})) : {};
await import('/atom_home/bundle.js?e=' + encodeURIComponent(m.etag || Date.now()));
"""


def _bundle_etag(path: Path) -> str:
    stat = path.stat()
    return f"{stat.st_mtime_ns:x}-{stat.st_size:x}"


class LoaderView(HomeAssistantView):
    url = LOADER_URL
    name = "atom_home:loader"
    requires_auth = False

    async def get(self, request: web.Request) -> web.StreamResponse:
        return web.Response(text=LOADER_JS, content_type="text/javascript", charset="utf-8", headers={"Cache-Control": "no-cache"})


class MetaView(HomeAssistantView):
    url = META_URL
    name = "atom_home:meta"
    requires_auth = False

    async def get(self, request: web.Request) -> web.StreamResponse:
        try:
            etag = await request.app["hass"].async_add_executor_job(_bundle_etag, FRONTEND_DIR / FRONTEND_FILE)
        except OSError:
            return web.Response(status=404)
        return web.json_response({"etag": etag, "version": request.app["hass"].data.get(DOMAIN, {}).get("_version", "0")}, headers={"Cache-Control": "no-store"})


class BundleView(HomeAssistantView):
    """The panel bundle with revalidation: browsers keep it cached but ask every time, so a HACS update
    (which replaces the file without a restart) reaches phones and tablets at the next page load."""

    url = BUNDLE_URL
    name = "atom_home:bundle"
    requires_auth = False

    async def get(self, request: web.Request) -> web.StreamResponse:
        path = FRONTEND_DIR / FRONTEND_FILE
        try:
            stat = await request.app["hass"].async_add_executor_job(path.stat)
        except OSError:
            return web.Response(status=404)
        etag = f'"{stat.st_mtime_ns:x}-{stat.st_size:x}"'
        if request.headers.get("If-None-Match") == etag:
            return web.Response(status=304, headers={"ETag": etag, "Cache-Control": "no-cache"})
        body = await request.app["hass"].async_add_executor_job(path.read_bytes)
        return web.Response(body=body, content_type="text/javascript", charset="utf-8", headers={"ETag": etag, "Cache-Control": "public, max-age=31536000, immutable" if request.query.get("e") == etag.strip('"') else "no-cache"})


async def async_setup(hass: HomeAssistant, config: dict) -> bool:
    """YAML setup is not used; everything happens in the config entry."""
    return True


async def async_setup_entry(hass: HomeAssistant, entry: ConfigEntry) -> bool:
    store: Store[dict] = Store(hass, STORAGE_VERSION, STORAGE_KEY)
    data = await store.async_load() or {}
    version = await hass.async_add_executor_job(_version)
    hass.data.setdefault(DOMAIN, {})[entry.entry_id] = {"store": store, "config": data.get("config")}
    hass.data[DOMAIN]["_version"] = version

    photos_dir = Path(hass.config.path(PHOTOS_DIR))
    await hass.async_add_executor_job(lambda: photos_dir.mkdir(parents=True, exist_ok=True))
    hass.data[DOMAIN]["_photos_dir"] = photos_dir
    await hass.http.async_register_static_paths([
        StaticPathConfig(STATIC_URL, str(FRONTEND_DIR), cache_headers=False),
        StaticPathConfig(PHOTOS_URL, str(photos_dir), cache_headers=True),
    ])
    hass.http.register_view(BundleView())
    hass.http.register_view(LoaderView())
    hass.http.register_view(MetaView())
    await panel_custom.async_register_panel(
        hass,
        webcomponent_name="atom-home-panel",
        frontend_url_path=PANEL_URL_PATH,
        sidebar_title=PANEL_TITLE,
        sidebar_icon=PANEL_ICON,
        module_url=f"{LOADER_URL}?v={version}",
        embed_iframe=False,
        trust_external=False,
        require_admin=False,
        config={"version": version},
    )
    _register_ws(hass)
    _LOGGER.info("Atom Home %s panel registered at /%s", version, PANEL_URL_PATH)
    return True


async def async_unload_entry(hass: HomeAssistant, entry: ConfigEntry) -> bool:
    panel_custom.async_remove_panel(hass, PANEL_URL_PATH)
    hass.data.get(DOMAIN, {}).pop(entry.entry_id, None)
    return True


def _entry_data(hass: HomeAssistant) -> dict | None:
    bucket = hass.data.get(DOMAIN) or {}
    return next(iter(bucket.values()), None)


def _register_ws(hass: HomeAssistant) -> None:
    if hass.data[DOMAIN].get("_ws_registered"):
        return
    hass.data[DOMAIN]["_ws_registered"] = True

    @websocket_api.websocket_command({vol.Required("type"): f"{DOMAIN}/config/get"})
    @callback
    def ws_get(hass: HomeAssistant, connection: websocket_api.ActiveConnection, msg: dict) -> None:
        data = _entry_data(hass)
        connection.send_result(msg["id"], {"config": (data or {}).get("config"), "version": hass.data[DOMAIN].get("_version", "0"), "admin": connection.user.is_admin})

    @websocket_api.websocket_command({vol.Required("type"): f"{DOMAIN}/config/set", vol.Required("config"): dict})
    @websocket_api.require_admin
    @websocket_api.async_response
    async def ws_set(hass: HomeAssistant, connection: websocket_api.ActiveConnection, msg: dict) -> None:
        data = _entry_data(hass)
        if data is None:
            connection.send_error(msg["id"], "not_loaded", "Atom Home is not set up")
            return
        raw = json.dumps(msg["config"], ensure_ascii=False)
        if len(raw.encode("utf-8")) > MAX_CONFIG_BYTES:
            connection.send_error(msg["id"], "too_large", f"Configuration exceeds {MAX_CONFIG_BYTES} bytes")
            return
        if msg["config"].get("schemaVersion") != 1:
            connection.send_error(msg["id"], "bad_schema", "schemaVersion must be 1")
            return
        data["config"] = msg["config"]
        await data["store"].async_save({"config": msg["config"]})
        connection.send_result(msg["id"], {"saved": True})

    PHOTO_NAME = re.compile(r"^[a-z0-9]{12,32}\.(jpg|png|webp)$")
    MIME_EXT = {"image/jpeg": "jpg", "image/png": "png", "image/webp": "webp"}

    @websocket_api.websocket_command({vol.Required("type"): f"{DOMAIN}/photo/set", vol.Required("mime"): vol.In(list(MIME_EXT)), vol.Required("data"): str})
    @websocket_api.require_admin
    @websocket_api.async_response
    async def ws_photo_set(hass: HomeAssistant, connection: websocket_api.ActiveConnection, msg: dict) -> None:
        """Store an owner photo (base64) under the photos folder; returns its URL. The frontend downsizes before upload."""
        try:
            raw = base64.b64decode(msg["data"], validate=True)
        except (binascii.Error, ValueError):
            connection.send_error(msg["id"], "bad_data", "data must be base64")
            return
        if len(raw) > MAX_PHOTO_BYTES:
            connection.send_error(msg["id"], "too_large", f"Photo exceeds {MAX_PHOTO_BYTES} bytes")
            return
        magic_ok = raw.startswith(b"\xff\xd8") or raw.startswith(b"\x89PNG") or raw[:4] == b"RIFF" and raw[8:12] == b"WEBP"
        if not magic_ok:
            connection.send_error(msg["id"], "bad_data", "not an image")
            return
        name = f"{secrets.token_hex(8)}.{MIME_EXT[msg['mime']]}"
        target = hass.data[DOMAIN]["_photos_dir"] / name
        await hass.async_add_executor_job(target.write_bytes, raw)
        connection.send_result(msg["id"], {"url": f"{PHOTOS_URL}/{name}", "bytes": len(raw)})

    @websocket_api.websocket_command({vol.Required("type"): f"{DOMAIN}/photo/delete", vol.Required("url"): str})
    @websocket_api.require_admin
    @websocket_api.async_response
    async def ws_photo_delete(hass: HomeAssistant, connection: websocket_api.ActiveConnection, msg: dict) -> None:
        name = msg["url"].rsplit("/", 1)[-1]
        if not msg["url"].startswith(PHOTOS_URL + "/") or not PHOTO_NAME.match(name):
            connection.send_error(msg["id"], "bad_url", "not an Atom Home photo")
            return
        target = hass.data[DOMAIN]["_photos_dir"] / name

        def _remove() -> bool:
            if target.exists():
                target.unlink()
                return True
            return False

        removed = await hass.async_add_executor_job(_remove)
        connection.send_result(msg["id"], {"removed": removed})

    websocket_api.async_register_command(hass, ws_get)
    websocket_api.async_register_command(hass, ws_set)
    websocket_api.async_register_command(hass, ws_photo_set)
    websocket_api.async_register_command(hass, ws_photo_delete)
