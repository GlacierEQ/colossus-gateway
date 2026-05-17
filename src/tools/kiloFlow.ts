import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { remoteExecutor } from "../lib/remoteExecutor.js";

export function registerKiloTools(server: McpServer) {
  server.tool(
    "kilo.maximize",
    "Trigger the MASTER_MAXIMIZER routine (Kilo Code Integration)",
    {
      reason: z.string().describe("The reason for triggering maximization")
    },
    async ({ reason }) => {
      const result = await remoteExecutor.execute("kilo.maximize", { reason });
      if (!result.success) return { isError: true, content: [{ type: "text", text: `❌ Maximization Failed: ${result.error}` }] };

      const { protocol, phase, actions } = result.data;
      return {
        content: [{ 
          type: "text", 
          text: `🌌 KILO MASTER MAXIMIZER ACTIVATED\nProtocol: ${protocol}\nPhase: ${phase}\n\n🛠️ Actions Executed:\n- ${actions.join('\n- ')}\n\nReason: ${reason}` 
        }]
      };
    }
  );

  server.tool(
    "flow.orchestrate",
    "Orchestrate complex AI flows using Gemini-Flow's Dual-Mode architecture",
    {
      action: z.string().describe("The orchestration action to perform"),
      mode: z.enum(["lightweight", "enterprise"]).default("lightweight").describe("Orchestration mode")
    },
    async (payload) => {
      const result = await remoteExecutor.execute("flow.orchestrate", payload);
      if (!result.success) return { isError: true, content: [{ type: "text", text: `❌ Orchestration Failed: ${result.error}` }] };

      return {
        content: [{ 
          type: "text", 
          text: `🌌 FLOW ORCHESTRATION SUCCESS\nID: ${result.data.orchestrationId}\nMode: ${result.data.mode}\n\nResult: ${result.data.result}` 
        }]
      };
    }
  );
}
