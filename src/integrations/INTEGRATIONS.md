# Colossus Platform Integrations

All 13 external platform connectors for the APEX Colossus stack, wired through a unified `connector_registry`.

---

## Connector Map

| # | Connector | Purpose in Colossus | Env Vars |
|---|-----------|---------------------|----------|
| 1 | **GitHub** | Issue tracking, code, CI/CD | `GITHUB_TOKEN` |
| 2 | **Notion** | Knowledge base, run logs, EJ docs | `NOTION_API_KEY` |
| 3 | **Vercel** | Deploy status, env var sync | `VERCEL_TOKEN` |
| 4 | **Supabase** | Live state: connector_jobs, godmind_memory, gap register | `SUPABASE_URL`, `SUPABASE_SERVICE_KEY` |
| 5 | **MotherDuck** | Analytics warehouse: scenario traces, energy logs, audit trails | `MOTHERDUCK_TOKEN` |
| 6 | **Airtable** | Community stakeholder registry, permitting tracker | `AIRTABLE_API_KEY`, `AIRTABLE_BASE_ID` |
| 7 | **ClickUp** | Project management, gauntlet tracking, P1/P2 tasks | `CLICKUP_API_KEY`, `CLICKUP_TEAM_ID` |
| 8 | **Google Docs** | Long-form scenario reports, legal artifacts | `GOOGLE_OAUTH_TOKEN` |
| 9 | **Google Sheets** | Rack inventory exports, EJ metrics dashboards | `GOOGLE_OAUTH_TOKEN` |
| 10 | **Microsoft OneNote** | Field notes, on-site incident records | `MICROSOFT_GRAPH_TOKEN` |
| 11 | **Pinecone** | Semantic vector memory (scenario similarity search) | `PINECONE_API_KEY`, `PINECONE_INDEX` |
| 12 | **Qdrant** | Secondary vector store (structured payload filtering) | `QDRANT_URL`, `QDRANT_API_KEY`, `QDRANT_COLLECTION` |
| 13 | **Sentry** | Runtime error tracking, alert rules per Colossus repo | `SENTRY_AUTH_TOKEN`, `SENTRY_ORG` |

---

## Quick Start

```bash
# Copy env template
cp .env.example .env
# Fill in your keys, then:
python scripts/run_connector_health.py
```

Expected output:
```
─────────────────────────────────────────────────────
  Colossus Platform Connector Health Check
─────────────────────────────────────────────────────
  ✅ github               ok  42ms
  ✅ notion               ok  85ms
  ✅ supabase             ok  31ms
  ⚠️  motherduck           skipped  missing env: MOTHERDUCK_TOKEN
  ...
```

---

## Usage Pattern

```python
from src.integrations import get_connector, health_check_all

# Get one connector
gh = get_connector("github")
issues = gh.list_issues("GlacierEQ", "xai-colossus-energy")

# Check all at once
results = health_check_all()
for name, r in results.items():
    print(name, r["status"])
```

---

## APEX Integration Pattern

Every Colossus domain repo (energy, cooling, servers, security, nanosphere) uses connectors in this order:

1. **Read** current scenario from Supabase `connector_jobs`
2. **Run** the gauntlet / simulation
3. **Write** results back to Supabase `godmind_memory`
4. **Upsert** semantic embedding to Pinecone + Qdrant via `MemoryRouter`
5. **Log** issues to GitHub and tasks to ClickUp if severity >= P1
6. **Track** errors to Sentry
7. **Archive** to MotherDuck for long-term analytics

---

## Vector Memory Dual-Write

Both `PineconeConnector` and `QdrantConnector` are active simultaneously:

| Backend | Strength | Namespaces/Collections |
|---------|----------|------------------------|
| **Pinecone** | Speed, managed, cosine similarity | `colossus-scenarios`, `colossus-docs`, `colossus-legal` |
| **Qdrant** | Payload filtering, self-hosted option, complex queries | `colossus` (unified collection with `scenario_type` payload) |

Use `MemoryRouter` (in `src/memory/`) for dual-write. Use connectors directly only for lower-level ops.

---

## Adding a New Connector

1. Create a class in `connector_registry.py` extending `BaseConnector`
2. Add to `CONNECTOR_MAP`
3. Add env vars to `.env.example`
4. Add unit test in `tests/test_connector_registry.py`
5. Update this doc
