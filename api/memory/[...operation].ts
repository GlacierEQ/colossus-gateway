import type { VercelRequest, VercelResponse } from "@vercel/node";
import {
  addMemory,
  deleteMemory,
  searchMemory,
  type MemoryProvider,
} from "../../src/lib/memoryRouter.js";
import { authorizeRequest } from "../../src/lib/operatorAuth.js";

type AddBody = {
  provider?: Exclude<MemoryProvider, "auto">;
  containerTag?: string;
  content?: string;
  customId?: string;
  user_id?: string;
  agent_id?: string;
  metadata?: Record<string, string | number | boolean>;
  payload?: Record<string, unknown>;
};

type SearchBody = {
  provider?: MemoryProvider;
  query?: string;
  q?: string;
  containerTag?: string;
  user_id?: string;
  agent_id?: string;
  limit?: number;
  threshold?: number;
  tags?: string[];
};

type DeleteBody = {
  id?: string;
  provider?: Exclude<MemoryProvider, "auto">;
};

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const auth = authorizeRequest(req.headers);
  if (!auth.authorized) {
    return res
      .status(401)
      .setHeader("WWW-Authenticate", "Bearer")
      .json({ ok: false, error: auth.message });
  }

  const operationValue = req.query.operation;
  const operation = Array.isArray(operationValue) ? operationValue[0] : operationValue;
  if (operation !== "add" && operation !== "search" && operation !== "delete") {
    return res.status(404).json({ ok: false, error: "Unknown memory operation" });
  }

  try {
    const body = (req.body ?? {}) as Record<string, unknown>;

    if (operation === "add") {
      if (req.method !== "POST") {
        return res.status(405).json({ ok: false, error: "Method not allowed" });
      }
      const input = body as AddBody;
      const provider = input.provider ?? "supermemory";
      if (!input.content && !input.payload) {
        return res.status(400).json({ ok: false, error: "content or payload is required" });
      }
      if ((provider === "supermemory" || provider === "both") && !input.containerTag) {
        return res.status(400).json({ ok: false, error: "containerTag is required for Supermemory" });
      }
      return res.status(200).json(await addMemory(provider, input as any));
    }

    if (operation === "search") {
      if (req.method !== "POST") {
        return res.status(405).json({ ok: false, error: "Method not allowed" });
      }
      const input = body as SearchBody;
      if (!input.query && !input.q) {
        return res.status(400).json({ ok: false, error: "query is required" });
      }
      return res.status(200).json(await searchMemory(input.provider ?? "auto", input));
    }

    if (req.method !== "POST" && req.method !== "DELETE") {
      return res.status(405).json({ ok: false, error: "Method not allowed" });
    }
    const input = body as DeleteBody;
    if (!input.id) {
      return res.status(400).json({ ok: false, error: "id is required" });
    }
    return res.status(200).json(await deleteMemory(input.provider ?? "supermemory", input.id));
  } catch (error: any) {
    return res.status(500).json({ ok: false, error: error?.message ?? "Unknown error" });
  }
}
