import type { VercelRequest, VercelResponse } from '../../src/types/vercel.js';
import { memoryDelete, type DeleteReq } from '../../lib/supermemory.js';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') return res.status(405).json({ ok: false, error: 'Method not allowed' });
  try {
    const body = req.body as DeleteReq;
    if (!body?.id) return res.status(400).json({ ok: false, error: 'id is required' });
    return res.status(200).json(await memoryDelete(body));
  } catch (e: any) {
    return res.status(500).json({ ok: false, error: e?.message ?? 'Unknown error' });
  }
}
