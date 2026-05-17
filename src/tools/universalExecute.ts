import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { remoteExecutor } from "../lib/remoteExecutor.js";

export function registerUniversalExecute(server: McpServer) {
  server.tool(
    "universal.execute",
    "Gateway tool to execute remote actions and services",
    { 
      toolName: z.string().describe("The name of the remote tool or service to invoke"),
      payload: z.any().optional().describe("Data passed to the remote execution")
    },
    async ({ toolName, payload }) => {
      const result = await remoteExecutor.execute(toolName, payload);
      
      if (!result.success) {
        return {
          isError: true,
          content: [{ type: "text", text: `❌ Remote execution failed: ${result.error}` }]
        };
      }

      return {
        content: [{ 
          type: "text", 
          text: `📡 Remote Result [${toolName}]:\n${JSON.stringify(result.data, null, 2)}` 
        }]
      };
    }
  );
}
