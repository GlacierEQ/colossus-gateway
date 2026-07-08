// GODMIND Connector — Notion
// Case management: create pages, sync docket entries, update case database.

import { ConnectorBase, ConnectorHealth, NotionConfig } from './types.js';

const NOTION_BASE = 'https://api.notion.com/v1';
const NOTION_VER  = '2022-06-28';

export class NotionConnector implements ConnectorBase {
  readonly name     = 'notion';
  readonly version  = '1.0.0';
  readonly category = 'docs' as const;

  private cfg: NotionConfig;

  constructor(cfg?: Partial<NotionConfig>) {
    this.cfg = {
      apiKey:             cfg?.apiKey             ?? process.env.NOTION_API_KEY ?? '',
      defaultDatabaseId:  cfg?.defaultDatabaseId  ?? process.env.NOTION_DEFAULT_DB,
      casesDatabaseId:    cfg?.casesDatabaseId    ?? process.env.NOTION_CASES_DB,
      evidenceDatabaseId: cfg?.evidenceDatabaseId ?? process.env.NOTION_EVIDENCE_DB,
    };
  }

  private headers() {
    return {
      Authorization:   `Bearer ${this.cfg.apiKey}`,
      'Notion-Version': NOTION_VER,
      'Content-Type':  'application/json',
    };
  }

  private async req<T>(method: string, path: string, body?: unknown): Promise<T> {
    const res = await fetch(`${NOTION_BASE}${path}`, {
      method, headers: this.headers(),
      body: body ? JSON.stringify(body) : undefined,
    });
    if (!res.ok) throw new Error(`[notion] ${method} ${path} → ${res.status}: ${await res.text()}`);
    return res.json() as Promise<T>;
  }

  async createCasePage(caseId: string, caseMeta: Record<string, unknown>): Promise<{ id: string; url: string }> {
    const dbId = this.cfg.casesDatabaseId ?? this.cfg.defaultDatabaseId;
    if (!dbId) throw new Error('[notion] No cases database ID configured');
    return this.req('POST', '/pages', {
      parent: { database_id: dbId },
      properties: {
        Name:       { title:   [{ text: { content: caseId } }] },
        Judge:      { rich_text: [{ text: { content: (caseMeta.judge as string) ?? '' } }] },
        Status:     { select: { name: 'Active' } },
        Created:    { date: { start: new Date().toISOString().split('T')[0] } },
      },
    });
  }

  async appendToPage(pageId: string, markdown: string): Promise<void> {
    const blocks = markdown.split('\n').filter(Boolean).map(line => ({
      object: 'block', type: 'paragraph',
      paragraph: { rich_text: [{ type: 'text', text: { content: line.slice(0, 2000) } }] }
    }));
    await this.req('PATCH', `/blocks/${pageId}/children`, { children: blocks.slice(0, 100) });
  }

  async queryDatabase(databaseId: string, filter?: Record<string, unknown>): Promise<{ results: unknown[] }> {
    return this.req('POST', `/databases/${databaseId}/query`, { filter: filter ?? {} });
  }

  async healthCheck(): Promise<ConnectorHealth> {
    const start = Date.now();
    try {
      await this.req('GET', '/users/me');
      return { ok: true, connector: this.name, latencyMs: Date.now() - start, checkedAt: new Date().toISOString() };
    } catch (err) {
      return { ok: false, connector: this.name, error: (err as Error).message, checkedAt: new Date().toISOString() };
    }
  }
}
