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
from homeassistant.components import frontend, panel_custom, websocket_api
from homeassistant.components.http import HomeAssistantView, StaticPathConfig
from homeassistant.config_entries import ConfigEntry
from homeassistant.core import HomeAssistant, callback
from homeassistant.exceptions import Unauthorized
from homeassistant.helpers import issue_registry as ir
from homeassistant.helpers.start import async_at_started
from homeassistant.helpers.storage import Store
from aiohttp import web

from .light_sleep import MINUTES as SLEEP_MINUTES, LightSleep
from .automations import automation_rows
from .feeder import feeder_log
from .air_tasks import AirTasks
from .alarms import AlarmScheduler, normalise_alarms, switched_off
from .bundle import GzipCache, accepts_gzip, etag_matches, etag_of
from .config_state import ConfigState, ConfigWriteError
from .helpers_check import missing_helpers, short_helpers
from .const import (
    DOMAIN, FRONTEND_FILE, MAX_PHOTO_BYTES, PANEL_ICON, PANEL_TITLE, PANEL_URL_PATH, PHOTOS_DIR, PHOTOS_URL, STATIC_URL, STORAGE_KEY, STORAGE_VERSION,
)

_LOGGER = logging.getLogger(__name__)
FRONTEND_DIR = Path(__file__).parent / "frontend"


def _version() -> str:
    try:
        return json.loads((Path(__file__).parent / "manifest.json").read_text(encoding="utf-8")).get("version", "0")
    except (OSError, ValueError):
        return "0"


def _alarm_targets(alarm: dict) -> set[str]:
    """Only the targets the scheduler will actually command (even when the alarm is currently disabled)."""
    targets = set()
    if alarm.get("light") and alarm.get("lightEntity"):
        targets.add(alarm["lightEntity"])
    if alarm.get("alice") != "off" and alarm.get("station"):
        targets.add(alarm["station"])
    return targets


def _alarm_auth_update(user):
    """Validate changed records against the stored list while its write lock is held, and attribute them atomically."""
    def update(before: list, after: list, authors: dict) -> dict:
        previous = {a["id"]: a for a in normalise_alarms(before)}
        updated = {}
        for alarm in normalise_alarms(after):
            aid = alarm["id"]
            if previous.get(aid) == alarm:
                if aid in authors:
                    updated[aid] = authors[aid]
                continue
            targets = _alarm_targets(alarm)
            if not user.is_admin:
                for entity_id in targets:
                    if not user.permissions.check_entity(entity_id, "control"):
                        raise Unauthorized(entity_id=entity_id)
                if targets:
                    updated[aid] = {"user_id": getattr(user, "id", None)}
            # An admin's changed alarm is explicitly authorized as integration-owned, like legacy saved alarms.
        return updated
    return update


def _scheduled_alarms(state: ConfigState) -> list[dict]:
    """Attach server-only author snapshots; an active ring must retain its author if its saved row is later removed."""
    alarms = normalise_alarms((state.config or {}).get("alarms"))
    auth = state.alarm_auth
    if auth is None:
        return alarms
    authors = auth.get("authors")
    if auth.get("version") != 1 or not isinstance(authors, dict):
        return [{**alarm, "_author": None} for alarm in alarms]
    return [{**alarm, "_author": authors[alarm["id"]]} if alarm["id"] in authors else alarm for alarm in alarms]


# The version of the Python that runs, read once per run of Home Assistant. An update through HACS replaces manifest.json
# at once, but the modules in memory stay the old ones until a restart; a plain reload of the entry must go on answering
# with the old version, or the panel's «нужен перезапуск» note would go out while the old code still serves it.
_RUNNING_VERSION: str | None = None


BUNDLE_URL = "/atom_home/bundle.js"
LOADER_URL = "/atom_home/loader.js"
META_URL = "/atom_home/meta"
# The loader is what the panel registers as module_url. It asks the integration which bundle is current (a cache-busting query
# defeats proxies such as Cloudflare that rewrite Cache-Control) and imports the bundle under a URL unique to that build.
LOADER_JS = """// ST-1 of the audit of 04.11.2026: the panel element gets a skeleton before the bundle arrives (a copy of frontend/src/ui/skeleton.js).
const savedTheme = () => { try { return localStorage.getItem('atom-home-theme'); } catch (e) { return null; } }; // S2: the panel's own theme, left by the bundle on the previous load
// the words under the skeleton in the language the panel left on its previous load (frontend/src/ui/skeleton.js: LANG_KEY, SKELETON_TEXT), else Home Assistant's, else the browser's
const WAIT = { ru: 'Подключаемся к дому…', en: 'Connecting to the home…', ro: 'Ne conectăm la casă…' };
const savedLang = () => { const pick = v => { const l = String(v || '').replace(/"/g, '').slice(0, 2).toLowerCase(); return WAIT[l] ? l : null; }; try { return pick(localStorage.getItem('atom-home-lang')) || pick(localStorage.getItem('selectedLanguage')) || pick(navigator.language) || 'ru'; } catch (e) { return 'ru'; } };
const SKELETON = '<style>:host{display:block;position:relative;width:100%;height:100vh;height:100dvh;overflow:hidden}' + '.hm-skeleton{position:absolute;inset:0;display:flex;flex-direction:column;gap:16px;padding:20px 24px;background:#f2f2f6;color:#6b6b70;font:500 15px/1.4 -apple-system,system-ui,"Segoe UI",Roboto,sans-serif;overflow:hidden;box-sizing:border-box}.hm-skeleton-head{height:34px;width:42%;max-width:260px;border-radius:10px}.hm-skeleton-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(142px,1fr));gap:12px}.hm-skeleton-tile{aspect-ratio:1;border-radius:22px}.hm-skeleton .is-bone{background:linear-gradient(100deg,#e3e3ea 30%,#ededf2 50%,#e3e3ea 70%);background-size:200% 100%;animation:hm-shimmer 1.4s linear infinite}.hm-skeleton p{margin:auto 0 0;text-align:center}@keyframes hm-shimmer{to{background-position:-200% 0}}@media (max-width:599px){.hm-skeleton{padding:14px}.hm-skeleton-grid{grid-template-columns:repeat(3,minmax(0,1fr))}}@media (prefers-reduced-motion:reduce){.hm-skeleton .is-bone{animation:none}}.hm-skeleton.is-dark{background:#0f1016;color:#ffffffcc}.hm-skeleton.is-dark .is-bone{background:linear-gradient(100deg,#232430 30%,#2c2d3a 50%,#232430 70%);background-size:200% 100%}' + '</style>' + '<div class="hm-skeleton' + (savedTheme() === 'dark' ? ' is-dark' : '') + '" role="status" aria-busy="true" aria-live="polite"><div class="hm-skeleton-head is-bone"></div><div class="hm-skeleton-grid"><div class="hm-skeleton-tile is-bone"></div><div class="hm-skeleton-tile is-bone"></div><div class="hm-skeleton-tile is-bone"></div><div class="hm-skeleton-tile is-bone"></div><div class="hm-skeleton-tile is-bone"></div><div class="hm-skeleton-tile is-bone"></div><div class="hm-skeleton-tile is-bone"></div><div class="hm-skeleton-tile is-bone"></div></div><p>' + WAIT[savedLang()] + '</p></div>';
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
    return etag_of(path.stat())


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
        # Open to a browser that has not signed in yet (the loader runs before the panel has a token), so it says nothing
        # but which bundle is current: no version of the integration for a stranger to read.
        return web.json_response({"etag": etag}, headers={"Cache-Control": "no-store"})


class BundleView(HomeAssistantView):
    """The panel bundle with revalidation: browsers keep it cached but ask every time, so a HACS update
    (which replaces the file without a restart) reaches phones and tablets at the next page load.
    A megabyte of JavaScript goes out gzip-compressed to every client that accepts it (a quarter of the bytes on a phone
    away from home); the compressed copy is made once per build, in a thread."""

    url = BUNDLE_URL
    name = "atom_home:bundle"
    requires_auth = False

    def __init__(self) -> None:
        self._gzip = GzipCache()

    async def get(self, request: web.Request) -> web.StreamResponse:
        return await self._answer(request, body=True)

    async def head(self, request: web.Request) -> web.StreamResponse:
        """The same status and headers as GET without the file («curl -I», a proxy's or a monitor's check); Home Assistant
        registers only the methods a view has, so without this a HEAD was answered 405."""
        return await self._answer(request, body=False)

    async def _answer(self, request: web.Request, body: bool) -> web.StreamResponse:
        path, hass = FRONTEND_DIR / FRONTEND_FILE, request.app["hass"]
        try:
            stat = await hass.async_add_executor_job(path.stat)
        except OSError:
            return web.Response(status=404)
        etag = f'"{etag_of(stat)}"'
        if etag_matches(request.headers.get("If-None-Match"), etag):
            return web.Response(status=304, headers={"ETag": etag, "Cache-Control": "no-cache", "Vary": "Accept-Encoding"})
        headers = {"ETag": etag, "Vary": "Accept-Encoding", "Cache-Control": "public, max-age=31536000, immutable" if request.query.get("e") == etag.strip('"') else "no-cache"}
        if not body:  # nothing is read or compressed for a question about the headers
            if accepts_gzip(request.headers.get("Accept-Encoding")):
                headers["Content-Encoding"] = "gzip"
            return web.Response(status=200, content_type="text/javascript", charset="utf-8", headers=headers)
        try:
            if accepts_gzip(request.headers.get("Accept-Encoding")):
                body = await self._gzip.get(hass.async_add_executor_job, path, etag)
                headers["Content-Encoding"] = "gzip"
            else:
                body = await hass.async_add_executor_job(path.read_bytes)
        except OSError:
            return web.Response(status=404)
        return web.Response(body=body, content_type="text/javascript", charset="utf-8", headers=headers)


async def async_setup(hass: HomeAssistant, config: dict) -> bool:
    """YAML setup is not used; everything happens in the config entry."""
    return True


async def async_setup_entry(hass: HomeAssistant, entry: ConfigEntry) -> bool:
    store: Store[dict] = Store(hass, STORAGE_VERSION, STORAGE_KEY)
    data = await store.async_load() or {}
    global _RUNNING_VERSION
    if _RUNNING_VERSION is None:
        _RUNNING_VERSION = await hass.async_add_executor_job(_version)
    version = _RUNNING_VERSION
    state = ConfigState(data.get("config"), data.get("revision", 0), store.async_save,
                        **({"alarm_auth": data["alarm_auth"]} if "alarm_auth" in data else {}))

    async def alarm_authorized(alarm: dict) -> bool:
        """Use the current author's permissions at execution, including after a restart or account removal."""
        if "_author" not in alarm:
            return True  # backward-compatible integration-owned legacy/admin alarms
        author = alarm["_author"]
        user_id = author.get("user_id") if isinstance(author, dict) else None
        if not isinstance(user_id, str) or not user_id:
            return False
        user = await hass.auth.async_get_user(user_id)
        return bool(user and user.is_active and all(user.permissions.check_entity(target, "control") for target in _alarm_targets(alarm)))

    async def alarm_rang_once(alarm_id: str) -> None:
        """An alarm with no weekdays has rung: store it switched off, so that it is «один раз» after a restart too and the panel shows it off."""
        try:
            await state.write_alarms(switched_off(alarm_id))
        except ConfigWriteError as err:
            _LOGGER.error("Atom Home: the alarm %s rang once and could not be stored switched off (%s); it stays off until a restart", alarm_id, err.code, exc_info=err.__cause__)

    scheduler = AlarmScheduler(hass, alarm_rang_once, authorize=alarm_authorized)
    scheduler.set_alarms(_scheduled_alarms(state))
    scheduler.start()  # a ringing flag restored across the restart is stale; cleared once HA is up
    sleep = LightSleep(hass)
    await sleep.async_load()
    air_tasks = AirTasks(hass)
    await air_tasks.async_load()

    @callback
    def check_helpers(_hass: HomeAssistant | None = None) -> None:
        """Once HA is up (before that the helpers may not be loaded): a missing or too short helper goes to «Исправления»."""
        for issue, found in (("missing_helpers", missing_helpers(hass.states.get)), ("short_helpers", short_helpers(hass.states.get))):
            if found:
                ir.async_create_issue(hass, DOMAIN, issue, is_fixable=False, severity=ir.IssueSeverity.WARNING, translation_key=issue, translation_placeholders={"helpers": ", ".join(found)})
            else:
                ir.async_delete_issue(hass, DOMAIN, issue)

    hass.data.setdefault(DOMAIN, {})[entry.entry_id] = {"air_tasks": air_tasks, "store": store, "state": state, "alarms": scheduler, "light_sleep": sleep, "helpers_unsub": async_at_started(hass, check_helpers)}
    hass.data[DOMAIN]["_version"] = version

    photos_dir = Path(hass.config.path(PHOTOS_DIR))
    await hass.async_add_executor_job(lambda: photos_dir.mkdir(parents=True, exist_ok=True))
    hass.data[DOMAIN]["_photos_dir"] = photos_dir
    has_assets = await hass.async_add_executor_job((FRONTEND_DIR / "assets").is_dir)
    if not hass.data[DOMAIN].get("_http_registered"):  # the server takes a path or a view once per run, and a reload comes back here
        await hass.http.async_register_static_paths([
            # the pictures of the build carry a hash in their names: they may be kept for good (PERF-6); listed first, the longer path wins
            *([StaticPathConfig(f"{STATIC_URL}/assets", str(FRONTEND_DIR / "assets"), cache_headers=True)] if has_assets else []),
            StaticPathConfig(STATIC_URL, str(FRONTEND_DIR), cache_headers=False),
            StaticPathConfig(PHOTOS_URL, str(photos_dir), cache_headers=True),
        ])
        hass.http.register_view(BundleView())
        hass.http.register_view(LoaderView())
        hass.http.register_view(MetaView())
        hass.data[DOMAIN]["_http_registered"] = True
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
    frontend.async_remove_panel(hass, PANEL_URL_PATH)
    bucket = hass.data.get(DOMAIN, {}).pop(entry.entry_id, None) or {}
    if (sched := bucket.get("alarms")):
        await sched.async_shutdown()
    if (air := bucket.get("air_tasks")):
        await air.async_unload()
        if entry.disabled_by:  # nothing will load the jobs again to stop them; a reload keeps them. After unload, so its own listeners do not write the file back
            await air.async_remove()
    if (sleep := bucket.get("light_sleep")):
        sleep.shutdown()
    if (unsub := bucket.get("helpers_unsub")):
        unsub()
    for issue in ("missing_helpers", "short_helpers"):  # nothing reads the helpers any more; a reload judges them afresh
        ir.async_delete_issue(hass, DOMAIN, issue)
    return True


async def async_remove_entry(hass: HomeAssistant, entry: ConfigEntry) -> None:
    """Unload keeps the air jobs for the next load; removal is final."""
    await AirTasks(hass).async_remove()


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
        if state is None:
            # The entry is being reloaded (or is switched off): there is nothing to read at this moment. «config: null,
            # revision: 0» here was taken by the panel for a house with no settings, and it showed the factory set as real.
            # An error makes it keep what it has and read again (runtime/loader.ts), like the two save commands below.
            connection.send_error(msg["id"], "not_loaded", "Atom Home is not set up")
            return
        connection.send_result(msg["id"], {"config": state.config, "revision": state.revision, "version": hass.data[DOMAIN].get("_version", "0"), "admin": connection.user.is_admin})

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
            revision = await state.write(msg["config"], msg.get("expected_revision"), msg.get("client_features"), alarm_auth_update=_alarm_auth_update(connection.user))
        except ConfigWriteError as err:
            if err.code == "save_failed":
                _LOGGER.error("Atom Home: configuration could not be written", exc_info=err.__cause__)
            connection.send_error(msg["id"], err.code, err.message)
            return
        if (sched := (_entry_data(hass) or {}).get("alarms")):
            sched.set_alarms(_scheduled_alarms(state))
        connection.send_result(msg["id"], {"saved": True, "revision": revision})

    # Per socket: the revision whose alarms that panel holds from the answer to its own alarm save. Such an answer does not
    # always carry a revision for the panel to keep (see below), and without this its second alarm in a row would be refused.
    alarms_seen: dict[int, int] = {}

    def saw_alarms(connection: websocket_api.ActiveConnection, revision: int) -> None:
        key = id(connection)
        if key not in alarms_seen:
            connection.subscriptions[f"{DOMAIN}/alarms/seen"] = lambda: alarms_seen.pop(key, None)  # forgotten when the socket closes
        alarms_seen[key] = revision

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
        try:
            # Only `alarms` changes: every other stored field is kept, whatever this panel's copy of it is.
            revision, current, alarms = await state.write_alarms(lambda _stored: alarms, msg.get("expected_revision"), alarms_seen.get(id(connection)), alarm_auth_update=_alarm_auth_update(connection.user))
        except ConfigWriteError as err:
            if err.code == "save_failed":
                _LOGGER.error("Atom Home: the alarms could not be written", exc_info=err.__cause__)
            connection.send_error(msg["id"], err.code, err.message)
            return
        saw_alarms(connection, revision)
        if (sched := bucket.get("alarms")):
            sched.set_alarms(_scheduled_alarms(state))
        result = {"saved": True, "alarms": alarms}
        if current:  # a panel whose copy of the rest is older keeps its old revision: its next config/set is refused and it reads afresh
            result["revision"] = revision
        connection.send_result(msg["id"], result)

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

    @websocket_api.websocket_command({vol.Required("type"): f"{DOMAIN}/light/sleep", vol.Required("entity_id"): str, vol.Required("minutes"): vol.In((0,) + SLEEP_MINUTES)})
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
        if not connection.user.permissions.check_entity(msg["entity_id"], "control"):
            raise Unauthorized(entity_id=msg["entity_id"])
        try:
            at = await sleep.schedule(msg["entity_id"], msg["minutes"], context=connection.context(msg))
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
            await air.start(msg["kind"], msg["roomId"], msg["device"], msg["sensor"], context=connection.context(msg))
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
        if not air:
            connection.send_error(msg["id"], "not_ready", "Atom Home is starting")
            return
        try:
            await air.stop(msg["device"], context=connection.context(msg))
        except ValueError as err:
            connection.send_error(msg["id"], "invalid", str(err))
            return
        except Exception as err:  # the device refused: the job stays and keeps trying, and the panel says so
            connection.send_error(msg["id"], "failed", str(err))
            return
        connection.send_result(msg["id"], air.summary())

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
        if msg["url"] != f"{PHOTOS_URL}/{name}" or not PHOTO_NAME.fullmatch(name):
            connection.send_error(msg["id"], "bad_url", "not an Atom Home photo")
            return
        state: ConfigState | None = (_entry_data(hass) or {}).get("state")
        if state is None:
            connection.send_error(msg["id"], "not_loaded", "Atom Home is not set up")
            return
        target = hass.data[DOMAIN]["_photos_dir"] / name

        def _remove() -> bool:
            if target.exists():
                target.unlink()
                return True
            return False

        removed = await state.remove_unreferenced(msg["url"], lambda: hass.async_add_executor_job(_remove))
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
