// GODMIND Connector — Neon (Postgres)
// Persistent relational store: case registry, entity graph, document index.
// Uses the Neon serverless driver or standard pg connection string.

import { ConnectorBase, ConnectorHealth, NeonConfig } from './types.js';

export class NeonConnector implements ConnectorBase {
  readonly name     = 'neon';
  readonly version  = '1.0.0';
  readonly category = 'database' as const;

  private cfg: NeonConfig;

  constructor(cfg?: Partial<NeonConfig>) {
    this.cfg = {
      connectionString: cfg?.connectionString ?? process.env.NEON_CONNECTION_STRING ?? process.env.DATABASE_URL ?? '',
      projectId:        cfg?.projectId        ?? process.env.NEON_PROJECT_ID,
      branchId:         cfg?.branchId         ?? process.env.NEON_BRANCH_ID,
      readOnly:         cfg?.readOnly         ?? false,
    };
  }

  /**
   * Execute a SQL query via Neon serverless HTTP API.
   * For heavy workloads, switch to a pooled pg client.
   */
  async query<T = Record<string, unknown>>(sql: string, params: unknown[] = []): Promise<T[]> {
    const res = await fetch(`${this.cfg.connectionString}/query`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Neon-Pool-Opt-In': 'true' },
      body: JSON.stringify({ query: sql, params }),
    }).catch(() => null);

    // Fallback: use neon serverless driver if available
    if (!res) {
      try {
        const { neon } = await import('@neondatabase/serverless');
        const sql_fn = neon(this.cfg.connectionString);
        return (await sql_fn`${sql}`) as T[];
      } catch {
        throw new Error('[neon] Could not connect. Install @neondatabase/serverless or use pg.');
      }
    }
    if (!res.ok) throw new Error(`[neon] Query failed: ${res.status}: ${await res.text()}`);
    const data = await res.json() as { rows: T[] };
    return data.rows ?? [];
  }

  async initSchema(): Promise<void> {
    const statements = [
      `CREATE TABLE IF NOT EXISTS cases (
        case_id    TEXT PRIMARY KEY,
        judge      TEXT,
        court      TEXT,
        parties    JSONB DEFAULT '[]',
        attorneys  JSONB DEFAULT '[]',
        created_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW()
      )`,
      `CREATE TABLE IF NOT EXISTS documents (
        sha256     TEXT PRIMARY KEY,
        case_id    TEXT REFERENCES cases(case_id),
        filename   TEXT,
        pages      INT,
        ocr_done   BOOLEAN DEFAULT FALSE,
        ingested_at TIMESTAMPTZ DEFAULT NOW()
      )`,
      `CREATE TABLE IF NOT EXISTS entities (
        id         UUID DEFAULT gen_random_uuid() PRIMARY KEY,
        case_id    TEXT REFERENCES cases(case_id),
        type       TEXT,  -- PERSON, ORG, DATE, LOCATION
        value      TEXT,
        source_doc TEXT,
        created_at TIMESTAMPTZ DEFAULT NOW()
      )`,
      `CREATE INDEX IF NOT EXISTS idx_entities_case ON entities(case_id)`,
    ];
    for (const s of statements) await this.query(s);
  }

  async upsertCase(caseData: Record<string, unknown>): Promise<void> {
    await this.query(
      `INSERT INTO cases (case_id, judge, court, parties, attorneys)
       VALUES ($1,$2,$3,$4,$5)
       ON CONFLICT (case_id) DO UPDATE SET updated_at = NOW()`,
      [
        caseData.caseId, caseData.judge, caseData.court,
        JSON.stringify(caseData.parties ?? []),
        JSON.stringify(caseData.attorneys ?? []),
      ]
    );
  }

  async healthCheck(): Promise<ConnectorHealth> {
    const start = Date.now();
    try {
      await this.query('SELECT 1');
      return { ok: true, connector: this.name, latencyMs: Date.now() - start, checkedAt: new Date().toISOString() };
    } catch (err) {
      return { ok: false, connector: this.name, error: (err as Error).message, checkedAt: new Date().toISOString() };
    }
  }
}
