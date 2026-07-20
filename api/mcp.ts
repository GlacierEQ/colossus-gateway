import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { server } from "../src/server.js";
import { authorizeRequest } from "../src/lib/operatorAuth.js";
import { GATEWAY_VERSION } from "../src/constants.js";
import type { IncomingMessage, ServerResponse } from "http";

function reject(res: ServerResponse, message: string) {
  res.writeHead(401, { "Content-Type": "application/json", "WWW-Authenticate": "Bearer" });
  res.end(JSON.stringify({ ok: false, error: message }));
}

export default async function handler(req: IncomingMessage, res: ServerResponse) {
  if (req.method === "GET" && (req.url ?? "").includes("/health")) {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ status: "ok", gateway: "colossus-gateway", version: GATEWAY_VERSION }));
    return;
  }

  const auth = authorizeRequest(req.headers);
  if (!auth.authorized) return reject(res, auth.message);

  const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: () => crypto.randomUUID() });
  res.on("close", () => transport.close());
  await server.connect(transport);
  await transport.handleRequest(req, res);
}
