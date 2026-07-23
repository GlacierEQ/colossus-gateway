import { randomUUID } from "node:crypto";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import type { IncomingMessage, ServerResponse } from "node:http";
import { runBridgeContext } from "../src/bridge/context.js";
import { GATEWAY_VERSION } from "../src/constants.js";
import { authorizeRequest } from "../src/lib/operatorAuth.js";
import { server } from "../src/server.js";

function header(req: IncomingMessage, name: string): string | undefined {
  const value = req.headers[name.toLowerCase()];
  return Array.isArray(value) ? value[0] : value;
}

function reject(res: ServerResponse, message: string) {
  res.writeHead(401, {
    "Content-Type": "application/json",
    "WWW-Authenticate": "Bearer",
  });
  res.end(JSON.stringify({ ok: false, error: message }));
}

export default async function handler(req: IncomingMessage, res: ServerResponse) {
  if (req.method === "GET" && (req.url ?? "").includes("/health")) {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({
      status: "ok",
      gateway: "colossus-gateway",
      version: GATEWAY_VERSION,
      active_bridge: true,
      direct_notion_header_auth: true,
    }));
    return;
  }

  const auth = authorizeRequest(req.headers);
  if (!auth.authorized) {
    reject(res, auth.message);
    return;
  }

  const transport = new StreamableHTTPServerTransport({
    sessionIdGenerator: () => randomUUID(),
  });

  res.on("close", () => transport.close());
  await server.connect(transport);
  await runBridgeContext({
    boxAccessToken: header(req, "x-box-access-token"),
    notionAccessToken: header(req, "x-notion-token"),
    actor: header(req, "x-colossus-actor") || "mcp-client",
    requestId: header(req, "x-request-id"),
    source: "remote-mcp",
  }, () => transport.handleRequest(req, res));
}
