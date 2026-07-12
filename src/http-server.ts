import "dotenv/config";
import http from "http";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { server } from "./server.js";
import { ANSWER, GATEWAY_VERSION, SESSION_IDLE_S } from "./constants.js";

const PORT = Number(process.env.PORT) || 3000;

const httpServer = http.createServer(async (req, res) => {
  // Health check
  if (req.method === "GET" && req.url === "/health") {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(
      JSON.stringify({
        status: "ok",
        gateway: "colossus-gateway",
        version: GATEWAY_VERSION,
        session_idle_s: SESSION_IDLE_S,
        answer: ANSWER,
        timestamp: new Date().toISOString(),
      })
    );
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
  console.error(`🚀 COLOSSUS GATEWAY ${GATEWAY_VERSION} — HTTP LIVE on port ${PORT}`);
});
