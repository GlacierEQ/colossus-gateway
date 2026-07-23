import { mem0Add, mem0Delete, mem0Search, type Mem0Input } from "./mem0.js";
import { memoryAdd as supermemoryAdd, memoryDelete as supermemoryDelete, memorySearch as supermemorySearch, type AddReq, type SearchReq } from "./supermemory.js";

export type MemoryProvider = "auto" | "mem0" | "supermemory" | "both";

function chooseProvider(query = "", containerTag = ""): "mem0" | "supermemory" {
  const signal = `${query} ${containerTag}`.toLowerCase();
  const wantsLongForm = /case|brain|legal|document|provenance|evidence|source/.test(signal);
  if (wantsLongForm && process.env.SUPERMEMORY_API_KEY) return "supermemory";
  if (!wantsLongForm && process.env.MEM0_API_KEY) return "mem0";
  return process.env.SUPERMEMORY_API_KEY ? "supermemory" : "mem0";
}

function trimText(value: unknown, max = 800): string | undefined {
  if (typeof value !== "string") return undefined;
  return value.length > max ? `${value.slice(0, max)}…` : value;
}

function compactMem0(value: any) {
  const rows = Array.isArray(value) ? value : Array.isArray(value?.results) ? value.results : [];
  return rows.slice(0, 5).map((row: any) => ({
    id: row.id,
    memory: trimText(row.memory ?? row.content),
    score: row.score,
    metadata: row.metadata,
  }));
}

function compactSupermemory(value: any) {
  const rows = Array.isArray(value?.results) ? value.results : [];
  return rows.slice(0, 5).map((row: any) => ({
    documentId: row.documentId,
    title: row.title,
    score: row.score,
    metadata: row.metadata,
    chunks: Array.isArray(row.chunks) ? row.chunks.slice(0, 2).map((chunk: any) => ({ content: trimText(chunk.content), score: chunk.score })) : [],
  }));
}

export async function searchMemory(provider: MemoryProvider, input: SearchReq & { user_id?: string; agent_id?: string }) {
  const selected = provider === "auto" ? chooseProvider(input.query ?? input.q, input.containerTag ?? "") : provider;
  const mem0Input: Mem0Input = { query: input.query ?? input.q, user_id: input.user_id, agent_id: input.agent_id, limit: input.limit };

  if (selected === "mem0") return { provider: "mem0", results: compactMem0(await mem0Search(mem0Input)) };
  if (selected === "supermemory") return { provider: "supermemory", results: compactSupermemory(await supermemorySearch(input)) };

  const [mem0, supermemory] = await Promise.all([mem0Search(mem0Input), supermemorySearch(input)]);
  return { provider: "both", results: { mem0: compactMem0(mem0), supermemory: compactSupermemory(supermemory) } };
}

export async function deleteMemory(provider: Exclude<MemoryProvider, "auto">, id: string) {
  if (provider === "mem0") return { provider, result: await mem0Delete(id) };
  if (provider === "supermemory") return { provider, result: await supermemoryDelete({ id }) };
  const [mem0, supermemory] = await Promise.all([mem0Delete(id), supermemoryDelete({ id })]);
  return { provider: "both", result: { mem0, supermemory } };
}

export async function addMemory(provider: Exclude<MemoryProvider, "auto">, input: AddReq & { user_id?: string; agent_id?: string }) {
  const content = input.content ?? JSON.stringify(input.payload ?? {});
  if (provider === "mem0") {
    return { provider, result: await mem0Add({ messages: [{ role: "user", content }], user_id: input.user_id, agent_id: input.agent_id, metadata: input.metadata }) };
  }
  if (provider === "supermemory") return { provider, result: await supermemoryAdd(input) };

  const [mem0, supermemory] = await Promise.all([
    mem0Add({ messages: [{ role: "user", content }], user_id: input.user_id, agent_id: input.agent_id, metadata: input.metadata }),
    supermemoryAdd(input),
  ]);
  return { provider: "both", result: { mem0, supermemory } };
}
