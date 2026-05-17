import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { remoteExecutor } from "../lib/remoteExecutor.js";

/**
 * MYCELIUM NETWORK: The management layer for the distributed Mysterium Network.
 * Acts as the 'root system' that keeps all scattered Daemons interconnected.
 */
export function registerMyceliumTools(server: McpServer) {
  server.tool(
    "mycelium.network_status",
    "Get the health and connectivity status of the entire Mycelium Network.",
    {},
    async () => {
      console.log(`[Mycelium] 🍄 Scanning network roots...`);
      const result = await remoteExecutor.execute("mycelium.status", {});
      return {
        content: [{ type: "text", text: `🍄 MYCELIUM NETWORK STATUS\n\n${JSON.stringify(result.data, null, 2)}` }]
      };
    }
  );

  server.tool(
    "mycelium.broadcast",
    "Broadcast a new directive or logic upgrade to ALL Daemons in the Mycelium Network simultaneously.",
    {
      directive: z.string().describe("The new mission or logic update."),
      priority: z.enum(["LOW", "MEDIUM", "HIGH", "CRITICAL"]).default("MEDIUM")
    },
    async ({ directive, priority }) => {
      console.log(`[Mycelium] 📡 Broadcasting Directive: ${directive} | Priority: ${priority}`);
      const result = await remoteExecutor.execute("mycelium.broadcast", { directive, priority });
      return {
        content: [{ type: "text", text: `📡 MYCELIUM BROADCAST SUCCESSFUL\n\nDirective: ${directive}\nStatus: Propagated to all nodes.` }]
      };
    }
  );
}
