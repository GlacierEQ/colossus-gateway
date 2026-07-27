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

console.log('[vercel-install-gate] API typecheck and tests passed');
