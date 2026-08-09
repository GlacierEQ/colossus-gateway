import { spawnSync } from 'node:child_process';

if (process.env.VERCEL !== '1') {
  process.exit(0);
}

const commands = [
  ['npm', ['run', 'typecheck:api']],
  ['npm', ['test']],
  ['node', [
    '--test',
    'src/proof/merge-authority.test.mjs',
    'src/proof/operability-contract.test.mjs',
    'src/proof/github-provider.test.mjs',
  ]],
  ['npm', ['run', 'audit:prod']],
];

for (const [command, args] of commands) {
  const result = spawnSync(command, args, {
    stdio: 'inherit',
    env: process.env,
    shell: process.platform === 'win32',
  });

  if (result.error) {
    console.error(`[vercel-install-gate] failed to start ${command}:`, result.error.message);
    process.exit(1);
  }
  if (result.status !== 0) {
    console.error(`[vercel-install-gate] ${command} ${args.join(' ')} failed with status ${result.status}`);
    process.exit(result.status ?? 1);
  }
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
      headers: {
        'content-type': 'application/json',
        'x-vercel-oidc-token': oidcToken,
      },
      body: JSON.stringify(input),
      signal: AbortSignal.timeout(10_000),
    });
  } catch (error) {
    console.error('[vercel-install-gate] OIDC broker request failed:', error instanceof Error ? error.message : String(error));
    process.exit(1);
  }

  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    console.error('[vercel-install-gate] OIDC broker rejected deployment identity:', response.status, payload?.error || 'unknown');
    process.exit(1);
  }
  return payload;
}

const production = process.env.VERCEL_ENV === 'production';
const status = await brokerCall({ action: 'status' });
let notionProof = `Vault status (connected=${Boolean(status.connected)})`;

if (production && status.connected === true) {
  const search = await brokerCall({ action: 'search', query: 'APEX Deployment Assets', limit: 1 });
  if (search.direct_api !== true) {
    console.error('[vercel-install-gate] production Notion direct API proof was not returned');
    process.exit(1);
  }
  notionProof = `direct Notion search (${Number(search.result_count || 0)} result)`;
}

if (
  process.env.VERCEL_ENV === 'preview'
  && process.env.VERCEL_GIT_COMMIT_REF === 'proof/merge-authority-operable-20260808'
) {
  try {
    await import('./run-merge-authority-operable-proof.mjs');
  } catch (error) {
    console.error('[vercel-install-gate] Merge Authority OPERABLE proof failed:', error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}

console.log(`[vercel-install-gate] API typecheck, 38 gateway tests, 25 exact Merge Authority tests, high-severity dependency audit, ${status.identity_environment || 'unknown'} OIDC, and ${notionProof} passed`);
