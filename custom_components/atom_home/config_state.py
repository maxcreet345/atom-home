"""Revisioned house configuration: one writer at a time, disk first, and no silent loss of fields an older panel does not know.

Kept free of Home Assistant imports so the write rules are testable without a running instance.
"""
from __future__ import annotations

import asyncio
import json
from typing import Any, Awaitable, Callable, Optional

from .const import CLIENT_FEATURE_COMPOSITION, MAX_CONFIG_BYTES, WIZARD_DEVICE_FIELDS


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


class ConfigState:
    """In-memory copy of `.storage/atom_home.config` plus its revision. `save` persists `{config, revision}`."""

    def __init__(self, config: Optional[dict], revision: int, save: Callable[[dict], Awaitable[None]]) -> None:
        self.config = config
        self.revision = revision if isinstance(revision, int) and revision >= 0 else 0
        self._save = save
        self._lock = asyncio.Lock()

    async def write(self, config: Any, expected_revision: Optional[int] = None, client_features: Optional[list] = None) -> int:
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
            revision = self.revision + 1
            try:
                await self._save({"config": config, "revision": revision})
            except Exception as err:  # noqa: BLE001 — any storage failure must surface as a failed save
                raise ConfigWriteError("save_failed", "Configuration could not be written") from err
            self.config, self.revision = config, revision
            return revision
