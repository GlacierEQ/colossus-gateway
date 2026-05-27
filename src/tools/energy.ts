import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { remoteExecutor } from "../lib/remoteExecutor.js";

/**
 * Energy Sovereignty Tools (Starfire Ring)
 * Manages 1.4GW generation and grid-scale storage.
 */
export function registerEnergyTools(server: McpServer) {
  server.tool(
    "energy.smr_spool",
    "Spool up Small Modular Reactors (SMRs) to meet 1.4GW demand",
    {
      targetMW: z.number().max(1400).describe("Target power generation in MW")
    },
    async ({ targetMW }) => {
      const result = await remoteExecutor.execute("energy.smr_spool", { targetMW });
      if (!result.success) return { isError: true, content: [{ type: "text", text: `❌ SMR Spool Failed: ${result.error}` }] };

      return {
        content: [{ 
          type: "text", 
          text: `🔥 STARFIRE RING: SMR SPOOL ACTIVE\nTarget: ${targetMW} MW\nStatus: ${result.data.status}\nEstimated Sync: ${result.data.syncTime} mins` 
        }]
      };
    }
  );

  server.tool(
    "energy.megapack_balance",
    "Balance the Megapack array for sub-100ms load shedding support",
    {},
    async () => {
      const result = await remoteExecutor.execute("energy.megapack_balance", {});
      if (!result.success) return { isError: true, content: [{ type: "text", text: `❌ Megapack Balancing Failed: ${result.error}` }] };

      return {
        content: [{ 
          type: "text", 
          text: `🔋 MEGAPACK ARRAY BALANCED\nSOC: ${result.data.soc}%\nGrid Support Ready: ${result.data.ready ? 'YES' : 'NO'}` 
        }]
      };
    }
  );

  server.tool(
    "energy.dark_island",
    "Activate Starlink-based Dark Island optical routing (Off-Grid Mode)",
    {
      nodeId: z.string().describe("Target node or zone to take off-grid")
    },
    async ({ nodeId }) => {
      const result = await remoteExecutor.execute("energy.dark_island", { nodeId });
      if (!result.success) return { isError: true, content: [{ type: "text", text: `❌ Dark Island Activation Failed: ${result.error}` }] };

      return {
        content: [{ 
          type: "text", 
          text: `🛰️ DARK ISLAND ACTIVE: ${nodeId}\nRouting: Optical (Starlink)\nUtility Dependency: ZERO` 
        }]
      };
    }
  );
}
