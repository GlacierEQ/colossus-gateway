// COLOSSUS GATEWAY v2.1
// Universal MCP Bridge — GlacierEQ APEX Engine
// Case 1FDV-23-0001009 | Operator: Casey Barton
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { Dropbox } from "dropbox";
import { Client as NotionClient } from "@notionhq/client";
import { Octokit } from "octokit";
import { createClient } from '@supabase/supabase-js';
import crypto from "crypto";

const server = new McpServer({
  name: "colossus-gateway",
  version: "2.1.0",
  description: "Hi Guy Reviews - Universal MCP Bridge (GitHub, Notion, Dropbox, APEX, Aspen Grove)"
});

// ====================== CONFIG ======================
const DROPBOX_TOKEN  = process.env.DROPBOX_TOKEN;
const NOTION_TOKEN   = process.env.NOTION_TOKEN;
const NOTION_DB_ID   = process.env.NOTION_DATABASE_ID;
const GITHUB_TOKEN   = process.env.GITHUB_TOKEN;
const GITHUB_OWNER   = "GlacierEQ";
const SUPABASE_URL   = "https://kjebemdgvjvuutzvhbtp.supabase.co";
const SUPABASE_KEY   = process.env.SUPABASE_SERVICE_ROLE_KEY;
const CASE_ID        = "1FDV-23-0001009";

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY!);
const notion   = new NotionClient({ auth: NOTION_TOKEN! });
const octokit  = new Octokit({ auth: GITHUB_TOKEN });
const dbx      = new Dropbox({ accessToken: DROPBOX_TOKEN! });

// ====================== FORENSIC HELPERS ======================
async function createHash(data: any): Promise<string> {
  const str = JSON.stringify(data, Object.keys(data || {}).sort());
  return crypto.createHash("sha256").update(str).digest("hex");
}

async function aspenIngest(type: string, title: string, metadata: any) {
  const hash    = await createHash(metadata);
  const pointer = `aspen://node/${hash.slice(0, 16)}`;

  await supabase.from('apex_integration_events').insert({
    case_id:    CASE_ID,
    event_type: type,
    title,
    metadata:   { ...metadata, hash, pointer, timestamp: new Date().toISOString() }
  });

  return pointer;
}

// ====================== UNIVERSAL TOOL ======================
server.tool(
  "universal.execute",
  "Single powerful tool for all APEX services",
  {
    toolName: z.string().describe(
      "github.write_file | github.list_repos | notion.create_page | notion.query_db | " +
      "dropbox.upload | dropbox.list | apex.timeline | apex.ingest"
    ),
    payload: z.any().optional(),
  },
  async ({ toolName, payload = {} }) => {
    let result: any;

    // ── GitHub ──────────────────────────────────────────────
    if (toolName === "github.write_file") {
      result = await octokit.rest.repos.createOrUpdateFileContents({
        owner:   GITHUB_OWNER,
        repo:    payload.repo || "mastermind-colossus",
        path:    payload.path,
        message: payload.message || `Colossus Gateway v2.1 — ${new Date().toISOString()}`,
        content: Buffer.from(payload.content || "").toString("base64"),
        ...(payload.sha ? { sha: payload.sha } : {})
      });
    } else if (toolName === "github.list_repos") {
      const { data } = await octokit.rest.repos.listForAuthenticatedUser({ per_page: 50 });
      result = data.map(r => ({ name: r.name, url: r.html_url, private: r.private }));

    // ── Notion ──────────────────────────────────────────────
    } else if (toolName === "notion.create_page") {
      result = await notion.pages.create(payload);
    } else if (toolName === "notion.query_db") {
      result = await notion.databases.query({ database_id: NOTION_DB_ID!, ...payload });

    // ── Dropbox ─────────────────────────────────────────────
    } else if (toolName === "dropbox.upload") {
      result = await dbx.filesUpload({ path: payload.path, contents: payload.contents });
    } else if (toolName === "dropbox.list") {
      result = await dbx.filesListFolder({ path: payload.path || "" });

    // ── Aspen / Supabase ────────────────────────────────────
    } else if (toolName === "apex.timeline") {
      const { data } = await supabase
        .from('apex_integration_events')
        .select('*')
        .eq('case_id', CASE_ID)
        .order('created_at', { ascending: true });
      result = data;
    } else if (toolName === "apex.ingest") {
      const pointer = await aspenIngest(
        payload.type || "manual",
        payload.title || "Manual ingest",
        payload.metadata || {}
      );
      result = { pointer, status: "ingested" };
    } else {
      result = { error: `Unknown toolName: ${toolName}` };
    }

    // ── Forensic logging (every operation) ──────────────────
    const hash    = await createHash(result);
    const pointer = await aspenIngest(toolName, `Operation: ${toolName}`, { result, payload });

    return {
      content: [{
        type: "text",
        text: JSON.stringify({
          success:       true,
          result,
          forensicHash:  hash,
          aspenPointer:  pointer,
          message:       "✅ Operation complete. Fully logged to Aspen Grove + Supabase."
        }, null, 2)
      }]
    };
  }
);

const transport = new StdioServerTransport();
await server.connect(transport);

console.log("🚀 COLOSSUS GATEWAY v2.1 — FULLY DEPLOYED & CONNECTED");
console.log("Ready for Grok, Gemini, Claude, Perplexity, and all APEX chains.");
console.log(`Case: ${CASE_ID} | Operator: GlacierEQ`);
