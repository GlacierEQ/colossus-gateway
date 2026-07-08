// GODMIND Connector — Qdrant
// Self-hosted or cloud vector store for case evidence semantic retrieval.

import { ConnectorBase, ConnectorHealth, QdrantConfig, VectorRecord } from './types.js';

export class QdrantConnector implements ConnectorBase {
  readonly name     = 'qdrant';
  readonly version  = '1.0.0';
  readonly category = 'vector' as const;

  private cfg: QdrantConfig;

  constructor(cfg?: Partial<QdrantConfig>) {
    this.cfg = {
      url:            cfg?.url            ?? process.env.QDRANT_URL            ?? 'http://localhost:6333',
      apiKey:         cfg?.apiKey         ?? process.env.QDRANT_API_KEY,
      collectionName: cfg?.collectionName ?? process.env.QDRANT_COLLECTION     ?? 'colossus',
      vectorSize:     cfg?.vectorSize     ?? parseInt(process.env.QDRANT_VECTOR_SIZE ?? '1536', 10),
    };
  }

  private headers() {
    return {
      'Content-Type': 'application/json',
      ...(this.cfg.apiKey ? { 'api-key': this.cfg.apiKey } : {}),
    };
  }

  private async req<T>(method: string, path: string, body?: unknown): Promise<T> {
    const res = await fetch(`${this.cfg.url}${path}`, {
      method, headers: this.headers(),
      body: body ? JSON.stringify(body) : undefined,
    });
    if (!res.ok) throw new Error(`[qdrant] ${method} ${path} → ${res.status}: ${await res.text()}`);
    return res.json() as Promise<T>;
  }

  async ensureCollection(vectorSize?: number): Promise<void> {
    try {
      await this.req('GET', `/collections/${this.cfg.collectionName}`);
    } catch {
      await this.req('PUT', `/collections/${this.cfg.collectionName}`, {
        vectors: { size: vectorSize ?? this.cfg.vectorSize, distance: 'Cosine' }
      });
    }
  }

  async upsert(records: VectorRecord[]): Promise<void> {
    const points = records.map(r => ({ id: r.id, vector: r.vector, payload: r.payload }));
    await this.req('PUT', `/collections/${this.cfg.collectionName}/points`, { points });
  }

  async search(vector: number[], limit = 10, filter?: Record<string, unknown>): Promise<{
    result: { id: string; score: number; payload?: Record<string, unknown> }[]
  }> {
    return this.req('POST', `/collections/${this.cfg.collectionName}/points/search`, {
      vector, limit, with_payload: true, filter
    });
  }

  async delete(ids: (string | number)[]): Promise<void> {
    await this.req('POST', `/collections/${this.cfg.collectionName}/points/delete`, {
      points: ids
    });
  }

  async healthCheck(): Promise<ConnectorHealth> {
    const start = Date.now();
    try {
      await this.req('GET', '/healthz');
      return { ok: true, connector: this.name, latencyMs: Date.now() - start, checkedAt: new Date().toISOString() };
    } catch (err) {
      return { ok: false, connector: this.name, error: (err as Error).message, checkedAt: new Date().toISOString() };
    }
  }
}
