"""«Выключить через» for lamps of the Atom Home panel.

The panel asks for a lamp to go off in N minutes; this module keeps the timers in HA (they survive a closed browser
and a restart), switches the lamp off when the time comes, drops the timer when someone switches the lamp off by hand,
and mirrors the pending list into `input_text.atom_light_sleep` («light.x|17:40;light.y|18:05») so every open panel
shows «выключится в 17:40» without polling.
"""
from __future__ import annotations

import logging
import re
from datetime import datetime, timedelta
from typing import Any, Callable

from homeassistant.core import HomeAssistant, callback
from homeassistant.helpers.event import async_track_point_in_time, async_track_state_change_event
from homeassistant.helpers.storage import Store
from homeassistant.util import dt as dt_util

_LOGGER = logging.getLogger(__name__)
STORAGE_KEY = "atom_home.light_sleep"
STORAGE_VERSION = 1
MIRROR = "input_text.atom_light_sleep"
MINUTES = (15, 30, 60)
ENTITY_RE = re.compile(r"^light\.[a-z0-9_]+$")


class LightSleep:
    """Pending switch-off times per light entity."""

    def __init__(self, hass: HomeAssistant) -> None:
        self.hass = hass
        self.store: Store[dict] = Store(hass, STORAGE_VERSION, STORAGE_KEY)
        self.pending: dict[str, datetime] = {}
        self._unsubs: dict[str, Callable[[], None]] = {}
        self._watch: Callable[[], None] | None = None

    async def async_load(self) -> None:
        data = await self.store.async_load() or {}
        now = dt_util.now()
        for entity_id, iso in (data.get("pending") or {}).items():
            at = dt_util.parse_datetime(iso) if isinstance(iso, str) else None
            if not isinstance(entity_id, str) or not ENTITY_RE.match(entity_id) or at is None:
                continue
            at = dt_util.as_local(at)
            if at <= now:
                self.hass.async_create_task(self._off(entity_id))  # missed while HA was down: catch up
            else:
                self.pending[entity_id] = at
        self._reschedule()
        await self._mirror()

    def summary(self) -> dict[str, str]:
        return {k: v.isoformat() for k, v in self.pending.items()}

    async def schedule(self, entity_id: str, minutes: int) -> datetime | None:
        """Set (minutes > 0) or cancel (0) the switch-off of a lamp; returns the time it will go off."""
        if not ENTITY_RE.match(entity_id):
            raise ValueError("not a light")
        if minutes <= 0:
            self.pending.pop(entity_id, None)
        else:
            self.pending[entity_id] = dt_util.now() + timedelta(minutes=minutes)
        self._reschedule()
        await self._save()
        await self._mirror()
        return self.pending.get(entity_id)

    def _reschedule(self) -> None:
        for unsub in self._unsubs.values():
            unsub()
        self._unsubs.clear()
        for entity_id, at in self.pending.items():
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
        self.pending.pop(entity_id, None)
        self._unsubs.pop(entity_id, lambda: None)()
        try:
            await self.hass.services.async_call("light", "turn_off", {"entity_id": entity_id, "transition": 2}, blocking=True)
        except Exception as err:  # noqa: BLE001 — the lamp may be away; the timer is spent either way
            _LOGGER.warning("Atom Home light sleep: %s did not switch off: %s", entity_id, err)
        self._reschedule()
        await self._save()
        await self._mirror()

    @callback
    def _changed(self, event) -> None:
        """A lamp switched off by hand (or gone) forgets its timer."""
        new = event.data.get("new_state")
        entity_id = event.data.get("entity_id")
        if entity_id in self.pending and (new is None or new.state in ("off", "unavailable")):
            self.pending.pop(entity_id, None)
            self._reschedule()
            self.hass.async_create_task(self._save())
            self.hass.async_create_task(self._mirror())

    async def _save(self) -> None:
        await self.store.async_save({"pending": self.summary()})

    async def _mirror(self) -> None:
        if self.hass.states.get(MIRROR) is None:
            return
        value = ";".join(f"{k}|{v.strftime('%H:%M')}" for k, v in sorted(self.pending.items()))[:255]
        try:
            await self.hass.services.async_call("input_text", "set_value", {"entity_id": MIRROR, "value": value}, blocking=True)
        except Exception as err:  # noqa: BLE001
            _LOGGER.debug("Atom Home light sleep mirror: %s", err)

    def shutdown(self) -> None:
        for unsub in self._unsubs.values():
            unsub()
        self._unsubs.clear()
        if self._watch:
            self._watch()
            self._watch = None
