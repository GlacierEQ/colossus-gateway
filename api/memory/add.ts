import type { VercelRequest, VercelResponse } from "@vercel/node";
import { memoryAdd, type AddReq } from "../../src/lib/supermemory.js";
import { authorizeRequest } from "../../src/lib/operatorAuth.js";

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const auth = authorizeRequest(req.headers);
  if (!auth.authorized) return res.status(401).setHeader("WWW-Authenticate", "Bearer").json({ ok: false, error: auth.message });
  if (req.method !== "POST") return res.status(405).json({ ok: false, error: "Method not allowed" });
  try {
    const body = req.body as AddReq;
    if (!body?.containerTag || (!body.content && !body.payload)) return res.status(400).json({ ok: false, error: "containerTag and content (or payload) required" });
    return res.status(200).json(await memoryAdd(body));
  } catch (e: any) {
    return res.status(500).json({ ok: false, error: e?.message ?? "Unknown error" });
  }
}
