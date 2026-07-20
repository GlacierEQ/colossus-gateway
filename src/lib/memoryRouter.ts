import { mem0Add, mem0Search, type Mem0Input } from "./mem0.js";
import { memoryAdd as supermemoryAdd, memorySearch as supermemorySearch, type AddReq, type SearchReq } from "./supermemory.js";

export type MemoryProvider = "auto" | "mem0" | "supermemory" | "both";

function chooseProvider(query = "", containerTag = ""): "mem0" | "supermemory" {
  const signal = `${query} ${containerTag}`.toLowerCase();
  return /case|brain|legal|document|provenance|evidence|source/.test(signal) ? "supermemory" : "mem0";
}

export async function searchMemory(provider: MemoryProvider, input: SearchReq & { user_id?: string; agent_id?: string }) {
  const selected = provider === "auto" ? chooseProvider(input.query ?? input.q, input.containerTag ?? "") : provider;
  const mem0Input: Mem0Input = { query: input.query ?? input.q, user_id: input.user_id, agent_id: input.agent_id, limit: input.limit };

  if (selected === "mem0") return { provider: "mem0", results: await mem0Search(mem0Input) };
  if (selected === "supermemory") return { provider: "supermemory", results: await supermemorySearch(input) };

  const [mem0, supermemory] = await Promise.all([
    mem0Search(mem0Input),
    supermemorySearch(input),
  ]);
  return { provider: "both", results: { mem0, supermemory } };
}

export async function addMemory(provider: Exclude<MemoryProvider, "auto">, input: AddReq & { user_id?: string; agent_id?: string }) {
  if (provider === "mem0") {
    return { provider, result: await mem0Add({
      messages: [{ role: "user", content: input.content ?? JSON.stringify(input.payload ?? {}) }],
      user_id: input.user_id,
      agent_id: input.agent_id,
      metadata: input.metadata,
    }) };
  }
  if (provider === "supermemory") return { provider, result: await supermemoryAdd(input) };

  const [mem0, supermemory] = await Promise.all([
    mem0Add({ messages: [{ role: "user", content: input.content ?? JSON.stringify(input.payload ?? {}) }], user_id: input.user_id, agent_id: input.agent_id, metadata: input.metadata }),
    supermemoryAdd(input),
  ]);
  return { provider: "both", result: { mem0, supermemory } };
}
