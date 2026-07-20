import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { remoteExecutor } from "../lib/remoteExecutor.js";
import { isRemoteToolAllowed } from "../lib/toolPolicy.js";

export function registerUniversalExecute(server: McpServer) {
  server.tool(
    "universal.execute",
    "Execute an allowlisted gateway action. Add COLOSSUS_ALLOWED_REMOTE_TOOLS for additional actions.",
    {
      toolName: z.string().min(1),
      payload: z.any().optional(),
    },
    async ({ toolName, payload }) => {
      if (!isRemoteToolAllowed(toolName)) {
        return { isError: true, content: [{ type: "text", text: `❌ Tool is not allowlisted: ${toolName}` }] };
      }
      const result = await remoteExecutor.execute(toolName, payload);
      if (!result.success) return { isError: true, content: [{ type: "text", text: `❌ Remote execution failed: ${result.error}` }] };
      return { content: [{ type: "text", text: `📡 Remote Result [${toolName}]:\n${JSON.stringify(result.data, null, 2)}` }] };
    },
  );
}
