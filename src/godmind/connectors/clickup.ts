// GODMIND Connector — ClickUp
// Project management: create case tasks, track filing deadlines, update status.

import { ConnectorBase, ConnectorHealth, ClickUpConfig } from './types.js';

const CU_BASE = 'https://api.clickup.com/api/v2';

export class ClickUpConnector implements ConnectorBase {
  readonly name     = 'clickup';
  readonly version  = '1.0.0';
  readonly category = 'project' as const;

  private cfg: ClickUpConfig;

  constructor(cfg?: Partial<ClickUpConfig>) {
    this.cfg = {
      apiToken:           cfg?.apiToken           ?? process.env.CLICKUP_API_TOKEN       ?? '',
      defaultWorkspaceId: cfg?.defaultWorkspaceId ?? process.env.CLICKUP_WORKSPACE_ID,
      defaultListId:      cfg?.defaultListId      ?? process.env.CLICKUP_DEFAULT_LIST_ID,
      caseListId:         cfg?.caseListId         ?? process.env.CLICKUP_CASE_LIST_ID,
      evidenceListId:     cfg?.evidenceListId     ?? process.env.CLICKUP_EVIDENCE_LIST_ID,
    };
  }

  private headers() {
    return { Authorization: this.cfg.apiToken, 'Content-Type': 'application/json' };
  }

  private async req<T>(method: string, path: string, body?: unknown): Promise<T> {
    const res = await fetch(`${CU_BASE}${path}`, {
      method, headers: this.headers(),
      body: body ? JSON.stringify(body) : undefined,
    });
    if (!res.ok) throw new Error(`[clickup] ${method} ${path} → ${res.status}: ${await res.text()}`);
    return res.json() as Promise<T>;
  }

  async createCaseTask(caseId: string, caseMeta: Record<string, unknown>, deadline?: Date): Promise<{ id: string; url: string }> {
    const listId = this.cfg.caseListId ?? this.cfg.defaultListId;
    if (!listId) throw new Error('[clickup] No list ID configured for cases');
    return this.req('POST', `/list/${listId}/task`, {
      name:        `[CASE] ${caseId}`,
      description: `Judge: ${caseMeta.judge ?? 'Unknown'}\nParties: ${JSON.stringify(caseMeta.parties ?? [])}`,
      status:      'active',
      priority:    2,
      due_date:    deadline ? deadline.getTime() : undefined,
      tags:        ['colossus', 'legal'],
    });
  }

  async createFilingTask(caseId: string, filingName: string, deadline?: Date): Promise<{ id: string }> {
    const listId = this.cfg.caseListId ?? this.cfg.defaultListId;
    if (!listId) throw new Error('[clickup] No list ID configured');
    return this.req('POST', `/list/${listId}/task`, {
      name:     `[FILING] ${caseId} — ${filingName}`,
      status:   'pending',
      priority: 1,
      due_date: deadline ? deadline.getTime() : undefined,
      tags:     ['colossus', 'filing', 'deadline'],
    });
  }

  async updateTaskStatus(taskId: string, status: string): Promise<void> {
    await this.req('PUT', `/task/${taskId}`, { status });
  }

  async getWorkspaceTasks(workspaceId: string): Promise<unknown[]> {
    const data = await this.req<{ tasks: unknown[] }>('GET', `/team/${workspaceId}/task?tags[]=colossus`);
    return data.tasks;
  }

  async healthCheck(): Promise<ConnectorHealth> {
    const start = Date.now();
    try {
      await this.req('GET', '/user');
      return { ok: true, connector: this.name, latencyMs: Date.now() - start, checkedAt: new Date().toISOString() };
    } catch (err) {
      return { ok: false, connector: this.name, error: (err as Error).message, checkedAt: new Date().toISOString() };
    }
  }
}
