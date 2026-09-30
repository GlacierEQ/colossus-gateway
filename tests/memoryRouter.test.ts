import { describe, expect, it, vi } from 'vitest';
import {
  executeMemorySearch,
  planMemoryRoutes,
} from '../src/lib/memoryRouter.js';

describe('dynamic memory routing', () => {
  it('orders available providers by workload intent without making one canonical', () => {
    expect(planMemoryRoutes('continue my legal case evidence', '', {
      mem0: true,
      supermemory: true,
    })).toEqual(['supermemory', 'mem0']);

    expect(planMemoryRoutes('what did we decide last time', '', {
      mem0: true,
      supermemory: true,
    })).toEqual(['mem0', 'supermemory']);
  });

  it('removes unavailable providers instead of selecting a dead route', () => {
    expect(planMemoryRoutes('case evidence', '', {
      mem0: true,
      supermemory: false,
    })).toEqual(['mem0']);
  });

  it('fails over when the preferred memory provider errors', async () => {
    const mem0 = vi.fn(async () => ({ results: [{ id: 'm1', memory: 'continuity' }] }));
    const supermemory = vi.fn(async () => {
      throw new Error('supermemory unavailable');
    });

    const result = await executeMemorySearch(
      ['supermemory', 'mem0'],
      { query: 'case evidence', limit: 5 },
      { mem0, supermemory },
    );

    expect(result.provider).toBe('mem0');
    expect(result.attempted).toEqual(['supermemory', 'mem0']);
    expect(result.failures).toEqual([
      { provider: 'supermemory', error: 'supermemory unavailable' },
    ]);
    expect(result.degraded).toBe(true);
    expect(result.results).toHaveLength(1);
  });

  it('does not turn one provider failure into global context loss', async () => {
    const result = await executeMemorySearch(
      ['mem0', 'supermemory'],
      { query: 'continuity' },
      {
        mem0: async () => {
          throw new Error('mem0 down');
        },
        supermemory: async () => ({
          results: [{
            documentId: 'doc-1',
            title: 'Recovered state',
            chunks: [{ content: 'prior context', score: 0.9 }],
          }],
        }),
      },
    );

    expect(result.provider).toBe('supermemory');
    expect(result.results[0]).toMatchObject({ documentId: 'doc-1' });
    expect(result.degraded).toBe(true);
  });
});
