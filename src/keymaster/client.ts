import { randomUUID } from 'node:crypto';

const SUPABASE_URL = process.env.APEX_CAPABILITY_SUPABASE_URL || 'https://dyhprklicgewmrimecey.supabase.co';
const BROKER_URL = `${SUPABASE_URL}/functions/v1/apex-keymaster-broker`;
const BROKER_TIMEOUT_MS = 15_000;
const SECRET_KEY = /token|secret|password|authorization|private[_-]?key|credential/i;

export interface KeymasterUseOptions {
  secretRef: string;
  provider: string;
  operation: string;
  actor?: string;
  requestId?: string;
  oidcToken?: string;
  auditMetadata?: Record<string, unknown>;
}

export interface KeymasterSecretContext {
  secretRef: string;
  provider: string;
  accountLabel: string;
  purpose: string;
  scope: unknown[] | Record<string, unknown>;
  version: number;
  resolveReceiptId: string;
  requestId: string;
}

interface ResolvePayload {
  ok: true;
  secret_ref: string;
  provider: string;
  account_label: string;
  purpose: string;
  scope: unknown[] | Record<string, unknown>;
  version: number;
  secret: string;
  resolve_receipt_id: string;
}

function boundedText(value: string, name: string, max: number): string {
  const normalized = value.trim();
  if (!normalized || normalized.length > max) throw new Error(`invalid_${name}`);
  return normalized;
}

function sanitize(value: unknown, key = ''): unknown {
  if (SECRET_KEY.test(key)) return '[REDACTED]';
  if (value === null || value === undefined) return value;
  if (typeof value === 'string') return value.length > 512 ? { length: value.length } : value;
  if (typeof value === 'number' || typeof value === 'boolean') return value;
  if (Array.isArray(value)) return value.slice(0, 100).map((item) => sanitize(item));
  if (typeof value === 'object') {
    const output: Record<string, unknown> = {};
    for (const [childKey, childValue] of Object.entries(value as Record<string, unknown>)) {
      output[childKey] = sanitize(childValue, childKey);
    }
    return output;
  }
  return String(value);
}

function resultContainsSecret(value: unknown, secret: string): boolean {
  if (!secret) return false;
  if (typeof value === 'string') return value.includes(secret);
  if (Array.isArray(value)) return value.some((item) => resultContainsSecret(item, secret));
  if (value && typeof value === 'object') {
    return Object.values(value as Record<string, unknown>).some((item) => resultContainsSecret(item, secret));
  }
  return false;
}

async function brokerCall(body: Record<string, unknown>, oidcToken: string): Promise<any> {
  const response = await fetch(BROKER_URL, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-vercel-oidc-token': oidcToken,
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(BROKER_TIMEOUT_MS),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const code = typeof payload?.error === 'string' ? payload.error : `keymaster_broker_http_${response.status}`;
    throw new Error(code);
  }
  return payload;
}

async function recordUse(
  options: Required<Pick<KeymasterUseOptions, 'secretRef' | 'provider' | 'operation'>> &
    Pick<KeymasterUseOptions, 'actor' | 'auditMetadata'>,
  oidcToken: string,
  requestId: string,
  outcome: 'succeeded' | 'failed' | 'blocked',
  extra: Record<string, unknown> = {},
): Promise<void> {
  await brokerCall({
    action: 'record_use',
    secret_ref: options.secretRef,
    request_id: requestId,
    actor: options.actor || 'colossus-keymaster-client',
    operation: options.operation,
    outcome,
    metadata: sanitize({ ...options.auditMetadata, ...extra }),
  }, oidcToken);
}

/**
 * Resolve a credential by opaque reference, use it inside one server-side callback,
 * and write a use receipt. The raw value is never returned by this function.
 */
export async function withKeymasterSecret<T>(
  options: KeymasterUseOptions,
  operation: (secret: string, context: KeymasterSecretContext) => Promise<T>,
): Promise<T> {
  const secretRef = boundedText(options.secretRef, 'secret_ref', 64);
  const provider = boundedText(options.provider.toLowerCase(), 'provider', 64);
  const operationName = boundedText(options.operation, 'operation', 256);
  const oidcToken = options.oidcToken || process.env.VERCEL_OIDC_TOKEN || '';
  if (!oidcToken) throw new Error('workload_identity_unavailable');
  const requestId = options.requestId || `keymaster-use-${randomUUID()}`;

  const resolved = await brokerCall({
    action: 'resolve',
    secret_ref: secretRef,
    provider,
    operation: operationName,
    request_id: requestId,
    actor: options.actor || 'colossus-keymaster-client',
  }, oidcToken) as ResolvePayload;

  if (!resolved?.ok || typeof resolved.secret !== 'string' || !resolved.secret) {
    throw new Error('keymaster_resolve_invalid_response');
  }

  const context: KeymasterSecretContext = {
    secretRef: resolved.secret_ref,
    provider: resolved.provider,
    accountLabel: resolved.account_label,
    purpose: resolved.purpose,
    scope: resolved.scope,
    version: resolved.version,
    resolveReceiptId: resolved.resolve_receipt_id,
    requestId,
  };

  try {
    const result = await operation(resolved.secret, context);
    if (resultContainsSecret(result, resolved.secret)) {
      await recordUse(
        { ...options, secretRef, provider, operation: operationName },
        oidcToken,
        requestId,
        'blocked',
        { reason: 'raw_secret_detected_in_tool_result', resolve_receipt_id: context.resolveReceiptId },
      );
      throw new Error('raw_secret_return_blocked');
    }

    await recordUse(
      { ...options, secretRef, provider, operation: operationName },
      oidcToken,
      requestId,
      'succeeded',
      { resolve_receipt_id: context.resolveReceiptId },
    );
    return result;
  } catch (error) {
    if (error instanceof Error && error.message === 'raw_secret_return_blocked') throw error;
    await recordUse(
      { ...options, secretRef, provider, operation: operationName },
      oidcToken,
      requestId,
      'failed',
      {
        resolve_receipt_id: context.resolveReceiptId,
        error_name: error instanceof Error ? error.name : 'UnknownError',
      },
    ).catch(() => undefined);
    throw error;
  }
}
