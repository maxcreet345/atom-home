"""Room alarms of the Atom Home panel.

The list lives in the panel configuration (`alarms`); this module schedules the next ring of every enabled alarm,
fades a dimmable light in before it, rings through the room's Yandex speaker, repeats as configured,
and raises the «ringing» flag the panel turns into a banner. Everything goes through ordinary HA services, so it
works with no browser open. Stop/snooze arrive as WebSocket commands or as the flag being switched off.
"""
from __future__ import annotations

import asyncio
import logging
import re
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from typing import Any, Awaitable, Callable

from homeassistant.core import HomeAssistant, callback
from homeassistant.helpers.event import async_track_point_in_time, async_track_state_change_event
from homeassistant.helpers.start import async_at_started
from homeassistant.util import dt as dt_util

from .helpers_check import RING_FLAG, RING_TEXT

_LOGGER = logging.getLogger(__name__)
AUTO_STOP = timedelta(minutes=10)
FADE_STEP = 30  # seconds between brightness steps
ID_RE = re.compile(r"^[A-Za-z0-9_-]{1,32}$")
ENTITY_RE = re.compile(r"^[a-z_]+\.[a-z0-9_]+$")
TIME_RE = re.compile(r"^([01]\d|2[0-3]):[0-5]\d$")
FADE_CHOICES = (0, 5, 10, 15, 20, 30)
REPEAT_EVERY_CHOICES = (3, 5, 10)


def normalise_alarms(raw: Any) -> list[dict]:
    """Keep only well-formed alarms; drop the rest silently (the panel validates first, this is the backstop)."""
    out: list[dict] = []
    if not isinstance(raw, list):
        return out
    seen: set[str] = set()
    for a in raw[:40]:
        if not isinstance(a, dict):
            continue
        aid = a.get("id")
        if not isinstance(aid, str) or not ID_RE.match(aid) or aid in seen:
            continue
        time = a.get("time")
        if not isinstance(time, str) or not TIME_RE.match(time):
            continue
        days = a.get("days")
        days = sorted({d for d in days if isinstance(d, int) and 1 <= d <= 7}) if isinstance(days, list) else []
        alice = a.get("alice") if a.get("alice") in ("off", "tts", "music") else "off"
        station = a.get("station") if isinstance(a.get("station"), str) and ENTITY_RE.match(a.get("station")) else ""
        light = a.get("lightEntity") if isinstance(a.get("lightEntity"), str) and ENTITY_RE.match(a.get("lightEntity")) else ""
        fade = a.get("fadeMin") if a.get("fadeMin") in FADE_CHOICES else 15
        repeats = a.get("repeats") if isinstance(a.get("repeats"), int) and 0 <= a.get("repeats") <= 10 else 0
        every = a.get("repeatEveryMin") if a.get("repeatEveryMin") in REPEAT_EVERY_CHOICES else 5
        seen.add(aid)
        out.append({
            "id": aid, "room": str(a.get("room") or "")[:64], "time": time, "days": days, "enabled": a.get("enabled") is not False,
            "label": str(a.get("label") or "")[:40], "alice": alice, "phrase": str(a.get("phrase") or "")[:120], "station": station,
            "light": bool(a.get("light")) and bool(light), "lightEntity": light, "fadeMin": fade, "push": False,
            "repeats": repeats, "repeatEveryMin": every,
        })
    return out


def next_fire(alarm: dict, now: datetime) -> datetime | None:
    """Next local calendar occurrence, strictly in the future as an absolute instant.

    Autumn's ambiguous time rings once, at its first occurrence. A missing spring time
    moves forward by the DST gap (03:30 becomes 04:30), never into an immediate loop.
    """
    hh, mm = (int(x) for x in alarm["time"].split(":"))
    for d in range(0, 8):
        day = now.date() + timedelta(days=d)
        cand = datetime.combine(day, datetime.min.time(), tzinfo=now.tzinfo).replace(hour=hh, minute=mm)
        cand = cand.astimezone(timezone.utc).astimezone(now.tzinfo)
        if cand.astimezone(timezone.utc) <= now.astimezone(timezone.utc):
            continue
        if alarm["days"] and cand.isoweekday() not in alarm["days"]:
            continue
        return cand
    return None


def switched_off(alarm_id: str) -> Callable[[list], list | None]:
    """The change to the stored alarms once an alarm with no weekdays has rung: that alarm off, the rest untouched (None: nothing to write)."""
    def change(alarms: list) -> list | None:
        if not any(isinstance(a, dict) and a.get("id") == alarm_id and a.get("enabled") is not False for a in alarms):
            return None
        return [{**a, "enabled": False} if isinstance(a, dict) and a.get("id") == alarm_id else a for a in alarms]
    return change


@dataclass(eq=False)
class _Ring:
    alarm: dict
    repeat_left: int
    stop_unsub: Callable[[], None] | None = None
    task: asyncio.Task | None = None
    ringing: bool = False
    speaker_started: bool = False


class AlarmScheduler:
    def __init__(self, hass: HomeAssistant, on_once: Callable[[str], Awaitable[None]] | None = None,
                 authorize: Callable[[dict], Awaitable[bool]] | None = None) -> None:
        self.hass = hass
        self._alarms: list[dict] = []
        self._unsubs: list[Callable[[], None]] = []
        self._on_once = on_once  # told the id of an alarm with no weekdays once it has rung: the caller stores it switched off
        self._spent: set[str] = set()  # rang once, and the caller has not finished storing it switched off yet
        self._fades: dict[str, tuple[asyncio.Task, tuple[datetime, str]]] = {}  # one sunrise per alarm: id → (task, (ring time, light))
        self._started_unsub: Callable[[], None] | None = None
        self._scheduled: dict[str, tuple[dict, datetime]] = {}
        # An editable alarm id can ring again on a different speaker while its previous
        # occurrence is still active. Keep the occurrences, not just the latest id.
        self._active: list[_Ring] = []
        self._tasks: set[asyncio.Task] = set()
        self._writes: set[asyncio.Task] = set()
        self._closed = False
        self._authorize = authorize
        self._flag_unsub = async_track_state_change_event(hass, [RING_FLAG], self._flag_changed)

    # ---- scheduling -------------------------------------------------------------------------
    def set_alarms(self, alarms: list[dict]) -> None:
        # A list that was on its way to the disk when a «один раз» alarm rang still has it switched on (the panel sent it a
        # moment before the ring). Until the switch-off of that alarm is stored it stays off here, or it would ring again tomorrow.
        self._alarms = [{**a, "enabled": False} if a["id"] in self._spent else a for a in alarms]
        self._reschedule()

    def _clear(self) -> None:
        for u in self._unsubs:
            u()
        self._unsubs = []
        self._scheduled = {}

    def _reschedule(self) -> None:
        self._clear()
        if self._closed:
            return
        now = dt_util.now()
        fading: dict[str, tuple[dict, datetime]] = {}  # the alarms whose sunrise is under way at this moment
        for alarm in self._alarms:
            if not alarm["enabled"]:
                continue
            at = next_fire(alarm, now)
            if at is None:
                continue
            self._scheduled[alarm["id"]] = (alarm, at)
            self._unsubs.append(async_track_point_in_time(self.hass, self._make(alarm, "ring", at), at))
            if alarm["light"] and alarm["fadeMin"]:
                fade_at = at.astimezone(timezone.utc) - timedelta(minutes=alarm["fadeMin"])
                if fade_at > now.astimezone(timezone.utc):
                    self._unsubs.append(async_track_point_in_time(self.hass, self._make(alarm, "fade", at), fade_at))
                else:
                    fading[alarm["id"]] = (alarm, at)
        # Every save of the panel's settings comes here (a theme switched, another room's alarm). A sunrise already running
        # for the same ring and the same lamp goes on from where it is; one whose alarm was changed, switched off or has rung stops.
        for aid, (task, key) in list(self._fades.items()):
            want = fading.get(aid)
            if task.done() or want is None or key != (want[1], want[0]["lightEntity"]):
                if not task.done():
                    task.cancel()
                del self._fades[aid]
        for aid, (alarm, at) in fading.items():
            if aid not in self._fades:
                self._start_fade(alarm, at)
        _LOGGER.debug("Atom Home alarms: %d scheduled", len(self._unsubs))

    def _start_fade(self, alarm: dict, ring_at: datetime) -> None:
        self._cancel_fade(alarm["id"])
        # A background task: a sunrise lasts up to half an hour and must not hold up Home Assistant's start-up or a reload.
        task = self.hass.async_create_background_task(self._fade(alarm, ring_at), f"atom_home alarm sunrise {alarm['id']}")
        self._fades[alarm["id"]] = (task, (ring_at, alarm["lightEntity"]))

    def _cancel_fade(self, alarm_id: str) -> None:
        task = self._fades.pop(alarm_id, (None, None))[0]
        if task and not task.done():
            task.cancel()

    def _task(self, coro) -> asyncio.Task:
        task = self.hass.async_create_task(coro)
        self._tasks.add(task)
        task.add_done_callback(self._tasks.discard)
        return task

    def _make(self, alarm: dict, what: str, at: datetime):
        @callback
        def fire(_now: datetime) -> None:
            if self._closed or self._scheduled.get(alarm["id"]) != (alarm, at):
                return
            now = dt_util.now().astimezone(timezone.utc)
            if what == "fade":
                if at.astimezone(timezone.utc) > now:
                    self._start_fade(alarm, at)
            else:
                # One callback can arrive after several rooms are due. Consume every due
                # occurrence before cancelling/rebuilding timers, including one-shot alarms.
                due = [a for a, when in self._scheduled.values() if when.astimezone(timezone.utc) <= now]
                for current in due:
                    ring = _Ring(current, current["repeats"])
                    self._active.append(ring)
                    self._queue_ring(ring)
                    if not current["days"]:
                        self._spend(current)
                self._reschedule()
        return fire

    def _spend(self, alarm: dict) -> None:
        """No weekdays means «один раз»: once it has rung the alarm is switched off, here at once and in the stored config.
        The ring itself (repeats, snooze, stop) goes on with the copy it was given."""
        self._alarms = [{**a, "enabled": False} if a["id"] == alarm["id"] else a for a in self._alarms]
        if self._on_once:
            self._spent.add(alarm["id"])
            # A reload must finish this write, or the restored one-shot alarm rings again.
            task = self.hass.async_create_task(self._store_spent(alarm["id"]))
            self._writes.add(task)
            task.add_done_callback(self._writes.discard)

    async def _store_spent(self, alarm_id: str) -> None:
        try:
            await self._on_once(alarm_id)
        except Exception as err:  # noqa: BLE001 — it stays off in this run either way
            _LOGGER.error("Atom Home alarm: %s rang once and was not stored switched off: %s", alarm_id, err)
        finally:
            # Stored: a later save of the old list is refused as a conflict. Not stored: the owner may switch it on again.
            self._spent.discard(alarm_id)

    def summary(self) -> dict:
        now = dt_util.now()
        latest = next(reversed(self._active), None)
        return {"count": len(self._alarms), "next": [{"id": a["id"], "at": (next_fire(a, now) or now).isoformat()} for a in self._alarms if a["enabled"] and next_fire(a, now)], "ringing": latest.alarm["id"] if latest else None, "repeatLeft": latest.repeat_left if latest else 0}

    async def _allowed(self, alarm: dict) -> bool:
        if self._closed:
            return False
        try:
            return self._authorize is None or await self._authorize(alarm)
        except Exception as err:  # noqa: BLE001 — unavailable authorization must fail closed
            _LOGGER.warning("Atom Home alarm: authorization failed for %s: %s", alarm["id"], err)
            return False

    # ---- the light ----------------------------------------------------------------------------
    async def _fade(self, alarm: dict, ring_at: datetime) -> None:
        """1 % → 100 % from now to the ring, by the clock: a sunrise that did not begin exactly `fadeMin` before the ring
        (Home Assistant started in the middle of it, the alarm was saved late) still ends at the ring and not up to half a
        minute before it, so a save in that gap finds it running and does not begin it again from 1 %."""
        ring_at = ring_at.astimezone(timezone.utc)
        total = max(1.0, (ring_at - dt_util.now().astimezone(timezone.utc)).total_seconds())
        warned = False
        while True:
            left = (ring_at - dt_util.now().astimezone(timezone.utc)).total_seconds()
            if left <= 0:
                return  # the ring itself puts the lamp at 100 %
            if not await self._allowed(alarm) or self._closed:
                return
            step = min(FADE_STEP, left)
            pct = max(1, min(100, round(1 + 99 * (1 - left / total))))
            try:
                await self.hass.services.async_call("light", "turn_on", {"entity_id": alarm["lightEntity"], "brightness_pct": pct, "transition": max(1, round(min(step, total)))}, blocking=False)
            except asyncio.CancelledError:
                raise
            except Exception as err:  # noqa: BLE001
                # Home Assistant is still starting and `light` has no service yet, or the lamp refused once: the next step
                # tries again. Giving up here left the room dark until the ring.
                if not warned:
                    _LOGGER.warning("Atom Home alarm: a step of the sunrise on %s failed, the next one is tried: %s", alarm["lightEntity"], err)
                    warned = True
            await asyncio.sleep(step)

    # ---- ringing ------------------------------------------------------------------------------
    def _queue_ring(self, ring: _Ring, quiet: bool = False) -> None:
        if self._closed or ring not in self._active:
            return
        self._cancel_stop_timer(ring)
        ring.task = self._task(self._ring(ring, quiet))

    async def _ring_text(self, ring: _Ring) -> None:
        alarm = ring.alarm
        await self.hass.services.async_call("input_text", "set_value", {"entity_id": RING_TEXT, "value": f"{alarm['id']}|{alarm['room']}|{alarm['time']}|{alarm['label']}|{ring.repeat_left}"[:255]}, blocking=False)

    async def _ring(self, ring: _Ring, quiet: bool = False) -> None:
        alarm = ring.alarm
        if quiet:
            await self._quiet_ring(ring)
        if not await self._allowed(alarm):
            if ring in self._active:
                self._active.remove(ring)
                await self._refresh_banner()
            return
        if self._closed or ring not in self._active:
            return
        ring.ringing = True
        try:
            if alarm["light"] and alarm["lightEntity"]:
                await self.hass.services.async_call("light", "turn_on", {"entity_id": alarm["lightEntity"], "brightness_pct": 100}, blocking=False)
            await self._ring_text(ring)
            await self.hass.services.async_call("input_boolean", "turn_on", {"entity_id": RING_FLAG}, blocking=False)
            if alarm["alice"] != "off" and alarm["station"]:
                # A speaker has one playback stream. Its newest command owns cleanup;
                # an older occurrence's deadline must not stop this newer sound.
                for previous in self._active:
                    if previous.alarm["station"] == alarm["station"]:
                        previous.speaker_started = False
                ring.speaker_started = True
                if alarm["alice"] == "tts":
                    await self.hass.services.async_call("media_player", "play_media", {"entity_id": alarm["station"], "media_content_type": "text", "media_content_id": alarm["phrase"] or "Доброе утро, пора вставать"}, blocking=False)
                else:
                    await self.hass.services.async_call("yandex_station", "send_command", {"entity_id": alarm["station"], "command": "включи музыку"}, blocking=False)
            # No push for alarms (owner's decision 04.11.2026): the speaker, the light and the panel banner wake people up.
        except Exception as err:  # noqa: BLE001
            _LOGGER.warning("Atom Home alarm: ring failed: %s", err)
        # Without an answer: repeat after the interval while repeats remain, else stop after AUTO_STOP.
        if not self._closed and ring in self._active:
            delay = timedelta(minutes=alarm["repeatEveryMin"]) if ring.repeat_left > 0 else AUTO_STOP

            @callback
            def auto_next(_now: datetime) -> None:
                self._auto_next(ring)

            ring.stop_unsub = async_track_point_in_time(self.hass, auto_next, dt_util.now().astimezone(timezone.utc) + delay)

    @callback
    def _auto_next(self, ring: _Ring) -> None:
        ring.stop_unsub = None
        if self._closed or ring not in self._active:
            return
        if ring.repeat_left > 0:
            ring.repeat_left -= 1
            self._queue_ring(ring, quiet=True)
        else:
            self._task(self._stop_ring(ring))

    def _cancel_stop_timer(self, ring: _Ring) -> None:
        if ring.stop_unsub:
            ring.stop_unsub()
            ring.stop_unsub = None

    async def _quiet_ring(self, ring: _Ring) -> None:
        # A pending authorization check has not granted ownership of the speaker.
        # Cancelling that work must not send even a cleanup command to its target.
        if ring.speaker_started and await self._quiet(ring.alarm):
            ring.speaker_started = False

    async def _quiet(self, alarm: dict | None = None) -> bool:
        """Silence the speaker of the alarm that rings. When this run knows of none but the flag is up (HA restarted in the
        middle of a ring), the alarm is found by the id the ringing text holds: the music it started is still playing."""
        alarm = alarm or self._stale()
        if alarm and alarm["alice"] != "off" and alarm["station"]:
            try:
                await self.hass.services.async_call("media_player", "media_stop", {"entity_id": alarm["station"]}, blocking=False)
            except Exception as err:  # noqa: BLE001 — a speaker that is away must not keep the banner up
                _LOGGER.warning("Atom Home alarm: %s was not stopped: %s", alarm["station"], err)
                return False
        return True

    def _stale(self) -> dict | None:
        flag, text = self.hass.states.get(RING_FLAG), self.hass.states.get(RING_TEXT)
        if flag is None or flag.state != "on" or text is None or not isinstance(text.state, str):
            return None
        alarm_id = text.state.split("|", 1)[0]
        return next((a for a in self._alarms if a["id"] == alarm_id), None)

    def start(self) -> None:
        """Clear what a restart left behind once Home Assistant is up: before that the two helpers may not be restored yet
        and the speaker has no service to be stopped with."""
        @callback
        def started(_hass: Any) -> None:
            if not self._closed:
                self._task(self.resume())

        if not self._closed and self._started_unsub is None:
            self._started_unsub = async_at_started(self.hass, started)

    async def resume(self, _hass: Any = None) -> None:
        """After a restart nothing rings: a flag restored as «on» (HA restarted mid-alarm, 04.11.2026 21:52) would leave a stale
        «Будильник» banner on every screen, so it is lowered together with the ringing text, and the speaker is stopped."""
        if self._closed or self._active:
            return
        try:
            await self._quiet()
            if (st := self.hass.states.get(RING_FLAG)) and st.state == "on":
                await self.hass.services.async_call("input_boolean", "turn_off", {"entity_id": RING_FLAG}, blocking=False)
            if (tx := self.hass.states.get(RING_TEXT)) and tx.state not in ("", "unknown", "unavailable"):
                await self.hass.services.async_call("input_text", "set_value", {"entity_id": RING_TEXT, "value": ""}, blocking=False)
        except Exception as err:  # noqa: BLE001
            _LOGGER.warning("Atom Home alarm: the ringing flag was not cleared after the restart: %s", err)

    async def stop(self) -> None:
        """Stop all active sounds and repeats; unrelated upcoming sunrises continue."""
        active = list(self._active)
        for ring in active:
            self._drop_ring(ring)
        if active:
            for ring in active:
                await self._quiet_ring(ring)
        else:
            await self._quiet()
        await self._refresh_banner()

    def _drop_ring(self, ring: _Ring) -> None:
        self._cancel_stop_timer(ring)
        if ring.task and not ring.task.done():
            ring.task.cancel()
        if ring in self._active:
            self._active.remove(ring)
        self._cancel_fade(ring.alarm["id"])

    async def _stop_ring(self, ring: _Ring) -> None:
        if ring not in self._active:
            return
        self._drop_ring(ring)
        await self._quiet_ring(ring)
        await self._refresh_banner()

    async def _refresh_banner(self) -> None:
        latest = next((ring for ring in reversed(self._active) if ring.ringing), None)
        if latest:
            await self._ring_text(latest)
        elif (st := self.hass.states.get(RING_FLAG)) and st.state == "on":
            await self.hass.services.async_call("input_boolean", "turn_off", {"entity_id": RING_FLAG}, blocking=False)

    async def snooze(self, minutes: int = 9) -> None:
        active = list(self._active)
        if not active:
            return
        for ring in active:
            self._cancel_stop_timer(ring)
            if ring.task and not ring.task.done():
                ring.task.cancel()
            ring.ringing = False
        for ring in active:
            await self._quiet_ring(ring)
            if not self._closed and ring in self._active:
                @callback
                def wake(_now: datetime, current: _Ring = ring) -> None:
                    self._queue_ring(current)

                ring.stop_unsub = async_track_point_in_time(self.hass, wake, dt_util.now().astimezone(timezone.utc) + timedelta(minutes=minutes))
        await self._refresh_banner()

    @callback
    def _flag_changed(self, event) -> None:
        new = event.data.get("new_state")
        if not self._closed and new is not None and new.state == "off" and any(ring.ringing for ring in self._active):
            # Someone switched the flag off (the panel's Stop button, HA UI): treat as stop.
            self._task(self.stop())

    async def async_shutdown(self) -> None:
        """Cancel pending work before awaiting cleanup of every speaker this run owns."""
        active = list(self._active)
        stale = self._stale() if not active else None
        tasks = list(self._tasks) + [task for task, _key in self._fades.values()]
        self.shutdown()
        for task in tasks:
            try:
                await task
            except asyncio.CancelledError:
                pass
            except Exception as err:  # noqa: BLE001 — cleanup of the remaining speakers still runs
                _LOGGER.warning("Atom Home alarm: task failed during unload: %s", err)
        for ring in active:
            await self._quiet_ring(ring)
        if stale:
            await self._quiet(stale)
        await self._refresh_banner()
        # Audible work is cancelled and the speakers are quiet. Complete durable one-shot
        # bookkeeping before the next setup reads storage; do not cancel it with ring tasks.
        for task in list(self._writes):
            await task

    def shutdown(self) -> None:
        self._closed = True
        self._clear()
        for ring in list(self._active):
            self._drop_ring(ring)
        for task in list(self._tasks):
            task.cancel()
        for alarm_id in list(self._fades):
            self._cancel_fade(alarm_id)
        if self._started_unsub:
            self._started_unsub()
            self._started_unsub = None
        self._flag_unsub()
