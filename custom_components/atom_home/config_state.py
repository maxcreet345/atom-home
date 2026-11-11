"""Revisioned house configuration: one writer at a time, disk first, and no silent loss of fields an older panel does not know.

Kept free of Home Assistant imports so the write rules are testable without a running instance.
"""
from __future__ import annotations

import asyncio
import json
from typing import Any, Awaitable, Callable, Optional
from urllib.parse import unquote, urlsplit

from .const import CLIENT_FEATURE_COMPOSITION, CLIENT_FEATURE_ROOM_FEED, CLIENT_FEATURE_TARIFF, MAX_CONFIG_BYTES, WIZARD_DEVICE_FIELDS


class ConfigWriteError(Exception):
    """A rejected write; `code` is sent to the panel as the WebSocket error code."""

    def __init__(self, code: str, message: str) -> None:
        super().__init__(message)
        self.code = code
        self.message = message


def has_wizard_fields(config: Optional[dict]) -> bool:
    """True when a stored config carries per-device fields that only a composition-aware panel preserves on save."""
    devices = (config or {}).get("devices")
    if not isinstance(devices, dict):
        return False
    return any(isinstance(d, dict) and any(f in d for f in WIZARD_DEVICE_FIELDS) for d in devices.values())


def has_room_feeds(config: Optional[dict]) -> bool:
    """True when a stored config maps a room to a house feed (`rooms.<area>.feed`), which a panel before room_feed_v1 drops on save."""
    rooms = (config or {}).get("rooms")
    if not isinstance(rooms, dict):
        return False
    return any(isinstance(r, dict) and "feed" in r for r in rooms.values())


def has_tariffs(config: Optional[dict]) -> bool:
    """True when a stored config holds the electricity price history (`energy.tariffs`), which a panel before energy_tariff_v1 drops on save."""
    energy = (config or {}).get("energy")
    if not isinstance(energy, dict):
        return False
    tariffs = energy.get("tariffs")
    return isinstance(tariffs, list) and len(tariffs) > 0


# What `alarms/set` builds on when nothing is stored yet (a non-admin may set an alarm before the owner opens «Настройка»).
DEFAULT_CONFIG = {"schemaVersion": 1, "home": {"name": "Мой дом", "language": "ru", "theme": "light"}, "rooms": {}, "devices": {}, "entities": {}, "buttons": [], "sections": {}, "modules": {}}

AlarmAuthUpdate = Callable[[list, list, dict], dict]
_AUTH_UNSET = object()


def references_url(value: Any, url: str) -> bool:
    """Find a photo in every saved field, including future modules and URL query/fragment variants."""
    if isinstance(value, str):
        try:
            return unquote(urlsplit(value).path) == url
        except ValueError:
            return False
    if isinstance(value, dict):
        return any(references_url(k, url) or references_url(v, url) for k, v in value.items())
    if isinstance(value, list):
        return any(references_url(v, url) for v in value)
    return False


class ConfigState:
    """In-memory copy of `.storage/atom_home.config` plus its revision. `save` persists `{config, revision}`."""

    def __init__(self, config: Optional[dict], revision: int, save: Callable[[dict], Awaitable[None]], alarm_auth: Any = _AUTH_UNSET) -> None:
        self.config = config
        self.revision = revision if isinstance(revision, int) and revision >= 0 else 0
        self._save = save
        self._lock = asyncio.Lock()
        # Server-owned metadata, never accepted from the panel's config. An additive, separately versioned envelope
        # keeps storage v1 readable and leaves legacy/admin alarms integration-owned. Unknown metadata fails closed.
        self.alarm_auth = None if alarm_auth is _AUTH_UNSET else alarm_auth if isinstance(alarm_auth, dict) else {"version": 0}
        # The revision at which the `alarms` key last changed. What happened before this run is not known, so it starts at
        # the loaded revision: a panel that read the config in this run and saw no alarm change since has the current alarms.
        self.alarms_revision = self.revision

    def _auth_for(self, before: list, after: list, update: Optional[AlarmAuthUpdate]) -> Optional[dict]:
        if update is None:
            return self.alarm_auth
        if self.alarm_auth is not None and (self.alarm_auth.get("version") != 1 or not isinstance(self.alarm_auth.get("authors"), dict)):
            raise ConfigWriteError("unsupported_storage", "Alarm author metadata needs a newer integration")
        authors = update(before, after, (self.alarm_auth or {}).get("authors", {}))
        return {"version": 1, "authors": authors} if authors else None

    @staticmethod
    def _payload(config: dict, revision: int, auth: Optional[dict]) -> dict:
        data = {"config": config, "revision": revision}
        if auth is not None:
            data["alarm_auth"] = auth
        return data

    async def remove_unreferenced(self, url: str, remove: Callable[[], Awaitable[bool]]) -> bool:
        """Check the committed config and remove under the same lock as config writes; `remove` does I/O off-loop."""
        async with self._lock:
            if references_url(self.config, url):
                return False
            removing = asyncio.ensure_future(remove())
            try:
                return await asyncio.shield(removing)
            except asyncio.CancelledError:
                # Cancelling an executor future does not stop its thread. Keep the config lock until unlink really
                # finishes, including if the WebSocket request is cancelled repeatedly during entry/connection teardown.
                while not removing.done():
                    try:
                        await asyncio.shield(removing)
                    except asyncio.CancelledError:
                        pass
                removing.result()
                raise

    async def write(self, config: Any, expected_revision: Optional[int] = None, client_features: Optional[list] = None, *, alarm_auth_update: Optional[AlarmAuthUpdate] = None) -> int:
        """Validate and store a whole config; returns the new revision or raises ConfigWriteError."""
        if not isinstance(config, dict):
            raise ConfigWriteError("bad_schema", "config must be an object")
        if len(json.dumps(config, ensure_ascii=False).encode("utf-8")) > MAX_CONFIG_BYTES:
            raise ConfigWriteError("too_large", f"Configuration exceeds {MAX_CONFIG_BYTES} bytes")
        if config.get("schemaVersion") != 1:
            raise ConfigWriteError("bad_schema", "schemaVersion must be 1")
        async with self._lock:
            if expected_revision is not None and expected_revision != self.revision:
                raise ConfigWriteError("conflict", "Configuration was changed elsewhere")
            # Checked against what is stored, not what arrives: an old panel never sends the fields it would drop.
            if has_wizard_fields(self.config) and (expected_revision is None or CLIENT_FEATURE_COMPOSITION not in (client_features or [])):
                raise ConfigWriteError("client_outdated", "This panel version cannot keep the saved device setup; reload the page")
            if has_room_feeds(self.config) and CLIENT_FEATURE_ROOM_FEED not in (client_features or []):
                raise ConfigWriteError("client_outdated", "This panel version cannot keep the rooms' apartment feeds; reload the page")
            if has_tariffs(self.config) and CLIENT_FEATURE_TARIFF not in (client_features or []):
                raise ConfigWriteError("client_outdated", "This panel version cannot keep the electricity tariff; reload the page")
            auth = self._auth_for((self.config or {}).get("alarms", []), config.get("alarms", []), alarm_auth_update)
            revision = self.revision + 1
            try:
                await self._save(self._payload(config, revision, auth))
            except Exception as err:  # noqa: BLE001 — any storage failure must surface as a failed save
                raise ConfigWriteError("save_failed", "Configuration could not be written") from err
            if (self.config or {}).get("alarms") != config.get("alarms"):
                self.alarms_revision = revision
            self.config, self.revision = config, revision
            self.alarm_auth = auth
            return revision

    async def write_alarms(self, change: Callable[[list], Optional[list]], expected_revision: Optional[int] = None, alarms_seen: Optional[int] = None, *, alarm_auth_update: Optional[AlarmAuthUpdate] = None) -> tuple[int, bool, list]:
        """Replace only the `alarms` key of what is stored; every other key is kept as it is at the moment of the write.

        `change` gets the stored alarms and returns the new list (None: nothing to write). A panel whose revision is behind
        only because of saves that did not touch the alarms (a theme switched on another screen) is not refused: its alarm
        list is the current one, and the rest of the config is not its to send. `alarms_seen` is a later revision whose
        alarms the caller is known to hold (the answer to its own previous alarm save). Returns (revision, current, alarms);
        `current` is False when the caller's revision was not the stored one — it must not take the new revision for its
        own, because the rest of its config copy is older than what is stored."""
        async with self._lock:
            if expected_revision is not None and expected_revision != self.revision and max(expected_revision, alarms_seen or 0) < self.alarms_revision:
                raise ConfigWriteError("conflict", "Configuration was changed elsewhere")
            config = dict(self.config or DEFAULT_CONFIG)
            before = config.get("alarms") if isinstance(config.get("alarms"), list) else []
            alarms = change(list(before))
            if alarms is None:
                return self.revision, expected_revision == self.revision, before
            config["alarms"] = alarms
            if len(json.dumps(config, ensure_ascii=False).encode("utf-8")) > MAX_CONFIG_BYTES:
                raise ConfigWriteError("too_large", f"Configuration exceeds {MAX_CONFIG_BYTES} bytes")
            auth = self._auth_for(before, alarms, alarm_auth_update)
            current = expected_revision == self.revision
            revision = self.revision + 1
            try:
                await self._save(self._payload(config, revision, auth))
            except Exception as err:  # noqa: BLE001 — any storage failure must surface as a failed save
                raise ConfigWriteError("save_failed", "Configuration could not be written") from err
            if before != alarms:
                self.alarms_revision = revision
            self.config, self.revision = config, revision
            self.alarm_auth = auth
            return revision, current, alarms
