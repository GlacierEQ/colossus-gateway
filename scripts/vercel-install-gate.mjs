import { spawnSync } from 'node:child_process';

if (process.env.VERCEL !== '1') {
  process.exit(0);
}

const commands = [
  ['npm', ['run', 'typecheck:api']],
  ['npm', ['test']],
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

let brokerResponse;
try {
  brokerResponse = await fetch('https://dyhprklicgewmrimecey.supabase.co/functions/v1/apex-notion-broker', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-vercel-oidc-token': oidcToken,
    },
    body: JSON.stringify({ action: 'status' }),
    signal: AbortSignal.timeout(10_000),
  });
} catch (error) {
  console.error('[vercel-install-gate] OIDC broker request failed:', error instanceof Error ? error.message : String(error));
  process.exit(1);
}

const brokerPayload = await brokerResponse.json().catch(() => ({}));
if (!brokerResponse.ok) {
  console.error('[vercel-install-gate] OIDC broker rejected deployment identity:', brokerResponse.status, brokerPayload?.error || 'unknown');
  process.exit(1);
}

console.log(`[vercel-install-gate] API typecheck, 35 tests, and ${brokerPayload.identity_environment || 'unknown'} OIDC broker verification passed`);
