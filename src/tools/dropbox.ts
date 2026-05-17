import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { remoteExecutor } from "../lib/remoteExecutor.js";

export function registerDropboxTools(server: McpServer) {
  server.tool(
    "dropbox.swarm_harvest",
    "Unleash a saturated harvest across Dropbox shared folders to extract forensic legal and evidence artifacts",
    {
      targets: z.array(z.string()).optional().describe("List of target directories (e.g., '01_LEGAL', 'CASE_ARCHIVES')"),
      chunks: z.number().default(4).describe("Number of processing chunks to use")
    },
    async (args) => {
      const result = await remoteExecutor.execute("dropbox.swarm_harvest", args);
      if (!result.success) return { isError: true, content: [{ type: "text", text: `❌ Dropbox Swarm Harvest Failed: ${result.error}` }] };

      return {
        content: [{ 
          type: "text", 
          text: `🚀 DROPBOX SATURATED HARVEST COMPLETE\n\n` +
                `Total Artifacts: ${result.data.total_artifacts}\n` +
                `Chunks Processed: ${result.data.chunks_processed}\n` +
                `Protocol: ${result.data.protocol}\n\n` +
                `📋 Artifact Inventory:\n` +
                `${result.data.results.map((r: any) => `- ${r.file} [${r.type}] | ${r.forensic_hash}`).join('\n')}\n\n` +
                `Artifacts bit-level sealed and anchored to Aspen Grove (Ring -3).`
        }]
      };
    }
  );

  server.tool(
    "dropbox.list_files",
    "List files and folders in a specific Dropbox path",
    {
      path: z.string().default("").describe("The Dropbox path to list")
    },
    async (args) => {
      const result = await remoteExecutor.execute("dropbox.list_files", args);
      if (!result.success) return { isError: true, content: [{ type: "text", text: `❌ Dropbox List Failed: ${result.error}` }] };

      return {
        content: [{ 
          type: "text", 
          text: `📂 DROPBOX DIRECTORY: ${args.path || 'ROOT'}\n\n` +
                `${result.data.files.map((f: any) => `[${f.type.toUpperCase()}] ${f.name} ${f.size ? `(${f.size})` : ''}`).join('\n')}`
        }]
      };
    }
  );
}
