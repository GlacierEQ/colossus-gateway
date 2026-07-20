import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { addMemory, searchMemory } from "../lib/memoryRouter.js";

const scalar = z.union([z.string(), z.number(), z.boolean()]);
const metadata = z.record(z.string(), scalar).optional();

export function registerMemoryTools(server: McpServer) {
  server.tool(
    "memory.search",
    "Token-efficient search across Mem0 or Case Brain Supermemory. Use auto for routed retrieval.",
    {
      provider: z.enum(["auto", "mem0", "supermemory", "both"]).default("auto"),
      query: z.string().min(1),
      containerTag: z.string().optional(),
      userId: z.string().optional(),
      agentId: z.string().optional(),
      limit: z.number().int().min(1).max(10).default(5),
    },
    async ({ provider, query, containerTag, userId, agentId, limit }) => ({
      content: [{ type: "text", text: JSON.stringify(await searchMemory(provider, { query, containerTag, user_id: userId, agent_id: agentId, limit })) }],
    }),
  );

  server.tool(
    "memory.add",
    "Write scoped context to Mem0, Case Brain Supermemory, or both. Do not store credentials or tokens.",
    {
      provider: z.enum(["mem0", "supermemory", "both"]).default("mem0"),
      content: z.string().min(1),
      containerTag: z.string().min(1),
      customId: z.string().optional(),
      userId: z.string().optional(),
      agentId: z.string().optional(),
      metadata,
    },
    async ({ provider, content, containerTag, customId, userId, agentId, metadata: meta }) => ({
      content: [{ type: "text", text: JSON.stringify(await addMemory(provider, { content, containerTag, customId, user_id: userId, agent_id: agentId, metadata: meta })) }],
    }),
  );
}
