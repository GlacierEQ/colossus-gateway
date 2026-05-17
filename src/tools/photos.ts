import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { remoteExecutor } from "../lib/remoteExecutor.js";

export function registerPhotoTools(server: McpServer) {
  server.tool(
    "google_photos.swarm_harvest",
    "Unleash a saturated swarm across 8 Google accounts to harvest high-fidelity visual evidence",
    {
      accounts: z.number().default(8).describe("Number of accounts to swarm"),
      query: z.string().optional().describe("Search query for visual artifacts (e.g., 'Kekoa medical')")
    },
    async (args) => {
      const result = await remoteExecutor.execute("google_photos.swarm_harvest", args);
      if (!result.success) return { isError: true, content: [{ type: "text", text: `❌ Photo Swarm Harvest Failed: ${result.error}` }] };

      return {
        content: [{ 
          type: "text", 
          text: `📸 GOOGLE PHOTOS SATURATED HARVEST COMPLETE\n\n` +
                `Total Artifacts Found: ${result.data.total_images}\n` +
                `Accounts Saturated: ${result.data.accounts_saturated}\n` +
                `Fidelity: ${result.data.fidelity}\n\n` +
                `🧱 Distribution:\n` +
                `${result.data.distribution.map((d: any) => `- ${d.accountId}: ${d.images_found} images | ${d.status}`).join('\n')}\n\n` +
                `Artifacts anchored to Aspen Grove (Ring -3).`
        }]
      };
    }
  );
}
