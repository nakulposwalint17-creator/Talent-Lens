"""In-memory sliding-window rate limiter.

State lives in the process, which matches the documented single-worker
deployment (the evaluation queue is per-process too). Running several workers
would need a shared store such as Redis.
"""

from __future__ import annotations

import math
import threading
import time
from collections import deque
from collections.abc import Callable


class RateLimiter:
    def __init__(self, clock: Callable[[], float] = time.monotonic, max_keys: int = 50_000) -> None:
        self._clock = clock
        self._max_keys = max_keys
        self._hits: dict[str, deque[float]] = {}
        self._lock = threading.Lock()

    def hit(self, key: str, limit: int, window_seconds: float) -> float | None:
        """Record one event for ``key``. Returns None if allowed, else seconds until a slot frees up."""
        now = self._clock()
        with self._lock:
            hits = self._prune(key, now, window_seconds)
            if len(hits) >= limit:
                return max(0.0, hits[0] + window_seconds - now)
            hits.append(now)
            return None

    def peek(self, key: str, limit: int, window_seconds: float) -> float | None:
        """Like ``hit`` but without recording an event (used to check a lockout before work is done)."""
        now = self._clock()
        with self._lock:
            hits = self._prune(key, now, window_seconds)
            return max(0.0, hits[0] + window_seconds - now) if len(hits) >= limit else None

    def reset(self, key: str) -> None:
        with self._lock:
            self._hits.pop(key, None)

    def _prune(self, key: str, now: float, window_seconds: float) -> deque[float]:
        hits = self._hits.get(key)
        if hits is None:
            if len(self._hits) >= self._max_keys:
                # Bound memory under a flood of distinct keys: drop the stalest entries.
                for stale in sorted(self._hits, key=lambda k: self._hits[k][-1] if self._hits[k] else 0)[:1000]:
                    del self._hits[stale]
            hits = self._hits[key] = deque()
        while hits and hits[0] <= now - window_seconds:
            hits.popleft()
        return hits


def retry_after_header(seconds: float) -> str:
    return str(max(1, math.ceil(seconds)))
