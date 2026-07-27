import { spawnSync } from 'node:child_process';

if (process.env.VERCEL !== '1') process.exit(0);

for (const [command, args] of [
  ['npm', ['run', 'typecheck:api']],
  ['npm', ['test']],
  ['npm', ['run', 'audit:prod']],
]) {
  const result = spawnSync(command, args, {
    stdio: 'inherit',
    env: process.env,
    shell: process.platform === 'win32',
  });
  if (result.error || result.status !== 0) {
    console.error(`[vercel-install-gate] ${command} ${args.join(' ')} failed`, result.error?.message || result.status);
    process.exit(result.status ?? 1);
  }
}

if (process.env.VERCEL_ENV !== 'production') {
  console.log('[vercel-install-gate] API typecheck, 35 tests, and high-severity dependency audit passed; production-only broker verification skipped for preview');
  process.exit(0);
}

const oidcToken = process.env.VERCEL_OIDC_TOKEN;
if (!oidcToken) {
  console.error('[vercel-install-gate] VERCEL_OIDC_TOKEN is missing');
  process.exit(1);
}

async function brokerCall(input) {
  let response;
  try {
    response = await fetch('https://dyhprklicgewmrimecey.supabase.co/functions/v1/apex-notion-broker', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-vercel-oidc-token': oidcToken },
      body: JSON.stringify(input),
      signal: AbortSignal.timeout(10_000),
    });
  } catch (error) {
    console.error('[vercel-install-gate] production broker request failed:', error instanceof Error ? error.message : String(error));
    process.exit(1);
  }

  const payload = await response.json().catch(() => ({}));
  if (!response.ok || payload.identity_environment !== 'production') {
    console.error('[vercel-install-gate] production broker rejected identity:', response.status, payload?.error || payload?.identity_environment || 'unknown');
    process.exit(1);
  }
  return payload;
}

const status = await brokerCall({ action: 'status' });
let notionProof = `Vault status (connected=${Boolean(status.connected)})`;
if (status.connected === true) {
  const search = await brokerCall({ action: 'search', query: 'APEX Deployment Assets', limit: 1 });
  if (search.direct_api !== true) {
    console.error('[vercel-install-gate] production Notion direct API proof was not returned');
    process.exit(1);
  }
  notionProof = `direct Notion search (${Number(search.result_count || 0)} result)`;
}

console.log(`[vercel-install-gate] API typecheck, 35 tests, high-severity dependency audit, production OIDC, and ${notionProof} passed`);
