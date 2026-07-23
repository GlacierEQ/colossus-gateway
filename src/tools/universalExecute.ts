import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { remoteExecutor } from "../lib/remoteExecutor.js";
import { isReadOnlyTool, isRemoteToolAllowed } from "../lib/toolPolicy.js";

export function registerUniversalExecute(server: McpServer) {
  server.tool(
    "universal.execute",
    "Execute an explicitly allowlisted gateway action. Non-read actions require confirm=true.",
    {
      toolName: z.string().min(1),
      payload: z.any().optional(),
      confirm: z.boolean().default(false),
    },
    async ({ toolName, payload, confirm }) => {
      if (!isRemoteToolAllowed(toolName)) {
        return { isError: true, content: [{ type: "text", text: `❌ Tool is not allowlisted: ${toolName}` }] };
      }
      if (!isReadOnlyTool(toolName) && !confirm) {
        return { isError: true, content: [{ type: "text", text: `⚠️ Confirmation required for non-read action: ${toolName}` }] };
      }
      const result = await remoteExecutor.execute(toolName, payload);
      if (!result.success) return { isError: true, content: [{ type: "text", text: `❌ Remote execution failed: ${result.error}` }] };
      return { content: [{ type: "text", text: `📡 Remote Result [${toolName}]:\n${JSON.stringify(result.data, null, 2)}` }] };
    },
  );
}
