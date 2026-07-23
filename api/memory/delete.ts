import type { VercelRequest, VercelResponse } from "@vercel/node";
import { deleteMemory, type MemoryProvider } from "../../src/lib/memoryRouter.js";
import { authorizeRequest } from "../../src/lib/operatorAuth.js";

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const auth = authorizeRequest(req.headers);
  if (!auth.authorized) return res.status(401).setHeader("WWW-Authenticate", "Bearer").json({ ok: false, error: auth.message });
  if (req.method !== "POST" && req.method !== "DELETE") return res.status(405).json({ ok: false, error: "Method not allowed" });
  try {
    const body = (req.body ?? {}) as { id?: string; provider?: Exclude<MemoryProvider, "auto"> };
    if (!body.id) return res.status(400).json({ ok: false, error: "id is required" });
    return res.status(200).json(await deleteMemory(body.provider ?? "supermemory", body.id));
  } catch (e: any) {
    return res.status(500).json({ ok: false, error: e?.message ?? "Unknown error" });
  }
}
