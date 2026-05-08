// api/health.ts
// GET /api/health — liveness probe for Vercel + uptime monitors
import type { VercelRequest, VercelResponse } from '@vercel/node';

export default function handler(_req: VercelRequest, res: VercelResponse) {
  res.status(200).json({
    status:  'ok',
    service: 'colossus-gateway',
    version: '2.1.0',
    case:    '1FDV-23-0001009',
    ts:      new Date().toISOString(),
  });
}
