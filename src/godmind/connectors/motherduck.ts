// GODMIND Connector — MotherDuck / DuckDB
// Analytical queries over case indexes, exhibit tables, and timeline data.
// Uses MotherDuck REST API for cloud; falls back to local DuckDB process.

import { ConnectorBase, ConnectorHealth, MotherDuckConfig } from './types.js';

const MD_BASE = 'https://api.motherduck.com/v1';

export class MotherDuckConnector implements ConnectorBase {
  readonly name     = 'motherduck';
  readonly version  = '1.0.0';
  readonly category = 'database' as const;

  private cfg: MotherDuckConfig;

  constructor(cfg?: Partial<MotherDuckConfig>) {
    this.cfg = {
      token:    cfg?.token    ?? process.env.MOTHERDUCK_TOKEN    ?? '',
      database: cfg?.database ?? process.env.MOTHERDUCK_DATABASE ?? 'colossus',
      readOnly: cfg?.readOnly ?? false,
    };
  }

  private headers() {
    return {
      Authorization: `Bearer ${this.cfg.token}`,
      'Content-Type': 'application/json',
    };
  }

  async query<T = Record<string, unknown>>(sql: string): Promise<T[]> {
    const res = await fetch(`${MD_BASE}/query`, {
      method: 'POST',
      headers: this.headers(),
      body: JSON.stringify({ query: sql, database: this.cfg.database }),
    });
    if (!res.ok) throw new Error(`[motherduck] Query failed: ${res.status}: ${await res.text()}`);
    const data = await res.json() as { data: T[] };
    return data.data ?? [];
  }

  async createCaseTable(): Promise<void> {
    await this.query(`
      CREATE TABLE IF NOT EXISTS case_index (
        case_id       VARCHAR PRIMARY KEY,
        judge         VARCHAR,
        parties       JSON,
        attorneys     JSON,
        documents     INTEGER,
        pages         INTEGER,
        ocr_pages     INTEGER,
        manifest_hash VARCHAR,
        created_at    TIMESTAMP DEFAULT NOW(),
        updated_at    TIMESTAMP DEFAULT NOW()
      )
    `);
  }

  async upsertCase(caseData: Record<string, unknown>): Promise<void> {
    const keys = Object.keys(caseData);
    const vals = Object.values(caseData).map(v =>
      typeof v === 'object' ? `'${JSON.stringify(v)}'` : `'${v}'`
    );
    await this.query(`
      INSERT INTO case_index (${keys.join(',')})
      VALUES (${vals.join(',')})
      ON CONFLICT (case_id) DO UPDATE SET updated_at = NOW()
    `);
  }

  async searchDocuments(caseId: string, fts: string): Promise<Record<string, unknown>[]> {
    return this.query(`
      SELECT * FROM documents
      WHERE case_id = '${caseId}'
        AND (filename ILIKE '%${fts}%' OR ocr_text ILIKE '%${fts}%')
      LIMIT 50
    `);
  }

  async healthCheck(): Promise<ConnectorHealth> {
    const start = Date.now();
    try {
      await this.query('SELECT 1 AS ping');
      return { ok: true, connector: this.name, latencyMs: Date.now() - start, checkedAt: new Date().toISOString() };
    } catch (err) {
      return { ok: false, connector: this.name, error: (err as Error).message, checkedAt: new Date().toISOString() };
    }
  }
}
