"""Read-only journal of a Xiaomi pet feeder, as the Mi Home card shows it.

The feeder keeps what the cat ate and what it dispensed as MIOT events in Xiaomi's cloud; the local
properties do not carry them, and on xiaomi.feeder.iv2001 the local desiccant reads 0 % while the cloud has
the real value. The panel asks here; this asks the xiaomi_miot integration (the owner's own account, its own
session) through two fixed read calls. No device command is possible from this module, the API paths are
constants and the panel passes only the entity it wants the journal of.
"""
from __future__ import annotations

import json
import logging
import time
from typing import TYPE_CHECKING, Any

if TYPE_CHECKING:
    from homeassistant.core import HomeAssistant

_LOGGER = logging.getLogger(__name__)

CACHE_SECONDS = 60
DAYS = 8
LIMIT = 300
ATE, DISPENSED = "2.1", "2.5"
# ATE: piid 18 grams, 25 time, 28 = 0 one meal / 1 the day's running total, 27 the device's UTC offset
# DISPENSED: piid 8 grams, 16 = 1 by hand / 2 by the plan, 17 time, 27 the device's UTC offset

_cache: dict[str, tuple[float, dict[str, Any] | None]] = {}


def _props(row: dict[str, Any]) -> dict[int, Any]:
    try:
        return {int(p["piid"]): p.get("value") for p in json.loads(row.get("value") or "[]")}
    except (TypeError, ValueError, KeyError, AttributeError):
        return {}


def parse_events(ate: list[dict[str, Any]] | None, dispensed: list[dict[str, Any]] | None) -> tuple[list[dict[str, Any]], int | None]:
    """Xiaomi's rows to the panel's events: one row per meal, the day's running totals dropped, duplicates merged."""
    events: dict[tuple[int, str], dict[str, Any]] = {}
    tz: int | None = None
    for row in ate or []:
        p = _props(row)
        if p.get(28) != 0 or not isinstance(p.get(18), (int, float)):
            continue
        at = p.get(25) or row.get("time")
        if isinstance(at, int):
            events[(at, "ate")] = {"at": at, "kind": "ate", "grams": p[18]}
            tz = p.get(27, tz)
    for row in dispensed or []:
        p = _props(row)
        at = p.get(17) or row.get("time")
        if isinstance(at, int) and isinstance(p.get(8), (int, float)):
            kind = "manual" if p.get(16) == 1 else "plan"
            events[(at, kind)] = {"at": at, "kind": kind, "grams": p[8]}
            tz = p.get(27, tz)
    return sorted(events.values(), key=lambda e: e["at"]), tz if isinstance(tz, int) else None


def parse_desiccant(rows: list[dict[str, Any]] | None) -> dict[str, int] | None:
    values = {r.get("piid"): r.get("value") for r in rows or [] if r.get("code") == 0}
    level, days = values.get(1), values.get(2)
    return {"level": level, "days": days} if isinstance(level, int) and isinstance(days, int) else None


def device_did(attributes: dict[str, Any]) -> str | None:
    """Xiaomi's id of the device: `did` on current xiaomi_miot, `miot_did` on older ones."""
    did = attributes.get("did") or attributes.get("miot_did")
    return str(did) if did else None


async def feeder_log(hass: HomeAssistant, entity_id: str) -> dict[str, Any] | None:
    """The journal of a feeder's entity, cached a minute; None when it is not a feeder or the cloud does not answer."""
    from homeassistant.helpers import device_registry as dr, entity_registry as er

    entry = er.async_get(hass).async_get(entity_id)
    device = dr.async_get(hass).async_get(entry.device_id) if entry and entry.device_id else None
    if not entry or entry.platform != "xiaomi_miot" or not device or not (device.model or "").startswith("xiaomi.feeder."):
        return None
    cached = _cache.get(entity_id)
    if cached and time.monotonic() - cached[0] < CACHE_SECONDS:
        return cached[1]
    state = hass.states.get(entity_id)
    did = device_did(state.attributes) if state else None
    if not did or not hass.services.has_service("xiaomi_miot", "request_xiaomi_api"):
        return None

    async def ask(api: str, data: dict[str, Any]) -> list[dict[str, Any]] | None:
        answer = await hass.services.async_call("xiaomi_miot", "request_xiaomi_api", {"entity_id": entity_id, "api": api, "data": data, "method": "POST", "crypt": True}, blocking=True, return_response=True)
        result = answer.get("result") if isinstance(answer, dict) else None
        return result if isinstance(result, list) else None

    now = int(time.time())
    window = {"did": str(did), "type": "event", "time_start": now - DAYS * 86400, "time_end": now, "limit": LIMIT}
    log: dict[str, Any] | None = None
    try:
        ate = await ask("/user/get_user_device_data", {**window, "key": ATE})
        dispensed = await ask("/user/get_user_device_data", {**window, "key": DISPENSED})
        desiccant = await ask("/miotspec/prop/get", {"params": [{"did": str(did), "siid": 6, "piid": 1}, {"did": str(did), "siid": 6, "piid": 2}]})
        if ate is not None or dispensed is not None:
            events, tz = parse_events(ate, dispensed)
            log = {"events": events, "tz": tz, "desiccant": parse_desiccant(desiccant)}
    except Exception as err:  # the journal is a convenience: the card works without it
        _LOGGER.debug("feeder journal failed: %s", err)
    _cache[entity_id] = (time.monotonic(), log)
    return log
