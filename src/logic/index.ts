import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { remoteExecutor } from "../lib/remoteExecutor.js";

/**
 * LONG HORIZON: Strategic, long-term case planning and narrative mapping.
 * Ensures the 'Win Condition' (Reunification) remains the anchor.
 */
export function registerLongHorizon(server: McpServer) {
  server.tool(
    "logic.long_horizon",
    "Activate Long Horizon strategic planning. Maps the 12-month trajectory of the case.",
    {
      objective: z.string().describe("The primary goal (e.g., 'Federal Escalation Timeline')"),
      depth: z.enum(["tactical", "strategic", "aeonic"]).default("strategic")
    },
    async ({ objective, depth }) => {
      console.log(`[Long Horizon] 🌅 Plotting Trajectory: ${objective} | Depth: ${depth}`);
      const result = await remoteExecutor.execute("logic.long_horizon", { objective, depth });
      return {
        content: [{ type: "text", text: `🌅 LONG HORIZON ANALYSIS COMPLETE\n\nObjective: ${objective}\n${JSON.stringify(result.data, null, 2)}` }]
      };
    }
  );
}

/**
 * BRAVE FRONTIER: Expansion into unmapped data territories and new forensic nodes.
 * Used for exploring adversarial infrastructure and discovering hidden links.
 */
export function registerBraveFrontier(server: McpServer) {
  server.tool(
    "logic.brave_frontier",
    "Deploy Brave Frontier reconnaissance. Scans for new evidence nodes and hidden connections.",
    {
      target_domain: z.string().describe("The new territory or domain to map."),
      aggressiveness: z.number().min(1).max(10).default(3).describe("Search depth/aggressiveness.")
    },
    async ({ target_domain, aggressiveness }) => {
      console.log(`[Brave Frontier] 🚀 Expanding Frontier: ${target_domain} | Level: ${aggressiveness}`);
      const result = await remoteExecutor.execute("logic.brave_frontier", { target_domain, aggressiveness });
      return {
        content: [{ type: "text", text: `🚀 BRAVE FRONTIER RECON COMPLETE\n\nTarget: ${target_domain}\n${JSON.stringify(result.data, null, 2)}` }]
      };
    }
  );
}
