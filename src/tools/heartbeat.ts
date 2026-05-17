import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { remoteExecutor } from "../lib/remoteExecutor.js";

export function registerHeartbeat(server: McpServer) {
  server.tool(
    "gemini.heartbeat",
    "Monitor the health and operational status of the Gemini Unified System",
    {},
    async () => {
      const result = await remoteExecutor.execute("gemini.heartbeat", {});
      
      if (!result.success) {
        return {
          isError: true,
          content: [{ type: "text", text: `❌ Heartbeat Failed: ${result.error}` }]
        };
      }

      const { status, lastLog, activeServices } = result.data;
      const logLines = lastLog.length > 0 ? lastLog.join('\n') : "No logs available.";
      
      return {
        content: [{ 
          type: "text", 
          text: `💓 GEMINI SYSTEM HEARTBEAT\nStatus: ${status}\n\n🛠️ Active Services:\n${activeServices.join(', ')}\n\n📋 Latest Logs:\n${logLines}` 
        }]
      };
    }
  );
}
