import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import crypto from "node:crypto";

const DEFAULT_TIMEOUT_MS = 45000;
const MAX_ATTEMPTS = 3;

async function invokeComputerUser(payload: Record<string, unknown>) {
  const endpoint = process.env.COMPUTER_USER_VISIT_URL;
  if (!endpoint) {
    return {
      ok: false,
      state: "UNBOUND_RUNTIME",
      error: "COMPUTER_USER_VISIT_URL is not configured on the gateway runtime"
    };
  }

  const token = process.env.COMPUTER_USER_TOKEN;
  const idempotencyKey = String(payload.idempotency_key || crypto.randomUUID());
  let lastError = "unknown";

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), DEFAULT_TIMEOUT_MS);
    try {
      const response = await fetch(endpoint, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-idempotency-key": idempotencyKey,
          ...(token ? { authorization: `Bearer ${token}` } : {})
        },
        body: JSON.stringify({ ...payload, idempotency_key: idempotencyKey }),
        signal: controller.signal
      });
      const text = await response.text();
      const data = text ? (() => { try { return JSON.parse(text); } catch { return { raw: text }; } })() : {};
      if (response.ok) {
        return {
          ok: true,
          state: "TERMINAL_RECEIPT_RETURNED",
          attempt,
          idempotency_key: idempotencyKey,
          upstream_status: response.status,
          receipt: data
        };
      }
      lastError = `HTTP ${response.status}: ${text.slice(0, 1000)}`;
      if (response.status >= 400 && response.status < 500 && response.status !== 429) break;
    } catch (error: any) {
      lastError = error?.name === "AbortError" ? "timeout" : String(error?.message || error);
    } finally {
      clearTimeout(timer);
    }
    if (attempt < MAX_ATTEMPTS) await new Promise(resolve => setTimeout(resolve, 500 * attempt));
  }

  return {
    ok: false,
    state: "UPSTREAM_UNAVAILABLE",
    idempotency_key: idempotencyKey,
    error: lastError
  };
}

export function registerComputerUserTools(server: McpServer) {
  server.tool(
    "computer_user.visit",
    "Navigate a URL through the governed GlacierEQ/computer-user runtime and return terminal execution receipts.",
    {
      url: z.string().url(),
      account_scope: z.string().optional(),
      idempotency_key: z.string().optional(),
      text_limit: z.number().int().positive().max(20000).default(5000)
    },
    async (args) => {
      const result = await invokeComputerUser(args);
      return {
        isError: !result.ok,
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }]
      };
    }
  );
}
