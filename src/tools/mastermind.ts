import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { remoteExecutor } from "../lib/remoteExecutor.js";

export function registerMastermindTools(server: McpServer) {
  server.tool(
    "mastermind.strategize",
    "Engage the Mastermind Strategic Intelligence System for tactical analysis",
    {
      caseId: z.string().default("1FDV-23-0001009").describe("The Case ID to analyze (Defaults to Constitutional Warfare)"),
      objective: z.string().describe("The primary objective or question for Mastermind")
    },
    async ({ caseId, objective }) => {
      const result = await remoteExecutor.execute("mastermind.strategize", { caseId, objective });
      if (!result.success) return { isError: true, content: [{ type: "text", text: `❌ Mastermind Engagement Failed: ${result.error}` }] };

      return {
        content: [{ 
          type: "text", 
          text: `🧠 MASTERMIND STRATEGIC ANALYSIS\nCase: ${result.data.caseId}\nRing Level: ${result.data.ringLevel}\n\nObjective: ${objective}\n\n⚡ Strategic Output:\n${result.data.strategy}\n\nConfidence: ${result.data.confidence}%` 
        }]
      };
    }
  );

  server.tool(
    "mastermind.deploy_piston",
    "Deploy a specific GlacierEQ Universal Upgrade v3.1 Piston via Mastermind",
    {
      piston: z.enum([
        "Microwave", "Supernova", "Core-Think", "Bodybuilder", 
        "Sherlock-Alpha", "Sonic", "Ghost", "Phantom", 
        "Viper", "Wraith", "Specter", "Shadow"
      ]).describe("The Piston to deploy"),
      target: z.string().describe("The target vector or system for the Piston")
    },
    async ({ piston, target }) => {
      const result = await remoteExecutor.execute("mastermind.deploy_piston", { piston, target });
      if (!result.success) return { isError: true, content: [{ type: "text", text: `❌ Piston Deployment Failed: ${result.error}` }] };

      return {
        content: [{ 
          type: "text", 
          text: `🔥 PISTON DEPLOYED: [${piston}]\nTarget: ${target}\nImpact Assessment: ${result.data.impact}\nStatus: ${result.data.status}` 
        }]
      };
    }
  );
}
