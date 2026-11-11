"""The three helpers the panel reads the alarm and the lamp timers through. The integration does not create them
(an input_boolean / input_text belongs to the owner's Home Assistant); it says so in «Исправления» when one is missing.
Kept free of Home Assistant imports so the rule is testable without it.
"""
from __future__ import annotations

from typing import Any, Callable

RING_FLAG = "input_boolean.alarm_ringing"
RING_TEXT = "input_text.alarm_ringing"
SLEEP_MIRROR = "input_text.atom_light_sleep"
TEXT_MAX = 255


def missing_helpers(get_state: Callable[[str], Any]) -> list[str]:
    """Entity ids of the helpers Home Assistant does not have."""
    return [entity_id for entity_id in (RING_FLAG, RING_TEXT, SLEEP_MIRROR) if get_state(entity_id) is None]


def short_helpers(get_state: Callable[[str], Any]) -> list[str]:
    """The text helpers created with a length under 255 (the default is 100): a long value is refused by Home Assistant."""
    short = []
    for entity_id in (RING_TEXT, SLEEP_MIRROR):
        state = get_state(entity_id)
        limit = (getattr(state, "attributes", None) or {}).get("max") if state is not None else None
        if isinstance(limit, (int, float)) and limit < TEXT_MAX:
            short.append(entity_id)
    return short
