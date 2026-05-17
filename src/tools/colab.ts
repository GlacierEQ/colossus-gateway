import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { remoteExecutor } from "../lib/remoteExecutor.js";

export function registerColabTools(server: McpServer) {
  server.tool(
    "colab.setup_bridge",
    "Prepare repositories and setup commands for shared processing in Google Colab",
    {
      repos: z.array(z.string()).optional().describe("List of repository names to make runnable in Colab")
    },
    async (args) => {
      const result = await remoteExecutor.execute("colab.setup_bridge", args);
      if (!result.success) return { isError: true, content: [{ type: "text", text: `❌ Colab Bridge Failed: ${result.error}` }] };

      return {
        content: [{ 
          type: "text", 
          text: `🚀 GOOGLE COLAB BRIDGE READY\n\n` +
                `Notebook: ${result.data.notebook_name}\n` +
                `Processing: ${result.data.shared_processing}\n` +
                `Aspen Link: ${result.data.aspen_link}\n\n` +
                `📝 Setup Commands (Copy into Colab cell):\n` +
                `${result.data.setup_commands.join('\n')}`
        }]
      };
    }
  );

  server.tool(
    "colab.swarm_strike",
    "Intelligently route heavy forensic tasks across multiple Google Colab accounts (identities)",
    {
      tasks: z.array(z.string()).describe("The list of forensic tasks or files to process"),
      accounts: z.number().default(8).describe("The number of Google accounts/instances to leverage")
    },
    async (args) => {
      const result = await remoteExecutor.execute("colab.swarm_strike", args);
      if (!result.success) return { isError: true, content: [{ type: "text", text: `❌ Swarm Strike Failed: ${result.error}` }] };

      return {
        content: [{ 
          type: "text", 
          text: `🌌 SWARM ACCOUNT STRIKE INITIALIZED\n\n` +
                `Status: ${result.data.status}\n` +
                `Accounts Engaged: ${result.data.total_accounts}\n` +
                `Aggregate RAM: ${result.data.aggregate_ram}\n\n` +
                `🧱 Distribution Matrix:\n` +
                `${result.data.distribution.map((d: any) => `- ${d.account_id}: [${d.tasks.length} tasks] (${d.ram_allocated})`).join('\n')}`
        }]
      };
    }
  );
}
