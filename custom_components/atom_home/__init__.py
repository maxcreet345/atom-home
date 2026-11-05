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
from homeassistant.exceptions import Unauthorized
from homeassistant.helpers.storage import Store
from aiohttp import web

from .light_sleep import LightSleep
from .automations import automation_rows
from .feeder import feeder_log
from .air_tasks import AirTasks
from .alarms import AlarmScheduler, normalise_alarms
from .config_state import ConfigState, ConfigWriteError
from .const import (
    CLIENT_FEATURE_COMPOSITION, DOMAIN, FRONTEND_FILE, MAX_PHOTO_BYTES, PANEL_ICON, PANEL_TITLE, PANEL_URL_PATH, PHOTOS_DIR, PHOTOS_URL, STATIC_URL, STORAGE_KEY, STORAGE_VERSION,
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
LOADER_JS = """// ST-1 of the audit of 04.11.2026: the panel element gets a skeleton before the bundle arrives (a copy of frontend/src/ui/skeleton.js).
const savedTheme = () => { try { return localStorage.getItem('atom-home-theme'); } catch (e) { return null; } }; // S2: the panel's own theme, left by the bundle on the previous load
const SKELETON = '<style>:host{display:block;position:relative;width:100%;height:100vh;height:100dvh;overflow:hidden}' + '.hm-skeleton{position:absolute;inset:0;display:flex;flex-direction:column;gap:16px;padding:20px 24px;background:#f2f2f6;color:#6b6b70;font:500 15px/1.4 -apple-system,system-ui,"Segoe UI",Roboto,sans-serif;overflow:hidden;box-sizing:border-box}.hm-skeleton-head{height:34px;width:42%;max-width:260px;border-radius:10px}.hm-skeleton-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(142px,1fr));gap:12px}.hm-skeleton-tile{aspect-ratio:1;border-radius:22px}.hm-skeleton .is-bone{background:linear-gradient(100deg,#e3e3ea 30%,#ededf2 50%,#e3e3ea 70%);background-size:200% 100%;animation:hm-shimmer 1.4s linear infinite}.hm-skeleton p{margin:auto 0 0;text-align:center}@keyframes hm-shimmer{to{background-position:-200% 0}}@media (max-width:599px){.hm-skeleton{padding:14px}.hm-skeleton-grid{grid-template-columns:repeat(3,minmax(0,1fr))}}@media (prefers-reduced-motion:reduce){.hm-skeleton .is-bone{animation:none}}.hm-skeleton.is-dark{background:#0f1016;color:#ffffffcc}.hm-skeleton.is-dark .is-bone{background:linear-gradient(100deg,#232430 30%,#2c2d3a 50%,#232430 70%);background-size:200% 100%}' + '</style>' + '<div class="hm-skeleton' + (savedTheme() === 'dark' ? ' is-dark' : '') + '" role="status" aria-busy="true" aria-live="polite"><div class="hm-skeleton-head is-bone"></div><div class="hm-skeleton-grid"><div class="hm-skeleton-tile is-bone"></div><div class="hm-skeleton-tile is-bone"></div><div class="hm-skeleton-tile is-bone"></div><div class="hm-skeleton-tile is-bone"></div><div class="hm-skeleton-tile is-bone"></div><div class="hm-skeleton-tile is-bone"></div><div class="hm-skeleton-tile is-bone"></div><div class="hm-skeleton-tile is-bone"></div></div><p>Подключаемся к дому…</p></div>';
const deep = (root, sel) => { const hit = root.querySelector && root.querySelector(sel); if (hit) return hit; for (const n of root.querySelectorAll ? root.querySelectorAll('*') : []) if (n.shadowRoot) { const f = deep(n.shadowRoot, sel); if (f) return f; } return null; };
const skeleton = () => { try { if (customElements.get('atom-home-panel')) return; const main = document.querySelector('home-assistant'); const el = main ? deep(main.shadowRoot || main, 'atom-home-panel') : null; if (el && !el.shadowRoot) el.attachShadow({ mode: 'open' }).innerHTML = SKELETON; } catch (e) { /* cosmetic */ } };
skeleton();
const retry = setInterval(skeleton, 20); setTimeout(() => clearInterval(retry), 15000); // HA adds the element a moment after this module starts
if (!document.querySelector('meta[name="theme-color"]')) { const meta = document.createElement('meta'); meta.name = 'theme-color'; meta.content = '#f2f2f6'; document.head.append(meta); }
const r = await fetch('/atom_home/meta?t=' + Date.now(), { cache: 'no-store', credentials: 'same-origin' }).catch(() => null);
const m = r && r.ok ? await r.json().catch(() => ({})) : {};
await import('/atom_home/bundle.js?e=' + encodeURIComponent(m.etag || Date.now()));
clearInterval(retry);
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
    scheduler = AlarmScheduler(hass)
    scheduler.set_alarms(normalise_alarms((data.get("config") or {}).get("alarms")))
    await scheduler.resume()  # a ringing flag restored across the restart is stale
    sleep = LightSleep(hass)
    await sleep.async_load()
    air_tasks = AirTasks(hass)
    await air_tasks.async_load()
    hass.data.setdefault(DOMAIN, {})[entry.entry_id] = {"air_tasks": air_tasks, "store": store, "state": ConfigState(data.get("config"), data.get("revision", 0), store.async_save), "alarms": scheduler, "light_sleep": sleep}
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
    bucket = hass.data.get(DOMAIN, {}).pop(entry.entry_id, None) or {}
    if (sched := bucket.get("alarms")):
        sched.shutdown()
    if (air := bucket.get("air_tasks")):
        air.unload()
    if (sleep := bucket.get("light_sleep")):
        sleep.shutdown()
    return True


def _entry_data(hass: HomeAssistant) -> dict | None:
    # The bucket also holds `_version`, `_photos_dir`…; after an entry reload the entry is no longer the first value.
    bucket = hass.data.get(DOMAIN) or {}
    return next((v for k, v in bucket.items() if not k.startswith("_") and isinstance(v, dict)), None)


def _register_ws(hass: HomeAssistant) -> None:
    if hass.data[DOMAIN].get("_ws_registered"):
        return
    hass.data[DOMAIN]["_ws_registered"] = True

    @websocket_api.websocket_command({vol.Required("type"): f"{DOMAIN}/config/get"})
    @callback
    def ws_get(hass: HomeAssistant, connection: websocket_api.ActiveConnection, msg: dict) -> None:
        state: ConfigState | None = (_entry_data(hass) or {}).get("state")
        connection.send_result(msg["id"], {"config": state.config if state else None, "revision": state.revision if state else 0, "version": hass.data[DOMAIN].get("_version", "0"), "admin": connection.user.is_admin})

    @websocket_api.websocket_command({vol.Required("type"): f"{DOMAIN}/capabilities/get"})
    @callback
    def ws_capabilities(hass: HomeAssistant, connection: websocket_api.ActiveConnection, msg: dict) -> None:
        """What this backend supports; a panel that gets `unknown_command` here is talking to an older integration."""
        connection.send_result(msg["id"], {"configRevision": 1, "composition": 1, "assist": 0, "alarms": 1, "lightSleep": 1, "automations": 1, "feederLog": 1, "airTasks": 1})

    @websocket_api.websocket_command({
        vol.Required("type"): f"{DOMAIN}/config/set",
        vol.Required("config"): dict,
        vol.Optional("expected_revision"): vol.All(int, vol.Range(min=0)),
        vol.Optional("client_features"): [str],
    })
    @websocket_api.require_admin
    @websocket_api.async_response
    async def ws_set(hass: HomeAssistant, connection: websocket_api.ActiveConnection, msg: dict) -> None:
        state: ConfigState | None = (_entry_data(hass) or {}).get("state")
        if state is None:
            connection.send_error(msg["id"], "not_loaded", "Atom Home is not set up")
            return
        try:
            revision = await state.write(msg["config"], msg.get("expected_revision"), msg.get("client_features"))
        except ConfigWriteError as err:
            if err.code == "save_failed":
                _LOGGER.error("Atom Home: configuration could not be written", exc_info=err.__cause__)
            connection.send_error(msg["id"], err.code, err.message)
            return
        if (sched := (_entry_data(hass) or {}).get("alarms")):
            sched.set_alarms(normalise_alarms((state.config or {}).get("alarms")))
        connection.send_result(msg["id"], {"saved": True, "revision": revision})

    @websocket_api.websocket_command({vol.Required("type"): f"{DOMAIN}/alarms/set", vol.Required("alarms"): list, vol.Optional("expected_revision"): vol.All(int, vol.Range(min=0))})
    @websocket_api.async_response
    async def ws_alarms_set(hass: HomeAssistant, connection: websocket_api.ActiveConnection, msg: dict) -> None:
        """Any signed-in user may set the house alarms: only the `alarms` key changes, the rest of the config is kept as stored."""
        bucket = _entry_data(hass) or {}
        state: ConfigState | None = bucket.get("state")
        if state is None:
            connection.send_error(msg["id"], "not_loaded", "Atom Home is not set up")
            return
        alarms = normalise_alarms(msg["alarms"])
        config = dict(state.config or {"schemaVersion": 1, "home": {"name": "Мой дом", "language": "ru", "theme": "light"}, "rooms": {}, "devices": {}, "entities": {}, "buttons": [], "sections": {}, "modules": {}})
        config["alarms"] = alarms
        try:
            revision = await state.write(config, msg.get("expected_revision"), [CLIENT_FEATURE_COMPOSITION])
        except ConfigWriteError as err:
            connection.send_error(msg["id"], err.code, err.message)
            return
        if (sched := bucket.get("alarms")):
            sched.set_alarms(alarms)
        connection.send_result(msg["id"], {"saved": True, "revision": revision, "alarms": alarms})

    @websocket_api.websocket_command({vol.Required("type"): f"{DOMAIN}/alarm/stop"})
    @websocket_api.async_response
    async def ws_alarm_stop(hass: HomeAssistant, connection: websocket_api.ActiveConnection, msg: dict) -> None:
        if (sched := (_entry_data(hass) or {}).get("alarms")):
            await sched.stop()
        connection.send_result(msg["id"], {"stopped": True})

    @websocket_api.websocket_command({vol.Required("type"): f"{DOMAIN}/alarm/snooze", vol.Optional("minutes"): vol.All(int, vol.Range(min=1, max=60))})
    @websocket_api.async_response
    async def ws_alarm_snooze(hass: HomeAssistant, connection: websocket_api.ActiveConnection, msg: dict) -> None:
        if (sched := (_entry_data(hass) or {}).get("alarms")):
            await sched.snooze(msg.get("minutes", 9))
        connection.send_result(msg["id"], {"snoozed": True})

    @websocket_api.websocket_command({vol.Required("type"): f"{DOMAIN}/light/sleep", vol.Required("entity_id"): str, vol.Required("minutes"): vol.All(int, vol.Range(min=0, max=720))})
    @websocket_api.async_response
    async def ws_light_sleep(hass: HomeAssistant, connection: websocket_api.ActiveConnection, msg: dict) -> None:
        """Any user of the house may set «turn off in N minutes» on a lamp (0 cancels)."""
        sleep: LightSleep | None = (_entry_data(hass) or {}).get("light_sleep")
        if sleep is None:
            connection.send_error(msg["id"], "not_ready", "Atom Home is not set up")
            return
        if hass.states.get(msg["entity_id"]) is None:
            connection.send_error(msg["id"], "not_found", "no such light")
            return
        try:
            at = await sleep.schedule(msg["entity_id"], msg["minutes"])
        except ValueError as err:
            connection.send_error(msg["id"], "invalid", str(err))
            return
        connection.send_result(msg["id"], {"until": at.isoformat() if at else None, "pending": sleep.summary()})

    @websocket_api.websocket_command({vol.Required("type"): f"{DOMAIN}/light/sleep/state"})
    @callback
    def ws_light_sleep_state(hass: HomeAssistant, connection: websocket_api.ActiveConnection, msg: dict) -> None:
        sleep: LightSleep | None = (_entry_data(hass) or {}).get("light_sleep")
        connection.send_result(msg["id"], {"pending": sleep.summary() if sleep else {}})

    @websocket_api.websocket_command({vol.Required("type"): f"{DOMAIN}/automations"})
    @callback
    def ws_automations(hass: HomeAssistant, connection: websocket_api.ActiveConnection, msg: dict) -> None:
        """AUTO-2 of the audit: the automations that touch devices, read-only (name, description, enabled, last run, references)."""
        try:
            connection.send_result(msg["id"], automation_rows(hass))
        except Exception as err:  # never break the panel over a listing
            _LOGGER.warning("automation listing failed: %s", err)
            connection.send_result(msg["id"], [])

    @websocket_api.websocket_command({vol.Required("type"): f"{DOMAIN}/feeder/log", vol.Required("entity_id"): str, vol.Optional("fresh", default=False): bool})
    @websocket_api.async_response
    async def ws_feeder_log(hass: HomeAssistant, connection: websocket_api.ActiveConnection, msg: dict) -> None:
        """The pet feeder's journal, eaten grams and desiccant from Xiaomi's cloud, read-only; null when there are none."""
        try:
            if not connection.user.permissions.check_entity(msg["entity_id"], "read"):
                connection.send_result(msg["id"], None)
                return
            connection.send_result(msg["id"], await feeder_log(hass, msg["entity_id"], msg["fresh"]))
        except Exception as err:  # never break the panel over a journal
            _LOGGER.warning("feeder journal failed: %s", err)
            connection.send_result(msg["id"], None)

    @websocket_api.websocket_command({vol.Required("type"): f"{DOMAIN}/air/tasks"})
    @callback
    def ws_air_tasks(hass: HomeAssistant, connection: websocket_api.ActiveConnection, msg: dict) -> None:
        """The «fix it» jobs of the Air card now running."""
        air: AirTasks | None = (_entry_data(hass) or {}).get("air_tasks")
        connection.send_result(msg["id"], air.summary() if air else [])

    @websocket_api.websocket_command({vol.Required("type"): f"{DOMAIN}/air/start", vol.Required("kind"): str, vol.Required("roomId"): str, vol.Required("device"): str, vol.Required("sensor"): str, vol.Optional("target"): vol.Coerce(float)})
    @websocket_api.async_response
    async def ws_air_start(hass: HomeAssistant, connection: websocket_api.ActiveConnection, msg: dict) -> None:
        """Run a device until the reading is normal. The target is the server's; the one the panel shows is only for display."""
        air: AirTasks | None = (_entry_data(hass) or {}).get("air_tasks")
        if not air:
            connection.send_error(msg["id"], "not_ready", "Atom Home is starting")
            return
        if not connection.user.permissions.check_entity(msg["device"], "control"):
            raise Unauthorized()
        try:
            await air.start(msg["kind"], msg["roomId"], msg["device"], msg["sensor"])
        except ValueError as err:
            connection.send_error(msg["id"], "invalid", str(err))
            return
        except Exception as err:  # the device refused: say so in the panel
            connection.send_error(msg["id"], "failed", str(err))
            return
        connection.send_result(msg["id"], air.summary())

    @websocket_api.websocket_command({vol.Required("type"): f"{DOMAIN}/air/stop", vol.Required("device"): str})
    @websocket_api.async_response
    async def ws_air_stop(hass: HomeAssistant, connection: websocket_api.ActiveConnection, msg: dict) -> None:
        air: AirTasks | None = (_entry_data(hass) or {}).get("air_tasks")
        if not connection.user.permissions.check_entity(msg["device"], "control"):
            raise Unauthorized()
        if air:
            await air.stop(msg["device"])
        connection.send_result(msg["id"], air.summary() if air else [])

    @websocket_api.websocket_command({vol.Required("type"): f"{DOMAIN}/alarms/state"})
    @callback
    def ws_alarms_state(hass: HomeAssistant, connection: websocket_api.ActiveConnection, msg: dict) -> None:
        sched = (_entry_data(hass) or {}).get("alarms")
        connection.send_result(msg["id"], sched.summary() if sched else {"count": 0, "next": [], "ringing": None, "repeatLeft": 0})

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
    websocket_api.async_register_command(hass, ws_capabilities)
    websocket_api.async_register_command(hass, ws_set)
    websocket_api.async_register_command(hass, ws_photo_set)
    websocket_api.async_register_command(hass, ws_photo_delete)
    websocket_api.async_register_command(hass, ws_alarms_set)
    websocket_api.async_register_command(hass, ws_alarm_stop)
    websocket_api.async_register_command(hass, ws_alarm_snooze)
    websocket_api.async_register_command(hass, ws_alarms_state)
    websocket_api.async_register_command(hass, ws_light_sleep)
    websocket_api.async_register_command(hass, ws_light_sleep_state)
    websocket_api.async_register_command(hass, ws_automations)
    websocket_api.async_register_command(hass, ws_feeder_log)
    websocket_api.async_register_command(hass, ws_air_tasks)
    websocket_api.async_register_command(hass, ws_air_start)
    websocket_api.async_register_command(hass, ws_air_stop)
