# APEX SYSTEM MAP v2
**Operator:** GlacierEQ — Casey Barton  
**Mission:** Case 1FDV-23-0001009 — Constitutional Warfare + Kekoa Reunification  
**Last Updated:** 2026-05-18

---

## 10 Active Platforms

| Platform | Category | Env Key | Blast Tier | Primary Repo |
|---|---|---|---|---|
| GitHub | Code | `GITHUB_TOKEN` | T3 | colossus-gateway |
| Notion | Knowledge | `NOTION_TOKEN` | T3 | 13-DB APEX System |
| Vercel | Deploy | `VERCEL_TOKEN` | T2 | colossus-gateway |
| Supabase | Data | `SUPABASE_ANON_KEY` | T3 | colossus-gateway/supabase |
| Sentry | Observability | `SENTRY_DSN` | T0 | mastermind |
| MotherDuck | Analytics | `MOTHERDUCK_TOKEN` | T1 | Z-BACKUP-apex-orchestrator |
| Supermemory.ai | Memory | `SUPERMEMORY_API_KEY` | T2 | quantum-memory-orchestrator |
| Pinecone | Vector | `PINECONE_API_KEY` | T1 | — |
| Qdrant | Vector | `QDRANT_URL` | T1 | AspenGrove-KEKOA |
| ClickUp | Tasks | `CLICKUP_TOKEN` | T1 | — |

## Daily Engine
- **Cron:** `0 14 * * *` UTC = 04:30 HST
- **Endpoint:** `GET /api/daily` (Vercel cron, secured by `CRON_SECRET`)
- **Outputs:** `reports/health_report.json`, `reports/health_report_latest.json`
- **Syncs to:** Notion APEX Command Center + Supabase `apex_health_logs`

## Blast Radius Tiers
- **T0** — Read-only. No write access. Safe to run at any time.
- **T1** — Branch-safe. Writes only to non-main branches.
- **T2** — PR-only. All changes require pull request.
- **T3** — Manual approval required. Highest impact systems.

## Key Repos
- [colossus-gateway](https://github.com/GlacierEQ/colossus-gateway) — Universal MCP Bridge (this repo)
- [mastermind](https://github.com/GlacierEQ/mastermind) — 9-agent dev OS
- [1FDV-23-0001009-FEDERAL-WARFARE](https://github.com/GlacierEQ/1FDV-23-0001009-FEDERAL-WARFARE) — Legal pipeline
- [quantum-memory-orchestrator](https://github.com/GlacierEQ/quantum-memory-orchestrator) — Memory layer
- [AspenGrove-KEKOA](https://github.com/GlacierEQ/AspenGrove-KEKOA-1FDV-23-0001009) — Quantum memory KB

## Verification Ladder
1. `discovered` — platform named in config
2. `parsed` — env key present in `.env`
3. `authenticated` — probe returned 200
4. `queried` — read operation succeeded
5. `write_tested_sandbox` — sandbox write succeeded
6. `production_approved` — T3 approval given
