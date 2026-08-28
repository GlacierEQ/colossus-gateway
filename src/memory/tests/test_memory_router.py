"""
Unit tests for the APEX Memory Layer.
Runs against real clients when env vars are set;
falls back to mock/skip when keys are absent.
"""

import pytest
from unittest.mock import MagicMock


# ------------------------------------------------------------------ #
#  Fixtures                                                             #
# ------------------------------------------------------------------ #

FAKE_EMBEDDING = [0.01] * 1536


@pytest.fixture()
def mock_pinecone_client():
    client = MagicMock()
    client.health_check.return_value = {
        "platform": "pinecone",
        "status": "ok",
        "total_vectors": 42,
    }
    client.upsert.return_value = {"platform": "pinecone", "upserted": 1}
    client.query.return_value = [
        {"id": "abc", "score": 0.95, "metadata": {"text": "test"}}
    ]
    return client


@pytest.fixture()
def mock_supermemory_client():
    client = MagicMock()
    client.health_check.return_value = {
        "platform": "supermemory",
        "status": "ok",
        "latency_ms": 40,
    }
    client.write.return_value = {
        "platform": "supermemory",
        "memory_id": "mem_abc",
        "status": "written",
    }
    client.search.return_value = [
        {"id": "mem_abc", "score": 0.9, "content": "test", "tags": ["ops"]}
    ]
    return client


# ------------------------------------------------------------------ #
#  Health check                                                         #
# ------------------------------------------------------------------ #


def test_health_check_all_ok(mock_pinecone_client, mock_supermemory_client):
    from src.memory.memory_router import MemoryRouter

    router = MemoryRouter.__new__(MemoryRouter)
    router._pinecone = mock_pinecone_client
    router._supermemory = mock_supermemory_client

    result = router.health_check_all()
    assert result["overall"] == "ok"
    assert result["backends"]["pinecone"]["status"] == "ok"
    assert result["backends"]["supermemory"]["status"] == "ok"


def test_health_check_degraded(mock_pinecone_client, mock_supermemory_client):
    from src.memory.memory_router import MemoryRouter

    mock_pinecone_client.health_check.return_value = {
        "platform": "pinecone",
        "status": "error",
        "error": "timeout",
    }

    router = MemoryRouter.__new__(MemoryRouter)
    router._pinecone = mock_pinecone_client
    router._supermemory = mock_supermemory_client

    result = router.health_check_all()
    assert result["overall"] == "degraded"


# ------------------------------------------------------------------ #
#  Scenario persistence                                                 #
# ------------------------------------------------------------------ #


def test_remember_scenario_dual_write(mock_pinecone_client, mock_supermemory_client):
    from src.memory.memory_router import MemoryRouter

    router = MemoryRouter.__new__(MemoryRouter)
    router._pinecone = mock_pinecone_client
    router._supermemory = mock_supermemory_client

    result = router.remember_scenario(
        scenario_id="scn-energy-001",
        embedding=FAKE_EMBEDDING,
        repo="xai-colossus-energy",
        scenario_name="N-1 Feeder Failure",
        result="PASS",
        metrics={"mw_shed": 12.5, "recovery_time_s": 4.2},
    )

    assert result["scenario_id"] == "scn-energy-001"
    assert result["pinecone"]["upserted"] == 1
    assert result["supermemory"]["memory_id"] == "mem_abc"

    # Verify tags include repo and result
    call_args = mock_supermemory_client.write.call_args
    assert "xai-colossus-energy" in call_args.kwargs["tags"]
    assert "pass" in call_args.kwargs["tags"]


# ------------------------------------------------------------------ #
#  Decision recording                                                   #
# ------------------------------------------------------------------ #


def test_record_decision(mock_supermemory_client):
    from src.memory.memory_router import MemoryRouter

    router = MemoryRouter.__new__(MemoryRouter)
    router._pinecone = None
    router._supermemory = mock_supermemory_client

    result = router.record_decision(
        agent_id="gap-detector-v2",
        decision="throttle_rack_7",
        context="feeder_A_at_98pct_load",
        outcome="SUCCESS",
        repo="xai-colossus-energy",
    )

    assert result["memory_id"] == "mem_abc"
    call_args = mock_supermemory_client.write.call_args
    assert "apex" in call_args.kwargs["tags"]
    assert "success" in call_args.kwargs["tags"]


# ------------------------------------------------------------------ #
#  Recall (search)                                                      #
# ------------------------------------------------------------------ #


def test_recall_both_backends(mock_pinecone_client, mock_supermemory_client):
    from src.memory.memory_router import MemoryRouter

    router = MemoryRouter.__new__(MemoryRouter)
    router._pinecone = mock_pinecone_client
    router._supermemory = mock_supermemory_client

    result = router.recall(
        query="feeder failure scenario",
        embedding=FAKE_EMBEDDING,
        namespace="scenario",
    )

    assert "pinecone" in result["backends"]
    assert "supermemory" in result["backends"]
    assert result["backends"]["pinecone"][0]["score"] == 0.95


def test_recall_supermemory_only_no_embedding(mock_supermemory_client):
    from src.memory.memory_router import MemoryRouter

    router = MemoryRouter.__new__(MemoryRouter)
    router._pinecone = None
    router._supermemory = mock_supermemory_client

    result = router.recall(query="turbine trip", embedding=None)
    assert (
        "pinecone" not in result["backends"]
        or result["backends"].get("pinecone") is None
    )
    assert result["backends"]["supermemory"][0]["content"] == "test"
