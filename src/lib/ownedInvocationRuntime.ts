import { searchMemory } from './memoryRouter.js';
import { executeNotionSearch } from '../tools/notionDirect.js';
import type { InvocationDependencies } from './ownedInvocation.js';

const AI_GATEWAY_BASE = 'https://ai-gateway.vercel.sh/v1';

function gatewayCredential(): string {
  return (process.env.AI_GATEWAY_API_KEY || process.env.VERCEL_OIDC_TOKEN || '').trim();
}

function responseText(payload: any): string {
  if (typeof payload?.output_text === 'string' && payload.output_text.trim()) return payload.output_text;
  const chunks: string[] = [];
  for (const item of Array.isArray(payload?.output) ? payload.output : []) {
    if (typeof item?.text === 'string') chunks.push(item.text);
    for (const part of Array.isArray(item?.content) ? item.content : []) {
      if (typeof part?.text === 'string') chunks.push(part.text);
      else if (typeof part?.output_text === 'string') chunks.push(part.output_text);
    }
  }
  return chunks.join('\n').trim();
}

export function defaultOwnedModel(): string {
  return (process.env.GLACIEREQ_DEFAULT_MODEL || 'openai/gpt-5.6-sol').trim();
}

export function productionInvocationDependencies(): InvocationDependencies {
  return {
    recoverMemory: (prompt) => searchMemory('auto', {
      query: prompt,
      limit: 5,
      user_id: 'casey-barton',
      agent_id: 'glaciereq-owned-runtime',
    }),
    recoverNotion: (prompt) => executeNotionSearch(
      { query: prompt, limit: 5 },
      {
        source: 'owned-invocation',
        actor: 'operator',
        vercelOidcToken: process.env.VERCEL_OIDC_TOKEN,
      },
    ),
    callModel: async ({ prompt, model, system }) => {
      const credential = gatewayCredential();
      if (!credential) {
        throw new Error('Vercel AI Gateway credential is unavailable');
      }

      const response = await fetch(`${AI_GATEWAY_BASE}/responses`, {
        method: 'POST',
        headers: {
          authorization: `Bearer ${credential}`,
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          model,
          instructions: system,
          input: [{ type: 'message', role: 'user', content: prompt }],
          providerOptions: {
            gateway: {
              disallowPromptTraining: true,
            },
          },
        }),
      });

      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        const detail = typeof payload?.error?.message === 'string'
          ? payload.error.message
          : JSON.stringify(payload).slice(0, 1200);
        throw new Error(`AI Gateway HTTP ${response.status}: ${detail}`);
      }
      const text = responseText(payload);
      if (!text) throw new Error('AI Gateway returned no text output');
      return {
        model: typeof payload?.model === 'string' ? payload.model : model,
        text,
      };
    },
  };
}
