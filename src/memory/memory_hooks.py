"""
memory_hooks.py — Colossus AI Memory Integration Hooks
======================================================
Decorators and context managers that auto-wire MemoryRouter into
any Colossus gauntlet, run function, or APEX orchestration loop.

Usage:
    from src.memory.memory_hooks import gauntlet_memory, recall_last_incident

    @gauntlet_memory(scenario_type="energy", tags=["feeder", "N-1"])
    def run_feeder_overload_gauntlet(params):
        # ... gauntlet logic ...
        return {"mw_headroom": 42.5, "status": "PASS"}

    # Or as a context manager:
    with GauntletSession("cooling", tags=["pump-failure"]) as session:
        result = run_cooling_loop()
        session.record(result)
"""

from __future__ import annotations

import functools
import time
import traceback
import uuid
from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Any, Callable, Dict, List, Optional

try:
    from src.memory.memory_router import MemoryRouter
except ImportError:
    MemoryRouter = None  # graceful degradation if deps not installed


# ---------------------------------------------------------------------------
# Config
# ---------------------------------------------------------------------------

SCENARIO_TYPES = [
    "energy",
    "cooling",
    "servers",
    "security",
    "nanosphere",
    "apex",
    "legal",
    "ej",  # environmental justice
    "grid",
    "permitting",
]


# ---------------------------------------------------------------------------
# Core hook: @gauntlet_memory decorator
# ---------------------------------------------------------------------------


def gauntlet_memory(
    scenario_type: str = "generic",
    tags: Optional[List[str]] = None,
    router: Optional[Any] = None,
    fail_silent: bool = True,
):
    """
    Decorator that wraps a gauntlet function with memory pre/post calls.

    Pre-run:
        - Recalls the last incident of the same scenario_type from memory
        - Injects it as `prior_context` kwarg into the function

    Post-run (success):
        - Writes the result to MemoryRouter as a scenario record
        - Tags with scenario_type, run_id, timestamp

    Post-run (failure):
        - Writes the exception as an incident record
        - Tags with 'incident', scenario_type, 'needs-review'

    Args:
        scenario_type: One of SCENARIO_TYPES. Used for namespace routing.
        tags: Extra tags to attach to the memory record.
        router: Optional MemoryRouter instance. Creates one from env if None.
        fail_silent: If True, memory errors do not propagate to the caller.
    """
    tags = tags or []

    def decorator(func: Callable) -> Callable:
        @functools.wraps(func)
        def wrapper(*args, **kwargs):
            _router = router or _get_router()
            run_id = str(uuid.uuid4())[:8]
            start_ts = datetime.now(timezone.utc).isoformat()
            start_time = time.perf_counter()

            # ---- PRE: recall prior context --------------------------------
            prior_context = None
            if _router:
                try:
                    prior_context = recall_last_incident(
                        scenario_type=scenario_type,
                        router=_router,
                    )
                    kwargs["prior_context"] = prior_context
                except Exception as exc:  # noqa: BLE001
                    if not fail_silent:
                        raise
                    print(f"[memory_hooks] recall failed: {exc}")

            # ---- RUN gauntlet --------------------------------------------
            result = None
            exc_info = None
            try:
                result = func(*args, **kwargs)
                status = "PASS" if _is_pass(result) else "FAIL"
            except Exception as exc:  # noqa: BLE001
                exc_info = exc
                status = "ERROR"
                result = {"error": str(exc), "traceback": traceback.format_exc()}

            elapsed_ms = int((time.perf_counter() - start_time) * 1000)

            # ---- POST: write memory record --------------------------------
            if _router:
                try:
                    _router.remember_scenario(
                        scenario_type=scenario_type,
                        content=(
                            f"Gauntlet: {func.__name__} | run_id={run_id} | "
                            f"status={status} | elapsed={elapsed_ms}ms\n"
                            f"Result: {result}"
                        ),
                        metadata={
                            "run_id": run_id,
                            "function": func.__name__,
                            "scenario_type": scenario_type,
                            "status": status,
                            "elapsed_ms": elapsed_ms,
                            "timestamp": start_ts,
                            "tags": tags + [scenario_type, status.lower()],
                            "had_prior_context": prior_context is not None,
                        },
                    )
                except Exception as exc2:  # noqa: BLE001
                    if not fail_silent:
                        raise
                    print(f"[memory_hooks] write failed: {exc2}")

            if exc_info is not None:
                raise exc_info

            return result

        return wrapper

    return decorator


# ---------------------------------------------------------------------------
# Context manager: GauntletSession
# ---------------------------------------------------------------------------


@dataclass
class GauntletSession:
    """
    Context manager for gauntlets that need fine-grained control.

    with GauntletSession("energy", tags=["turbine-trip"]) as session:
        result = run_turbine_trip()
        session.record(result, status="PASS")
    """

    scenario_type: str
    tags: List[str] = field(default_factory=list)
    router: Optional[Any] = None
    fail_silent: bool = True

    _router: Any = field(init=False, default=None)
    _run_id: str = field(init=False, default="")
    _start_ts: str = field(init=False, default="")
    _start_time: float = field(init=False, default=0.0)
    prior_context: Optional[Dict] = field(init=False, default=None)

    def __enter__(self):
        self._router = self.router or _get_router()
        self._run_id = str(uuid.uuid4())[:8]
        self._start_ts = datetime.now(timezone.utc).isoformat()
        self._start_time = time.perf_counter()

        if self._router:
            try:
                self.prior_context = recall_last_incident(
                    scenario_type=self.scenario_type,
                    router=self._router,
                )
            except Exception as exc:  # noqa: BLE001
                if not self.fail_silent:
                    raise
                print(f"[GauntletSession] recall failed: {exc}")
        return self

    def record(self, result: Any, status: Optional[str] = None):
        """Explicitly write a result to memory mid-session or at close."""
        if not self._router:
            return
        _status = status or ("PASS" if _is_pass(result) else "FAIL")
        elapsed_ms = int((time.perf_counter() - self._start_time) * 1000)
        try:
            self._router.remember_scenario(
                scenario_type=self.scenario_type,
                content=(
                    f"GauntletSession run_id={self._run_id} | status={_status} | "
                    f"elapsed={elapsed_ms}ms\nResult: {result}"
                ),
                metadata={
                    "run_id": self._run_id,
                    "scenario_type": self.scenario_type,
                    "status": _status,
                    "elapsed_ms": elapsed_ms,
                    "timestamp": self._start_ts,
                    "tags": self.tags + [self.scenario_type, _status.lower()],
                },
            )
        except Exception as exc:  # noqa: BLE001
            if not self.fail_silent:
                raise
            print(f"[GauntletSession] write failed: {exc}")

    def __exit__(self, exc_type, exc_val, exc_tb):
        if exc_type is not None:
            elapsed_ms = int((time.perf_counter() - self._start_time) * 1000)
            if self._router:
                try:
                    self._router.remember_scenario(
                        scenario_type=self.scenario_type,
                        content=(
                            f"GauntletSession ERROR run_id={self._run_id} | "
                            f"elapsed={elapsed_ms}ms\n{exc_type.__name__}: {exc_val}"
                        ),
                        metadata={
                            "run_id": self._run_id,
                            "scenario_type": self.scenario_type,
                            "status": "ERROR",
                            "elapsed_ms": elapsed_ms,
                            "timestamp": self._start_ts,
                            "tags": self.tags
                            + [self.scenario_type, "error", "incident"],
                            "exception": str(exc_val),
                        },
                    )
                except Exception:  # noqa: BLE001
                    pass
        return False  # do not suppress exceptions


# ---------------------------------------------------------------------------
# Helper: recall_last_incident
# ---------------------------------------------------------------------------


def recall_last_incident(
    scenario_type: str,
    router: Optional[Any] = None,
    top_k: int = 3,
) -> Optional[Dict]:
    """
    Recall the most recent incident / gauntlet result for a scenario type.
    Returns the top hit metadata dict, or None if memory is empty / unavailable.

    Used by:
        - APEX orchestration brain to avoid repeating failed decisions
        - Energy gauntlet to compare current MW headroom vs last run
        - Cooling gauntlet to detect degrading thermal trends
        - Security event bus to correlate repeated config drift
    """
    _router = router or _get_router()
    if not _router:
        return None

    try:
        results = _router.recall(
            query=f"{scenario_type} gauntlet incident status result",
            scenario_type=scenario_type,
            top_k=top_k,
        )
        if results:
            return results[0] if isinstance(results, list) else results
    except Exception as exc:  # noqa: BLE001
        print(f"[recall_last_incident] failed for {scenario_type}: {exc}")
    return None


# ---------------------------------------------------------------------------
# APEX decision hook
# ---------------------------------------------------------------------------


def apex_decision(
    decision_type: str,
    content: str,
    metadata: Optional[Dict] = None,
    router: Optional[Any] = None,
    fail_silent: bool = True,
):
    """
    One-liner for DOCTOR-STRANGE APEX brain to record orchestration decisions.

    Called after every APEX loop iteration:
        apex_decision(
            decision_type="load_shed",
            content="Shed rack-07 due to feeder headroom < 5 MW",
            metadata={"rack": "rack-07", "reason": "feeder_overload"},
        )
    """
    _router = router or _get_router()
    if not _router:
        return

    try:
        _router.record_decision(
            decision_type=decision_type,
            content=content,
            metadata={
                **(metadata or {}),
                "timestamp": datetime.now(timezone.utc).isoformat(),
                "decision_type": decision_type,
            },
        )
    except Exception as exc:  # noqa: BLE001
        if not fail_silent:
            raise
        print(f"[apex_decision] write failed: {exc}")


# ---------------------------------------------------------------------------
# EJ / compliance event hook
# ---------------------------------------------------------------------------


def ej_event(
    event_type: str,
    description: str,
    affected_area: Optional[str] = None,
    severity: str = "medium",
    router: Optional[Any] = None,
    fail_silent: bool = True,
):
    """
    Record an environmental-justice or compliance event.

    Examples:
        ej_event("emissions_spike", "NOx proxy above permit threshold",
                 affected_area="Boxtown", severity="high")
        ej_event("water_restriction", "Memphis Utility issued flow reduction",
                 severity="critical")
    """
    _router = router or _get_router()
    if not _router:
        return

    try:
        _router.remember_scenario(
            scenario_type="ej",
            content=(
                f"EJ EVENT [{severity.upper()}]: {event_type}\n"
                f"Description: {description}\n"
                f"Affected area: {affected_area or 'unspecified'}"
            ),
            metadata={
                "event_type": event_type,
                "severity": severity,
                "affected_area": affected_area,
                "timestamp": datetime.now(timezone.utc).isoformat(),
                "tags": ["ej", "compliance", event_type, severity],
            },
        )
    except Exception as exc:  # noqa: BLE001
        if not fail_silent:
            raise
        print(f"[ej_event] write failed: {exc}")


# ---------------------------------------------------------------------------
# Internal helpers
# ---------------------------------------------------------------------------

_cached_router = None


def _get_router():
    """Lazy-init a shared MemoryRouter from env vars."""
    global _cached_router  # noqa: PLW0603
    if _cached_router is not None:
        return _cached_router
    if MemoryRouter is None:
        return None
    try:
        _cached_router = MemoryRouter()
        return _cached_router
    except Exception as exc:  # noqa: BLE001
        print(f"[memory_hooks] MemoryRouter init failed: {exc}")
        return None


def _is_pass(result: Any) -> bool:
    """Heuristic: result is a PASS if it contains status/passed/ok signals."""
    if result is None:
        return False
    if isinstance(result, bool):
        return result
    if isinstance(result, dict):
        for key in ("status", "passed", "ok", "result"):
            val = result.get(key)
            if val is not None:
                if isinstance(val, bool):
                    return val
                if isinstance(val, str):
                    return val.upper() in ("PASS", "OK", "SUCCESS", "TRUE")
    return True  # default: treat non-exception return as pass
