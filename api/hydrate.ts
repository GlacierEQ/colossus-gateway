import type { IncomingMessage, ServerResponse } from 'node:http';
import { authorizeRequest } from '../src/lib/operatorAuth.js';
import { hydrateOwnedContext } from '../src/lib/ownedInvocation.js';
import { productionInvocationDependencies } from '../src/lib/ownedInvocationRuntime.js';

const ALLOWED_ORIGINS = new Set(['https://chatgpt.com', 'https://chat.openai.com']);

function setCors(req: IncomingMessage, res: ServerResponse) {
  const origin = String(req.headers.origin || '');
  if (ALLOWED_ORIGINS.has(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Vary', 'Origin');
  }
  res.setHeader('Access-Control-Allow-Headers', 'authorization, content-type, x-colossus-operator');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Cache-Control', 'no-store');
}

async function readJson(req: IncomingMessage): Promise<Record<string, unknown>> {
  let raw = '';
  for await (const chunk of req) {
    raw += chunk;
    if (raw.length > 1024 * 1024) throw new Error('request body too large');
  }
  const parsed = raw ? JSON.parse(raw) : {};
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('request body must be an object');
  return parsed as Record<string, unknown>;
}

function send(res: ServerResponse, status: number, payload: unknown) {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(payload));
}

export default async function handler(req: IncomingMessage, res: ServerResponse) {
  setCors(req, res);
  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }
  if (req.method !== 'POST') {
    send(res, 405, { status: 'method_not_allowed' });
    return;
  }

  const auth = authorizeRequest(req.headers as any);
  if (!auth.authorized) {
    send(res, 401, { status: 'unauthorized', error: auth.message });
    return;
  }

  try {
    const body = await readJson(req);
    const prompt = typeof body.prompt === 'string' ? body.prompt : '';
    const requireProvider = body.require_provider === true || body.requireProvider === true;
    const hydrated = await hydrateOwnedContext(
      { prompt, requireProvider },
      productionInvocationDependencies(),
    );
    send(res, 200, {
      schema: 'glaciereq.pre-response-hydration.v2',
      status: 'hydrated',
      provider_expected: true,
      provider_required: requireProvider,
      provider_retrieved: hydrated.providerRetrieved,
      context_mode: hydrated.contextMode,
      original_prompt: hydrated.prompt,
      hydrated_prompt: hydrated.hydratedPrompt,
      context: {
        lanes: hydrated.lanes,
        errors: hydrated.errors,
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const explicitContextFailure = message.includes('explicit provider context requirement');
    send(res, explicitContextFailure ? 409 : 400, {
      status: explicitContextFailure ? 'context_required' : 'rejected',
      error: message,
    });
  }
}
