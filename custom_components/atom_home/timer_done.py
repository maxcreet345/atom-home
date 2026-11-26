"""«Таймер готов» without a hand-made automation.

The panel shows the banner «Таймер готов» with «Стоп» on every screen while `input_boolean.timer_done` is on. On the first house an
automation of its own turned it on (and spoke on the speakers, and sent a push); a new house has none, and its timers ended silently
(26.11.2026). The integration now raises the flag itself when one of the clock's timers finishes and lowers it after two minutes, as the
automation did. Only the flag: a house that keeps its automation is not told twice, and turning a flag on twice changes nothing.
"""
from __future__ import annotations

import logging
from typing import Any, Callable

from homeassistant.core import HomeAssistant, callback
from homeassistant.helpers.event import async_call_later

from .helpers_check import TIMER_DONE, TIMERS

_LOGGER = logging.getLogger(__name__)
EVENT = "timer.finished"
HOLD_SECONDS = 120


class TimerDone:
    def __init__(self, hass: HomeAssistant) -> None:
        self.hass = hass
        self._unsub: Callable[[], None] | None = None
        self._lower: Callable[[], None] | None = None

    def start(self) -> None:
        self._unsub = self.hass.bus.async_listen(EVENT, self._finished)

    def shutdown(self) -> None:
        for cancel in (self._unsub, self._lower):
            if cancel:
                cancel()
        self._unsub = self._lower = None

    @callback
    def _finished(self, event: Any) -> None:
        if (event.data or {}).get("entity_id") not in TIMERS or self.hass.states.get(TIMER_DONE) is None:
            return
        self.hass.async_create_task(self._call("turn_on"))
        if self._lower:
            self._lower()
        self._lower = async_call_later(self.hass, HOLD_SECONDS, self._time_up)

    @callback
    def _time_up(self, _now: Any = None) -> None:
        self._lower = None
        state = self.hass.states.get(TIMER_DONE)
        if state is not None and state.state == "on":
            self.hass.async_create_task(self._call("turn_off"))

    async def _call(self, service: str) -> None:
        try:
            await self.hass.services.async_call("input_boolean", service, {"entity_id": TIMER_DONE}, blocking=True)
        except Exception:  # noqa: BLE001 — a flag that could not be set must not break the event bus
            _LOGGER.warning("Atom Home: %s could not be switched %s", TIMER_DONE, service.removeprefix("turn_"), exc_info=True)
