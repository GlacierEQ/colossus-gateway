import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { remoteExecutor } from "../lib/remoteExecutor.js";

export function registerMastermindTeamTools(server: McpServer) {
  server.tool(
    "mastermind.process",
    "Engage the Mastermind Team (Internal/Orchestration) to process an intent",
    {
      intent: z.string().describe("The intent or objective for the Mastermind Team to orchestrate")
    },
    async ({ intent }) => {
      const result = await remoteExecutor.execute("mastermind.process", { intent });
      if (!result.success) return { isError: true, content: [{ type: "text", text: `❌ Mastermind Team Failed: ${result.error}` }] };

      return {
        content: [{ 
          type: "text", 
          text: `🧠 MASTERMIND TEAM RESPONSE\nTeam: ${result.data.team}\nStatus: ${result.data.status}\n\n🛠️ Module Activation Plan:\n${JSON.stringify(result.data.module_activation_plan, null, 2)}\n\nTimestamp: ${result.data.timestamp}` 
        }]
      };
    }
  );

  server.tool(
    "mastermind.autonomous_repair",
    "Trigger autonomous repair and filesystem orchestration via Mastermind",
    {
      target: z.string().describe("The specific file or system requiring repair/orchestration")
    },
    async ({ target }) => {
      const result = await remoteExecutor.execute("mastermind.autonomous_repair", { target });
      if (!result.success) return { isError: true, content: [{ type: "text", text: `❌ Repair Failed: ${result.error}` }] };

      return {
        content: [{ 
          type: "text", 
          text: `🔧 MASTERMIND AUTONOMOUS REPAIR\nTarget: ${target}\nStatus: ${result.data.status}\nResult: ${result.data.result}` 
        }]
      };
    }
  );
}
