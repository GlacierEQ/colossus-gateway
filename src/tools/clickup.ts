import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { remoteExecutor } from "../lib/remoteExecutor.js";

export function registerClickUpTools(server: McpServer) {
  server.tool(
    "clickup.build_pipeline",
    "Automate the creation of perfect case pipelines and matrix structures in ClickUp for Case 1FDV",
    {
      workspaceName: z.string().default("1FDV-RICO-WARFARE").describe("The name for the ClickUp Workspace"),
      caseId: z.string().default("1FDV-23-0001009").describe("The Case ID to anchor the pipeline to")
    },
    async (args) => {
      const result = await remoteExecutor.execute("clickup.build_pipeline", args);
      if (!result.success) return { isError: true, content: [{ type: "text", text: `❌ ClickUp Pipeline Build Failed: ${result.error}` }] };

      return {
        content: [{ 
          type: "text", 
          text: `🚀 CLICKUP CASE PIPELINES PROVISIONED\n\n` +
                `Workspace: ${result.data.structure.workspace}\n` +
                `Space: ${result.data.structure.space}\n` +
                `Case ID: ${result.data.case_id}\n` +
                `Sync State: ${result.data.sync_state}\n\n` +
                `🧱 Structure Initialized:\n` +
                `${result.data.structure.folders.map((f: any) => `- Folder: ${f.name}\n  Lists: ${f.lists.join(', ')}`).join('\n')}\n\n` +
                `✨ Custom Statuses: ${result.data.structure.statuses.join(' → ')}\n` +
                `📝 Custom Fields: ${result.data.structure.custom_fields.join(', ')}`
        }]
      };
    }
  );
}
