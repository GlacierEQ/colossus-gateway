# APEX Memory Layer — Pinecone + Supermemory.ai

## Purpose

Every APEX agent decision, gauntlet outcome, and scenario result must survive session boundaries. This layer gives the Colossus AI war-room persistent, searchable memory across two complementary backends:

| Backend | Type | Primary Use |
|---|---|---|
| **Pinecone** | Vector (semantic) | Find similar scenarios, docs, and incidents by meaning, not exact text |
| **Supermemory.ai** | Text + structured | Resume agent sessions with full context; plain-language decision log |

## Namespaces / Spaces

| Domain | Pinecone Namespace | Supermemory Space env var |
|---|---|---|
| Ops decisions | `colossus-memory` | `SUPERMEMORY_SPACE_OPS` |
| Gauntlet scenarios | `colossus-scenarios` | `SUPERMEMORY_SPACE_SCENARIOS` |
| Legal / EJ findings | `colossus-legal` | `SUPERMEMORY_SPACE_LEGAL` |
| Architecture docs | `colossus-docs` | `SUPERMEMORY_SPACE_DOCS` |

## Usage

```python
from src.memory import MemoryRouter

router = MemoryRouter()

# Health check all backends
print(router.health_check_all())

# Store a scenario outcome (dual-write)
router.remember_scenario(
    scenario_id="scn-energy-001",
    embedding=your_embedding,       # list[float] len=1536
    repo="xai-colossus-energy",
    scenario_name="N-1 Feeder Failure",
    result="PASS",
    metrics={"mw_shed": 12.5, "recovery_time_s": 4.2},
)

# Record an APEX agent decision
router.record_decision(
    agent_id="gap-detector-v2",
    decision="throttle_rack_7",
    context="feeder_A_at_98pct_load",
    outcome="SUCCESS",
    repo="xai-colossus-energy",
)

# Recall matching memories
results = router.recall(
    query="feeder failure last week",
    embedding=query_embedding,      # optional — enables Pinecone path
    namespace="scenario",
)
```

## One-command health check

```bash
python scripts/run_memory_health.py
```

## Required env vars

```env
PINECONE_API_KEY=
PINECONE_INDEX=colossus-apex
PINECONE_ENVIRONMENT=us-east-1
PINECONE_EMBED_DIM=1536

SUPERMEMORY_API_KEY=
SUPERMEMORY_SPACE_OPS=
SUPERMEMORY_SPACE_SCENARIOS=
SUPERMEMORY_SPACE_LEGAL=
SUPERMEMORY_SPACE_DOCS=
```

## Architecture

```
                  ┌──────────────────┐
     All Colossus │  MemoryRouter    │
     repos call → │  memory_router.py│
                  └────────┬─────────┘
                           │
              ┌────────────┴────────────┐
              ▼                         ▼
     ┌────────────────┐       ┌──────────────────────┐
     │ PineconeClient │       │ SupermemoryClient     │
     │ pinecone_      │       │ supermemory_client.py │
     │ client.py      │       │                       │
     │                │       │ REST v3 API            │
     │ SDK v3         │       │ /memories, /search     │
     └────────────────┘       └──────────────────────┘
     Namespaces:               Spaces:
     colossus-docs             colossus-ops
     colossus-legal            colossus-scenarios
     colossus-incidents        colossus-legal
     colossus-scenarios        colossus-docs
     colossus-memory
```

## Installing dependencies

```bash
pip install pinecone-client httpx pytest
```

## Running tests

```bash
pytest src/memory/tests/ -v
```
