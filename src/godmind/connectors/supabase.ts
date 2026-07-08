// GODMIND Connector — Supabase
// Case data persistence: case registry, document index, entity store, timeline.

import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { ConnectorBase, ConnectorHealth, SupabaseConfig } from './types.js';

export class SupabaseConnector implements ConnectorBase {
  readonly name     = 'supabase';
  readonly version  = '1.0.0';
  readonly category = 'database' as const;

  private client: SupabaseClient;
  private cfg: SupabaseConfig;

  constructor(cfg?: Partial<SupabaseConfig>) {
    this.cfg = {
      url:            cfg?.url            ?? process.env.SUPABASE_URL            ?? '',
      anonKey:        cfg?.anonKey        ?? process.env.SUPABASE_ANON_KEY       ?? '',
      serviceRoleKey: cfg?.serviceRoleKey ?? process.env.SUPABASE_SERVICE_ROLE_KEY,
    };
    this.client = createClient(
      this.cfg.url,
      this.cfg.serviceRoleKey ?? this.cfg.anonKey
    );
  }

  get db(): SupabaseClient { return this.client; }

  async upsertCase(caseData: Record<string, unknown>): Promise<void> {
    const { error } = await this.client.from('cases').upsert(caseData, { onConflict: 'case_id' });
    if (error) throw new Error(`[supabase] upsertCase: ${error.message}`);
  }

  async upsertDocument(doc: Record<string, unknown>): Promise<void> {
    const { error } = await this.client.from('documents').upsert(doc, { onConflict: 'sha256' });
    if (error) throw new Error(`[supabase] upsertDocument: ${error.message}`);
  }

  async insertEntities(entities: Record<string, unknown>[]): Promise<void> {
    const { error } = await this.client.from('entities').insert(entities);
    if (error) throw new Error(`[supabase] insertEntities: ${error.message}`);
  }

  async insertTimelineEvents(events: Record<string, unknown>[]): Promise<void> {
    const { error } = await this.client.from('timeline_events').insert(events);
    if (error) throw new Error(`[supabase] insertTimelineEvents: ${error.message}`);
  }

  async getCase(caseId: string): Promise<Record<string, unknown> | null> {
    const { data, error } = await this.client.from('cases').select('*').eq('case_id', caseId).single();
    if (error) return null;
    return data;
  }

  async query(table: string, filters?: Record<string, unknown>): Promise<unknown[]> {
    let q = this.client.from(table).select('*');
    if (filters) {
      for (const [key, val] of Object.entries(filters)) q = q.eq(key, val);
    }
    const { data, error } = await q;
    if (error) throw new Error(`[supabase] query ${table}: ${error.message}`);
    return data ?? [];
  }

  async uploadFile(bucket: string, remotePath: string, fileBuffer: Buffer, contentType = 'application/octet-stream'): Promise<string> {
    const { error } = await this.client.storage.from(bucket).upload(remotePath, fileBuffer, {
      contentType, upsert: true
    });
    if (error) throw new Error(`[supabase] uploadFile: ${error.message}`);
    const { data } = this.client.storage.from(bucket).getPublicUrl(remotePath);
    return data.publicUrl;
  }

  async healthCheck(): Promise<ConnectorHealth> {
    const start = Date.now();
    try {
      await this.client.from('cases').select('count').limit(1);
      return { ok: true, connector: this.name, latencyMs: Date.now() - start, checkedAt: new Date().toISOString() };
    } catch (err) {
      return { ok: false, connector: this.name, error: (err as Error).message, checkedAt: new Date().toISOString() };
    }
  }
}
