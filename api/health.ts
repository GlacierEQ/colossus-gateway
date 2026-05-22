import type { IncomingMessage, ServerResponse } from "http";

export default function handler(_req: IncomingMessage, res: ServerResponse) {
  res.writeHead(200, { "Content-Type": "application/json" });
  res.end(JSON.stringify({
    status: "ok",
    gateway: "colossus-gateway",
    version: "2.1.0",
    transport: "HTTP/Vercel",
    timestamp: new Date().toISOString()
  }));
}
