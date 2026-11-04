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
from datetime import datetime, timedelta
from typing import Any, Callable

from homeassistant.core import HomeAssistant, callback
from homeassistant.helpers.event import async_track_point_in_time, async_track_state_change_event
from homeassistant.util import dt as dt_util

_LOGGER = logging.getLogger(__name__)
RING_FLAG = "input_boolean.alarm_ringing"
RING_TEXT = "input_text.alarm_ringing"
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
    """The next moment this alarm rings: today at `time` if still ahead and the weekday fits, else the next fitting day."""
    hh, mm = (int(x) for x in alarm["time"].split(":"))
    for d in range(0, 8):
        day = (now + timedelta(days=d)).date()
        cand = datetime.combine(day, datetime.min.time(), tzinfo=now.tzinfo).replace(hour=hh, minute=mm)
        if cand <= now:
            continue
        if alarm["days"] and cand.isoweekday() not in alarm["days"]:
            continue
        return cand
    return None


class AlarmScheduler:
    def __init__(self, hass: HomeAssistant) -> None:
        self.hass = hass
        self._alarms: list[dict] = []
        self._unsubs: list[Callable[[], None]] = []
        self._fade_task: asyncio.Task | None = None
        self._ring_task: asyncio.Task | None = None
        self._stop_unsub: Callable[[], None] | None = None
        self._ringing: dict | None = None
        self._repeat_left = 0
        self._ignore_flag_off = False
        self._flag_unsub = async_track_state_change_event(hass, [RING_FLAG], self._flag_changed)

    # ---- scheduling -------------------------------------------------------------------------
    def set_alarms(self, alarms: list[dict]) -> None:
        self._alarms = alarms
        self._reschedule()

    def _clear(self) -> None:
        for u in self._unsubs:
            u()
        self._unsubs = []

    def _reschedule(self) -> None:
        self._clear()
        now = dt_util.now()
        for alarm in self._alarms:
            if not alarm["enabled"]:
                continue
            at = next_fire(alarm, now)
            if at is None:
                continue
            self._unsubs.append(async_track_point_in_time(self.hass, self._make(alarm, "ring"), at))
            if alarm["light"] and alarm["fadeMin"]:
                fade_at = at - timedelta(minutes=alarm["fadeMin"])
                if fade_at > now:
                    self._unsubs.append(async_track_point_in_time(self.hass, self._make(alarm, "fade"), fade_at))
                else:
                    self.hass.async_create_task(self._fade(alarm, at))
        _LOGGER.debug("Atom Home alarms: %d scheduled", len(self._unsubs))

    def _make(self, alarm: dict, what: str):
        @callback
        def fire(_now: datetime) -> None:
            if what == "fade":
                self.hass.async_create_task(self._fade(alarm, next_fire(alarm, dt_util.now()) or dt_util.now()))
            else:
                self.hass.async_create_task(self._ring(alarm, first=True))
                self._reschedule()
        return fire

    def summary(self) -> dict:
        now = dt_util.now()
        return {"count": len(self._alarms), "next": [{"id": a["id"], "at": (next_fire(a, now) or now).isoformat()} for a in self._alarms if a["enabled"] and next_fire(a, now)], "ringing": self._ringing["id"] if self._ringing else None, "repeatLeft": self._repeat_left}

    # ---- the light ----------------------------------------------------------------------------
    async def _fade(self, alarm: dict, ring_at: datetime) -> None:
        if self._fade_task and not self._fade_task.done():
            self._fade_task.cancel()
        self._fade_task = asyncio.current_task()
        total = max(1, int((ring_at - dt_util.now()).total_seconds()))
        steps = max(1, total // FADE_STEP)
        try:
            for i in range(steps + 1):
                pct = max(1, min(100, round(1 + 99 * i / steps)))
                await self.hass.services.async_call("light", "turn_on", {"entity_id": alarm["lightEntity"], "brightness_pct": pct, "transition": min(FADE_STEP, total)}, blocking=False)
                if i < steps:
                    await asyncio.sleep(FADE_STEP)
        except asyncio.CancelledError:
            raise
        except Exception as err:  # noqa: BLE001
            _LOGGER.warning("Atom Home alarm: light fade failed: %s", err)

    # ---- ringing ------------------------------------------------------------------------------
    async def _ring(self, alarm: dict, first: bool) -> None:
        self._ringing = alarm
        if first:
            self._repeat_left = alarm["repeats"]
        self._cancel_stop_timer()
        try:
            if alarm["light"] and alarm["lightEntity"]:
                await self.hass.services.async_call("light", "turn_on", {"entity_id": alarm["lightEntity"], "brightness_pct": 100}, blocking=False)
            await self.hass.services.async_call("input_text", "set_value", {"entity_id": RING_TEXT, "value": f"{alarm['id']}|{alarm['room']}|{alarm['time']}|{alarm['label']}|{self._repeat_left}"[:255]}, blocking=False)
            await self.hass.services.async_call("input_boolean", "turn_on", {"entity_id": RING_FLAG}, blocking=False)
            if alarm["alice"] != "off" and alarm["station"]:
                if alarm["alice"] == "tts":
                    await self.hass.services.async_call("media_player", "play_media", {"entity_id": alarm["station"], "media_content_type": "text", "media_content_id": alarm["phrase"] or "Доброе утро, пора вставать"}, blocking=False)
                else:
                    await self.hass.services.async_call("yandex_station", "send_command", {"entity_id": alarm["station"], "command": "включи музыку"}, blocking=False)
            # No push for alarms (owner's decision 04.11.2026): the speaker, the light and the panel banner wake people up.
        except Exception as err:  # noqa: BLE001
            _LOGGER.warning("Atom Home alarm: ring failed: %s", err)
        # Without an answer: repeat after the interval while repeats remain, else stop after AUTO_STOP.
        delay = timedelta(minutes=alarm["repeatEveryMin"]) if self._repeat_left > 0 else AUTO_STOP
        self._stop_unsub = async_track_point_in_time(self.hass, self._auto_next, dt_util.now() + delay)

    @callback
    def _auto_next(self, _now: datetime) -> None:
        self._stop_unsub = None
        alarm = self._ringing
        if alarm is None:
            return
        if self._repeat_left > 0:
            self._repeat_left -= 1
            self.hass.async_create_task(self._quiet())
            self.hass.async_create_task(self._ring(alarm, first=False))
        else:
            self.hass.async_create_task(self.stop())

    def _cancel_stop_timer(self) -> None:
        if self._stop_unsub:
            self._stop_unsub()
            self._stop_unsub = None

    async def _quiet(self) -> None:
        alarm = self._ringing
        if alarm and alarm["alice"] != "off" and alarm["station"]:
            await self.hass.services.async_call("media_player", "media_stop", {"entity_id": alarm["station"]}, blocking=False)

    async def stop(self) -> None:
        """Stop the sound and the repeats; the light stays as it is."""
        self._cancel_stop_timer()
        if self._fade_task and not self._fade_task.done():
            self._fade_task.cancel()
        await self._quiet()
        self._ringing = None
        self._repeat_left = 0
        if (st := self.hass.states.get(RING_FLAG)) and st.state == "on":
            await self.hass.services.async_call("input_boolean", "turn_off", {"entity_id": RING_FLAG}, blocking=False)

    async def snooze(self, minutes: int = 9) -> None:
        alarm = self._ringing
        if alarm is None:
            return
        self._cancel_stop_timer()
        await self._quiet()
        self._ignore_flag_off = True
        if (st := self.hass.states.get(RING_FLAG)) and st.state == "on":
            await self.hass.services.async_call("input_boolean", "turn_off", {"entity_id": RING_FLAG}, blocking=True)
        self._stop_unsub = async_track_point_in_time(self.hass, lambda _n: self.hass.async_create_task(self._ring(alarm, first=False)), dt_util.now() + timedelta(minutes=minutes))

    @callback
    def _flag_changed(self, event) -> None:
        new = event.data.get("new_state")
        if self._ignore_flag_off:
            self._ignore_flag_off = False
            return
        if new is not None and new.state == "off" and self._ringing is not None and self._stop_unsub is not None:
            # Someone switched the flag off (the panel's Stop button, HA UI): treat as stop.
            self.hass.async_create_task(self.stop())

    def shutdown(self) -> None:
        self._clear()
        self._cancel_stop_timer()
        if self._fade_task and not self._fade_task.done():
            self._fade_task.cancel()
        self._flag_unsub()
