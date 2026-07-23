import type { IncomingMessage, ServerResponse } from "node:http";
import { GATEWAY_VERSION } from "../src/constants.js";

export default function handler(_req: IncomingMessage, res: ServerResponse) {
  res.writeHead(200, { "Content-Type": "application/json" });
  res.end(JSON.stringify({
    status: "ok",
    gateway: "colossus-gateway",
    version: GATEWAY_VERSION,
    transport: "HTTP/Vercel",
    timestamp: new Date().toISOString(),
  }));
}
