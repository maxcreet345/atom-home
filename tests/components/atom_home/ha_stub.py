"""Stand-ins for the few Home Assistant helpers the integration imports, so its real modules run under plain python3.

Used by the test_*.py scripts beside it (python3 tests/components/atom_home/test_alarms.py). Where the real Home Assistant
is installed (the pytest harness of tests/README.md) nothing is replaced and those scripts are skipped.
The clock, the timers, the state listeners and the storage live in one `World`; a test moves the clock itself.
"""
import asyncio
import importlib
import importlib.util
import json
import os
import pathlib
import sys
import types
import unittest
from datetime import datetime, timedelta, timezone

# ATOM_HOME_SRC points the scripts at another copy of the integration (an older release, to see a check fail there).
SRC = pathlib.Path(os.environ.get("ATOM_HOME_SRC") or pathlib.Path(__file__).parents[3] / "custom_components/atom_home")
TZ = timezone(timedelta(hours=2))
PACKAGE = "atom_home_under_test"


class State:
    def __init__(self, state, **attributes):
        self.state, self.attributes = state, attributes


class Unauthorized(Exception):
    def __init__(self, entity_id=None, **_kw):
        super().__init__(entity_id)
        self.entity_id = entity_id


class World:
    """One Home Assistant: its clock, what is scheduled, what listens, what is stored, what was called."""

    def __init__(self, now=None, running=True, **states):
        self.now = now or datetime(2026, 11, 10, 6, 0, 0, tzinfo=TZ)  # a Tuesday
        self.time_zone = self.now.tzinfo  # HA's configured zone does not change when a callback receives a UTC instant
        self.running, self.timers, self.listeners, self.started, self.sleepers = running, [], [], [], []
        self.stored, self.calls, self.tasks, self.refuse, self.issues = {}, [], [], set(), {}
        self.map = {k.replace("__", "."): v if isinstance(v, State) else State(v) for k, v in states.items()}
        self.states = types.SimpleNamespace(get=lambda entity_id: self.map.get(entity_id))
        self.services = types.SimpleNamespace(async_call=self._call)
        self.data = {}

    # ---- what the integration sees as `hass` ------------------------------------------------------------------------
    async def _call(self, domain, service, data, blocking=False, context=None, **_kw):
        name = f"{domain}.{service}"
        if name in self.refuse or domain in self.refuse:
            raise RuntimeError(f"ServiceNotFound: {name}")
        self.calls.append((self.now.strftime("%d %H:%M:%S"), name, dict(data), context))
        entity_id = data.get("entity_id")
        if name == "input_boolean.turn_on":
            self.set(entity_id, "on")
        elif name == "input_boolean.turn_off":
            self.set(entity_id, "off")
        elif name == "input_text.set_value":
            limit = getattr(self.map.get(entity_id), "attributes", {}).get("max", 255)
            if len(data["value"]) > limit:
                raise RuntimeError("value too long")
            self.map[entity_id] = State(data["value"], **getattr(self.map.get(entity_id), "attributes", {}))
        elif service == "turn_off" and entity_id in self.map:
            self.set(entity_id, "off")

    def async_create_task(self, coro):
        task = asyncio.ensure_future(coro)
        self.tasks.append(task)
        return task

    def async_create_background_task(self, coro, name=None):
        return self.async_create_task(coro)

    async def async_add_executor_job(self, func, *args):
        return await asyncio.get_event_loop().run_in_executor(None, func, *args)

    # ---- what a test does -------------------------------------------------------------------------------------------
    def named(self, name):
        return [c for c in self.calls if c[1] == name]

    def set(self, entity_id, state):
        """A state change, with the event to whoever listens (None removes the entity)."""
        old = self.map.get(entity_id)
        if state is None:
            self.map.pop(entity_id, None)
        else:
            self.map[entity_id] = State(state, **(old.attributes if old else {}))
        event = types.SimpleNamespace(data={"entity_id": entity_id, "old_state": old, "new_state": self.map.get(entity_id)})
        for row in [r for r in self.listeners if r[2] and entity_id in r[0]]:
            row[1](event)

    async def settle(self):
        """Let every task run as far as it can (a sunrise stays asleep until the clock is moved)."""
        for _ in range(25):
            await asyncio.sleep(0)
        self.tasks = [t for t in self.tasks if not t.done()]

    async def start(self):
        """EVENT_HOMEASSISTANT_STARTED."""
        self.running = True
        for row in [r for r in self.started if r[1]]:
            row[1] = False
            result = row[0](self)
            if asyncio.iscoroutine(result):
                await result
        await self.settle()

    async def advance(self, to=None, **delta):
        """Move the clock, firing every timer and waking every sleeper on the way, in order."""
        to = to or self.now + timedelta(**delta)
        while True:
            due = [(r[0], 0, i) for i, r in enumerate(self.timers) if r[2] and r[0] <= to] + [(s[0], 1, i) for i, s in enumerate(self.sleepers) if not s[1].done() and s[0] <= to]
            if not due:
                break
            at, kind, i = min(due)
            self.now = max(self.now, at)
            if kind == 0:
                self.timers[i][2] = False
                self.timers[i][1](self.now)
            else:
                self.sleepers[i][1].set_result(None)
            await self.settle()
        self.now = to
        await self.settle()

    def live_timers(self):
        return sorted(r[0] for r in self.timers if r[2])

    async def sleep(self, seconds):
        future = asyncio.get_event_loop().create_future()
        self.sleepers.append((self.now + timedelta(seconds=seconds), future))
        await future


world = None  # the World the stubs act on; a test sets it with `use`


def use(new_world):
    global world
    world = new_world
    return new_world


def _point_in_time(_hass, action, at):
    row = [at, action, True]
    world.timers.append(row)
    return lambda: row.__setitem__(2, False)


def _call_later(_hass, seconds, action):
    return _point_in_time(_hass, action, world.now + timedelta(seconds=seconds))


def _state_change(_hass, entity_ids, action):
    row = [list(entity_ids), action, True]
    world.listeners.append(row)
    return lambda: row.__setitem__(2, False)


def _at_started(hass, action):
    row = [action, True]
    if world.running:
        row[1] = False
        result = action(hass)
        if asyncio.iscoroutine(result):
            hass.async_create_task(result)
    else:
        world.started.append(row)
    return lambda: row.__setitem__(1, False)


class _Store:
    def __init__(self, _hass, _version, key):
        self.key = key

    def __class_getitem__(cls, _item):
        return cls

    async def async_load(self):
        return world.stored.get(self.key)

    async def async_save(self, data):
        world.stored[self.key] = json.loads(json.dumps(data))

    async def async_remove(self):
        world.stored.pop(self.key, None)


def _parse(text):
    try:
        return datetime.fromisoformat(text)
    except ValueError:
        return None


def _module(name, **attrs):
    module = types.ModuleType(name)
    module.__dict__.update(attrs)
    sys.modules[name] = module
    return module


def install():
    """Put the stand-ins in place and return the integration as a package whose modules import normally."""
    if PACKAGE in sys.modules:
        return sys.modules[PACKAGE]
    if importlib.util.find_spec("homeassistant") is not None:
        raise unittest.SkipTest("the real Home Assistant is installed: these scripts are for a machine without it")
    identity = lambda f: f  # noqa: E731
    _module("homeassistant", config_entries=_module("homeassistant.config_entries", ConfigEntry=object))
    _module("homeassistant.core", HomeAssistant=object, callback=identity)
    _module("homeassistant.exceptions", Unauthorized=Unauthorized)
    helpers = _module("homeassistant.helpers")
    _module("homeassistant.helpers.event", async_track_point_in_time=_point_in_time, async_track_state_change_event=_state_change, async_call_later=_call_later)
    _module("homeassistant.helpers.start", async_at_started=_at_started)
    _module("homeassistant.helpers.storage", Store=_Store)
    helpers.issue_registry = _module(
        "homeassistant.helpers.issue_registry", IssueSeverity=types.SimpleNamespace(WARNING="warning"),
        async_create_issue=lambda hass, domain, issue, **kw: world.issues.__setitem__(issue, kw),
        async_delete_issue=lambda hass, domain, issue: world.issues.pop(issue, None),
    )
    util = _module("homeassistant.util")
    util.dt = _module("homeassistant.util.dt", now=lambda: world.now, parse_datetime=_parse,
                      as_local=lambda d: d.astimezone(world.time_zone if world is not None else TZ))
    package = types.ModuleType(PACKAGE)
    package.__path__ = [str(SRC)]
    sys.modules[PACKAGE] = package
    return package


def load(name):
    install()
    return importlib.import_module(f"{PACKAGE}.{name}")


def run(coro):
    loop = asyncio.new_event_loop()
    try:
        return loop.run_until_complete(coro)
    finally:
        loop.close()


# ---- the whole integration: its HTTP views and WebSocket commands ------------------------------------------------------
class Response:
    """aiohttp's web.Response, as far as the views use it."""

    def __init__(self, body=None, text=None, status=200, headers=None, content_type=None, charset=None):
        self.body, self.text, self.status, self.headers, self.content_type = body, text, status, dict(headers or {}), content_type


class Request:
    def __init__(self, hass, headers=None, query=None):
        self.app, self.headers, self.query = {"hass": hass}, dict(headers or {}), dict(query or {})


class Key(str):
    """vol.Required / vol.Optional: the key itself, so a schema is a plain dict a test can read."""


class Rule:
    def __init__(self, kind, *args, **kw):
        self.kind, self.args, self.kw = kind, args, kw


class Connection:
    """One signed-in user's socket: what it may do and what it was answered."""

    def __init__(self, admin=False, deny=()):
        self.deny, self.results, self.errors, self.subscriptions = set(deny), [], [], {}
        self.user = types.SimpleNamespace(is_admin=admin, name="admin" if admin else "daniela", permissions=types.SimpleNamespace(check_entity=lambda entity_id, _perm: entity_id not in self.deny))

    def send_result(self, _id, result=None):
        self.results.append(result)

    def send_error(self, _id, code, message):
        self.errors.append((code, message))

    def context(self, _msg):
        return f"context of {self.user.name}"

    def close(self):
        """The socket closes: Home Assistant calls everything left in `subscriptions`."""
        for unsub in self.subscriptions.values():
            unsub()


COMMANDS = {}  # type → handler, as websocket_api.async_register_command got them


def _command(schema):
    def mark(func):
        func.schema = {str(k): v for k, v in schema.items()}
        return func
    return mark


def _require_admin(func):
    def guarded(hass, connection, msg):
        if not connection.user.is_admin:
            raise Unauthorized()
        return func(hass, connection, msg)
    guarded.admin_only = True
    return guarded


def _register(_hass, func):
    COMMANDS[func.schema["type"]] = func


async def send(connection, **msg):
    """One WebSocket message to the integration; the answer lands on the connection."""
    result = COMMANDS[msg["type"]](world, connection, {"id": 1, **msg})
    if asyncio.iscoroutine(result):
        await result
    await world.settle()
    return connection


def install_surface():
    """The integration's own __init__ on top of `install`: Home Assistant's web side and voluptuous are stood in for."""
    name = "atom_home_surface"
    if name in sys.modules:
        return sys.modules[name]
    install()
    identity = lambda f: f  # noqa: E731
    if importlib.util.find_spec("voluptuous") is None:
        _module("voluptuous", Required=lambda key, **kw: Key(key), Optional=lambda key, **kw: Key(key), All=lambda *a: Rule("all", *a), Range=lambda **kw: Rule("range", **kw), In=lambda container: Rule("in", container), Coerce=lambda kind: Rule("coerce", kind))
    if importlib.util.find_spec("aiohttp") is None:
        web = _module("aiohttp.web", Response=Response, Request=Request, StreamResponse=Response, json_response=lambda data, headers=None: Response(body=data, headers=headers, content_type="application/json"))
        _module("aiohttp", web=web)
    websocket_api = _module("homeassistant.components.websocket_api", websocket_command=_command, require_admin=_require_admin, async_response=identity, ActiveConnection=Connection, async_register_command=_register)
    frontend = _module("homeassistant.components.frontend", async_remove_panel=lambda hass, path: world.data.setdefault("_removed_panels", []).append(path))

    async def register_panel(hass, **kw):
        world.data.setdefault("_panels", []).append(kw)
    panel_custom = _module("homeassistant.components.panel_custom", async_register_panel=register_panel)
    _module("homeassistant.components.http", HomeAssistantView=object, StaticPathConfig=lambda url, path, cache_headers: (url, path, cache_headers))
    _module("homeassistant.components", frontend=frontend, panel_custom=panel_custom, websocket_api=websocket_api)
    sys.modules["homeassistant.helpers"].entity_registry = _module("homeassistant.helpers.entity_registry", EVENT_ENTITY_REGISTRY_UPDATED="entity_registry_updated", async_get=lambda hass: types.SimpleNamespace(async_get=lambda entity_id: None))
    spec = importlib.util.spec_from_file_location(name, SRC / "__init__.py", submodule_search_locations=[str(SRC)])
    module = importlib.util.module_from_spec(spec)
    sys.modules[name] = module
    spec.loader.exec_module(module)
    return module


def house(tmp, **kw):
    """A World with what async_setup_entry asks of `hass` beyond states and services."""
    w = use(World(**kw))
    w.views, w.static = [], []

    async def static_paths(paths):
        w.static.extend(paths)
    w.http = types.SimpleNamespace(async_register_static_paths=static_paths, register_view=w.views.append)
    w.config = types.SimpleNamespace(path=lambda *parts: str(pathlib.Path(tmp).joinpath(*parts)))
    w.bus = types.SimpleNamespace(async_listen=lambda event, listener: (lambda: None))
    return w
