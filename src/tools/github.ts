import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { remoteExecutor } from "../lib/remoteExecutor.js";

export function registerGitHubTools(server: McpServer) {
  server.tool(
    "github.list_repos",
    "List all GitHub repositories for the authenticated user",
    {},
    async () => {
      const result = await remoteExecutor.execute("github.list_repos", {});
      if (!result.success) return { isError: true, content: [{ type: "text", text: `❌ GitHub Repository Listing Failed: ${result.error}` }] };

      return {
        content: [{ 
          type: "text", 
          text: `📂 GITHUB REPOSITORIES:\n${JSON.stringify(result.data, null, 2)}` 
        }]
      };
    }
  );

  server.tool(
    "github.get_file",
    "Retrieve the content of a specific file from a GitHub repository",
    {
      repo: z.string().describe("The repository name (e.g., 'gemini-cli')"),
      path: z.string().describe("The path to the file within the repository")
    },
    async ({ repo, path }) => {
      const result = await remoteExecutor.execute("github.get_file", { repo, path });
      if (!result.success) return { isError: true, content: [{ type: "text", text: `❌ GitHub File Retrieval Failed: ${result.error}` }] };

      return {
        content: [{ 
          type: "text", 
          text: `📄 GITHUB FILE CONTENT [${repo}/${path}]:\n\n${result.data.content}` 
        }]
      };
    }
  );
}
