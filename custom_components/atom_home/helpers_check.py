"""The helpers the panel works through, and which of them Home Assistant lacks.

The alarm banner and the lamp timers read three of them (RING_FLAG, RING_TEXT, SLEEP_MIRROR); the clock's shared timers live in
`timer.atom_1…3` with their labels in one `input_text` and a «timer done» flag. On the first house they were made by hand; a new house
had none, and the «Time» sheet showed no timers at all (26.11.2026). Home Assistant gives an integration no way to create a helper
(the storage collections of `timer`, `input_boolean` and `input_text` are private to them), so the integration hands an administrator's
panel the list of missing ones (`claim`), once at a time, and the panel creates them through Home Assistant's own `<domain>/create`.
What is still missing after that goes to «Исправления».
Kept free of Home Assistant imports so the rule is testable without it.
"""
from __future__ import annotations

from typing import Any, Callable

RING_FLAG = "input_boolean.alarm_ringing"
RING_TEXT = "input_text.alarm_ringing"
SLEEP_MIRROR = "input_text.atom_light_sleep"
TIMERS = ("timer.atom_1", "timer.atom_2", "timer.atom_3")
TIMER_LABELS = "input_text.atom_timer_labels"
TIMER_DONE = "input_boolean.timer_done"
TEXT_MAX = 255
LEASE_SECONDS = 120  # one panel creates; another that opens meanwhile gets nothing to do

# entity id → what `<domain>/create` gets. Home Assistant makes the object id from the name (slugify): «Atom 1» → atom_1.
SPECS: dict[str, dict[str, Any]] = {
    RING_FLAG: {"name": "Alarm ringing", "icon": "mdi:alarm-bell"},
    RING_TEXT: {"name": "Alarm ringing", "max": TEXT_MAX, "icon": "mdi:alarm-bell"},
    SLEEP_MIRROR: {"name": "Atom light sleep", "max": TEXT_MAX, "icon": "mdi:lightbulb-auto"},
    **{t: {"name": f"Atom {n}", "icon": "mdi:timer-outline", "restore": True} for n, t in enumerate(TIMERS, 1)},
    TIMER_LABELS: {"name": "Atom timer labels", "max": TEXT_MAX, "icon": "mdi:label-outline"},
    TIMER_DONE: {"name": "Timer done", "icon": "mdi:timer-check-outline"},
}


def missing_helpers(get_state: Callable[[str], Any]) -> list[str]:
    """Entity ids of the alarm and lamp helpers Home Assistant does not have (the clock's are optional: no timers, no timer block)."""
    return [entity_id for entity_id in (RING_FLAG, RING_TEXT, SLEEP_MIRROR) if get_state(entity_id) is None]


def short_helpers(get_state: Callable[[str], Any]) -> list[str]:
    """The text helpers created with a length under 255 (the default is 100): a long value is refused by Home Assistant."""
    short = []
    for entity_id in (RING_TEXT, SLEEP_MIRROR):  # the labels' helper is created with 255 now; a hand-made one of the first house is not judged anew
        state = get_state(entity_id)
        limit = (getattr(state, "attributes", None) or {}).get("max") if state is not None else None
        if isinstance(limit, (int, float)) and limit < TEXT_MAX:
            short.append(entity_id)
    return short


def to_create(get_state: Callable[[str], Any], registered: Callable[[str], bool]) -> list[dict[str, Any]]:
    """What a panel should create: helpers with no state and no registry entry. An entry without a state is one the owner
    disabled or one being loaded; creating then would make `timer.atom_1_2`, which nothing reads."""
    out = []
    for entity_id, params in SPECS.items():
        if get_state(entity_id) is None and not registered(entity_id):
            domain, object_id = entity_id.split(".", 1)
            out.append({"entity_id": entity_id, "domain": domain, "object_id": object_id, "params": dict(params)})
    return out


class Lease:
    """One claimant at a time: the kiosks reload together after an update, and two panels creating the same helper make a `_2`.
    The holder may claim again (a helper that failed is tried once more at once); another one waits out the two minutes."""

    def __init__(self, now: Callable[[], float]) -> None:
        self._now = now
        self._until = 0.0
        self._holder: object = None

    def take(self, holder: object) -> bool:
        if self._now() < self._until and holder != self._holder:
            return False
        self._until, self._holder = self._now() + LEASE_SECONDS, holder
        return True
