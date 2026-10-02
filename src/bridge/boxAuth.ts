import { BoxApiError, BoxClient } from './boxClient.js';
import type { BridgeRequestContext } from './context.js';
import { withKeymasterSecret } from '../keymaster/client.js';

function directToken(context: BridgeRequestContext): string | undefined {
  return context.boxAccessToken || process.env.BOX_ACCESS_TOKEN;
}

export async function withBoxClient<T>(
  context: BridgeRequestContext,
  operation: string,
  fn: (client: BoxClient) => Promise<T>,
): Promise<T> {
  const token = directToken(context);
  if (token) return fn(new BoxClient(token));

  const secretRef = process.env.BOX_ACCESS_TOKEN_REF?.trim();
  if (!secretRef) {
    throw new BoxApiError(
      'BOX_NOT_CONNECTED: configure BOX_ACCESS_TOKEN_REF in Keymaster, BOX_ACCESS_TOKEN, or x-box-access-token',
      503,
    );
  }

  return withKeymasterSecret(
    {
      secretRef,
      provider: 'box',
      operation,
      actor: context.actor || 'colossus-box-bridge',
      requestId: context.requestId,
      oidcToken: context.vercelOidcToken,
      auditMetadata: {
        source: context.source || 'box-bridge',
        auth_mode: 'keymaster_ref',
      },
    },
    (secret) => fn(new BoxClient(secret)),
  );
}
