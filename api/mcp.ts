import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { server } from "../src/server.js";
import type { IncomingMessage, ServerResponse } from "http";

export default async function handler(req: IncomingMessage, res: ServerResponse) {
  if (req.method === "GET" && (req as any).url?.includes("/health")) {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ status: "ok", gateway: "colossus-gateway", version: "2.1.0" }));
    return;
  }

  const transport = new StreamableHTTPServerTransport({
    sessionIdGenerator: () => crypto.randomUUID(),
  });

  res.on("close", () => transport.close());
  await server.connect(transport);
  await transport.handleRequest(req, res);
}
