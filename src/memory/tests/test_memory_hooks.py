"""
test_memory_hooks.py — Unit tests for memory_hooks.py
"""

from __future__ import annotations

import pytest
from unittest.mock import MagicMock, patch, call
from src.memory.memory_hooks import (
    gauntlet_memory,
    GauntletSession,
    recall_last_incident,
    apex_decision,
    ej_event,
    _is_pass,
)


# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------

@pytest.fixture
def mock_router():
    router = MagicMock()
    router.recall.return_value = [{"status": "PASS", "scenario_type": "energy"}]
    return router


# ---------------------------------------------------------------------------
# _is_pass tests
# ---------------------------------------------------------------------------

def test_is_pass_true():
    assert _is_pass({"status": "PASS"}) is True

def test_is_pass_false():
    assert _is_pass({"status": "FAIL"}) is False

def test_is_pass_bool_true():
    assert _is_pass(True) is True

def test_is_pass_none():
    assert _is_pass(None) is False

def test_is_pass_dict_ok():
    assert _is_pass({"ok": True}) is True

def test_is_pass_unknown_dict():
    # dict with no known keys → default pass
    assert _is_pass({"mw": 42}) is True


# ---------------------------------------------------------------------------
# @gauntlet_memory decorator
# ---------------------------------------------------------------------------

def test_decorator_records_pass(mock_router):
    @gauntlet_memory(scenario_type="energy", tags=["feeder"], router=mock_router)
    def run_gauntlet(**kwargs):
        return {"status": "PASS", "mw_headroom": 10.0}

    result = run_gauntlet()
    assert result["status"] == "PASS"
    mock_router.remember_scenario.assert_called_once()
    call_kwargs = mock_router.remember_scenario.call_args[1]
    assert call_kwargs["scenario_type"] == "energy"
    assert "PASS" in call_kwargs["content"]


def test_decorator_records_fail(mock_router):
    @gauntlet_memory(scenario_type="energy", router=mock_router)
    def run_gauntlet(**kwargs):
        return {"status": "FAIL"}

    result = run_gauntlet()
    assert result["status"] == "FAIL"
    mock_router.remember_scenario.assert_called_once()
    call_kwargs = mock_router.remember_scenario.call_args[1]
    assert "FAIL" in call_kwargs["content"]


def test_decorator_records_exception(mock_router):
    @gauntlet_memory(scenario_type="servers", router=mock_router, fail_silent=False)
    def run_gauntlet(**kwargs):
        raise ValueError("rack offline")

    with pytest.raises(ValueError, match="rack offline"):
        run_gauntlet()

    mock_router.remember_scenario.assert_called_once()
    call_kwargs = mock_router.remember_scenario.call_args[1]
    assert "ERROR" in call_kwargs["content"]


def test_decorator_injects_prior_context(mock_router):
    received = {}

    @gauntlet_memory(scenario_type="energy", router=mock_router)
    def run_gauntlet(**kwargs):
        received["prior"] = kwargs.get("prior_context")
        return {"status": "PASS"}

    run_gauntlet()
    assert received["prior"] is not None
    mock_router.recall.assert_called_once()


def test_decorator_no_router_graceful():
    """Should run fine with no router — memory calls are skipped."""
    @gauntlet_memory(scenario_type="cooling", router=None, fail_silent=True)
    def run_gauntlet(**kwargs):
        return {"status": "PASS"}

    with patch("src.memory.memory_hooks._get_router", return_value=None):
        result = run_gauntlet()
    assert result["status"] == "PASS"


# ---------------------------------------------------------------------------
# GauntletSession context manager
# ---------------------------------------------------------------------------

def test_session_record(mock_router):
    with GauntletSession("cooling", tags=["pump"], router=mock_router) as session:
        session.record({"status": "PASS", "delta_t": 18.5})

    mock_router.remember_scenario.assert_called_once()
    call_kwargs = mock_router.remember_scenario.call_args[1]
    assert call_kwargs["scenario_type"] == "cooling"


def test_session_records_error_on_exception(mock_router):
    with pytest.raises(RuntimeError):
        with GauntletSession("cooling", router=mock_router) as session:
            raise RuntimeError("pump failed")

    mock_router.remember_scenario.assert_called_once()
    call_kwargs = mock_router.remember_scenario.call_args[1]
    assert "ERROR" in call_kwargs["content"]


# ---------------------------------------------------------------------------
# recall_last_incident
# ---------------------------------------------------------------------------

def test_recall_returns_top_hit(mock_router):
    result = recall_last_incident(scenario_type="energy", router=mock_router)
    assert result is not None
    assert result["scenario_type"] == "energy"


def test_recall_no_router():
    result = recall_last_incident(scenario_type="energy", router=None)
    assert result is None


def test_recall_router_exception(mock_router):
    mock_router.recall.side_effect = Exception("network error")
    result = recall_last_incident(scenario_type="energy", router=mock_router)
    assert result is None


# ---------------------------------------------------------------------------
# apex_decision
# ---------------------------------------------------------------------------

def test_apex_decision_writes(mock_router):
    apex_decision(
        decision_type="load_shed",
        content="Shed rack-07",
        metadata={"rack": "rack-07"},
        router=mock_router,
    )
    mock_router.record_decision.assert_called_once()
    call_kwargs = mock_router.record_decision.call_args[1]
    assert call_kwargs["decision_type"] == "load_shed"


def test_apex_decision_no_router():
    # should not raise
    apex_decision("load_shed", "test", router=None)


# ---------------------------------------------------------------------------
# ej_event
# ---------------------------------------------------------------------------

def test_ej_event_writes(mock_router):
    ej_event(
        event_type="emissions_spike",
        description="NOx above threshold",
        affected_area="Boxtown",
        severity="high",
        router=mock_router,
    )
    mock_router.remember_scenario.assert_called_once()
    call_kwargs = mock_router.remember_scenario.call_args[1]
    assert call_kwargs["scenario_type"] == "ej"
    assert "Boxtown" in call_kwargs["content"]
    assert "HIGH" in call_kwargs["content"]


def test_ej_event_no_router():
    # should not raise
    ej_event("emissions_spike", "test", router=None)
