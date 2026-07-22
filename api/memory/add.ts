import type { VercelRequest, VercelResponse } from "@vercel/node";
import { addMemory, type MemoryProvider } from "../../src/lib/memoryRouter.js";
import { authorizeRequest } from "../../src/lib/operatorAuth.js";

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const auth = authorizeRequest(req.headers);
  if (!auth.authorized) return res.status(401).setHeader("WWW-Authenticate", "Bearer").json({ ok: false, error: auth.message });
  if (req.method !== "POST") return res.status(405).json({ ok: false, error: "Method not allowed" });
  try {
    const body = (req.body ?? {}) as {
      provider?: Exclude<MemoryProvider, "auto">;
      containerTag?: string;
      content?: string;
      customId?: string;
      user_id?: string;
      agent_id?: string;
      metadata?: Record<string, string | number | boolean>;
      payload?: Record<string, unknown>;
    };
    const provider = body.provider ?? "supermemory";
    if (!body.content && !body.payload) return res.status(400).json({ ok: false, error: "content or payload is required" });
    if ((provider === "supermemory" || provider === "both") && !body.containerTag) {
      return res.status(400).json({ ok: false, error: "containerTag is required for Supermemory" });
    }
    return res.status(200).json(await addMemory(provider, body as any));
  } catch (e: any) {
    return res.status(500).json({ ok: false, error: e?.message ?? "Unknown error" });
  }
}
