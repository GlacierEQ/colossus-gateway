import type { VercelRequest, VercelResponse } from "@vercel/node";
import { memorySearch, type SearchReq } from "../../src/lib/supermemory.js";
import { authorizeRequest } from "../../src/lib/operatorAuth.js";

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const auth = authorizeRequest(req.headers);
  if (!auth.authorized) return res.status(401).setHeader("WWW-Authenticate", "Bearer").json({ ok: false, error: auth.message });
  if (req.method !== "POST") return res.status(405).json({ ok: false, error: "Method not allowed" });
  try {
    const body = req.body as SearchReq;
    if (!body?.query && !body?.q) return res.status(400).json({ ok: false, error: "query is required" });
    return res.status(200).json(await memorySearch(body));
  } catch (e: any) {
    return res.status(500).json({ ok: false, error: e?.message ?? "Unknown error" });
  }
}
