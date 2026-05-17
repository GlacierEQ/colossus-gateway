import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { registerTools } from "./tools/index.js";

export const server = new McpServer({ 
  name: "colossus-gateway", 
  version: "2.1.0" 
});

// Register all tools
registerTools(server);
