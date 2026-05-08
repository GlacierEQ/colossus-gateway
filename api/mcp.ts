// api/mcp.ts
// Vercel HTTP handler for Colossus Gateway v2.1
// Accepts POST /api/mcp  →  executes universal.execute  →  returns JSON
// Compatible with Vercel Serverless Functions (Node.js 20.x)
import type { VercelRequest, VercelResponse } from '@vercel/node';
import { executeUniversal } from '../lib/executor.js';

export const config = {
  maxDuration: 30, // seconds — enough for Notion + Dropbox round-trips
};

export default async function handler(req: VercelRequest, res: VercelResponse) {
  // CORS — allow all APEX chain callers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed. Use POST.' });
  }

  // Optional bearer token guard (set GATEWAY_SECRET env var to enable)
  const secret = process.env.GATEWAY_SECRET;
  if (secret) {
    const auth = req.headers.authorization ?? '';
    if (auth !== `Bearer ${secret}`) {
      return res.status(401).json({ error: 'Unauthorized' });
    }
  }

  try {
    const { toolName, payload = {} } = req.body as { toolName: string; payload?: any };
    if (!toolName) return res.status(400).json({ error: 'toolName is required' });

    const result = await executeUniversal(toolName, payload);
    return res.status(200).json(result);
  } catch (err: any) {
    console.error('[COLOSSUS] Error:', err);
    return res.status(500).json({
      error: err.message ?? 'Internal server error',
      stack: process.env.NODE_ENV === 'development' ? err.stack : undefined,
    });
  }
}
