// COLOSSUS GATEWAY v2.1 — stdio MCP entry point
// Universal MCP Bridge — GlacierEQ APEX Engine
// Case 1FDV-23-0001009 | Operator: Casey Barton
//
// This file is the stdio transport (local MCP / Claude Desktop / Cursor).
// The HTTP transport (Vercel) lives in api/mcp.ts.
// ALL tool logic lives in lib/executor.ts — single source of truth.

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { executeUniversal } from "../lib/executor.js";

const CASE_ID = "1FDV-23-0001009";
const VERSION = "2.1.0";

const server = new McpServer({
  name: "colossus-gateway",
  version: VERSION,
  description:
    "APEX Universal MCP Bridge — GitHub · Notion · Dropbox · Supabase · Aspen Grove | " +
    `Case ${CASE_ID} | GlacierEQ`,
});

// ====================== UNIVERSAL TOOL ======================
server.tool(
  "universal.execute",
  "Single tool for all APEX services. toolName options: " +
  "github.write_file | github.list_repos | github.get_file | " +
  "notion.create_page | notion.query_db | notion.update_page | " +
  "dropbox.upload | dropbox.list | dropbox.get_link | " +
  "apex.timeline | apex.ingest | apex.search",
  {
    toolName: z.string().describe(
      "Which operation to run. See tool description for full list."
    ),
    payload: z.record(z.any()).optional().describe(
      "Operation-specific parameters. Pass {} or omit for read-only ops."
    ),
  },
  async ({ toolName, payload = {} }) => {
    const result = await executeUniversal(toolName, payload);
    return {
      content: [{
        type: "text" as const,
        text: JSON.stringify(result, null, 2),
      }],
    };
  }
);

// ====================== BOOT ======================
const transport = new StdioServerTransport();
await server.connect(transport);

console.error([
  `🧊 COLOSSUS GATEWAY ${VERSION} — ONLINE`,
  `   Case    : ${CASE_ID}`,
  `   Operator: GlacierEQ (Casey Barton)`,
  `   Mode    : stdio (local MCP)`,
  `   HTTP    : https://colossus-gateway.vercel.app/api/mcp`,
  `   Health  : https://colossus-gateway.vercel.app/api/health`,
  `   Voice   : https://colossus-gateway.vercel.app/api/voice`,
  `   Tools   : github · notion · dropbox · supabase · apex`,
].join("\n"));
