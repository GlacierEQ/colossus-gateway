// api/voice.ts
// POST /api/voice — iOS Shortcut endpoint (APEX Voice field trigger)
// Body: { transcript: string, source: string }
// Classifies intent → calls the matching chain via executeUniversal
import type { VercelRequest, VercelResponse } from '@vercel/node';
import { executeUniversal } from '../lib/executor.js';

export const config = { maxDuration: 30 };

const CHAIN_MAP: Record<string, string[]> = {
  legal:   ['legal', 'kekoa', 'court', 'motion', 'filing', 'hearing', 'strike'],
  memory:  ['remember', 'recall', 'sync', 'update memory'],
  deploy:  ['push', 'deploy', 'ship', 'build', 'run ci'],
  timeline:['timeline', 'history', 'log', 'what happened'],
};

function classifyIntent(transcript: string): string {
  const t = transcript.toLowerCase();
  for (const [chain, kws] of Object.entries(CHAIN_MAP)) {
    if (kws.some(kw => t.includes(kw))) return chain;
  }
  return 'timeline'; // safe default
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(204).end();

  const { transcript = '', source = 'unknown' } = req.body ?? {};
  const intent = classifyIntent(transcript);

  // Map intents to universal.execute toolNames
  const toolMap: Record<string, { toolName: string; payload: any }> = {
    legal:    { toolName: 'apex.ingest', payload: { type: 'voice-legal',    title: transcript, metadata: { source, intent } } },
    memory:   { toolName: 'apex.timeline', payload: {} },
    deploy:   { toolName: 'github.list_repos', payload: {} },
    timeline: { toolName: 'apex.timeline', payload: {} },
  };

  const { toolName, payload } = toolMap[intent] ?? toolMap.timeline;
  const result = await executeUniversal(toolName, payload);

  return res.status(200).json({
    heard:  transcript,
    intent,
    result,
    speak:  `APEX received: ${intent} intent. Operation complete.`,
  });
}
