import { describe, expect, it, vi } from 'vitest';
import { invokeOwnedModel } from '../src/lib/ownedInvocation.js';
import { buildGatewayModelPlan, rankGatewayCatalog } from '../src/lib/ownedInvocationRuntime.js';

describe('owned invocation boundary', () => {
  it('recovers context before exactly one model invocation and preserves the operator message', async () => {
    const callModel = vi.fn(async (request: { prompt: string; model: string; system?: string }) => ({
      model: request.model,
      text: 'owned answer',
    }));

    const result = await invokeOwnedModel(
      {
        prompt: 'continue the actual work',
        model: 'openai/gpt-5.6-sol',
        system: 'Use the current mission.',
      },
      {
        recoverMemory: async () => ({ provider: 'mem0', results: [{ memory: 'prior correction' }] }),
        recoverNotion: async () => ({ ok: true, result: { results: [{ title: 'project state' }] } }),
        callModel,
      },
    );

    expect(result.invocation_owned).toBe(true);
    expect(result.context_mode).toBe('full');
    expect(result.response).toBe('owned answer');
    expect(callModel).toHaveBeenCalledTimes(1);

    const request = callModel.mock.calls[0][0];
    expect(request.prompt).toContain('<glaciereq_runtime>');
    expect(request.prompt).toContain('prior correction');
    expect(request.prompt).toContain('project state');
    expect(request.prompt).toContain('<operator_message>\ncontinue the actual work\n</operator_message>');
    expect(request.system).toContain('Use the current mission.');
  });

  it('treats retrieval failure as degraded telemetry instead of a global veto', async () => {
    const callModel = vi.fn(async (request: { prompt: string; model: string }) => ({
      model: request.model,
      text: 'continued',
    }));

    const result = await invokeOwnedModel(
      { prompt: 'continue from the last checkpoint', model: 'openai/gpt-5.6-sol' },
      {
        recoverMemory: async () => {
          throw new Error('memory temporarily unavailable');
        },
        recoverNotion: async () => ({ ok: false, error: { message: 'notion unavailable' } }),
        callModel,
      },
    );

    expect(result.context_mode).toBe('degraded');
    expect(result.response).toBe('continued');
    expect(result.context.errors.length).toBeGreaterThan(0);
    expect(callModel).toHaveBeenCalledTimes(1);
  });

  it('honors an explicit provider-context requirement without making it the default', async () => {
    const callModel = vi.fn();

    await expect(
      invokeOwnedModel(
        {
          prompt: 'read exact current provider state',
          model: 'openai/gpt-5.6-sol',
          requireProvider: true,
        },
        {
          recoverMemory: async () => {
            throw new Error('memory unavailable');
          },
          recoverNotion: async () => ({ ok: false, error: { message: 'notion unavailable' } }),
          callModel,
        },
      ),
    ).rejects.toThrow('explicit provider context requirement');

    expect(callModel).not.toHaveBeenCalled();
  });
});



describe('dynamic model routing', () => {
  it('uses an explicit requested model as the first route while preserving fallbacks', () => {
    const plan = buildGatewayModelPlan(
      { model: 'anthropic/claude-opus-5' },
      {
        GLACIEREQ_MODEL_POOL: 'openai/gpt-5.6-sol,google/gemini-3.1-pro-preview,anthropic/claude-opus-5',
      },
    );

    expect(plan.primary).toBe('anthropic/claude-opus-5');
    expect(plan.models).toEqual([
      'anthropic/claude-opus-5',
      'openai/gpt-5.6-sol',
      'google/gemini-3.1-pro-preview',
    ]);
  });

  it('uses the configured model pool dynamically when no single model is requested', () => {
    const plan = buildGatewayModelPlan(
      {},
      {
        GLACIEREQ_MODEL_POOL: 'openai/gpt-5.6-sol,anthropic/claude-opus-5,google/gemini-3.1-pro-preview',
        GLACIEREQ_PROVIDER_ORDER: 'openai,azure,anthropic,vertex,google',
      },
    );

    expect(plan.primary).toBe('openai/gpt-5.6-sol');
    expect(plan.models).toHaveLength(3);
    expect(plan.providerOrder).toEqual(['openai', 'azure', 'anthropic', 'vertex', 'google']);
    expect(plan.dynamic).toBe(true);
  });

  it('deduplicates model routes instead of creating fake fallback diversity', () => {
    const plan = buildGatewayModelPlan(
      {},
      {
        GLACIEREQ_MODEL_POOL: 'openai/gpt-5.6-sol,openai/gpt-5.6-sol,anthropic/claude-opus-5',
      },
    );
    expect(plan.models).toEqual(['openai/gpt-5.6-sol', 'anthropic/claude-opus-5']);
  });
});



describe('live model discovery', () => {
  it('builds a provider-diverse pool from current capability-bearing language models', () => {
    const ranked = rankGatewayCatalog([
      {
        id: 'provider-a/new-reasoner',
        owned_by: 'provider-a',
        type: 'language',
        released: 200,
        context_window: 200000,
        tags: ['reasoning', 'tool-use'],
      },
      {
        id: 'provider-a/older-reasoner',
        owned_by: 'provider-a',
        type: 'language',
        released: 100,
        context_window: 500000,
        tags: ['reasoning', 'tool-use'],
      },
      {
        id: 'provider-b/agent-model',
        owned_by: 'provider-b',
        type: 'language',
        released: 180,
        context_window: 100000,
        tags: ['reasoning', 'tool-use'],
      },
      {
        id: 'provider-c/no-tools',
        owned_by: 'provider-c',
        type: 'language',
        released: 999,
        context_window: 1000000,
        tags: ['reasoning'],
      },
      {
        id: 'provider-d/image',
        owned_by: 'provider-d',
        type: 'image',
        released: 999,
        context_window: 0,
        tags: [],
      },
    ], {
      requiredTags: ['reasoning', 'tool-use'],
      limit: 4,
    });

    expect(ranked).toEqual([
      'provider-a/new-reasoner',
      'provider-b/agent-model',
      'provider-a/older-reasoner',
    ]);
  });

  it('does not invent a static winner when the live catalog contains no eligible model', () => {
    expect(rankGatewayCatalog([
      { id: 'provider/image', owned_by: 'provider', type: 'image', tags: [] },
    ], { requiredTags: ['reasoning', 'tool-use'], limit: 4 })).toEqual([]);
  });
});
