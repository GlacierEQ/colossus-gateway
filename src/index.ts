import "dotenv/config";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { server } from "./server.js";
import { GATEWAY_VERSION } from "./constants.js";

const transport = new StdioServerTransport();

try {
  await server.connect(transport);
  console.error(`🚀 COLOSSUS GATEWAY v${GATEWAY_VERSION} — LIVE (Transport: Stdio)`);
} catch (error) {
  console.error("❌ Failed to start Colossus Gateway:", error);
  process.exit(1);
}
