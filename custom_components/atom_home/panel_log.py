"""What went wrong on the panels, kept by the integration (27.11.2026).

A look picked on a second house did not stay and left no trace anywhere: the panel's own warning faded in six seconds, and Home Assistant's system
log lives in memory and is gone after the restart every update ends in. The panels now tell the integration about a refused save, a refused
command and a card that broke; it keeps the last entries in `.storage` (they survive restarts), writes each to Home Assistant's log too, and lets
an administrator read them (`atom_home/log/get`). A panel is a guest here: what it sends is cut to size, stripped of control characters and
limited per socket, so one tablet in a loop cannot fill the log.
Kept free of Home Assistant imports so the rules are testable without it.
"""
from __future__ import annotations

import re
import time
from datetime import datetime, timezone
from typing import Any, Awaitable, Callable, Optional

STORAGE_KEY = "atom_home.panel_log"
STORAGE_VERSION = 1
KEEP = 200            # entries kept
WHERE_MAX = 80
TEXT_MAX = 1500
DEVICE_MAX = 120
PER_SOCKET = 30       # entries one socket may write …
PER_USER = 60         # … and one user over all their sockets …
WINDOW_S = 600        # … in ten minutes
_CONTROL = re.compile(r"[\x00-\x08\x0b-\x1f\x7f]")


def clean(value: Any, limit: int) -> str:
    """A string from a panel, safe to keep and to log: no control characters (a newline stays), cut to `limit`."""
    text = value if isinstance(value, str) else ""
    return _CONTROL.sub(" ", text)[:limit].strip()


class Budget:
    """At most PER_SOCKET entries per socket in WINDOW_S seconds."""

    def __init__(self, now: Callable[[], float] = time.monotonic) -> None:
        self._now = now
        self._seen: dict[int, list[float]] = {}

    def _recent(self, key: Any) -> list[float]:
        now = self._now()
        recent = [t for t in self._seen.get(key, []) if now - t < WINDOW_S]
        self._seen[key] = recent
        return recent

    def take(self, key: int, user: str = "") -> bool:
        """One more entry from this socket, of this user: a user who opens more sockets still has PER_USER in all."""
        sock, mine = self._recent(key), self._recent(("user", user))
        if len(sock) >= PER_SOCKET or len(mine) >= PER_USER:
            return False
        now = self._now()
        sock.append(now)
        mine.append(now)
        return True

    def knows(self, key: int) -> bool:
        return key in self._seen

    def forget(self, key: int) -> None:
        self._seen.pop(key, None)


class PanelLog:
    def __init__(self, load: Callable[[], Awaitable[Optional[dict]]], save: Callable[[dict], Awaitable[None]], now: Callable[[], datetime] = lambda: datetime.now(timezone.utc)) -> None:
        self._load, self._save, self._now = load, save, now
        self.entries: list[dict] = []

    async def async_load(self) -> None:
        data = await self._load() or {}
        rows = data.get("entries") if isinstance(data, dict) else None
        self.entries = [r for r in rows if isinstance(r, dict)][-KEEP:] if isinstance(rows, list) else []

    def add(self, user: str, where: Any, text: Any, version: Any = None, device: Any = None) -> Optional[dict]:
        """The entry as kept, or None when there is nothing to keep."""
        entry = {"at": self._now().isoformat(timespec="seconds"), "user": clean(user, 60), "where": clean(where, WHERE_MAX), "text": clean(text, TEXT_MAX)}
        if not entry["where"] or not entry["text"]:
            return None
        if (v := clean(version, 20)):
            entry["version"] = v
        if (d := clean(device, DEVICE_MAX)):
            entry["device"] = d
        self.entries = [*self.entries, entry][-KEEP:]
        return entry

    def data(self) -> dict:
        return {"entries": self.entries}

    async def async_save(self) -> None:
        await self._save(self.data())


def log_line(entry: dict) -> str:
    """The entry for Home Assistant's log: one line (a newline in a panel's text must not forge another line there)."""
    first = entry["text"].splitlines()[0] if entry["text"] else ""
    device = f" · {entry['device']}" if entry.get("device") else ""
    return f"Atom Home panel · {entry['user']}{device} · {entry['where']}: {first}"
