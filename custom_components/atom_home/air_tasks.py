"""«Fix it» jobs of the Air card: a device runs until a reading is back to normal, then stops by itself.

The panel's button («Убрать влагу») asks for a job; this module keeps it in HA, so it finishes with every panel closed and
survives a restart. A job ends when the reading reaches its target, after an hour at the latest, on «Stop», or when someone
switches the device off by hand. A device that was already on before the job is left on. A device that is away when the job
ends is not forgotten: the job waits for it and switches it off when it is back, because HA skips an unavailable entity
without an error. Nothing is created in HA's configuration; the targets live here, the panel cannot choose them.
"""
from __future__ import annotations

import logging
import re
import time
from typing import Any, Callable

try:
    from homeassistant.core import callback
except ImportError:  # plain unittest: HA's own decorator only sets this mark
    def callback(func):
        func._hass_callback = True
        return func

_LOGGER = logging.getLogger(__name__)
STORAGE_KEY = "atom_home.air_tasks"
STORAGE_VERSION = 1
MAX_SECONDS = 3600
RETRY_SECONDS = 60
KINDS = ("dehumidify", "purify")


def target_for(kind: str, month: int) -> int:
    """Where the job stops. Heating season: outdoor air is dry once warm, 60 % is within reach. May to September it brings 60-66 % itself, so 65 %."""
    if kind == "purify":
        return 15
    return 65 if 5 <= month <= 9 else 60


# the room's vent: any fan but a purifier, or a relay that says so as a whole word («prevent» on a feeder is not a vent, nor is the hood's light or the relay's child lock)
DEVICE_RE = re.compile(r"(?:fan\.(?!.*(?:purifier|airp))[a-z0-9_]+|switch\.(?!(?:.*_)?(?:light|lamp|led|lock|indicator|mode|backlight)(?:_|$))(?:[a-z0-9]+_)*(?:vent|ventilation|exhaust|hood|vytiazhka|vytiazh)(?:_[a-z0-9]+)*)")
SENSOR_RE = re.compile(r"sensor\.[a-z0-9_]+")
ROOM_RE = re.compile(r"[a-z0-9_]{1,64}")


def reached(kind: str, value: Any, target: float) -> bool:
    """Is the reading back to normal? An unavailable or non-numeric reading is not: the job waits or runs out its hour."""
    try:
        number = float(value)
    except (TypeError, ValueError):
        return False
    if number != number or number in (float("inf"), float("-inf")):
        return False
    return number <= target


def check(kind: Any, device: Any, sensor: Any, room: Any) -> None:
    """Refuse anything the panel has no business asking for."""
    if kind not in KINDS:
        raise ValueError("unknown kind")
    if not isinstance(device, str) or not DEVICE_RE.fullmatch(device):
        raise ValueError("bad device")
    if not isinstance(sensor, str) or not SENSOR_RE.fullmatch(sensor):
        raise ValueError("bad sensor")
    if not isinstance(room, str) or not ROOM_RE.fullmatch(room):
        raise ValueError("bad room")


class AirTasks:
    """Running jobs per device. The clock and the HA helpers are injected so the logic runs under plain unittest."""

    def __init__(self, hass: Any, store: Any = None, track_state: Callable | None = None, call_later: Callable | None = None, now: Callable[[], float] = time.time, at_started: Callable | None = None, month: Callable[[], int] | None = None, category: Callable[[str], Any] | None = None) -> None:
        if store is None:
            from homeassistant.helpers import entity_registry as er
            from homeassistant.helpers.event import async_call_later, async_track_state_change_event
            from homeassistant.helpers.start import async_at_started
            from homeassistant.helpers.storage import Store
            from homeassistant.util import dt as dt_util

            def registry_category(entity_id: str) -> Any:
                entry = er.async_get(hass).async_get(entity_id)
                return entry.entity_category if entry else None

            store, track_state, call_later, at_started = Store(hass, STORAGE_VERSION, STORAGE_KEY), async_track_state_change_event, async_call_later, async_at_started
            month, category = (lambda: dt_util.now().month), registry_category  # the house's own calendar, as the panel's
        self.hass, self.store, self._track, self._later, self._now, self._at_started = hass, store, track_state, call_later, now, at_started
        self._month = month or (lambda: time.localtime(now()).tm_mon)
        self._category = category or (lambda _entity: None)
        self.jobs: dict[str, dict[str, Any]] = {}
        self._unsub: dict[str, list[Callable[[], None]]] = {}
        self._cancel_started: Callable[[], None] | None = None

    def summary(self) -> list[dict[str, Any]]:
        return [{"kind": j["kind"], "roomId": j["roomId"], "device": j["device"], "sensor": j["sensor"], "target": j["target"], "startedAt": int(j["startedAt"] * 1000)} for j in self.jobs.values() if not j.get("stopping")]

    async def async_load(self) -> None:
        """Take the jobs back. They are judged once HA is up: before that a device may not exist yet and a command to it would do nothing."""
        data = await self.store.async_load() or {}
        for raw in data.get("jobs") or []:
            try:
                check(raw.get("kind"), raw.get("device"), raw.get("sensor"), raw.get("roomId"))
                job = {"kind": raw["kind"], "roomId": raw["roomId"], "device": raw["device"], "sensor": raw["sensor"], "target": int(raw["target"]), "startedAt": float(raw["startedAt"]), "wasOn": bool(raw.get("wasOn")), "stopping": bool(raw.get("stopping"))}
            except (ValueError, TypeError, KeyError):
                continue
            self.jobs[job["device"]] = job
            self._arm(job)
        if self.jobs and self._at_started:
            self._cancel_started = self._at_started(self.hass, self._review)

    async def _review(self, _hass: Any = None) -> None:
        self._cancel_started = None
        for device, job in list(self.jobs.items()):
            state, sensor = self.hass.states.get(device), self.hass.states.get(job["sensor"])
            if state is None:
                self._drop(device)  # HA is up and has no such device any more
            elif job["stopping"] or self._now() - job["startedAt"] >= MAX_SECONDS or (sensor and reached(job["kind"], sensor.state, job["target"])):
                await self._finish(device, switch_off=True)
            elif state.state == "off":
                self._drop(device)  # it went off while HA was down
        await self._save()

    async def start(self, kind: str, room: str, device: str, sensor: str) -> None:
        check(kind, device, sensor, room)
        running = self.jobs.get(device)
        if running is not None:
            if running["kind"] == kind and not running["stopping"]:
                return  # a double tap, or another panel was first
            raise ValueError("device busy")
        if self._category(device):
            raise ValueError("bad device")  # a device's setting, not the device
        state, reading = self.hass.states.get(device), self.hass.states.get(sensor)
        if state is None or state.state in ("unavailable", "unknown"):
            raise ValueError("device offline")  # «unknown» would lose whether it was on before
        target = target_for(kind, self._month())
        if reading is not None and reached(kind, reading.state, target):
            return  # nothing to fix any more
        was_on = state.state == "on"
        job = {"kind": kind, "roomId": room, "device": device, "sensor": sensor, "target": target, "startedAt": self._now(), "wasOn": was_on, "stopping": False}
        self.jobs[device] = job  # taken before waiting for the device: a second press sees it
        if not was_on:
            try:
                await self.hass.services.async_call("homeassistant", "turn_on", {"entity_id": device}, blocking=True)
            except Exception:
                if self.jobs.get(device) is job:
                    del self.jobs[device]
                raise
            if self.jobs.get(device) is not job:
                return  # «Stop» came while the device was starting
        self._arm(job)
        await self._save()

    async def stop(self, device: str) -> None:
        if device in self.jobs:
            await self._finish(device, switch_off=True)

    def unload(self) -> None:
        if self._cancel_started:
            self._cancel_started()
            self._cancel_started = None
        for device in list(self._unsub):
            self._disarm(device)

    def _disarm(self, device: str) -> None:
        for unsub in self._unsub.pop(device, []):
            unsub()

    def _arm(self, job: dict[str, Any]) -> None:
        device, sensor = job["device"], job["sensor"]
        self._disarm(device)

        @callback
        def changed(event: Any) -> None:
            entity, new = event.data.get("entity_id"), event.data.get("new_state")
            if new is None or new.state == "unavailable":
                return  # a blip or a restart says nothing about the job; the hour goes on
            if entity == device:
                if job["stopping"]:
                    self.hass.async_create_task(self._finish(device, switch_off=True))  # it is back: now it can be switched off
                elif new.state == "off":
                    self.hass.async_create_task(self._finish(device, switch_off=False))  # switched off by hand: nothing more to do
            elif entity == sensor and not job["stopping"] and reached(job["kind"], new.state, job["target"]):
                self.hass.async_create_task(self._finish(device, switch_off=True))

        @callback
        def out_of_time(_now: Any) -> None:
            self.hass.async_create_task(self._finish(device, switch_off=True))

        left = RETRY_SECONDS if job["stopping"] else max(1.0, MAX_SECONDS - (self._now() - job["startedAt"]))
        self._unsub[device] = [self._track(self.hass, [device, sensor], changed), self._later(self.hass, left, out_of_time)]

    def _drop(self, device: str) -> None:
        self.jobs.pop(device, None)
        self._disarm(device)

    async def _hold(self, job: dict[str, Any]) -> None:
        """The device could not be switched off now: keep the job until it can."""
        if self.jobs.get(job["device"]) is not job:
            return
        first = not job["stopping"]
        job["stopping"] = True
        self._arm(job)
        if first:
            await self._save()

    async def _finish(self, device: str, switch_off: bool) -> None:
        job = self.jobs.get(device)
        if job is None:
            return
        if switch_off and not job["wasOn"]:
            state = self.hass.states.get(device)
            if state is None or state.state == "unavailable":
                await self._hold(job)  # HA would skip it without an error
                return
            self._disarm(device)
            try:  # sent even if it reads «off»: it may have been switched on a moment ago and not have reported yet
                await self.hass.services.async_call("homeassistant", "turn_off", {"entity_id": device}, blocking=True)
            except Exception as err:  # noqa: BLE001 - the device refused: try again until it is off
                _LOGGER.warning("Atom Home air job: %s did not switch off: %s", device, err)
                await self._hold(job)
                return
        self._drop(device)
        await self._save()

    async def _save(self) -> None:
        await self.store.async_save({"jobs": list(self.jobs.values())})
