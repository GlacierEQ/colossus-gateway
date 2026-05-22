import "dotenv/config";
import http from "http";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { server } from "./server.js";

const PORT = process.env.PORT || 3000;

const httpServer = http.createServer(async (req, res) => {
  // Health check
  if (req.method === "GET" && req.url === "/health") {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ status: "ok", gateway: "colossus-gateway", version: "2.1.0", timestamp: new Date().toISOString() }));
    return;
  }

  // MCP HTTP transport
  const transport = new StreamableHTTPServerTransport({
    sessionIdGenerator: () => crypto.randomUUID(),
  });

  res.on("close", () => transport.close());

  try {
    await server.connect(transport);
    await transport.handleRequest(req, res);
  } catch (err) {
    console.error("Transport error:", err);
    if (!res.headersSent) {
      res.writeHead(500);
      res.end("Internal Server Error");
    }
  }
});

httpServer.listen(PORT, () => {
  console.error(`🚀 COLOSSUS GATEWAY v2.1 — HTTP LIVE on port ${PORT}`);
});
