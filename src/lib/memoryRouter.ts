import { mem0Add, mem0Delete, mem0Search, type Mem0Input } from "./mem0.js";
import { memoryAdd as supermemoryAdd, memoryDelete as supermemoryDelete, memorySearch as supermemorySearch, type AddReq, type SearchReq } from "./supermemory.js";

export type MemoryProvider = "auto" | "mem0" | "supermemory" | "both";

export type ConcreteMemoryProvider = "mem0" | "supermemory";

export function planMemoryRoutes(
  query = "",
  containerTag = "",
  availability: { mem0: boolean; supermemory: boolean } = {
    mem0: Boolean(process.env.MEM0_API_KEY),
    supermemory: Boolean(process.env.SUPERMEMORY_API_KEY),
  },
): ConcreteMemoryProvider[] {
  const signal = `${query} ${containerTag}`.toLowerCase();
  const wantsLongForm = /case|brain|legal|document|provenance|evidence|source/.test(signal);
  const preferred: ConcreteMemoryProvider[] = wantsLongForm
    ? ["supermemory", "mem0"]
    : ["mem0", "supermemory"];
  return preferred.filter((provider) => availability[provider]);
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

export async function executeMemorySearch(
  routes: ConcreteMemoryProvider[],
  input: SearchReq & { user_id?: string; agent_id?: string },
  dependencies: {
    mem0: (input: Mem0Input) => Promise<any>;
    supermemory: (input: SearchReq & { user_id?: string; agent_id?: string }) => Promise<any>;
  } = {
    mem0: mem0Search,
    supermemory: supermemorySearch,
  },
) {
  const mem0Input: Mem0Input = {
    query: input.query ?? input.q,
    user_id: input.user_id,
    agent_id: input.agent_id,
    limit: input.limit,
  };
  const attempted: ConcreteMemoryProvider[] = [];
  const failures: Array<{ provider: ConcreteMemoryProvider; error: string }> = [];

  for (const route of routes) {
    attempted.push(route);
    try {
      const raw = route === "mem0"
        ? await dependencies.mem0(mem0Input)
        : await dependencies.supermemory(input);
      return {
        provider: route,
        attempted,
        failures,
        degraded: failures.length > 0,
        results: route === "mem0" ? compactMem0(raw) : compactSupermemory(raw),
      };
    } catch (error) {
      failures.push({
        provider: route,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  throw new Error(
    `memory routes exhausted: ${failures.map((item) => `${item.provider}=${item.error}`).join("; ") || "no eligible providers"}`,
  );
}

export async function searchMemory(provider: MemoryProvider, input: SearchReq & { user_id?: string; agent_id?: string }) {
  if (provider === "auto") {
    const routes = planMemoryRoutes(input.query ?? input.q, input.containerTag ?? "");
    return executeMemorySearch(routes, input);
  }

  if (provider === "mem0" || provider === "supermemory") {
    return executeMemorySearch([provider], input);
  }

  const routes = planMemoryRoutes(input.query ?? input.q, input.containerTag ?? "", {
    mem0: true,
    supermemory: true,
  });
  const settled = await Promise.allSettled(
    routes.map((route) => executeMemorySearch([route], input)),
  );
  const successes = settled
    .filter((item): item is PromiseFulfilledResult<Awaited<ReturnType<typeof executeMemorySearch>>> => item.status === "fulfilled")
    .map((item) => item.value);
  if (!successes.length) {
    const failures = settled
      .filter((item): item is PromiseRejectedResult => item.status === "rejected")
      .map((item) => String(item.reason));
    throw new Error(`all memory providers failed: ${failures.join("; ")}`);
  }
  return {
    provider: "both",
    degraded: successes.length !== routes.length,
    attempted: routes,
    results: Object.fromEntries(successes.map((item) => [item.provider, item.results])),
  };
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
