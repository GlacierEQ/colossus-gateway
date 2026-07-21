import { createHash, randomUUID } from 'node:crypto';
import { Client as NotionClient } from '@notionhq/client';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';

export type AuditStatus = 'started' | 'succeeded' | 'failed' | 'blocked';

export interface AuditEvent {
  requestId?: string;
  action: string;
  status: AuditStatus;
  actor?: string;
  source?: string;
  target?: Record<string, unknown>;
  arguments?: unknown;
  result?: unknown;
  error?: string;
  startedAt?: string;
  completedAt?: string;
}

const CAPABILITY_SUPABASE_URL = process.env.APEX_CAPABILITY_SUPABASE_URL || 'https://dyhprklicgewmrimecey.supabase.co';
const CAPABILITY_SUPABASE_PUBLISHABLE_KEY = process.env.APEX_CAPABILITY_SUPABASE_PUBLISHABLE_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImR5aHBya2xpY2dld21yaW1lY2V5Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTI5NTkxMjUsImV4cCI6MjA2ODUzNTEyNX0.KSddhx8HBzWFM73hdM-p_IChuI8bdb5UitmehQYXRtI';
const SECRET_KEY = /token|secret|password|authorization|private[_-]?key|download[_-]?url|content[_-]?base64|capability/i;
const CONTENT_KEY = /(^|_)(content|body|text|bytes|data)$/i;

function digest(value: unknown): string {
  return createHash('sha256').update(JSON.stringify(value ?? null)).digest('hex');
}

function sanitize(value: unknown, key = ''): unknown {
  if (SECRET_KEY.test(key)) return '[REDACTED]';
  if (value === null || value === undefined) return value;
  if (typeof value === 'string') {
    if (CONTENT_KEY.test(key) || value.length > 2048) {
      return { sha256: createHash('sha256').update(value).digest('hex'), length: value.length };
    }
    return value;
  }
  if (typeof value === 'number' || typeof value === 'boolean') return value;
  if (Array.isArray(value)) return value.slice(0, 100).map((item) => sanitize(item));
  if (typeof value === 'object') {
    const output: Record<string, unknown> = {};
    for (const [childKey, childValue] of Object.entries(value as Record<string, unknown>)) {
      output[childKey] = sanitize(childValue, childKey);
    }
    return output;
  }
  return String(value);
}

export class AuditLedger {
  private readonly supabase: SupabaseClient | null;
  private readonly capabilitySupabase: SupabaseClient;
  private readonly notion: NotionClient | null;

  constructor() {
    const url = process.env.SUPABASE_URL;
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_KEY;
    this.supabase = url && key ? createClient(url, key, { auth: { persistSession: false } }) : null;
    this.capabilitySupabase = createClient(
      CAPABILITY_SUPABASE_URL,
      CAPABILITY_SUPABASE_PUBLISHABLE_KEY,
      { auth: { persistSession: false } },
    );
    this.notion = process.env.NOTION_TOKEN ? new NotionClient({ auth: process.env.NOTION_TOKEN }) : null;
  }

  async consumeCapability(nonce: string, allowedTool: string, expectedSha256: string): Promise<boolean> {
    if (!nonce || !/^[0-9a-f]{64}$/i.test(expectedSha256)) return false;
    const nonceHash = createHash('sha256').update(nonce).digest('hex');
    const { data, error } = await this.capabilitySupabase.rpc('consume_apex_tool_gateway_capability', {
      p_nonce_hash: nonceHash,
      p_allowed_tool: allowedTool,
      p_expected_sha256: expectedSha256.toLowerCase(),
    });
    return !error && data === true;
  }

  private async recordPublishable(metadata: Record<string, unknown>): Promise<string> {
    const event = {
      request_id: metadata.request_id,
      action: metadata.action,
      status: metadata.status,
      actor: metadata.actor,
      source: metadata.source,
      target: metadata.target,
      arguments_sha256: metadata.arguments_sha256,
      result_sha256: metadata.result_sha256,
      error: typeof metadata.error === 'string' ? metadata.error : undefined,
      metadata: {
        schema_version: metadata.schema_version,
        started_at: metadata.started_at,
        completed_at: metadata.completed_at,
      },
    };
    const { data, error } = await this.capabilitySupabase.rpc('record_apex_tool_gateway_event', { p_event: event });
    if (error) return `failed:${error.message}`;
    return data?.recorded === true ? 'recorded_publishable_rpc' : 'failed:unexpected response';
  }

  async record(event: AuditEvent): Promise<{ request_id: string; supabase: string; notion: string }> {
    const requestId = event.requestId || randomUUID();
    const timestamp = event.completedAt || new Date().toISOString();
    const metadata: Record<string, unknown> = {
      schema_version: '1.0',
      request_id: requestId,
      action: event.action,
      status: event.status,
      actor: event.actor || 'unknown',
      source: event.source || 'colossus-gateway',
      target: sanitize(event.target),
      arguments: sanitize(event.arguments),
      arguments_sha256: digest(event.arguments),
      result: sanitize(event.result),
      result_sha256: digest(event.result),
      error: event.error ? sanitize(event.error) : undefined,
      started_at: event.startedAt,
      completed_at: timestamp,
    };

    let supabaseState = 'not_configured';
    if (this.supabase) {
      const table = process.env.AUDIT_TABLE || 'apex_integration_events';
      const row = table === 'apex_integration_events'
        ? {
            event_type: 'TOOL_ACTION',
            title: `${event.action}:${event.status}`,
            metadata,
            case_id: process.env.CASE_ID || '1FDV-23-0001009',
          }
        : metadata;
      const { error } = await this.supabase.from(table).insert(row as any);
      if (error && table !== 'apex_integration_events') {
        const fallback = await this.supabase.from('apex_integration_events').insert({
          event_type: 'TOOL_ACTION',
          title: `${event.action}:${event.status}`,
          metadata,
          case_id: process.env.CASE_ID || '1FDV-23-0001009',
        });
        supabaseState = fallback.error ? `failed:${fallback.error.message}` : 'fallback_recorded';
      } else {
        supabaseState = error ? `failed:${error.message}` : 'recorded';
      }
    }
    if (supabaseState === 'not_configured' || supabaseState.startsWith('failed:')) {
      supabaseState = await this.recordPublishable(metadata);
    }

    let notionState = 'not_configured';
    const parentPageId = process.env.NOTION_ACTION_PARENT_PAGE_ID;
    if (this.notion && parentPageId && ['succeeded', 'failed', 'blocked'].includes(event.status)) {
      try {
        await this.notion.pages.create({
          parent: { type: 'page_id', page_id: parentPageId },
          properties: {
            title: {
              type: 'title',
              title: [{ type: 'text', text: { content: `${event.action} — ${event.status}` } }],
            },
          },
          children: [
            {
              object: 'block',
              type: 'code',
              code: {
                language: 'json',
                rich_text: [{ type: 'text', text: { content: JSON.stringify(metadata, null, 2).slice(0, 18000) } }],
              },
            },
          ],
        });
        notionState = 'recorded';
      } catch (error) {
        notionState = `failed:${error instanceof Error ? error.message : 'unknown'}`;
      }
    }

    return { request_id: requestId, supabase: supabaseState, notion: notionState };
  }

  async retrieveNotion(query: string, limit = 10, accessToken?: string): Promise<unknown[]> {
    const boundedLimit = Math.min(Math.max(limit, 1), 100);
    const client = accessToken ? new NotionClient({ auth: accessToken }) : this.notion;

    if (client) {
      const response = await client.search({
        query,
        page_size: boundedLimit,
        sort: { direction: 'descending', timestamp: 'last_edited_time' },
      });
      return response.results.map((item: any) => ({
        id: item.id,
        object: item.object,
        url: item.url,
        last_edited_time: item.last_edited_time,
        title:
          item.title?.[0]?.plain_text ||
          item.properties?.title?.title?.[0]?.plain_text ||
          item.properties?.Name?.title?.[0]?.plain_text ||
          item.properties?.name?.title?.[0]?.plain_text ||
          'Untitled',
      }));
    }

    const response = await fetch(`${CAPABILITY_SUPABASE_URL}/functions/v1/apex-notion-broker`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${CAPABILITY_SUPABASE_PUBLISHABLE_KEY}`,
        apikey: CAPABILITY_SUPABASE_PUBLISHABLE_KEY,
        'content-type': 'application/json',
      },
      body: JSON.stringify({ action: 'search', query, limit: boundedLimit }),
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error(payload?.message || payload?.error || `notion_broker_http_${response.status}`);
    }
    return Array.isArray(payload?.results) ? payload.results : [];
  }
}

export const auditLedger = new AuditLedger();
