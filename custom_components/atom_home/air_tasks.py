"""«Fix it» jobs of the Air card: a device runs until a reading is back to normal, then stops by itself.

The panel's button («Убрать влагу») asks for a job; this module keeps it in HA, so it finishes with every panel closed and
survives a restart. A job ends when the reading reaches its target, after an hour at the latest, on «Stop», or when someone
switches the device off by hand. A device that was already on before the job is left on. Nothing is created in HA's
configuration; the targets live here, the panel cannot choose them.
"""
from __future__ import annotations

import logging
import re
import time
from typing import Any, Callable

_LOGGER = logging.getLogger(__name__)
STORAGE_KEY = "atom_home.air_tasks"
STORAGE_VERSION = 1
MAX_SECONDS = 3600
TARGETS = {"dehumidify": 60, "purify": 15}
# the room's vent: any fan but a purifier, or a relay that says so as a whole word («prevent» on a feeder is not a vent)
DEVICE_RE = re.compile(r"^(?:fan\.(?!.*purifier)[a-z0-9_]+|switch\.(?:[a-z0-9]+_)*(?:vent|ventilation|exhaust|hood|vytiazhka|vytiazh)(?:_[a-z0-9]+)*)$")
SENSOR_RE = re.compile(r"^sensor\.[a-z0-9_]+$")
ROOM_RE = re.compile(r"^[a-z0-9_]{1,64}$")


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
    if kind not in TARGETS:
        raise ValueError("unknown kind")
    if not isinstance(device, str) or not DEVICE_RE.match(device):
        raise ValueError("bad device")
    if not isinstance(sensor, str) or not SENSOR_RE.match(sensor):
        raise ValueError("bad sensor")
    if not isinstance(room, str) or not ROOM_RE.match(room):
        raise ValueError("bad room")


class AirTasks:
    """Running jobs per device. The clock and the HA helpers are injected so the logic runs under plain unittest."""

    def __init__(self, hass: Any, store: Any = None, track_state: Callable | None = None, call_later: Callable | None = None, now: Callable[[], float] = time.time) -> None:
        if store is None or track_state is None or call_later is None:
            from homeassistant.helpers.event import async_call_later, async_track_state_change_event
            from homeassistant.helpers.storage import Store
            store = store or Store(hass, STORAGE_VERSION, STORAGE_KEY)
            track_state = track_state or async_track_state_change_event
            call_later = call_later or async_call_later
        self.hass, self.store, self._track, self._later, self._now = hass, store, track_state, call_later, now
        self.jobs: dict[str, dict[str, Any]] = {}
        self._unsub: dict[str, list[Callable[[], None]]] = {}

    def summary(self) -> list[dict[str, Any]]:
        return [{"kind": j["kind"], "roomId": j["roomId"], "device": j["device"], "sensor": j["sensor"], "target": j["target"], "startedAt": int(j["startedAt"] * 1000)} for j in self.jobs.values()]

    async def async_load(self) -> None:
        data = await self.store.async_load() or {}
        for raw in data.get("jobs") or []:
            try:
                check(raw.get("kind"), raw.get("device"), raw.get("sensor"), raw.get("roomId"))
                job = {"kind": raw["kind"], "roomId": raw["roomId"], "device": raw["device"], "sensor": raw["sensor"], "target": TARGETS[raw["kind"]], "startedAt": float(raw["startedAt"]), "wasOn": bool(raw.get("wasOn"))}
            except (ValueError, TypeError, KeyError):
                continue
            self.jobs[job["device"]] = job
            sensor = self.hass.states.get(job["sensor"])
            if self._now() - job["startedAt"] >= MAX_SECONDS or (sensor and reached(job["kind"], sensor.state, job["target"])):
                await self._finish(job["device"], switch_off=True)
            else:
                self._arm(job)

    async def start(self, kind: str, room: str, device: str, sensor: str) -> None:
        check(kind, device, sensor, room)
        if device in self.jobs:
            return  # a double tap, or another panel was first
        state, reading = self.hass.states.get(device), self.hass.states.get(sensor)
        if state is None or state.state == "unavailable":
            raise ValueError("device offline")
        if reading is not None and reached(kind, reading.state, TARGETS[kind]):
            return  # nothing to fix any more
        was_on = state.state == "on"
        if not was_on:
            await self.hass.services.async_call("homeassistant", "turn_on", {"entity_id": device}, blocking=True)
        job = {"kind": kind, "roomId": room, "device": device, "sensor": sensor, "target": TARGETS[kind], "startedAt": self._now(), "wasOn": was_on}
        self.jobs[device] = job
        self._arm(job)
        await self._save()

    async def stop(self, device: str) -> None:
        if device in self.jobs:
            await self._finish(device, switch_off=True)

    def unload(self) -> None:
        for unsubs in self._unsub.values():
            for unsub in unsubs:
                unsub()
        self._unsub.clear()

    def _arm(self, job: dict[str, Any]) -> None:
        device, sensor = job["device"], job["sensor"]

        def changed(event: Any) -> None:
            entity, new = event.data.get("entity_id"), event.data.get("new_state")
            if entity == device and (new is None or new.state in ("off", "unavailable")):
                self.hass.async_create_task(self._finish(device, switch_off=False))  # switched off by hand or gone: nothing more to do
            elif entity == sensor and new is not None and reached(job["kind"], new.state, job["target"]):
                self.hass.async_create_task(self._finish(device, switch_off=True))

        def out_of_time(_now: Any) -> None:
            self.hass.async_create_task(self._finish(device, switch_off=True))

        left = max(1.0, MAX_SECONDS - (self._now() - job["startedAt"]))
        self._unsub[device] = [self._track(self.hass, [device, sensor], changed), self._later(self.hass, left, out_of_time)]

    async def _finish(self, device: str, switch_off: bool) -> None:
        job = self.jobs.pop(device, None)
        for unsub in self._unsub.pop(device, []):
            unsub()
        if job is None:
            return
        if switch_off and not job["wasOn"]:
            try:
                await self.hass.services.async_call("homeassistant", "turn_off", {"entity_id": device}, blocking=True)
            except Exception as err:  # noqa: BLE001 - the device may be away; the job is over either way
                _LOGGER.warning("Atom Home air job: %s did not switch off: %s", device, err)
        await self._save()

    async def _save(self) -> None:
        await self.store.async_save({"jobs": list(self.jobs.values())})
