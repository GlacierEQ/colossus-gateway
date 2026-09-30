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


export interface GatewayCatalogModel {
  id?: string;
  owned_by?: string;
  type?: string;
  released?: number;
  context_window?: number;
  tags?: string[];
}

export function rankGatewayCatalog(
  catalog: GatewayCatalogModel[],
  options: { requiredTags: string[]; limit: number },
): string[] {
  const required = new Set(options.requiredTags.map((item) => item.trim()).filter(Boolean));
  const eligible = catalog
    .filter((item) => typeof item.id === 'string' && item.id.trim())
    .filter((item) => item.type === 'language')
    .filter((item) => {
      const tags = new Set((item.tags || []).map((tag) => tag.trim()));
      return [...required].every((tag) => tags.has(tag));
    })
    .sort((a, b) => {
      const releaseDelta = Number(b.released || 0) - Number(a.released || 0);
      if (releaseDelta) return releaseDelta;
      const contextDelta = Number(b.context_window || 0) - Number(a.context_window || 0);
      if (contextDelta) return contextDelta;
      return String(a.id).localeCompare(String(b.id));
    });

  const selected: string[] = [];
  const seenOwners = new Set<string>();
  for (const item of eligible) {
    const owner = String(item.owned_by || String(item.id).split('/')[0] || 'unknown');
    if (!seenOwners.has(owner)) {
      selected.push(String(item.id));
      seenOwners.add(owner);
      if (selected.length >= options.limit) return selected;
    }
  }
  for (const item of eligible) {
    const id = String(item.id);
    if (!selected.includes(id)) selected.push(id);
    if (selected.length >= options.limit) break;
  }
  return selected;
}

async function discoverGatewayModels(
  fetchFn: typeof fetch = fetch,
  env: NodeJS.ProcessEnv = process.env,
): Promise<string[]> {
  const requiredTags = csv(env.GLACIEREQ_MODEL_REQUIRED_TAGS || 'reasoning,tool-use');
  const limit = Math.max(2, Math.min(8, Number(env.GLACIEREQ_MODEL_POOL_LIMIT || 4)));
  const response = await fetchFn(`${AI_GATEWAY_BASE}/models`);
  if (!response.ok) throw new Error(`AI Gateway model discovery HTTP ${response.status}`);
  const payload = await response.json().catch(() => ({}));
  const catalog = Array.isArray(payload?.data) ? payload.data : [];
  return rankGatewayCatalog(catalog, { requiredTags, limit });
}

export async function resolveGatewayModelPlan(
  input: { model?: string; fallbackModels?: string[]; providerOrder?: string[] },
  env: NodeJS.ProcessEnv = process.env,
  fetchFn: typeof fetch = fetch,
): Promise<GatewayModelPlan> {
  const configuredPool = csv(env.GLACIEREQ_MODEL_POOL);
  if (input.model?.trim() || (input.fallbackModels && input.fallbackModels.length) || configuredPool.length) {
    return buildGatewayModelPlan(input, env);
  }
  const discovered = await discoverGatewayModels(fetchFn, env);
  if (!discovered.length) {
    throw new Error('No eligible live AI Gateway models were discovered');
  }
  return buildGatewayModelPlan(
    {
      model: discovered[0],
      fallbackModels: discovered.slice(1),
      providerOrder: input.providerOrder,
    },
    env,
  );
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

export async function defaultOwnedModel(): Promise<string> {
  return (await resolveGatewayModelPlan({})).primary;
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

      const plan = await resolveGatewayModelPlan({ model, fallbackModels, providerOrder });
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
