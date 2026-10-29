"""Config storage: revisions, one writer at a time, disk before memory, and the guard against panels that would drop device setup."""
from __future__ import annotations

import asyncio
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from pytest_homeassistant_custom_component.common import MockConfigEntry

from custom_components.atom_home import async_setup_entry
from custom_components.atom_home.config_state import ConfigState, ConfigWriteError, has_wizard_fields
from custom_components.atom_home.const import CLIENT_FEATURE_COMPOSITION, DOMAIN, STORAGE_KEY

BASE = {"schemaVersion": 1, "home": {"name": "Test"}, "devices": {"e:light.a": {"enabled": False}}}
WIZARD = {"schemaVersion": 1, "devices": {"w:1": {"composition": {"version": 1, "sourceDeviceIds": [], "primaryEntityId": "sensor.a", "entities": {}}}}}


def state(config=None, revision=0, save=None) -> ConfigState:
    return ConfigState(config, revision, save or AsyncMock())


async def test_write_increments_revision_and_persists_it() -> None:
    save = AsyncMock()
    s = state(save=save)
    assert await s.write(BASE) == 1
    assert await s.write(BASE, expected_revision=1) == 2
    save.assert_awaited_with({"config": BASE, "revision": 2})
    assert s.revision == 2 and s.config == BASE


async def test_stale_revision_is_a_conflict_and_changes_nothing() -> None:
    s = state(BASE, 3)
    with pytest.raises(ConfigWriteError) as err:
        await s.write({**BASE, "home": {"name": "Other"}}, expected_revision=2)
    assert err.value.code == "conflict"
    assert s.revision == 3 and s.config == BASE


async def test_two_concurrent_writes_with_one_revision_exactly_one_wins() -> None:
    async def slow_save(_: dict) -> None:
        await asyncio.sleep(0.01)

    s = state(BASE, 5, slow_save)
    results = await asyncio.gather(s.write(BASE, expected_revision=5), s.write(BASE, expected_revision=5), return_exceptions=True)
    assert sorted(type(r).__name__ for r in results) == ["ConfigWriteError", "int"]
    assert [r.code for r in results if isinstance(r, ConfigWriteError)] == ["conflict"]
    assert s.revision == 6


async def test_disk_failure_is_reported_and_memory_keeps_the_last_saved_config() -> None:
    s = state(BASE, 1, AsyncMock(side_effect=OSError("disk full")))
    with pytest.raises(ConfigWriteError) as err:
        await s.write({**BASE, "home": {"name": "New"}}, expected_revision=1)
    assert err.value.code == "save_failed"
    assert s.revision == 1 and s.config == BASE


@pytest.mark.parametrize(("payload", "code"), [
    ({"schemaVersion": 2}, "bad_schema"),
    ([], "bad_schema"),
    ({"schemaVersion": 1, "home": {"name": "x" * (513 * 1024)}}, "too_large"),
])
async def test_malformed_or_huge_configs_are_rejected(payload, code) -> None:
    s = state(BASE, 1)
    with pytest.raises(ConfigWriteError) as err:
        await s.write(payload)
    assert err.value.code == code
    assert s.revision == 1


def test_wizard_fields_are_detected_per_device() -> None:
    assert not has_wizard_fields(None)
    assert not has_wizard_fields(BASE)
    assert has_wizard_fields(WIZARD)
    assert has_wizard_fields({"devices": {"p:feeder:1": {"type": "pet_feeder"}}})


async def test_old_panels_keep_saving_until_a_device_setup_is_stored() -> None:
    s = state(BASE, 1)
    assert await s.write(BASE) == 2  # no revision, no features: today's panel
    assert await s.write(WIZARD, expected_revision=2, client_features=[CLIENT_FEATURE_COMPOSITION]) == 3
    for kwargs in ({}, {"expected_revision": 3}, {"client_features": [CLIENT_FEATURE_COMPOSITION]}):
        with pytest.raises(ConfigWriteError) as err:
            await s.write(BASE, **kwargs)
        assert err.value.code == "client_outdated"
    assert s.config == WIZARD
    assert await s.write(BASE, expected_revision=3, client_features=[CLIENT_FEATURE_COMPOSITION]) == 4  # explicit reset by a new panel


async def _setup(hass, hass_storage, stored=None):
    if stored is not None:
        hass_storage[STORAGE_KEY] = {"version": 1, "minor_version": 1, "key": STORAGE_KEY, "data": stored}
    entry = MockConfigEntry(domain=DOMAIN)
    entry.add_to_hass(hass)
    hass.http = MagicMock(async_register_static_paths=AsyncMock())
    with patch("custom_components.atom_home.panel_custom.async_register_panel", AsyncMock()):
        assert await async_setup_entry(hass, entry)
    return entry


async def test_ws_get_reports_revision_and_set_returns_the_next_one(hass, hass_ws_client, hass_storage) -> None:
    await _setup(hass, hass_storage, {"config": BASE, "revision": 7})
    ws = await hass_ws_client(hass)
    await ws.send_json({"id": 1, "type": f"{DOMAIN}/config/get"})
    got = await ws.receive_json()
    assert got["success"] and got["result"]["revision"] == 7 and got["result"]["config"] == BASE

    await ws.send_json({"id": 2, "type": f"{DOMAIN}/capabilities/get"})
    caps = await ws.receive_json()
    assert caps["result"] == {"configRevision": 1, "composition": 1, "assist": 0}

    await ws.send_json({"id": 3, "type": f"{DOMAIN}/config/set", "config": BASE, "expected_revision": 7})
    saved = await ws.receive_json()
    assert saved["success"] and saved["result"] == {"saved": True, "revision": 8}

    await ws.send_json({"id": 4, "type": f"{DOMAIN}/config/set", "config": BASE, "expected_revision": 7})
    stale = await ws.receive_json()
    assert not stale["success"] and stale["error"]["code"] == "conflict"


async def test_legacy_storage_without_revision_starts_at_zero(hass, hass_ws_client, hass_storage) -> None:
    await _setup(hass, hass_storage, {"config": BASE})
    ws = await hass_ws_client(hass)
    await ws.send_json({"id": 1, "type": f"{DOMAIN}/config/set", "config": BASE})
    saved = await ws.receive_json()
    assert saved["result"]["revision"] == 1


async def test_revision_survives_a_restart(hass, hass_ws_client, hass_storage) -> None:
    entry = await _setup(hass, hass_storage, {"config": BASE, "revision": 2})
    ws = await hass_ws_client(hass)
    await ws.send_json({"id": 1, "type": f"{DOMAIN}/config/set", "config": BASE, "expected_revision": 2})
    got = await ws.receive_json(); assert got.get("result", {}).get("revision") == 3, got
    await hass.async_block_till_done()
    assert hass_storage[STORAGE_KEY]["data"] == {"config": BASE, "revision": 3}

    hass.data[DOMAIN].pop(entry.entry_id)
    hass.http = MagicMock(async_register_static_paths=AsyncMock())  # the websocket client fixture started a real, frozen HTTP app
    with patch("custom_components.atom_home.panel_custom.async_register_panel", AsyncMock()):
        assert await async_setup_entry(hass, entry)
    await ws.send_json({"id": 2, "type": f"{DOMAIN}/config/get"})
    got = await ws.receive_json(); assert got.get("result", {}).get("revision") == 3, got


async def test_non_admin_cannot_write(hass, hass_ws_client, hass_storage, hass_read_only_access_token) -> None:
    await _setup(hass, hass_storage, {"config": BASE, "revision": 1})
    ws = await hass_ws_client(hass, hass_read_only_access_token)
    await ws.send_json({"id": 1, "type": f"{DOMAIN}/config/set", "config": BASE, "expected_revision": 1})
    denied = await ws.receive_json()
    assert not denied["success"] and denied["error"]["code"] == "unauthorized"
    await ws.send_json({"id": 2, "type": f"{DOMAIN}/config/get"})
    assert (await ws.receive_json())["result"]["revision"] == 1
