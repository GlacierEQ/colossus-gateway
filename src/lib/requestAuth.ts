import { timingSafeEqual } from 'node:crypto';

type Env = Record<string, string | undefined>;
type Headers = Record<string, string | string[] | undefined>;

function first(value: string | string[] | undefined): string {
  return Array.isArray(value) ? (value[0] ?? '') : (value ?? '');
}

function exactSecretMatch(supplied: string, expected: string): boolean {
  if (!supplied || !expected) return false;
  const left = Buffer.from(supplied, 'utf8');
  const right = Buffer.from(expected, 'utf8');
  return left.length === right.length && timingSafeEqual(left, right);
}

export function isCronAuthorized(
  authorization: string | string[] | undefined,
  env: Env = process.env,
): boolean {
  const secret = env.CRON_SECRET?.trim();
  if (!secret) return false;
  return exactSecretMatch(first(authorization), `Bearer ${secret}`);
}

export function isToolCallAuthorized(
  headers: Headers,
  env: Env = process.env,
): boolean {
  const expected = (env.COLOSSUS_TOOL_KEY || env.COLOSSUS_KEY)?.trim();

  if (!expected) {
    const production = env.NODE_ENV === 'production' || env.VERCEL_ENV === 'production';
    return !production && env.ALLOW_UNAUTHENTICATED_TOOL_CALLS === 'true';
  }

  const bearer = first(headers.authorization).replace(/^Bearer\s+/i, '');
  const fallback = first(headers['x-colossus-key']);
  return exactSecretMatch(bearer || fallback, expected);
}
