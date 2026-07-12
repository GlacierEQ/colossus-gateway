import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { registerTools } from "./tools/index.js";
import { GATEWAY_VERSION } from "./constants.js";

export const server = new McpServer({ 
  name: "colossus-gateway", 
  version: GATEWAY_VERSION,
});

// Register all tools
registerTools(server);
