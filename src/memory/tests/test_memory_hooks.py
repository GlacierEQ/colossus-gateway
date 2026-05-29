"""
test_memory_hooks.py
--------------------
Unit tests for memory_hooks.py — uses mock MemoryRouter so no real
Pinecone or Supermemory credentials are required.
"""

from __future__ import annotations

import sys
import types
from unittest.mock import MagicMock, patch

import pytest

from src.memory.memory_hooks import (
    GauntletMemoryContext,
    GauntletResult,
    _write_to_memory,
    gauntlet_memory_hook,
)


# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------

@pytest.fixture
def mock_router():
    r = MagicMock()
    r.remember_scenario = MagicMock(return_value=True)
    r.record_incident = MagicMock(return_value=True)
    r.record_decision = MagicMock(return_value=True)
    return r


@pytest.fixture
def pass_result():
    return {
        "passed": True,
        "metrics": {"mw_draw": 42.5, "headroom_mw": 12.1},
        "failures": [],
        "warnings": [],
        "tags": ["grid"],
    }


@pytest.fixture
def fail_result():
    return {
        "passed": False,
        "metrics": {"mw_draw": 98.0, "headroom_mw": -2.0},
        "failures": ["feeder MW exceeded limit", "N-1 headroom negative"],
        "warnings": ["approaching thermal cap"],
        "tags": ["grid", "EJ"],
    }


# ---------------------------------------------------------------------------
# GauntletResult.from_dict
# ---------------------------------------------------------------------------

class TestGauntletResult:
    def test_from_dict_pass(self, pass_result):
        r = GauntletResult.from_dict("xai-colossus-energy", "feeder_n1", 1.23, pass_result)
        assert r.passed is True
        assert r.repo == "xai-colossus-energy"
        assert r.duration_s == pytest.approx(1.23)
        assert r.metrics["mw_draw"] == 42.5

    def test_from_dict_fail(self, fail_result):
        r = GauntletResult.from_dict("xai-colossus-energy", "feeder_n1", 2.0, fail_result)
        assert r.passed is False
        assert "feeder MW exceeded limit" in r.failures

    def test_memory_payload_contains_required_keys(self, pass_result):
        r = GauntletResult.from_dict("xai-colossus-energy", "feeder_n1", 1.0, pass_result)
        payload = r.to_memory_payload()
        assert "id" in payload
        assert "text" in payload
        assert "metadata" in payload
        assert payload["metadata"]["type"] == "gauntlet_result"


# ---------------------------------------------------------------------------
# _write_to_memory
# ---------------------------------------------------------------------------

class TestWriteToMemory:
    def test_pass_writes_scenario_only(self, mock_router, pass_result):
        r = GauntletResult.from_dict("xai-colossus-energy", "feeder_n1", 1.0, pass_result)
        _write_to_memory(mock_router, r, raise_on_error=False)
        mock_router.remember_scenario.assert_called_once()
        mock_router.record_incident.assert_not_called()

    def test_fail_writes_scenario_and_incident(self, mock_router, fail_result):
        r = GauntletResult.from_dict("xai-colossus-energy", "feeder_n1", 1.0, fail_result)
        _write_to_memory(mock_router, r, raise_on_error=False)
        mock_router.remember_scenario.assert_called_once()
        mock_router.record_incident.assert_called_once()
        incident_call = mock_router.record_incident.call_args
        assert incident_call.kwargs["metadata"]["severity"] == "P2"

    def test_exception_tag_sets_p1(self, mock_router, fail_result):
        fail_result["tags"] = ["exception"]
        r = GauntletResult.from_dict("repo", "scenario", 0.5, fail_result)
        _write_to_memory(mock_router, r, raise_on_error=False)
        incident_call = mock_router.record_incident.call_args
        assert incident_call.kwargs["metadata"]["severity"] == "P1"

    def test_router_error_suppressed_by_default(self, mock_router, pass_result):
        mock_router.remember_scenario.side_effect = RuntimeError("Pinecone down")
        r = GauntletResult.from_dict("repo", "scenario", 0.5, pass_result)
        # Should not raise
        _write_to_memory(mock_router, r, raise_on_error=False)

    def test_router_error_raised_when_flag_set(self, mock_router, pass_result):
        mock_router.remember_scenario.side_effect = RuntimeError("Pinecone down")
        r = GauntletResult.from_dict("repo", "scenario", 0.5, pass_result)
        with pytest.raises(RuntimeError):
            _write_to_memory(mock_router, r, raise_on_error=True)


# ---------------------------------------------------------------------------
# gauntlet_memory_hook decorator
# ---------------------------------------------------------------------------

class TestDecorator:
    def test_pass_through_return_value(self, mock_router, pass_result):
        with patch("src.memory.memory_hooks._get_router", return_value=mock_router):
            @gauntlet_memory_hook(repo="xai-colossus-energy", scenario="feeder_n1")
            def run():
                return pass_result

            out = run()
            assert out["passed"] is True
            mock_router.remember_scenario.assert_called_once()

    def test_exception_records_failure_and_reraises(self, mock_router):
        with patch("src.memory.memory_hooks._get_router", return_value=mock_router):
            @gauntlet_memory_hook(repo="xai-colossus-energy", scenario="feeder_n1")
            def run():
                raise ValueError("Feeder trip")

            with pytest.raises(ValueError, match="Feeder trip"):
                run()

            # Incident should be written even on exception
            mock_router.record_incident.assert_called_once()


# ---------------------------------------------------------------------------
# GauntletMemoryContext
# ---------------------------------------------------------------------------

class TestContextManager:
    def test_context_pass(self, mock_router, pass_result):
        with patch("src.memory.memory_hooks._get_router", return_value=mock_router):
            with GauntletMemoryContext(repo="xai-colossus-cooling", scenario="pump_failure") as ctx:
                ctx.set_result(pass_result)
            mock_router.remember_scenario.assert_called_once()
            mock_router.record_incident.assert_not_called()

    def test_context_captures_exception(self, mock_router):
        with patch("src.memory.memory_hooks._get_router", return_value=mock_router):
            with pytest.raises(RuntimeError):
                with GauntletMemoryContext(repo="xai-colossus-cooling", scenario="pump_failure"):
                    raise RuntimeError("Pump offline")
            mock_router.record_incident.assert_called_once()
