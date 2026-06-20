const BASE_URL = process.env.SUPERMEMORY_BASE_URL ?? "https://api.supermemory.ai";
const API_KEY  = process.env.SUPERMEMORY_API_KEY!;

export type Source = "perplexity" | "claude" | "cursor" | "omni-bridge";

export interface AddReq    { containerTag: string; tags: string[]; schema: string; payload: Record<string,unknown>; source: Source; }
export interface SearchReq { containerTag?: string|null; query: string; tags?: string[]; limit?: number; }
export interface DeleteReq { id: string; containerTag?: string|null; hardDelete?: boolean; }

const norm    = (s: string) => s.trim().toLowerCase().replace(/[^a-z0-9\-:]+/g,"-").replace(/-{2,}/g,"-").replace(/^-|-$/g,"");
const normTag = (s: string) => s.trim().toLowerCase().replace(/\s+/g,"-");

async function upstream(path: string, body: unknown) {
  if (!API_KEY) throw new Error("SUPERMEMORY_API_KEY not set");
  const r = await fetch(`${BASE_URL}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${API_KEY}` },
    body: JSON.stringify(body),
  });
  if (!r.ok) throw new Error(`Supermemory ${r.status}: ${(await r.text()).slice(0,400)}`);
  return r.json() as Promise<Record<string,unknown>>;
}

export async function memoryAdd(req: AddReq) {
  const containerTag = norm(req.containerTag);
  const tags = req.tags.map(normTag);
  const data = await upstream("/v1/memory/add", { containerTag, tags: [...tags, `source:${req.source}`], schema: req.schema, payload: req.payload });
  return { ok: true, error: null, id: String(data.id ?? data.memoryId ?? ""), containerTag, tags };
}

export async function memorySearch(req: SearchReq) {
  const containerTag = req.containerTag ? norm(req.containerTag) : null;
  const tags = (req.tags ?? []).map(normTag);
  const limit = Math.min(Math.max(req.limit ?? 10, 1), 50);
  const data = await upstream("/v1/memory/search", { containerTag, query: req.query, tags, limit });
  const results = (Array.isArray(data.results) ? data.results : []).map((item: any) => ({
    id: String(item.id ?? ""), score: Number(item.score ?? 0),
    containerTag: item.containerTag ?? containerTag,
    tags: Array.isArray(item.tags) ? item.tags : [],
    schema: item.schema ?? null, payload: item.payload ?? {},
  }));
  return { ok: true, error: null, results };
}

export async function memoryDelete(req: DeleteReq) {
  const containerTag = req.containerTag ? norm(req.containerTag) : null;
  const data = await upstream("/v1/memory/delete", { id: req.id, containerTag, hardDelete: !!req.hardDelete });
  return { ok: true, error: null, id: String(data.id ?? req.id), deleted: true, hardDelete: !!req.hardDelete };
}
