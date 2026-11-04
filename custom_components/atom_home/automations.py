"""Read-only view of the automations that touch the panel's devices (AUTO-2 of the audit of 04.11.2026).

The panel shows «Автоматика (N)» in a device sheet: which HA automations reference the card's entities, device or area,
when they last ran and whether they are switched on. Nothing here changes HA: no turn_on/off, no trigger.
"""
from __future__ import annotations

import logging
from typing import Any

from homeassistant.core import HomeAssistant

_LOGGER = logging.getLogger(__name__)


def _strings(value: Any) -> list[str]:
    if isinstance(value, str):
        return [value]
    if isinstance(value, (list, tuple, set)):
        return [v for v in value if isinstance(v, str)]
    return []


def _walk(node: Any, entities: set[str], devices: set[str], areas: set[str]) -> None:
    """Collect every entity / device / area id named anywhere in a raw automation config (fallback when HA's helpers fail)."""
    if isinstance(node, dict):
        for key, value in node.items():
            if key == "entity_id":
                entities.update(v for v in _strings(value) if "." in v)
            elif key == "device_id":
                devices.update(_strings(value))
            elif key == "area_id":
                areas.update(_strings(value))
            else:
                _walk(value, entities, devices, areas)
    elif isinstance(node, (list, tuple)):
        for item in node:
            _walk(item, entities, devices, areas)


def automation_rows(hass: HomeAssistant) -> list[dict[str, Any]]:
    """One row per automation: name, description, enabled, last run, referenced entities / devices / areas."""
    try:
        from homeassistant.components import automation as automation_component
    except Exception:  # pragma: no cover - the automation integration is always present on a real instance
        return []
    component = hass.data.get("automation")
    rows: list[dict[str, Any]] = []
    for state in hass.states.async_all("automation"):
        entity_id = state.entity_id
        entities: set[str] = set()
        devices: set[str] = set()
        areas: set[str] = set()
        description = ""
        try:
            entities.update(automation_component.entities_in_automation(hass, entity_id))
            devices.update(automation_component.devices_in_automation(hass, entity_id))
            areas.update(automation_component.areas_in_automation(hass, entity_id))
        except Exception as err:  # helpers missing or changed: fall back to the raw config below
            _LOGGER.debug("automation helpers failed for %s: %s", entity_id, err)
        try:
            entity = component.get_entity(entity_id) if component is not None and hasattr(component, "get_entity") else None
            raw = getattr(entity, "raw_config", None)
            if isinstance(raw, dict):
                desc = raw.get("description")
                description = desc.strip() if isinstance(desc, str) else ""
                if not entities and not devices and not areas:
                    _walk(raw, entities, devices, areas)
        except Exception as err:
            _LOGGER.debug("raw config unavailable for %s: %s", entity_id, err)
        entities.discard(entity_id)
        last = state.attributes.get("last_triggered")
        rows.append({
            "entityId": entity_id,
            "name": state.attributes.get("friendly_name") or entity_id,
            "description": description,
            "enabled": state.state == "on",
            "lastTriggered": last.isoformat() if hasattr(last, "isoformat") else (last if isinstance(last, str) else None),
            "entities": sorted(entities),
            "devices": sorted(devices),
            "areas": sorted(areas),
        })
    rows.sort(key=lambda r: (not r["enabled"], r["name"].lower()))
    return rows
