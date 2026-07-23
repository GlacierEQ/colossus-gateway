export type Scalar = string | number | boolean;

export interface AddReq {
  containerTag: string;
  content?: string;
  customId?: string;
  metadata?: Record<string, Scalar>;
  filterByMetadata?: Record<string, Scalar | Scalar[]>;
  tags?: string[];
  schema?: string;
  payload?: Record<string, unknown>;
  source?: string;
}

export interface SearchReq {
  containerTag?: string | null;
  query?: string;
  q?: string;
  tags?: string[];
  limit?: number;
  threshold?: number;
}

export interface DeleteReq { id: string; }

const BASE_URL = process.env.SUPERMEMORY_BASE_URL ?? "https://api.supermemory.ai/v3";
const API_KEY = process.env.SUPERMEMORY_API_KEY;

async function request(path: string, init: RequestInit = {}) {
  if (!API_KEY) throw new Error("SUPERMEMORY_API_KEY not configured");
  const response = await fetch(`${BASE_URL}${path}`, {
    ...init,
    headers: {
      authorization: `Bearer ${API_KEY}`,
      "content-type": "application/json",
      ...(init.headers ?? {}),
    },
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(`Supermemory ${response.status}: ${JSON.stringify(data).slice(0, 400)}`);
  return data as Record<string, unknown>;
}

export async function memoryAdd(req: AddReq) {
  const content = req.content ?? (req.payload ? JSON.stringify(req.payload) : "");
  if (!req.containerTag || !content) throw new Error("containerTag and content are required");

  const metadata: Record<string, Scalar> = { ...(req.metadata ?? {}) };
  if (req.source) metadata.source = req.source;
  if (req.schema) metadata.schema = req.schema;
  if (req.tags?.length) metadata.tags = req.tags.join(",");

  const data = await request("/documents", {
    method: "POST",
    body: JSON.stringify({
      content,
      customId: req.customId,
      containerTag: req.containerTag,
      metadata,
      filterByMetadata: req.filterByMetadata,
    }),
  });
  return { ok: true, id: String(data.id ?? ""), status: data.status ?? "queued", containerTag: req.containerTag };
}

export async function memorySearch(req: SearchReq) {
  const query = (req.query ?? req.q ?? "").trim();
  if (!query) throw new Error("query is required");
  const params = new URLSearchParams({ q: query, limit: String(Math.min(Math.max(req.limit ?? 5, 1), 10)) });
  if (req.containerTag) params.set("containerTag", req.containerTag);
  if (req.threshold !== undefined) params.set("threshold", String(req.threshold));
  const data = await request(`/search?${params.toString()}`, { method: "GET" });
  const results = Array.isArray(data.results) ? data.results : [];
  return { ok: true, results, total: Number(data.total ?? results.length) };
}

export async function memoryDelete(req: DeleteReq) {
  if (!req.id) throw new Error("id is required");
  const data = await request(`/documents/${encodeURIComponent(req.id)}`, { method: "DELETE" });
  return { ok: true, id: req.id, deleted: true, data };
}
