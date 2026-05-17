import { describe, it, expect } from 'vitest';
import { remoteExecutor } from './lib/remoteExecutor.js';

describe('RemoteExecutor', () => {
  it('should handle unconfigured token or unknown tools', async () => {
    const result = await remoteExecutor.execute('unknown-tool', {});
    expect(result.success).toBe(false);
    // It will either fail due to no token in test env or unknown tool
    expect(result.error).toBeDefined();
  });
});
