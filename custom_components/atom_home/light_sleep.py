"""«Выключить через» for lamps of the Atom Home panel.

The panel asks for a lamp to go off in N minutes; this module keeps the timers in HA (they survive a closed browser
and a restart), switches the lamp off when the time comes, drops the timer when someone switches the lamp off by hand
(only then: a lamp that drops out of the network for a moment keeps its timer), and mirrors the pending list into `input_text.atom_light_sleep` («light.x|17:40;light.y|18:05») so every open panel
shows «выключится в 17:40» without polling.
"""
from __future__ import annotations

import logging
import re
from datetime import datetime, timedelta, timezone
from typing import Any, Callable

from homeassistant.core import HomeAssistant, callback
from homeassistant.helpers.event import async_call_later, async_track_point_in_time, async_track_state_change_event
from homeassistant.helpers.start import async_at_started
from homeassistant.helpers.storage import Store
from homeassistant.util import dt as dt_util

from .helpers_check import SLEEP_MIRROR, TEXT_MAX

_LOGGER = logging.getLogger(__name__)
STORAGE_KEY = "atom_home.light_sleep"
STORAGE_VERSION = 1
MIRROR = SLEEP_MIRROR
MINUTES = (15, 30, 60)  # what the sheet offers; 0 cancels
MIRROR_MAX = TEXT_MAX  # an input_text holds no more; the helper's own `max` may be less
AWAY = ("unavailable",)
WAIT_SECONDS = 600  # a lamp that is away when its time comes is switched off if it returns within this; later it would go dark under someone's hand
ENTITY_RE = re.compile(r"^(light|switch|input_boolean|fan)\.[a-z0-9_]+$")  # a relay the owner shows as a light is a switch (F2 of the audit)


class LightSleep:
    """Pending switch-off times per light entity."""

    def __init__(self, hass: HomeAssistant) -> None:
        self.hass = hass
        self.store: Store[dict] = Store(hass, STORAGE_VERSION, STORAGE_KEY)
        self.pending: dict[str, datetime] = {}
        self._unsubs: dict[str, Callable[[], None]] = {}
        self._watch: Callable[[], None] | None = None
        self._waiting: dict[str, Callable[[], None]] = {}  # the time has come and the lamp is away: entity → cancel of «give up»
        self._contexts: dict[str, Any] = {}  # who asked: the logbook names them at the switch-off
        self._started_unsub: Callable[[], None] | None = None
        self._up = False  # Home Assistant has started: lamps have states and services
        self._lit: set[str] = set()  # went out of the network while on: coming back «off» is then a hand on the switch

    async def async_load(self) -> None:
        data = await self.store.async_load() or {}
        for entity_id, iso in (data.get("pending") or {}).items():
            at = dt_util.parse_datetime(iso) if isinstance(iso, str) else None
            if not isinstance(entity_id, str) or not ENTITY_RE.match(entity_id) or at is None:
                continue
            self.pending[entity_id] = at.astimezone(timezone.utc)
        # The ones missed while HA was down are caught up once it is up: before that the lamp has no state and no service.
        self._started_unsub = async_at_started(self.hass, self._started)

    async def _started(self, _hass: Any = None) -> None:
        self._started_unsub, self._up = None, True
        now = dt_util.now().astimezone(timezone.utc)
        stale = False
        for entity_id, at in list(self.pending.items()):
            if at > now:
                continue
            if (now - at).total_seconds() > WAIT_SECONDS:
                # Home Assistant was down for long (a night without power): hours after its time the lamp is on because
                # someone switched it on, and it must not go dark under their hand — the same rule as for a lamp that was away.
                _LOGGER.warning("Atom Home light sleep: the time of %s passed %d min ago while Home Assistant was down; the timer is dropped", entity_id, (now - at).total_seconds() // 60)
                self._forget(entity_id)
                stale = True
            else:
                await self._off(entity_id)
        self._reschedule()
        if stale:
            await self._save()
        await self._mirror()

    def summary(self) -> dict[str, str]:
        return {k: dt_util.as_local(v).isoformat() for k, v in self.pending.items()}

    async def schedule(self, entity_id: str, minutes: int, context: Any = None) -> datetime | None:
        """Set (minutes > 0) or cancel (0) the switch-off of a lamp; returns the time it will go off."""
        if not ENTITY_RE.match(entity_id):
            raise ValueError("not a light")
        self._forget(entity_id)
        if minutes > 0:
            self.pending[entity_id] = dt_util.now().astimezone(timezone.utc) + timedelta(minutes=minutes)
            if context is not None:
                self._contexts[entity_id] = context
        self._reschedule()
        await self._save()
        await self._mirror()
        at = self.pending.get(entity_id)
        return dt_util.as_local(at) if at is not None else None

    def _forget(self, entity_id: str) -> None:
        self.pending.pop(entity_id, None)
        self._contexts.pop(entity_id, None)
        self._lit.discard(entity_id)
        self._unsubs.pop(entity_id, lambda: None)()
        self._waiting.pop(entity_id, lambda: None)()

    def _reschedule(self) -> None:
        for unsub in self._unsubs.values():
            unsub()
        self._unsubs.clear()
        if self._up:  # until HA is up nothing fires: the overdue ones are taken by _started
            for entity_id, at in self.pending.items():
                if entity_id not in self._waiting:
                    self._unsubs[entity_id] = async_track_point_in_time(self.hass, self._fire(entity_id), at)
        if self._watch:
            self._watch()
            self._watch = None
        if self.pending:
            self._watch = async_track_state_change_event(self.hass, list(self.pending), self._changed)

    def _fire(self, entity_id: str):
        @callback
        def fire(_now: datetime) -> None:
            self.hass.async_create_task(self._off(entity_id))
        return fire

    async def _off(self, entity_id: str) -> None:
        if entity_id not in self.pending:
            return
        state = self.hass.states.get(entity_id)
        if state is None or state.state in AWAY:
            # Out of the network at this moment (Zigbee2MQTT restarting, HA just up): the command would go nowhere and the
            # lamp would burn all night. The timer is kept for a while and done the moment the lamp answers again.
            self._unsubs.pop(entity_id, lambda: None)()
            if entity_id not in self._waiting:
                self._waiting[entity_id] = async_call_later(self.hass, WAIT_SECONDS, self._give_up(entity_id))
            return
        context = self._contexts.get(entity_id)
        self._forget(entity_id)
        try:
            if entity_id.startswith("light."):
                await self.hass.services.async_call("light", "turn_off", {"entity_id": entity_id, "transition": 2}, blocking=True, context=context)
            else:  # S1 of the security review: light.turn_off silently ignores a switch, so the timer never switched a relay-light off
                await self.hass.services.async_call("homeassistant", "turn_off", {"entity_id": entity_id}, blocking=True, context=context)
        except Exception as err:  # noqa: BLE001 — the lamp refused; the timer is spent either way
            _LOGGER.warning("Atom Home light sleep: %s did not switch off: %s", entity_id, err)
        self._reschedule()
        await self._save()
        await self._mirror()

    def _give_up(self, entity_id: str):
        @callback
        def give_up(_now: Any = None) -> None:
            if self._waiting.pop(entity_id, None) is None:
                return
            _LOGGER.warning("Atom Home light sleep: %s was away when its time came and did not return; the timer is dropped", entity_id)
            self._drop(entity_id)
        return give_up

    def _drop(self, entity_id: str) -> None:
        self._forget(entity_id)
        self._reschedule()
        self.hass.async_create_task(self._save())
        self.hass.async_create_task(self._mirror())

    @callback
    def _changed(self, event) -> None:
        """A lamp switched off by hand forgets its timer. Only on → off counts: `unavailable` for a moment, or the entity
        appearing after a restart, is not a hand on the switch. A lamp that was on, dropped out of the network and came
        back «off» (switched off at the wall while Zigbee2MQTT restarted) was switched off too: on → unavailable → off."""
        new, old = event.data.get("new_state"), event.data.get("old_state")
        entity_id = event.data.get("entity_id")
        if entity_id not in self.pending or new is None:
            return
        if entity_id in self._waiting:
            if new.state == "off":
                self._drop(entity_id)
            elif new.state not in AWAY:
                self.hass.async_create_task(self._off(entity_id))  # it is back: the overdue switch-off
        elif new.state == "off" and (entity_id in self._lit or old is not None and old.state == "on"):
            self._drop(entity_id)
        elif new.state == "on":
            self._lit.discard(entity_id)
        elif old is not None and old.state == "on":
            self._lit.add(entity_id)  # on → unavailable / unknown: remembered until it answers again

    async def _save(self) -> None:
        await self.store.async_save({"pending": self.summary()})

    async def _mirror(self) -> None:
        mirror = self.hass.states.get(MIRROR)
        if mirror is None:
            return
        try:
            room = min(MIRROR_MAX, int((getattr(mirror, "attributes", None) or {}).get("max", MIRROR_MAX)))
        except (TypeError, ValueError):
            room = MIRROR_MAX
        value = mirror_text(self.pending, room)
        try:
            await self.hass.services.async_call("input_text", "set_value", {"entity_id": MIRROR, "value": value}, blocking=True)
        except Exception as err:  # noqa: BLE001
            _LOGGER.warning("Atom Home light sleep: %s was not updated, the panel shows the old timers: %s", MIRROR, err)

    def shutdown(self) -> None:
        for unsub in list(self._unsubs.values()) + list(self._waiting.values()):
            unsub()
        self._unsubs.clear()
        self._waiting.clear()
        self._lit.clear()
        if self._started_unsub:
            self._started_unsub()
            self._started_unsub = None
        if self._watch:
            self._watch()
            self._watch = None


def mirror_text(pending: dict[str, datetime], room: int = MIRROR_MAX) -> str:
    """«light.x|17:40;light.y|18:05», the soonest first, whole entries only: half an entry reads in the panel as no timer at all."""
    out = ""
    for entity_id, at in sorted(pending.items(), key=lambda kv: (kv[1].timestamp(), kv[0])):
        entry = f"{entity_id}|{dt_util.as_local(at).strftime('%H:%M')}"
        if len(out) + len(entry) + (1 if out else 0) > room:
            break
        out += (";" if out else "") + entry
    return out
