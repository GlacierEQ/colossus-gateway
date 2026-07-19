import type { VercelRequest, VercelResponse } from '../../src/types/vercel.js';
import { memoryAdd, type AddReq } from '../../lib/supermemory.js';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') return res.status(405).json({ ok: false, error: 'Method not allowed' });
  try {
    const body = req.body as AddReq;
    if (!body?.containerTag || !body?.schema || !body?.payload || !body?.source)
      return res.status(400).json({ ok: false, error: 'containerTag, schema, payload, source required' });
    return res.status(200).json(await memoryAdd(body));
  } catch (e: any) {
    return res.status(500).json({ ok: false, error: e?.message ?? 'Unknown error' });
  }
}
