"""The panel bundle on the wire: gzip for a client that takes it, compressed once per build and off the event loop.

The file is about a megabyte of JavaScript and a quarter of that compressed; aiohttp does not compress a response by itself.
Kept free of Home Assistant and aiohttp imports so it is testable without them.
"""
from __future__ import annotations

import asyncio
import gzip
from pathlib import Path
from typing import Any, Callable, Optional


def etag_of(stat: Any) -> str:
    return f"{stat.st_mtime_ns:x}-{stat.st_size:x}"


def etag_matches(header: Optional[str], etag: str) -> bool:
    """True when an If-None-Match header names this entity tag: one value, a list («"a", "b"»), a weak one (W/"…": a proxy
    that re-compressed the file marks it so) or «*». The comparison is the weak one of RFC 9110, as the header asks."""
    def bare(tag: str) -> str:
        tag = tag.strip()
        return tag[2:] if tag[:2] in ("W/", "w/") else tag
    mine = bare(etag)
    return any(part.strip() == "*" or bare(part) == mine for part in (header or "").split(",") if part.strip())


def accepts_gzip(header: Optional[str]) -> bool:
    """True when the Accept-Encoding header allows gzip («gzip», «x-gzip» or «*», and not with q=0)."""
    allowed = False
    for part in (header or "").split(","):
        name, _, params = part.strip().partition(";")
        name = name.strip().lower()
        if name not in ("gzip", "x-gzip", "*"):
            continue
        quality = 1.0
        for param in params.split(";"):
            key, _, value = param.strip().partition("=")
            if key.strip().lower() == "q":
                try:
                    quality = float(value)
                except ValueError:
                    quality = 0.0
        if name != "*":
            return quality > 0
        allowed = quality > 0
    return allowed


def _compress(path: Path) -> bytes:
    return gzip.compress(path.read_bytes(), 9, mtime=0)


class GzipCache:
    """The compressed bundle of one build (the etag names it). Panels that ask at the same moment share one compression."""

    def __init__(self) -> None:
        self._etag: Optional[str] = None
        self._body: Optional[bytes] = None
        self._job: Optional[asyncio.Future] = None
        self._job_etag: Optional[str] = None

    async def get(self, executor: Callable[..., Any], path: Path, etag: str) -> bytes:
        """`executor(func, *args)` runs a blocking call in a thread and returns an awaitable (hass.async_add_executor_job)."""
        if self._etag == etag and self._body is not None:
            return self._body
        if self._job is None or self._job_etag != etag:
            self._job, self._job_etag = asyncio.ensure_future(executor(_compress, path)), etag
        job = self._job
        try:
            body = await asyncio.shield(job)  # a panel that hangs up must not cancel the work the others wait for
        except asyncio.CancelledError:
            raise
        except Exception:
            if self._job is job:
                self._job = self._job_etag = None
            raise
        if self._job is job:
            self._etag, self._body, self._job, self._job_etag = etag, body, None, None
        return body
