import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { remoteExecutor } from "../lib/remoteExecutor.js";

export function registerAspenTools(server: McpServer) {
  server.tool(
    "aspen.sync",
    "Synchronize with the Aspen Grove distributed intelligence layer (26 nodes)",
    {
      nodeId: z.number().min(1).max(26).optional().describe("Specific node to sync with. If omitted, syncs globally.")
    },
    async ({ nodeId }) => {
      const result = await remoteExecutor.execute("aspen.sync", { nodeId });
      if (!result.success) return { isError: true, content: [{ type: "text", text: `❌ Aspen Sync Failed: ${result.error}` }] };

      return {
        content: [{ 
          type: "text", 
          text: `🌲 ASPEN GROVE SYNC SUCCESSFUL\nLayer: Distributed Intelligence\nNodes Active: ${result.data.activeNodes}\nMode: ${result.data.mode}\nStatus: ${result.data.status}` 
        }]
      };
    }
  );

  server.tool(
    "aspen.direct_link",
    "Establish a direct secure link to the Aspen Grove layer",
    {
      payload: z.string().describe("Encrypted payload or query for the Grove")
    },
    async ({ payload }) => {
      const result = await remoteExecutor.execute("aspen.direct_link", { payload });
      if (!result.success) return { isError: true, content: [{ type: "text", text: `❌ Aspen Direct Link Failed: ${result.error}` }] };

      return {
        content: [{ 
          type: "text", 
          text: `🌲 ASPEN DIRECT LINK ESTABLISHED\nResponse: ${result.data.response}\nLatency: ${result.data.latency}ms` 
        }]
      };
    }
  );
}
