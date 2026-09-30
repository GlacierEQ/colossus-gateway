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

export interface GatewayModelPlan {
  primary: string;
  models: string[];
  providerOrder: string[];
  dynamic: boolean;
}

function csv(value: string | undefined): string[] {
  return (value || '')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
}

function dedupe(values: string[]): string[] {
  return [...new Set(values)];
}

export function buildGatewayModelPlan(
  input: { model?: string; fallbackModels?: string[]; providerOrder?: string[] },
  env: NodeJS.ProcessEnv = process.env,
): GatewayModelPlan {
  const configuredPool = csv(env.GLACIEREQ_MODEL_POOL);
  const requested = input.model?.trim();
  const fallbackModels = (input.fallbackModels || []).map((item) => item.trim()).filter(Boolean);
  const pool = dedupe([
    ...(requested ? [requested] : []),
    ...fallbackModels,
    ...configuredPool,
  ]);
  if (!pool.length) {
    throw new Error('No GlacierEQ model routes are configured; set GLACIEREQ_MODEL_POOL or request a model explicitly');
  }
  const providerOrder = dedupe(
    (input.providerOrder && input.providerOrder.length
      ? input.providerOrder
      : csv(env.GLACIEREQ_PROVIDER_ORDER))
      .map((item) => item.trim())
      .filter(Boolean),
  );
  return {
    primary: pool[0],
    models: pool,
    providerOrder,
    dynamic: pool.length > 1 || providerOrder.length > 1,
  };
}

export function defaultOwnedModel(): string {
  return buildGatewayModelPlan({}).primary;
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
    callModel: async ({ prompt, model, fallbackModels, providerOrder, system }) => {
      const credential = gatewayCredential();
      if (!credential) {
        throw new Error('Vercel AI Gateway credential is unavailable');
      }

      const plan = buildGatewayModelPlan({ model, fallbackModels, providerOrder });
      const response = await fetch(`${AI_GATEWAY_BASE}/responses`, {
        method: 'POST',
        headers: {
          authorization: `Bearer ${credential}`,
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          model: plan.primary,
          instructions: system,
          input: [{ type: 'message', role: 'user', content: prompt }],
          providerOptions: {
            gateway: {
              models: plan.models,
              ...(plan.providerOrder.length ? { order: plan.providerOrder } : {}),
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
      const gatewayMeta = payload?.provider_metadata?.gateway
        || payload?.providerMetadata?.gateway
        || payload?.provider_metadata
        || payload?.providerMetadata
        || undefined;
      return {
        model: typeof payload?.model === 'string' ? payload.model : plan.primary,
        text,
        route: {
          requested_primary: plan.primary,
          candidate_models: plan.models,
          provider_order: plan.providerOrder,
          dynamic: plan.dynamic,
          gateway: gatewayMeta,
        },
      };
    },
  };
}
