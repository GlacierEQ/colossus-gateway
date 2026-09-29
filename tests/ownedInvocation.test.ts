import { describe, expect, it, vi } from 'vitest';
import { invokeOwnedModel } from '../src/lib/ownedInvocation.js';

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
