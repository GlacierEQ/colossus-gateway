import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { composioExecute } from "../lib/composio.js";

export function registerComposioTools(server: McpServer) {
  server.tool(
    "composio.execute",
    "Execute an allowlisted Composio tool using a connected account managed by Composio.",
    {
      toolSlug: z.string().min(1),
      arguments: z.record(z.string(), z.any()).default({}),
      connectedAccountId: z.string().optional(),
      userId: z.string().optional(),
      version: z.string().optional(),
    },
    async ({ toolSlug, arguments: args, connectedAccountId, userId, version }) => ({
      content: [{ type: "text", text: JSON.stringify(await composioExecute({ toolSlug, arguments: args, connectedAccountId, userId, version })) }],
    }),
  );
}
