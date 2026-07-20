export interface Mem0Input {
  messages?: Array<{ role: string; content: string }>;
  query?: string;
  user_id?: string;
  agent_id?: string;
  metadata?: Record<string, unknown>;
  limit?: number;
}

const BASE_URL = process.env.MEM0_BASE_URL ?? "https://api.mem0.ai";

async function request(path: string, method: "POST", body: Mem0Input) {
  const key = process.env.MEM0_API_KEY;
  if (!key) throw new Error("MEM0_API_KEY not configured");
  const response = await fetch(`${BASE_URL}${path}`, {
    method,
    headers: { "content-type": "application/json", authorization: `Bearer ${key}` },
    body: JSON.stringify(body),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(`Mem0 ${response.status}: ${JSON.stringify(data).slice(0, 400)}`);
  return data;
}

export function mem0Add(input: Mem0Input) {
  if (!input.messages?.length) throw new Error("Mem0 add requires messages");
  return request("/v1/memories/", "POST", input);
}

export function mem0Search(input: Mem0Input) {
  if (!input.query?.trim()) throw new Error("Mem0 search requires query");
  return request("/v1/memories/search/", "POST", {
    ...input,
    limit: Math.min(Math.max(input.limit ?? 5, 1), 10),
  });
}
