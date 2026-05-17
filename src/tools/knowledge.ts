import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { remoteExecutor } from "../lib/remoteExecutor.js";

export function registerKnowledgeTools(server: McpServer) {
  server.tool(
    "notion.search",
    "Search for documents and pages in Notion",
    {
      query: z.string().describe("The search query to find documents (e.g., 'mega .doc' or 'google keep')")
    },
    async ({ query }) => {
      const result = await remoteExecutor.execute("notion.search", { query });
      if (!result.success) return { isError: true, content: [{ type: "text", text: `❌ Notion Search Failed: ${result.error}` }] };

      const pages = result.data.map((p: any) => ({
        title: p.properties?.title?.title?.[0]?.plain_text || p.properties?.Name?.title?.[0]?.plain_text || "Untitled",
        url: p.url,
        last_edited: p.last_edited_time
      }));

      return {
        content: [{ 
          type: "text", 
          text: `📓 NOTION SEARCH RESULTS:\n${JSON.stringify(pages, null, 2)}` 
        }]
      };
    }
  );

  server.tool(
    "mem0.memory_op",
    "Add or search long-term agent memories via Mem0",
    {
      operation: z.enum(["add", "search"]),
      content: z.string().describe("The memory content to add or the query to search for"),
      user_id: z.string().optional().describe("Optional user ID for personalized memory")
    },
    async ({ operation, content, user_id }) => {
      const tool = operation === "add" ? "mem0.add" : "mem0.search";
      const payload = operation === "add" 
        ? { messages: [{ role: "user", content }], user_id }
        : { query: content, user_id };

      const result = await remoteExecutor.execute(tool, payload);
      if (!result.success) return { isError: true, content: [{ type: "text", text: `❌ Mem0 Operation Failed: ${result.error}` }] };

      return {
        content: [{ 
          type: "text", 
          text: `🧠 MEM0 ${operation.toUpperCase()} SUCCESSFUL:\n${JSON.stringify(result.data, null, 2)}` 
        }]
      };
    }
  );
}
