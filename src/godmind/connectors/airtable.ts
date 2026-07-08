// GODMIND Connector — Airtable
// Spreadsheet-style case tracking: exhibits, contacts, filing deadlines.

import { ConnectorBase, ConnectorHealth, AirtableConfig } from './types.js';

const AT_BASE = 'https://api.airtable.com/v0';

export class AirtableConnector implements ConnectorBase {
  readonly name     = 'airtable';
  readonly version  = '1.0.0';
  readonly category = 'project' as const;

  private cfg: AirtableConfig;

  constructor(cfg?: Partial<AirtableConfig>) {
    this.cfg = {
      apiKey:          cfg?.apiKey          ?? process.env.AIRTABLE_API_KEY  ?? '',
      baseId:          cfg?.baseId          ?? process.env.AIRTABLE_BASE_ID  ?? '',
      caseTableId:     cfg?.caseTableId     ?? process.env.AIRTABLE_CASE_TABLE,
      evidenceTableId: cfg?.evidenceTableId ?? process.env.AIRTABLE_EVIDENCE_TABLE,
      timelineTableId: cfg?.timelineTableId ?? process.env.AIRTABLE_TIMELINE_TABLE,
    };
  }

  private headers() {
    return { Authorization: `Bearer ${this.cfg.apiKey}`, 'Content-Type': 'application/json' };
  }

  private async req<T>(method: string, tableId: string, body?: unknown, qs?: string): Promise<T> {
    const url = `${AT_BASE}/${this.cfg.baseId}/${tableId}${qs ? `?${qs}` : ''}`;
    const res = await fetch(url, {
      method, headers: this.headers(),
      body: body ? JSON.stringify(body) : undefined,
    });
    if (!res.ok) throw new Error(`[airtable] ${method} ${tableId} → ${res.status}: ${await res.text()}`);
    return res.json() as Promise<T>;
  }

  async createRecord(tableId: string, fields: Record<string, unknown>): Promise<{ id: string }> {
    return this.req('POST', tableId, { fields });
  }

  async updateRecord(tableId: string, recordId: string, fields: Record<string, unknown>): Promise<void> {
    await this.req('PATCH', `${tableId}/${recordId}`, { fields });
  }

  async listRecords(tableId: string, formula?: string): Promise<{ id: string; fields: Record<string, unknown> }[]> {
    const qs = formula ? `filterByFormula=${encodeURIComponent(formula)}` : undefined;
    const data = await this.req<{ records: { id: string; fields: Record<string, unknown> }[] }>('GET', tableId, undefined, qs);
    return data.records;
  }

  async addEvidence(exhibit: {
    caseId: string; filename: string; sha256: string;
    description?: string; date?: string; source?: string;
  }): Promise<{ id: string }> {
    const tableId = this.cfg.evidenceTableId;
    if (!tableId) throw new Error('[airtable] No evidence table ID configured');
    return this.createRecord(tableId, {
      'Case ID':     exhibit.caseId,
      'Filename':    exhibit.filename,
      'SHA-256':     exhibit.sha256,
      'Description': exhibit.description ?? '',
      'Date':        exhibit.date ?? '',
      'Source':      exhibit.source ?? '',
      'Ingested':    new Date().toISOString(),
    });
  }

  async addTimelineEvent(event: {
    caseId: string; date: string; description: string; significance?: string;
  }): Promise<{ id: string }> {
    const tableId = this.cfg.timelineTableId;
    if (!tableId) throw new Error('[airtable] No timeline table ID configured');
    return this.createRecord(tableId, {
      'Case ID':      event.caseId,
      'Date':         event.date,
      'Description':  event.description,
      'Significance': event.significance ?? 'MED',
    });
  }

  async healthCheck(): Promise<ConnectorHealth> {
    const start = Date.now();
    try {
      const tableId = this.cfg.caseTableId ?? this.cfg.evidenceTableId ?? 'Cases';
      await this.req('GET', tableId, undefined, 'maxRecords=1');
      return { ok: true, connector: this.name, latencyMs: Date.now() - start, checkedAt: new Date().toISOString() };
    } catch (err) {
      return { ok: false, connector: this.name, error: (err as Error).message, checkedAt: new Date().toISOString() };
    }
  }
}
