import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

export function registerPing(server: McpServer) {
  server.tool("ping", "Diagnostic tool to check server health", {}, async () => {
    return {
      content: [{ type: "text", text: "pong" }]
    };
  });
}
