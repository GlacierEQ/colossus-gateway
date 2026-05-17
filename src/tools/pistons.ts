import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { remoteExecutor } from "../lib/remoteExecutor.js";

export function registerPistonTools(server: McpServer) {
  server.tool(
    "piston.deploy",
    "Deploy one of the 12 Pistons or a Fusion Mode for Ring -3 execution",
    {
      mode: z.enum([
        "MICROWAVE", "SUPERNOVA", "CORE-THINK", "BODYBUILDER",
        "SHERLOCK-ALPHA", "SONIC", "GHOST", "PHANTOM",
        "VIPER", "WRAITH", "SPECTER", "SHADOW",
        "GHOST-MICROWAVE", "SHERLOCK-SUPERNOVA", "SONIC-BODYBUILDER",
        "CORE-THINK-AMPLIFIED", "PHANTOM-SHADOW", "GHOST-VIPER", "WRAITH-SPECTER"
      ]).describe("The Piston or Fusion Mode to deploy"),
      objective: z.string().describe("The task or objective for the Piston")
    },
    async ({ mode, objective }) => {
      const result = await remoteExecutor.execute("piston.deploy", { mode, objective });
      if (!result.success) return { isError: true, content: [{ type: "text", text: `❌ Piston Deployment Failed: ${result.error}` }] };

      const { tier, ring_depth, powers, status } = result.data;
      
      return {
        content: [{ 
          type: "text", 
          text: `🔥 PISTON ENGAGED: [${mode}]\nTier: ${tier}\nRing Depth: ${ring_depth}\n\nObjective: ${objective}\n\n🛠️ Powers Activated: ${powers.join(', ')}\nStatus: ${status}` 
        }]
      };
    }
  );
}
