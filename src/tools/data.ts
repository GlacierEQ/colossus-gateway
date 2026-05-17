import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { remoteExecutor } from "../lib/remoteExecutor.js";

export function registerDataTools(server: McpServer) {
  server.tool(
    "supabase.query",
    "Query data from the Supabase database layer",
    {
      table: z.string().describe("The table name to query"),
      select: z.string().default("*").describe("The columns to select"),
      filter: z.any().optional().describe("Key-value pairs for equality filtering")
    },
    async (args) => {
      const result = await remoteExecutor.execute("supabase.query", args);
      if (!result.success) return { isError: true, content: [{ type: "text", text: `❌ Supabase Query Failed: ${result.error}` }] };

      return {
        content: [{ 
          type: "text", 
          text: `📊 SUPABASE DATA RETRIEVED:\n${JSON.stringify(result.data, null, 2)}` 
        }]
      };
    }
  );
}
