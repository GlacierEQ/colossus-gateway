import { AsyncLocalStorage } from 'node:async_hooks';

export interface BridgeRequestContext {
  boxAccessToken?: string;
  actor?: string;
  requestId?: string;
  source?: string;
}

const storage = new AsyncLocalStorage<BridgeRequestContext>();

export function runBridgeContext<T>(context: BridgeRequestContext, fn: () => T): T {
  return storage.run(context, fn);
}

export function getBridgeContext(): BridgeRequestContext {
  return storage.getStore() ?? {};
}
