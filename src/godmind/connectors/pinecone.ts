// GODMIND Connector — Pinecone
// Semantic search for case evidence: upsert, query, and retrieve chunks.

import { ConnectorBase, ConnectorHealth, PineconeConfig, VectorRecord } from './types.js';

const PINECONE_BASE = (indexHost: string) => `https://${indexHost}`;

export class PineconeConnector implements ConnectorBase {
  readonly name     = 'pinecone';
  readonly version  = '1.0.0';
  readonly category = 'vector' as const;

  private cfg: PineconeConfig;
  private indexHost?: string;

  constructor(cfg?: Partial<PineconeConfig>) {
    this.cfg = {
      apiKey:     cfg?.apiKey     ?? process.env.PINECONE_API_KEY     ?? '',
      indexName:  cfg?.indexName  ?? process.env.PINECONE_INDEX_NAME  ?? 'colossus',
      namespace:  cfg?.namespace  ?? process.env.PINECONE_NAMESPACE,
      region:     cfg?.region     ?? process.env.PINECONE_REGION      ?? 'us-east-1',
    };
  }

  private headers() {
    return { 'Api-Key': this.cfg.apiKey, 'Content-Type': 'application/json' };
  }

  private async getIndexHost(): Promise<string> {
    if (this.indexHost) return this.indexHost;
    const res = await fetch(`https://api.pinecone.io/indexes/${this.cfg.indexName}`, {
      headers: this.headers()
    });
    if (!res.ok) throw new Error(`[pinecone] Index lookup failed: ${res.status}`);
    const data = await res.json() as { host: string };
    this.indexHost = data.host;
    return this.indexHost;
  }

  async upsert(records: VectorRecord[], namespace?: string): Promise<void> {
    const host = await this.getIndexHost();
    const ns = namespace ?? this.cfg.namespace ?? 'default';
    const res = await fetch(`${PINECONE_BASE(host)}/vectors/upsert`, {
      method: 'POST',
      headers: this.headers(),
      body: JSON.stringify({ vectors: records, namespace: ns }),
    });
    if (!res.ok) throw new Error(`[pinecone] Upsert failed: ${res.status}: ${await res.text()}`);
  }

  async query(vector: number[], topK = 10, namespace?: string, filter?: Record<string, unknown>): Promise<{
    matches: { id: string; score: number; metadata?: Record<string, unknown> }[]
  }> {
    const host = await this.getIndexHost();
    const ns = namespace ?? this.cfg.namespace ?? 'default';
    const res = await fetch(`${PINECONE_BASE(host)}/query`, {
      method: 'POST',
      headers: this.headers(),
      body: JSON.stringify({ vector, topK, namespace: ns, includeMetadata: true, filter }),
    });
    if (!res.ok) throw new Error(`[pinecone] Query failed: ${res.status}: ${await res.text()}`);
    return res.json() as Promise<{ matches: { id: string; score: number; metadata?: Record<string, unknown> }[] }>;
  }

  async deleteByIds(ids: string[], namespace?: string): Promise<void> {
    const host = await this.getIndexHost();
    const ns = namespace ?? this.cfg.namespace ?? 'default';
    const res = await fetch(`${PINECONE_BASE(host)}/vectors/delete`, {
      method: 'POST',
      headers: this.headers(),
      body: JSON.stringify({ ids, namespace: ns }),
    });
    if (!res.ok) throw new Error(`[pinecone] Delete failed: ${res.status}`);
  }

  async healthCheck(): Promise<ConnectorHealth> {
    const start = Date.now();
    try {
      await this.getIndexHost();
      return { ok: true, connector: this.name, latencyMs: Date.now() - start, checkedAt: new Date().toISOString() };
    } catch (err) {
      return { ok: false, connector: this.name, error: (err as Error).message, checkedAt: new Date().toISOString() };
    }
  }
}
