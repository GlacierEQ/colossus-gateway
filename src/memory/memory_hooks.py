"""
memory_hooks.py
---------------
Decorators and context managers that auto-wire any Colossus gauntlet
or orchestration loop into the MemoryRouter (Pinecone + Supermemory).

Usage — decorator:
    from src.memory.memory_hooks import gauntlet_memory_hook

    @gauntlet_memory_hook(repo="xai-colossus-energy", scenario="feeder_overload")
    def run_gauntlet(config):
        ...  # returns GauntletResult dict

Usage — context manager:
    from src.memory.memory_hooks import GauntletMemoryContext

    with GauntletMemoryContext(repo="xai-colossus-cooling", scenario="pump_failure") as ctx:
        result = run_cooling_gauntlet()
        ctx.set_result(result)
"""

from __future__ import annotations

import functools
import logging
import time
import traceback
from contextlib import contextmanager
from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Any, Callable, Dict, Generator, Optional

log = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# Result schema
# ---------------------------------------------------------------------------

@dataclass
class GauntletResult:
    """
    Normalised output from any Colossus gauntlet run.
    Gauntlets return a dict; this class validates/coerces it.
    """
    repo: str
    scenario: str
    passed: bool
    duration_s: float
    metrics: Dict[str, Any] = field(default_factory=dict)
    failures: list[str] = field(default_factory=list)
    warnings: list[str] = field(default_factory=list)
    timestamp: str = field(default_factory=lambda: datetime.now(timezone.utc).isoformat())
    tags: list[str] = field(default_factory=list)

    @classmethod
    def from_dict(cls, repo: str, scenario: str, duration_s: float, raw: Dict[str, Any]) -> "GauntletResult":
        return cls(
            repo=repo,
            scenario=scenario,
            passed=bool(raw.get("passed", raw.get("status") == "PASS")),
            duration_s=duration_s,
            metrics=raw.get("metrics", {}),
            failures=raw.get("failures", raw.get("errors", [])),
            warnings=raw.get("warnings", []),
            timestamp=raw.get("timestamp", datetime.now(timezone.utc).isoformat()),
            tags=raw.get("tags", []),
        )

    def to_memory_payload(self) -> Dict[str, Any]:
        status = "PASS" if self.passed else "FAIL"
        summary = (
            f"[{status}] {self.repo}/{self.scenario} "
            f"({self.duration_s:.1f}s) — "
            + ("OK" if self.passed else f"{len(self.failures)} failure(s): " + "; ".join(self.failures[:3]))
        )
        return {
            "id": f"{self.repo}:{self.scenario}:{self.timestamp}",
            "text": summary,
            "metadata": {
                "repo": self.repo,
                "scenario": self.scenario,
                "passed": self.passed,
                "duration_s": self.duration_s,
                "failures": self.failures,
                "warnings": self.warnings,
                "metrics": self.metrics,
                "tags": self.tags,
                "timestamp": self.timestamp,
                "type": "gauntlet_result",
            },
        }


# ---------------------------------------------------------------------------
# Router lazy-loader (avoids circular import at module level)
# ---------------------------------------------------------------------------

def _get_router():
    """Lazy-import MemoryRouter so hooks can be imported without env vars set."""
    try:
        from src.memory.memory_router import MemoryRouter
        return MemoryRouter()
    except Exception as exc:  # noqa: BLE001
        log.warning("MemoryRouter unavailable — memory writes skipped: %s", exc)
        return None


# ---------------------------------------------------------------------------
# Decorator
# ---------------------------------------------------------------------------

def gauntlet_memory_hook(
    repo: str,
    scenario: str,
    tags: Optional[list[str]] = None,
    raise_on_memory_error: bool = False,
) -> Callable:
    """
    Decorator that wraps a gauntlet run() function.

    The wrapped function must return a dict with at least:
        {"passed": bool, "metrics": dict, "failures": list}

    The decorator will:
        1. Time the run.
        2. Coerce the return value into a GauntletResult.
        3. Dual-write to Pinecone + Supermemory via MemoryRouter.
        4. On exception: record as a failed incident before re-raising.
    """
    _tags = tags or []

    def decorator(fn: Callable) -> Callable:
        @functools.wraps(fn)
        def wrapper(*args, **kwargs):
            start = time.monotonic()
            router = _get_router()
            raw_result: Optional[Dict] = None
            exc_info = None

            try:
                raw_result = fn(*args, **kwargs)
            except Exception as exc:  # noqa: BLE001
                exc_info = exc
                raw_result = {
                    "passed": False,
                    "metrics": {},
                    "failures": [f"{type(exc).__name__}: {exc}"],
                    "tags": _tags + ["exception"],
                }

            duration = time.monotonic() - start
            result = GauntletResult.from_dict(repo, scenario, duration, raw_result)
            result.tags = list(set(result.tags + _tags))

            if router is not None:
                _write_to_memory(router, result, raise_on_memory_error)

            if exc_info is not None:
                raise exc_info

            return raw_result

        return wrapper
    return decorator


# ---------------------------------------------------------------------------
# Context manager
# ---------------------------------------------------------------------------

class GauntletMemoryContext:
    """
    Context manager version of gauntlet_memory_hook.

    with GauntletMemoryContext(repo="xai-colossus-energy", scenario="n1_trip") as ctx:
        result = run_energy_gauntlet()
        ctx.set_result(result)   # optional — ctx captures exceptions automatically
    """

    def __init__(
        self,
        repo: str,
        scenario: str,
        tags: Optional[list[str]] = None,
        raise_on_memory_error: bool = False,
    ):
        self.repo = repo
        self.scenario = scenario
        self.tags = tags or []
        self.raise_on_memory_error = raise_on_memory_error
        self._result: Optional[Dict] = None
        self._start: float = 0.0
        self._router = None

    def set_result(self, result: Dict[str, Any]):
        self._result = result

    def __enter__(self) -> "GauntletMemoryContext":
        self._start = time.monotonic()
        self._router = _get_router()
        return self

    def __exit__(self, exc_type, exc_val, exc_tb):
        duration = time.monotonic() - self._start

        if exc_type is not None:
            raw = {
                "passed": False,
                "metrics": {},
                "failures": [f"{exc_type.__name__}: {exc_val}"],
                "tags": self.tags + ["exception"],
            }
        else:
            raw = self._result or {"passed": True, "metrics": {}, "failures": []}

        gauntlet_result = GauntletResult.from_dict(self.repo, self.scenario, duration, raw)
        gauntlet_result.tags = list(set(gauntlet_result.tags + self.tags))

        if self._router is not None:
            _write_to_memory(self._router, gauntlet_result, self.raise_on_memory_error)

        return False  # do not suppress exceptions


# ---------------------------------------------------------------------------
# Shared write helper
# ---------------------------------------------------------------------------

def _write_to_memory(
    router,
    result: GauntletResult,
    raise_on_error: bool,
) -> None:
    """Write a GauntletResult into both Pinecone and Supermemory."""
    payload = result.to_memory_payload()
    try:
        # Scenario record (always)
        router.remember_scenario(
            scenario_id=payload["id"],
            text=payload["text"],
            metadata=payload["metadata"],
        )

        # Incident record on failure
        if not result.passed:
            router.record_incident(
                incident_id=f"incident:{payload['id']}",
                text=(
                    f"GAUNTLET FAILURE — {result.repo}/{result.scenario}: "
                    + "; ".join(result.failures[:5])
                ),
                metadata={
                    **payload["metadata"],
                    "severity": "P1" if "exception" in result.tags else "P2",
                },
            )

        log.info(
            "[memory_hooks] wrote %s/%s (%s) to memory in %.2fs",
            result.repo,
            result.scenario,
            "PASS" if result.passed else "FAIL",
            result.duration_s,
        )
    except Exception as exc:  # noqa: BLE001
        log.error("[memory_hooks] write failed: %s\n%s", exc, traceback.format_exc())
        if raise_on_error:
            raise
