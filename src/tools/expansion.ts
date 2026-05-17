import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { remoteExecutor } from "../lib/remoteExecutor.js";

export function registerExpansionTools(server: McpServer) {
  server.tool(
    "gemma4.deploy_node",
    "Deploy a Gemma 4 Edge Node for localized, zero-cost intelligence expansion",
    {
      nodeId: z.string().describe("The unique ID for the Gemma 4 node"),
      profile: z.string().default("26B-A4B").describe("Model profile (e.g., '26B-A4B', 'E4B')")
    },
    async (args) => {
      const result = await remoteExecutor.execute("gemma4.deploy_node", args);
      if (!result.success) return { isError: true, content: [{ type: "text", text: `❌ Gemma 4 Deployment Failed: ${result.error}` }] };

      return {
        content: [{ 
          type: "text", 
          text: `🌌 GEMMA 4 EDGE NODE DEPLOYED: ${args.nodeId}\n\n` +
                `Model: ${result.data.model}\n` +
                `Architecture: ${result.data.architecture}\n` +
                `Context Window: ${result.data.context_window}\n` +
                `Ring Depth: ${result.data.ring}\n` +
                `Memory: ${result.data.memory_link}`
        }]
      };
    }
  );

  server.tool(
    "vlaw.integrate",
    "Integrate the V-LAW World Model framework for mental simulation and outcome prediction",
    {
      framework: z.string().optional().describe("V-LAW framework variant")
    },
    async (args) => {
      const result = await remoteExecutor.execute("vlaw.integrate", args);
      if (!result.success) return { isError: true, content: [{ type: "text", text: `❌ V-LAW Integration Failed: ${result.error}` }] };

      return {
        content: [{ 
          type: "text", 
          text: `🧠 V-LAW WORLD MODEL INTEGRATED\n\n` +
                `Framework: ${result.data.framework}\n` +
                `Capability: ${result.data.capability}\n` +
                `Fidelity: ${result.data.fidelity}\n` +
                `Status: ${result.data.status}\n` +
                `Aspen Sync: ${result.data.aspen_sync}`
        }]
      };
    }
  );

  server.tool(
    "gateway.get_colossus_key",
    "Retrieve the Colossus Master Key for Soul Stone authentication",
    {},
    async () => {
      const colossusKey = process.env.COLOSSUS_KEY;
      if (!colossusKey) return { isError: true, content: [{ type: "text", text: "❌ COLOSSUS_KEY not found in environment." }] };

      return {
        content: [{ 
          type: "text", 
          text: `🔐 COLOSSUS MASTER KEY: ${colossusKey}` 
        }]
      };
    }
  );
}
