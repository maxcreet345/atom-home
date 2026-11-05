"""Read-only journal of a Xiaomi pet feeder, as the Mi Home card shows it.

The feeder keeps what the cat ate and what it dispensed as MIOT events in Xiaomi's cloud; the local
properties do not carry them, and on xiaomi.feeder.iv2001 the local desiccant reads 0 % while the cloud has
the real value. The panel asks here; this asks the xiaomi_miot integration (the owner's own account, its own
session) through two fixed read calls. No device command is possible from this module, the API paths are
constants and the panel passes only the entity it wants the journal of.
"""
from __future__ import annotations

import asyncio
import json
import logging
import time
from typing import TYPE_CHECKING, Any

if TYPE_CHECKING:
    from homeassistant.core import HomeAssistant

_LOGGER = logging.getLogger(__name__)

CACHE_SECONDS = 150  # longer than the panel's two-minute poll, so several open panels cost one round to the cloud
FAIL_SECONDS = 30
FRESH_SECONDS = 15  # a panel may ask for a fresh read right after a feed, no oftener
DAYS = 8
LIMIT = 300
ATE, DISPENSED = "2.1", "2.5"
# ATE: piid 18 grams, 25 time, 28 = 0 one meal / 1 the day's running total, 27 the device's UTC offset
# DISPENSED: piid 8 grams, 16 = 1 by hand / 2 by the plan, 17 time, 27 the device's UTC offset

_cache: dict[str, tuple[float, dict[str, Any] | None]] = {}
_running: dict[str, asyncio.Task] = {}


def _props(row: dict[str, Any]) -> dict[int, Any]:
    try:
        return {int(p["piid"]): p.get("value") for p in json.loads(row.get("value") or "[]")}
    except (TypeError, ValueError, KeyError, AttributeError):
        return {}


def parse_events(ate: list[dict[str, Any]] | None, dispensed: list[dict[str, Any]] | None) -> tuple[list[dict[str, Any]], int | None]:
    """Xiaomi's rows to the panel's events: one row per meal, the day's running totals dropped, duplicates merged. The zone is the newest event's."""
    events: dict[tuple[int, str], dict[str, Any]] = {}
    zones: list[tuple[int, int]] = []
    for row in ate or []:
        p = _props(row)
        if p.get(28) != 0 or not isinstance(p.get(18), (int, float)):
            continue
        at = p.get(25) or row.get("time")
        if isinstance(at, int):
            events[(at, "ate")] = {"at": at, "kind": "ate", "grams": p[18]}
            if isinstance(p.get(27), int):
                zones.append((at, p[27]))
    for row in dispensed or []:
        p = _props(row)
        at = p.get(17) or row.get("time")
        if isinstance(at, int) and isinstance(p.get(8), (int, float)):
            kind = "manual" if p.get(16) == 1 else "plan"
            events[(at, kind)] = {"at": at, "kind": kind, "grams": p[8]}
            if isinstance(p.get(27), int):
                zones.append((at, p[27]))
    return sorted(events.values(), key=lambda e: e["at"]), max(zones)[1] if zones else None


def parse_desiccant(rows: list[dict[str, Any]] | None) -> dict[str, int] | None:
    values = {r.get("piid"): r.get("value") for r in rows or [] if r.get("code") == 0}
    level, days = values.get(1), values.get(2)
    return {"level": level, "days": days} if isinstance(level, int) and isinstance(days, int) else None


def device_did(attributes: dict[str, Any]) -> str | None:
    """Xiaomi's id of the device: `did` on current xiaomi_miot, `miot_did` on older ones."""
    did = attributes.get("did") or attributes.get("miot_did")
    return str(did) if did else None


async def _fetch(hass: HomeAssistant, entity_id: str, did: str, device_id: str) -> dict[str, Any] | None:
    async def ask(api: str, data: dict[str, Any]) -> list[dict[str, Any]] | None:
        answer = await hass.services.async_call("xiaomi_miot", "request_xiaomi_api", {"entity_id": entity_id, "api": api, "data": data, "method": "POST", "crypt": True}, blocking=True, return_response=True)
        result = answer.get("result") if isinstance(answer, dict) else None
        return result if isinstance(result, list) else None

    now = int(time.time())
    window = {"did": did, "type": "event", "time_start": now - DAYS * 86400, "time_end": now, "limit": LIMIT}
    try:
        ate = await ask("/user/get_user_device_data", {**window, "key": ATE})
        dispensed = await ask("/user/get_user_device_data", {**window, "key": DISPENSED})
    except Exception as err:  # the journal is a convenience: the card works without it
        _LOGGER.debug("feeder journal failed: %s", err)
        return None
    if ate is None or dispensed is None:  # half a journal would read as «nothing eaten»; the panel keeps the last whole one
        return None
    try:
        desiccant = parse_desiccant(await ask("/miotspec/prop/get", {"params": [{"did": did, "siid": 6, "piid": 1}, {"did": did, "siid": 6, "piid": 2}]}))
    except Exception as err:  # the meals are still good
        _LOGGER.debug("feeder desiccant failed: %s", err)
        desiccant = None
    if desiccant is None:  # a failed read must not blank a known value
        previous = _cache.get(device_id)
        desiccant = previous[1].get("desiccant") if previous and previous[1] else None
    events, tz = parse_events(ate, dispensed)
    return {"events": events, "tz": tz, "desiccant": desiccant}


async def feeder_log(hass: HomeAssistant, entity_id: str, fresh: bool = False) -> dict[str, Any] | None:
    """The journal of a feeder's entity. One round to the cloud per device at a time, cached; None when it is not a feeder or the cloud does not answer."""
    from homeassistant.helpers import device_registry as dr, entity_registry as er

    entry = er.async_get(hass).async_get(entity_id)
    device = dr.async_get(hass).async_get(entry.device_id) if entry and entry.device_id else None
    if not entry or entry.platform != "xiaomi_miot" or not device or not (device.model or "").startswith("xiaomi.feeder."):
        return None
    cached = _cache.get(device.id)
    if cached and time.monotonic() - cached[0] < (FRESH_SECONDS if fresh else CACHE_SECONDS if cached[1] is not None else FAIL_SECONDS):
        return cached[1]
    state = hass.states.get(entity_id)
    did = device_did(state.attributes) if state else None
    if not did or not hass.services.has_service("xiaomi_miot", "request_xiaomi_api"):
        return None
    task = _running.get(device.id)
    if task is None:
        task = _running[device.id] = hass.async_create_task(_fetch(hass, entity_id, did, device.id))
        task.add_done_callback(lambda _: _running.pop(device.id, None))
    log = await asyncio.shield(task)
    _cache[device.id] = (time.monotonic(), log)
    return log
