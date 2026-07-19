import type { VercelRequest, VercelResponse } from '../../src/types/vercel.js';
import { memorySearch, type SearchReq } from '../../lib/supermemory.js';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') return res.status(405).json({ ok: false, error: 'Method not allowed' });
  try {
    const body = req.body as SearchReq;
    if (!body?.query) return res.status(400).json({ ok: false, error: 'query is required' });
    return res.status(200).json(await memorySearch(body));
  } catch (e: any) {
    return res.status(500).json({ ok: false, error: e?.message ?? 'Unknown error' });
  }
}
