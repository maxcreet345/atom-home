"""Atom Home — universal household panel for Home Assistant.

Registers a custom sidebar panel served from this integration's `frontend/` folder and a small
WebSocket API that stores the house configuration (which devices to show, names, rooms, buttons)
in Home Assistant's `.storage`. Reading is open to every signed-in user; writing requires an admin.
"""
from __future__ import annotations

import json
import logging
from pathlib import Path

import voluptuous as vol
from homeassistant.components import panel_custom, websocket_api
from homeassistant.components.http import StaticPathConfig
from homeassistant.config_entries import ConfigEntry
from homeassistant.core import HomeAssistant, callback
from homeassistant.helpers.storage import Store

from .const import (
    DOMAIN, FRONTEND_FILE, MAX_CONFIG_BYTES, PANEL_ICON, PANEL_TITLE, PANEL_URL_PATH, STATIC_URL, STORAGE_KEY, STORAGE_VERSION,
)

_LOGGER = logging.getLogger(__name__)
FRONTEND_DIR = Path(__file__).parent / "frontend"


def _version() -> str:
    try:
        return json.loads((Path(__file__).parent / "manifest.json").read_text(encoding="utf-8")).get("version", "0")
    except (OSError, ValueError):
        return "0"


async def async_setup(hass: HomeAssistant, config: dict) -> bool:
    """YAML setup is not used; everything happens in the config entry."""
    return True


async def async_setup_entry(hass: HomeAssistant, entry: ConfigEntry) -> bool:
    store: Store[dict] = Store(hass, STORAGE_VERSION, STORAGE_KEY)
    data = await store.async_load() or {}
    version = await hass.async_add_executor_job(_version)
    hass.data.setdefault(DOMAIN, {})[entry.entry_id] = {"store": store, "config": data.get("config")}
    hass.data[DOMAIN]["_version"] = version

    await hass.http.async_register_static_paths([StaticPathConfig(STATIC_URL, str(FRONTEND_DIR), cache_headers=False)])
    await panel_custom.async_register_panel(
        hass,
        webcomponent_name="atom-home-panel",
        frontend_url_path=PANEL_URL_PATH,
        sidebar_title=PANEL_TITLE,
        sidebar_icon=PANEL_ICON,
        module_url=f"{STATIC_URL}/{FRONTEND_FILE}?v={version}",
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

    websocket_api.async_register_command(hass, ws_get)
    websocket_api.async_register_command(hass, ws_set)
