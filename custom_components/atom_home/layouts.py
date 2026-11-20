"""Tile layouts of each screen, one per named device (owner, 20.11.2026): «Планшет кухня», «Телефон Арарата»…

Each device of the house names itself once and keeps its own order and size of the cards on «Главная» and in every room. The layout
lives here, in HA, not in the browser: a phone or a tablet that is replaced (or whose cache is wiped) picks its name from the list and
gets its layout back. Any resident may arrange their own screen, so the payload is checked hard: a short id, a short name, at most so
many devices, screens and cards, spans in whole cells. Nothing here touches the house's configuration (config/set stays the
administrator's). HA-free on purpose: tests/components/atom_home/test_layouts.py runs it without Home Assistant.
"""
from __future__ import annotations

import asyncio
import json
import re
import time
from typing import Any, Awaitable, Callable

STORAGE_KEY = "atom_home.layouts"
STORAGE_VERSION = 1
MAX_PROFILES = 40
MAX_PER_USER = 10  # one resident cannot take every place: the kitchen tablet must still be able to name itself
MAX_SCOPES = 64
MAX_ITEMS = 160
MAX_SPAN = 8
MAX_BYTES = 96_000
PROFILE_ID = re.compile(r"^[a-z0-9][a-z0-9_-]{0,39}$")
SCOPE = re.compile(r"^(home|room:[A-Za-z0-9_.:-]{1,80})$")
KEY = re.compile(r"^[^\x00-\x1f]{1,200}$")


class LayoutError(Exception):
    def __init__(self, code: str, message: str):
        super().__init__(message)
        self.code, self.message = code, message


def _name(value: Any) -> str:
    if not isinstance(value, str):
        raise LayoutError("invalid_name", "The device name must be text")
    name = " ".join(value.split())
    if not 1 <= len(name) <= 40:
        raise LayoutError("invalid_name", "The device name takes 1 to 40 characters")
    return name


def clean_scopes(raw: Any) -> dict[str, list[list[Any]]]:
    """`{scope: [[key, w, h], …]}`: the order of the cards and their spans. Anything else is refused, not trimmed."""
    if not isinstance(raw, dict) or len(raw) > MAX_SCOPES:
        raise LayoutError("invalid_layout", "Too many screens or not a map")
    out: dict[str, list[list[Any]]] = {}
    for scope, items in raw.items():
        if not isinstance(scope, str) or not SCOPE.fullmatch(scope):
            raise LayoutError("invalid_layout", f"Unknown screen {scope!r}")
        if not isinstance(items, list) or len(items) > MAX_ITEMS:
            raise LayoutError("invalid_layout", f"Too many cards on {scope}")
        seen: set[str] = set()
        rows: list[list[Any]] = []
        for item in items:
            if not (isinstance(item, list) and len(item) == 3):
                raise LayoutError("invalid_layout", "A card is [key, width, height]")
            key, w, h = item
            if not isinstance(key, str) or not KEY.fullmatch(key) or key in seen:
                raise LayoutError("invalid_layout", "A card key is short text, once per screen")
            for span in (w, h):
                if isinstance(span, bool) or not isinstance(span, int) or not 1 <= span <= MAX_SPAN:
                    raise LayoutError("invalid_layout", f"A span is a whole number from 1 to {MAX_SPAN}")
            seen.add(key)
            rows.append([key, w, h])
        out[scope] = rows
    return out


class LayoutState:
    """The named devices and their layouts. `save` writes the whole map (HA's Store.async_save).

    Each device records who created it: only that person or an administrator may change or replace its arrangement, so a child
    cannot wipe the kitchen tablet from their own phone. A device created before owners were recorded is open to anyone.
    Writes are serialised: two phones saving at the same moment never lose each other's change.
    """

    def __init__(self, data: Any, save: Callable[[dict], Awaitable[None]]):
        self._save = save
        self._lock = asyncio.Lock()
        profiles = data.get("profiles") if isinstance(data, dict) else None
        self.profiles: dict[str, dict] = {}
        for pid, p in (profiles or {}).items():
            try:
                if PROFILE_ID.fullmatch(pid) and isinstance(p, dict):
                    owner = p.get("owner") if isinstance(p.get("owner"), str) else None
                    self.profiles[pid] = {"name": _name(p.get("name")), "scopes": clean_scopes(p.get("scopes", {})), "rev": int(p.get("rev", 0)), "updated": float(p.get("updated", 0)), "owner": owner}
            except (LayoutError, TypeError, ValueError):
                continue  # a damaged entry is dropped, the others stay

    def summary(self, user_id: str | None = None) -> dict:
        """What a panel sees: names, arrangements, revisions, and whether this user may change each one (never the owner's id)."""
        return {"profiles": {pid: {**{k: v for k, v in p.items() if k != "owner"}, "mine": p.get("owner") in (None, user_id)} for pid, p in self.profiles.items()}}

    async def write(self, pid: Any, name: Any, scopes: Any, expected_rev: int | None, user_id: str | None = None, admin: bool = False) -> int:
        if not isinstance(pid, str) or not PROFILE_ID.fullmatch(pid):
            raise LayoutError("invalid_profile", "Unknown device id")
        clean = {"name": _name(name), "scopes": clean_scopes(scopes)}
        if len(json.dumps(clean, ensure_ascii=False).encode()) > MAX_BYTES:
            raise LayoutError("too_large", "The layout is too large")
        async with self._lock:
            old = self.profiles.get(pid)
            if old is None:
                if len(self.profiles) >= MAX_PROFILES:
                    raise LayoutError("too_many", f"At most {MAX_PROFILES} devices")
                if not admin and sum(1 for p in self.profiles.values() if p.get("owner") == user_id) >= MAX_PER_USER:
                    raise LayoutError("too_many", f"At most {MAX_PER_USER} devices per person")
            elif not admin and old.get("owner") not in (None, user_id):
                raise LayoutError("not_owner", "Only whoever named this device, or an administrator, may change it")
            # an existing device is changed only by someone who saw its last revision: no blind overwrite
            if (old["rev"] if old else 0) != (expected_rev if expected_rev is not None else (None if old else 0)):
                raise LayoutError("conflict", "This device's layout was changed elsewhere")
            rev = (old["rev"] if old else 0) + 1
            entry = {**clean, "rev": rev, "updated": time.time(), "owner": old.get("owner") if old else user_id}
            nxt = {**self.profiles, pid: entry}
            await self._save({"profiles": nxt})
            self.profiles = nxt
            return rev

    async def remove(self, pid: Any) -> bool:
        async with self._lock:
            if not isinstance(pid, str) or pid not in self.profiles:
                return False
            nxt = {k: v for k, v in self.profiles.items() if k != pid}
            await self._save({"profiles": nxt})
            self.profiles = nxt
            return True
