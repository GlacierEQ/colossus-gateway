import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { remoteExecutor } from "../lib/remoteExecutor.js";

export function registerUpgradeTools(server: McpServer) {
  server.tool(
    "gateway.upgrade",
    "Activate MAX-UP chunks to integrate new extensions and capabilities",
    {
      chunkId: z.enum(["CHUNK_FORENSIC", "CHUNK_LEGAL", "CHUNK_ORCHESTRATION"]).describe("The ID of the MAX-UP chunk to activate")
    },
    async ({ chunkId }) => {
      const result = await remoteExecutor.execute("gateway.upgrade", { chunkId });
      if (!result.success) return { isError: true, content: [{ type: "text", text: `❌ Upgrade Failed: ${result.error}` }] };

      return {
        content: [{ 
          type: "text", 
          text: `🚀 MAX-UP CHUNK ACTIVATED: ${chunkId}\n\n` +
                `Mode: ${result.data.mode}\n` +
                `Integrated Extensions:\n- ${result.data.extensions.join('\n- ')}\n\n` +
                `Status: ${result.data.status}\n` +
                `All artifacts anchored into Aspen Grove.`
        }]
      };
    }
  );

  server.tool(
    "extension.execute",
    "Execute a virtual extension capability from the forensic, legal, or swarm matrix",
    {
      extension: z.string().describe("The extension name (e.g., 'mcp-security', 'adeu-redlines')"),
      action: z.string().describe("The action to perform"),
      params: z.any().optional().describe("Parameters for the action")
    },
    async (args) => {
      const result = await remoteExecutor.execute("extension.execute", args);
      if (!result.success) return { isError: true, content: [{ type: "text", text: `❌ Extension Strike Failed: ${result.error}` }] };

      return {
        content: [{ 
          type: "text", 
          text: `🎯 V-EXT STRIKE COMPLETE: ${args.extension}.${args.action}\n\n` +
                `Output: ${result.data.output}\n` +
                `Forensic Grade: ${result.data.forensic_grade}\n` +
                `Commitment: ${result.data.commitment}`
        }]
      };
    }
  );
}
