"""«Fix it» jobs of the Air card: a device runs until a reading is back to normal, then stops by itself.

The panel's button («Убрать влагу») asks for a job; this module keeps it in HA, so it finishes with every panel closed and
survives a restart. A job ends when the reading reaches its target, after an hour at the latest, on «Stop», or when someone
switches the device off by hand. A device that was already on before the job is left on.

A job is over only when the device reads off. A switch-off that does not take effect is sent again, five times a minute apart,
then the job ends and says so in air/tasks until the device itself reads off, seen by a listener with every panel closed. A device that is away when the job ends is not forgotten: the job waits for it and
switches it off when it is back, because HA skips an unavailable entity without an error, but for a day at most: after that the
vent may have been started on purpose, so the job is dropped with no command. A device that does not start within half a minute
ends the job the same way. Nothing is decided before HA is up and the jobs have been reviewed: until then a device may not exist
yet. Nothing is created in HA's configuration; the targets live here, the panel cannot choose them.
"""
from __future__ import annotations

import asyncio
import logging
import math
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
RETRY_TIMES = 5  # a switch-off that does not take effect, sent this many times a minute apart
START_GRACE_SECONDS = 30  # a device still off this long after turn_on did not start
AWAY_SECONDS = 86400  # how long a stopping job waits for a device; after that it may have been started on purpose
CALL_SECONDS = 15  # a blocking service call has no time limit of its own
OUTCOME_SECONDS = 3600  # how long the panel can still say how the last job ended
KINDS = ("dehumidify", "purify")
OUTCOMES = ("no_start", "no_stop", "out_of_time")


def target_for(kind: str, month: int) -> int:
    """Where the job stops. Heating season: outdoor air is dry once warm, 60 % is within reach. May to September it brings 60-66 % itself, so 64 %: just under «Влажно» at 65, or the button would come back the moment the vent stops."""
    if kind == "purify":
        return 15
    return 64 if 5 <= month <= 9 else 60


# the room's vent: any fan but a purifier, or a relay that says so as a whole word («prevent» on a feeder is not a vent, nor is the hood's light or the relay's child lock); «fan» only as the last word: switch.x_fan_beep is a setting of a device
DEVICE_RE = re.compile(r"(?:fan\.(?!.*(?:purifier|airp))[a-z0-9_]+|switch\.(?!.*(?:purifier|airp))(?!(?:.*_)?(?:lights?|lamps?|led|lock|indicator|mode|backlight|svet|podsvetka|lampa|blokirovka|zamok|rezhim|indikator)(?:_|$))(?:[a-z0-9]+_)*(?:vent|ventilation|exhaust|hood|vytiazh[a-z]*|ventiliatsiia|ventiliator|ventilator|extractor|fan$)(?:_[a-z0-9]+)*)")
SENSOR_RE = re.compile(r"sensor\.[a-z0-9_]+")
ROOM_RE = re.compile(r"[a-z0-9_]{1,64}")


def reached(kind: str, value: Any, target: float) -> bool:
    """Is the reading back to normal, on the whole number the panel prints: «60%» at 60.4 is the target reached. Half goes up, as in the panel, and Python's round would not. An unavailable or non-numeric reading is not: the job waits or runs out its hour."""
    try:
        number = float(value)
    except (TypeError, ValueError):
        return False
    if number != number or number in (float("inf"), float("-inf")):
        return False
    return math.floor(number + 0.5) <= target


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

    def __init__(self, hass: Any, store: Any = None, track_state: Callable | None = None, call_later: Callable | None = None, now: Callable[[], float] = time.time, at_started: Callable | None = None, month: Callable[[], int] | None = None, category: Callable[[str], Any] | None = None, track_rename: Callable | None = None) -> None:
        if store is None:
            from homeassistant.helpers import entity_registry as er
            from homeassistant.helpers.event import async_call_later, async_track_state_change_event
            from homeassistant.helpers.start import async_at_started
            from homeassistant.helpers.storage import Store
            from homeassistant.util import dt as dt_util

            def registry_category(entity_id: str) -> Any:
                entry = er.async_get(hass).async_get(entity_id)
                return entry.entity_category if entry else None

            def registry_updated(_hass: Any, listener: Callable) -> Callable[[], None]:
                return hass.bus.async_listen(er.EVENT_ENTITY_REGISTRY_UPDATED, listener)

            store, track_state, call_later, at_started, track_rename = Store(hass, STORAGE_VERSION, STORAGE_KEY), async_track_state_change_event, async_call_later, async_at_started, registry_updated
            month, category = (lambda: dt_util.now().month), registry_category  # the house's own calendar, as the panel's
        self.hass, self.store, self._track, self._later, self._now, self._at_started = hass, store, track_state, call_later, now, at_started
        self._month = month or (lambda: time.localtime(now()).tm_mon)
        self._category = category or (lambda _entity: None)
        self._track_rename = track_rename
        self._cancel_rename: Callable[[], None] | None = None
        self._closed = False  # unloaded: work still in flight must not arm anything, command the device or overwrite the next instance's file
        self.jobs: dict[str, dict[str, Any]] = {}
        self._unsub: dict[str, list[Callable[[], None]]] = {}
        self._cancel_started: Callable[[], None] | None = None
        self._reviewed = True  # false only from loading stored jobs until HA is up
        self._finishing: set[str] = set()  # a switch-off on its way: runtime only, not stored
        self._contexts: dict[str, Any] = {}  # who asked: the logbook names them for the job's later commands too
        self._outcomes: dict[str, dict[str, Any]] = {}  # how the last job on a device ended, when the owner should know
        self._watches: dict[str, list[Callable[[], None]]] = {}  # per device with a «no_stop» outcome: what ends that alarm

    @staticmethod
    def _row(job: dict[str, Any]) -> dict[str, Any]:
        return {"kind": job["kind"], "roomId": job["roomId"], "device": job["device"], "sensor": job["sensor"], "target": job["target"], "startedAt": int(job["startedAt"] * 1000), "wasOn": job["wasOn"], "stopping": job["stopping"]}

    def summary(self) -> list[dict[str, Any]]:
        """Running and stopping jobs, then how recent ones ended: a row with «outcome» is over."""
        now = self._now()
        started = False
        for device, ended in list(self._outcomes.items()):
            state = self.hass.states.get(device)
            if ended["job"].get("outcome") == "no_start" and state is not None and state.state == "on":  # started by hand after the press failed: not news any more, and with the vent on no button is there for a new job to clear it
                del self._outcomes[device]
                started = True
            elif ended["job"].get("outcome") != "no_stop" and now - ended["at"] >= OUTCOME_SECONDS:  # the owner's red tile has no time limit: only _watch and _review end it
                del self._outcomes[device]
        if started:
            self.hass.async_create_task(self._save())  # on disk too, or a restart would bring it back about a vent that started
        return [self._row(j) for j in self.jobs.values()] + [{**self._row(e["job"]), "outcome": e["job"]["outcome"]} for e in self._outcomes.values()]

    def _parsed(self, raw: Any) -> dict[str, Any]:
        """A stored job row; raises if it is not one."""
        check(raw.get("kind"), raw.get("device"), raw.get("sensor"), raw.get("roomId"))
        stopping = bool(raw.get("stopping"))
        job = {"kind": raw["kind"], "roomId": raw["roomId"], "device": raw["device"], "sensor": raw["sensor"], "target": int(raw["target"]), "startedAt": float(raw["startedAt"]), "wasOn": bool(raw.get("wasOn")), "stopping": stopping, "stoppingSince": float(raw.get("stoppingSince") or self._now()) if stopping else None, "tries": 0}
        if raw.get("outcome") in OUTCOMES:
            job["outcome"] = raw["outcome"]
        return job

    async def _stored(self) -> tuple[list[dict[str, Any]], dict[str, dict[str, Any]]]:
        data = await self.store.async_load()
        rows, ended = (data.get("jobs"), data.get("outcomes")) if isinstance(data, dict) else (None, None)
        jobs, outcomes = [], {}
        for raw in rows if isinstance(rows, list) else []:
            try:
                jobs.append(self._parsed(raw))
            except (ValueError, TypeError, KeyError, AttributeError):
                continue
        for raw in ended if isinstance(ended, list) else []:
            try:
                job = self._parsed(raw["job"])
                if job.get("outcome"):
                    outcomes[job["device"]] = {"job": job, "at": float(raw["at"])}
            except (ValueError, TypeError, KeyError, AttributeError):
                continue
        return jobs, outcomes

    async def async_load(self) -> None:
        """Take the jobs back. They are judged once HA is up: before that a device may not exist yet and a command to it would do nothing."""
        jobs, self._outcomes = await self._stored()
        alarms = [device for device, ended in self._outcomes.items() if ended["job"].get("outcome") == "no_stop"]
        if (jobs or alarms) and self._at_started:
            self._reviewed = False
        for job in jobs:
            self.jobs[job["device"]] = job
            self._arm(job)
        for device in alarms:
            self._watch(device)
        if self._track_rename:
            self._cancel_rename = self._track_rename(self.hass, self._renamed)
        if not self._reviewed:
            self._cancel_started = self._at_started(self.hass, self._review)

    async def async_remove(self) -> None:
        """The integration is being removed: nothing will ever stop its jobs, so stop them now and leave no file behind."""
        for job in (await self._stored())[0]:
            state = self.hass.states.get(job["device"])
            if job["wasOn"] or state is None or state.state == "unavailable":
                continue
            try:
                await self._send("turn_off", job["device"])
            except Exception as err:  # noqa: BLE001 - removal must go on
                _LOGGER.warning("Atom Home air job: %s did not switch off on removal: %s", job["device"], err)
        await self.store.async_remove()

    async def _review(self, _hass: Any = None) -> None:
        self._cancel_started = None
        self._reviewed = True
        for device, ended in list(self._outcomes.items()):
            state = self.hass.states.get(device)
            if ended["job"].get("outcome") == "no_stop" and (state is None or state.state == "off"):
                del self._outcomes[device]  # it read off while HA was down, or HA is up and has no such device
                self._unwatch(device)
        for device, job in list(self.jobs.items()):
            state, sensor = self.hass.states.get(device), self.hass.states.get(job["sensor"])
            if state is None:
                self._drop(device)  # HA is up and has no such device any more
            elif job["stopping"]:
                await self._finish(device, switch_off=True)
            elif sensor and reached(job["kind"], sensor.state, job["target"]):
                await self._finish(device, switch_off=True)
            elif self._now() - job["startedAt"] >= MAX_SECONDS:
                await self._finish(device, switch_off=True, outcome="out_of_time")
            elif state.state == "off":
                await self._finish(device, switch_off=True)  # it reads off, but a relay that reports late may still be on; a device that was on before is left alone
        await self._save()

    async def start(self, kind: str, room: str, device: str, sensor: str, context: Any = None) -> None:
        check(kind, device, sensor, room)
        running = self.jobs.get(device)
        if running is not None:
            if running["kind"] == kind and not running["stopping"] and device not in self._finishing:
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
        job = {"kind": kind, "roomId": room, "device": device, "sensor": sensor, "target": target, "startedAt": self._now(), "wasOn": was_on, "stopping": False, "stoppingSince": None, "tries": 0}
        self.jobs[device] = job  # taken before waiting for the device: a second press sees it
        self._outcomes.pop(device, None)
        self._unwatch(device)
        if context is not None:
            self._contexts[device] = context
        if was_on:
            self._arm(job)
            await self._save()
            return
        await self._save()  # on disk before the device moves: a restart in between still finds a job to end
        try:
            await self._send("turn_on", device)
        except Exception:  # noqa: BLE001 - a timeout, or a device that obeyed and then raised: it may have gone through, and nothing must run without a job
            if self.jobs.get(device) is job:
                await self._finish(device, switch_off=True)
            raise
        current = self.jobs.get(device)
        if current is not None and current is not job:
            return
        if current is None or job["stopping"]:  # «Stop» came while the device was starting and may have reached it first: the last word must be off
            self.jobs[device], job["tries"] = job, 0
            await self._finish(device, switch_off=True)
            return
        self._arm(job)
        self._arm_start_check(job)
        await self._save()

    async def stop(self, device: str, context: Any = None) -> None:
        """Raises when the device is not on its way to off, so the panel can say so. The job stays and keeps trying."""
        if context is not None and device in self.jobs:
            self._contexts[device] = context
        why = await self._finish(device, switch_off=True)
        if why == "device offline":
            raise ValueError(why)
        if why:
            raise RuntimeError(why)

    def unload(self) -> None:
        self._closed = True
        if self._cancel_rename:
            self._cancel_rename()
            self._cancel_rename = None
        if self._cancel_started:
            self._cancel_started()
            self._cancel_started = None
        for device in list(self._unsub):
            self._disarm(device)
        for device in list(self._watches):
            self._unwatch(device)

    def _disarm(self, device: str) -> None:
        for unsub in self._unsub.pop(device, []):
            unsub()

    def _unwatch(self, device: str) -> None:
        for unsub in self._watches.pop(device, []):
            unsub()

    @callback
    def _renamed(self, event: Any) -> None:
        """An entity got a new id: its job follows, or the vent would run on with nothing to stop it."""
        old, new = event.data.get("old_entity_id"), event.data.get("entity_id")
        if event.data.get("action") != "update" or not old or old == new:
            return
        moved = None
        for job in list(self.jobs.values()):
            if job["device"] == old:
                self._disarm(old)
                del self.jobs[old]
                job["device"], self.jobs[new], moved = new, job, job
                if old in self._contexts:
                    self._contexts[new] = self._contexts.pop(old)
            elif job["sensor"] == old:
                job["sensor"] = new
            else:
                continue
            self._arm(job)
        if old in self._outcomes:
            self._outcomes[new] = self._outcomes.pop(old)
            self._outcomes[new]["job"]["device"] = new
            if old in self._watches:
                self._unwatch(old)
                self._watch(new)
        self.hass.async_create_task(self._save())
        if moved and not DEVICE_RE.fullmatch(new):  # a new id that is no vent would not survive a restart: end it while it can still be stopped
            self.hass.async_create_task(self._finish(new, switch_off=True))

    def _arm(self, job: dict[str, Any]) -> None:
        if self._closed:
            return
        device, sensor = job["device"], job["sensor"]
        self._disarm(device)

        @callback
        def changed(event: Any) -> None:
            if not self._reviewed:
                return  # HA is starting: an «off» now says nothing, _review looks at everything once it is up
            entity, new, old = event.data.get("entity_id"), event.data.get("new_state"), event.data.get("old_state")
            if new is None and entity == device and not job["stopping"]:
                self._arm_gone_check(job)
                return
            if new is None or new.state == "unavailable":
                return  # a blip or a restart says nothing about the job; the hour goes on
            if entity == device:
                was = old.state if old is not None else None
                back = was in (None, "unavailable", "unknown")
                if job["stopping"]:
                    sent = job.get("sentAt")
                    if (new.state == "off" and job["tries"]) or (back and (sent is None or self._now() - sent >= RETRY_SECONDS)):
                        self.hass.async_create_task(self._finish(device, switch_off=True))  # it took effect, or it is back and can be switched off now; a link that flaps waits for the retry timer, or it would spend the five commands in seconds
                elif new.state == "off" and was == "on":
                    self.hass.async_create_task(self._finish(device, switch_off=False))  # switched off by hand: nothing more to do
                elif new.state == "off" and back:
                    self.hass.async_create_task(self._finish(device, switch_off=True))  # as in _review: it reads off with nobody having switched it, and a relay that reports late may still be on
            elif entity == sensor and not job["stopping"] and reached(job["kind"], new.state, job["target"]):
                self.hass.async_create_task(self._finish(device, switch_off=True))

        @callback
        def out_of_time(_now: Any) -> None:
            if self._reviewed:  # before that _review reads the clock itself
                self.hass.async_create_task(self._finish(device, switch_off=True, outcome=None if job["stopping"] else "out_of_time"))

        left = RETRY_SECONDS if job["stopping"] else min(MAX_SECONDS, max(1.0, MAX_SECONDS - (self._now() - job["startedAt"])))  # a clock behind at load must not stretch the hour
        self._unsub[device] = [self._track(self.hass, [device, sensor], changed), self._later(self.hass, left, out_of_time)]

    def _arm_gone_check(self, job: dict[str, Any]) -> None:
        """A running job's device left HA. A reload of its integration brings it back within the minute; if not, nothing can be stopped any more."""
        device = job["device"]

        @callback
        def gone(_now: Any) -> None:
            if self.jobs.get(device) is job and self.hass.states.get(device) is None:
                _LOGGER.warning("Atom Home air job: %s is no longer in HA", device)
                self.hass.async_create_task(self._end(job))

        self._unsub[device].append(self._later(self.hass, RETRY_SECONDS, gone))

    def _arm_start_check(self, job: dict[str, Any]) -> None:
        """turn_on accepted says nothing about the device: if it still reads off soon after, the job has nothing running."""
        if self._closed:
            return
        device = job["device"]

        @callback
        def not_started(_now: Any) -> None:
            state = self.hass.states.get(device)
            if self.jobs.get(device) is job and not job["stopping"] and state is not None and state.state == "off":
                self.hass.async_create_task(self._finish(device, switch_off=True, outcome="no_start"))  # sent off too: a relay that starts late must not run on with no job

        self._unsub[device].append(self._later(self.hass, START_GRACE_SECONDS, not_started))

    def _watch(self, device: str) -> None:
        """A vent that would not stop: the alarm lasts until the device itself reads off. Only this listener and _review end it: a panel's read may fall when HA has no state for the device yet, and it may read off with no panel open."""
        self._unwatch(device)
        if self._closed:
            return

        def over() -> None:
            self._outcomes.pop(device, None)
            self._unwatch(device)
            self.hass.async_create_task(self._save())  # on disk too, or a restart would bring the alarm back about a repaired vent

        @callback
        def gone(_now: Any) -> None:
            if self.hass.states.get(device) is None:
                over()

        @callback
        def changed(event: Any) -> None:
            if not self._reviewed:
                return  # HA is starting: an «off» or no state now says nothing, _review looks once it is up
            new = event.data.get("new_state")
            if new is None:
                self._watches[device].append(self._later(self.hass, RETRY_SECONDS, gone))  # a reload of its integration brings it back within the minute
            elif new.state == "off":
                over()

        self._watches[device] = [self._track(self.hass, [device], changed)]
        if self._reviewed and self.hass.states.get(device) is None:  # renamed, and the new id has no state yet: it may never get one, so no event would come
            self._watches[device].append(self._later(self.hass, RETRY_SECONDS, gone))

    def _drop(self, device: str) -> None:
        self.jobs.pop(device, None)
        self._contexts.pop(device, None)
        self._disarm(device)

    async def _end(self, job: dict[str, Any]) -> None:
        if job.get("outcome"):
            self._outcomes[job["device"]] = {"job": dict(job), "at": self._now()}  # saved with the jobs: «Вытяжка не выключилась» outlives a restart
        self._drop(job["device"])
        if job.get("outcome") == "no_stop":
            self._watch(job["device"])
        await self._save()

    async def _hold(self, job: dict[str, Any]) -> None:
        """The device is not off yet: keep the job until it is."""
        if self.jobs.get(job["device"]) is not job:
            return
        first = not job["stopping"]
        if first:
            job["stopping"], job["stoppingSince"] = True, self._now()
        self._arm(job)
        if first:
            await self._save()

    async def _send(self, service: str, device: str) -> None:
        await asyncio.wait_for(self.hass.services.async_call("homeassistant", service, {"entity_id": device}, blocking=True, context=self._contexts.get(device)), CALL_SECONDS)

    async def _finish(self, device: str, switch_off: bool, outcome: str | None = None) -> str | None:
        """End the job, or keep it as stopping until the device reads off. Says why the device is not on its way to off, or None."""
        job = self.jobs.get(device)
        if self._closed or job is None or device in self._finishing:
            return None
        if outcome:
            job["outcome"] = outcome
        if not switch_off or job["wasOn"]:
            await self._end(job)
            return None
        state = self.hass.states.get(device)
        if job["stopping"] and self._now() - job["stoppingSince"] >= AWAY_SECONDS:
            _LOGGER.warning("Atom Home air job: gave up on %s after a day without switching it off", device)
            job.pop("outcome", None)  # a day later it is no news
            await self._end(job)
            return None
        if state is None or state.state == "unavailable":
            if state is None and job["stopping"]:  # gone for a whole retry, not a reload of its integration: HA has no such device any more
                _LOGGER.warning("Atom Home air job: %s is no longer in HA", device)
                await self._end(job)
                return None
            await self._hold(job)  # HA would skip it without an error
            return "device offline"
        if job["tries"] and state.state == "off":
            await self._end(job)
            return None
        if job["tries"] >= RETRY_TIMES:
            _LOGGER.warning("Atom Home air job: %s was told %d times and still reads %s", device, job["tries"], state.state)
            job["outcome"] = "no_stop"
            await self._end(job)
            return None
        job["tries"] += 1
        job["sentAt"] = self._now()
        self._finishing.add(device)
        try:  # sent even if it reads «off»: it may have been switched on a moment ago and not have reported yet
            await self._send("turn_off", device)
        except Exception as err:  # noqa: BLE001 - the device refused or never answered: try again
            _LOGGER.warning("Atom Home air job: %s did not switch off: %r", device, err)
            self._finishing.discard(device)
            await self._hold(job)
            return "device refused"
        self._finishing.discard(device)
        state = self.hass.states.get(device)
        if state is None or state.state != "off":
            await self._hold(job)  # accepted says nothing about the device, a relay may report late: look again, send again
            return None
        await self._end(job)
        return None

    async def _save(self) -> None:
        if self._closed:
            return
        await self.store.async_save({"jobs": list(self.jobs.values()), **({"outcomes": list(self._outcomes.values())} if self._outcomes else {})})
