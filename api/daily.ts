/**
 * Vercel Cron Endpoint — /api/daily
 * Runs APEX Daily Engine on schedule: 0 14 * * * (04:30 HST = 14:30 UTC)
 * Configure in vercel.json: { "crons": [{ "path": "/api/daily", "schedule": "0 14 * * *" }] }
 */

import type { VercelRequest, VercelResponse } from '../src/types/vercel.js';
import { runFullSync } from '../src/apex-sync.js';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const authHeader = req.headers.authorization;
  const expected = `Bearer ${process.env.CRON_SECRET ?? ''}`;
  if (process.env.CRON_SECRET && authHeader !== expected) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    await runFullSync();
    return res.status(200).json({ status: 'APEX DAILY ENGINE complete', timestamp: new Date().toISOString() });
  } catch (err: any) {
    return res.status(500).json({ error: err?.message ?? 'Unknown error' });
  }
}
