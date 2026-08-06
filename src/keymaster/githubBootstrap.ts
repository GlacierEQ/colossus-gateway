const CANONICAL_ORIGIN = 'https://colossus-gateway.vercel.app';
const GITHUB_API_VERSION = '2026-03-10';
const BROKER_TIMEOUT_MS = 20_000;

export const GITHUB_BOOTSTRAP_PATHS = {
  start: '/keymaster/github/start',
  callback: '/keymaster/github/callback',
  setup: '/keymaster/github/setup',
} as const;

function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

function page(title: string, body: string): string {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHtml(title)}</title><style>:root{font-family:Inter,ui-sans-serif,system-ui,sans-serif;color-scheme:dark;background:#090b0f;color:#f4f4f5}*{box-sizing:border-box}body{margin:0;min-height:100vh;display:grid;place-items:center;padding:24px}.card{width:min(760px,100%);background:#14171d;border:1px solid #303640;border-radius:18px;padding:28px;box-shadow:0 24px 80px #0008}h1{margin:0 0 10px}p,li{color:#b7bdc8;line-height:1.55}.ok{color:#7ee787}.bad{color:#ff7b72}.warning{color:#f2cc60}a,button{display:inline-block;background:#fff;color:#111;border:0;border-radius:10px;padding:12px 16px;font-weight:750;text-decoration:none;margin-top:12px}code{word-break:break-all}</style></head><body><main class="card">${body}</main></body></html>`;
}

async function broker(
  supabaseUrl: string,
  oidcToken: string,
  input: Record<string, unknown>,
): Promise<{ status: number; payload: any }> {
  const response = await fetch(`${supabaseUrl}/functions/v1/apex-keymaster-broker`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-vercel-oidc-token': oidcToken,
    },
    body: JSON.stringify(input),
    signal: AbortSignal.timeout(BROKER_TIMEOUT_MS),
  });
  const payload = await response.json().catch(() => ({}));
  return { status: response.status, payload };
}

function requireState(value: string | null): string {
  const state = (value || '').trim();
  if (state.length < 32 || state.length > 512 || !/^[A-Za-z0-9_-]+$/.test(state)) {
    throw new Error('invalid_or_missing_bootstrap_link');
  }
  return state;
}

function requireCode(value: string | null): string {
  const code = (value || '').trim();
  if (code.length < 16 || code.length > 512 || !/^[A-Za-z0-9_-]+$/.test(code)) {
    throw new Error('invalid_or_missing_manifest_code');
  }
  return code;
}

export async function beginGithubBootstrap(
  url: URL,
  supabaseUrl: string,
  oidcToken: string,
): Promise<string> {
  const state = requireState(url.searchParams.get('state'));
  const requestId = `github-bootstrap-begin-${crypto.randomUUID()}`;
  const result = await broker(supabaseUrl, oidcToken, {
    action: 'github_bootstrap_begin',
    state,
    request_id: requestId,
    actor: 'phone-owner-consent',
  });
  if (result.status !== 200) {
    throw new Error(result.payload?.error || 'bootstrap_link_rejected');
  }

  const bootstrapRef = String(result.payload?.bootstrap_ref || '');
  const appName = `${String(result.payload?.app_name || 'Colossus Keymaster Bridge')} ${bootstrapRef.slice(-6)}`.slice(0, 100);
  const expected = Array.isArray(result.payload?.expected_repositories)
    ? result.payload.expected_repositories.map(String)
    : [];

  const manifest = {
    name: appName,
    url: CANONICAL_ORIGIN,
    description: 'Owner-only Colossus control-plane identity. Permanent key stays in Supabase Vault; tools receive only short-lived, repository-scoped tokens.',
    redirect_url: `${CANONICAL_ORIGIN}${GITHUB_BOOTSTRAP_PATHS.callback}`,
    callback_urls: [`${CANONICAL_ORIGIN}${GITHUB_BOOTSTRAP_PATHS.callback}`],
    setup_url: `${CANONICAL_ORIGIN}${GITHUB_BOOTSTRAP_PATHS.setup}`,
    setup_on_update: true,
    public: false,
    request_oauth_on_install: false,
    hook_attributes: {
      url: CANONICAL_ORIGIN,
      active: false,
    },
    default_events: [],
    default_permissions: {
      actions: 'write',
      contents: 'write',
      issues: 'write',
      workflows: 'write',
    },
  };

  const repositoryList = expected.map((repository: string) => `<li>${escapeHtml(repository)}</li>`).join('');
  const manifestJson = escapeHtml(JSON.stringify(manifest));
  const safeState = escapeHtml(state);
  return page('Create Colossus GitHub App', `
    <h1>Create the Colossus GitHub App</h1>
    <p>This is account consent—not key handling. GitHub generates the key and returns it directly to Colossus Vault.</p>
    <p class="warning">After creation, choose <strong>Only select repositories</strong> and approve exactly:</p>
    <ul>${repositoryList}</ul>
    <form id="manifest" action="https://github.com/settings/apps/new" method="post">
      <input type="hidden" name="manifest" value="${manifestJson}">
      <input type="hidden" name="state" value="${safeState}">
      <button type="submit">Continue to GitHub</button>
    </form>
    <script>document.getElementById('manifest').submit();</script>
  `);
}

export async function completeGithubManifest(
  url: URL,
  supabaseUrl: string,
  oidcToken: string,
): Promise<string> {
  const state = requireState(url.searchParams.get('state'));
  const code = requireCode(url.searchParams.get('code'));

  const conversion = await fetch(`https://api.github.com/app-manifests/${encodeURIComponent(code)}/conversions`, {
    method: 'POST',
    headers: {
      accept: 'application/vnd.github+json',
      'x-github-api-version': GITHUB_API_VERSION,
    },
    signal: AbortSignal.timeout(BROKER_TIMEOUT_MS),
  });
  let app: any = await conversion.json().catch(() => ({}));
  if (!conversion.ok) throw new Error(`github_manifest_conversion_failed_${conversion.status}`);

  let privateKey = typeof app?.pem === 'string' ? app.pem : '';
  const appId = Number(app?.id);
  const appSlug = typeof app?.slug === 'string' ? app.slug : '';
  const appClientId = typeof app?.client_id === 'string' ? app.client_id : '';
  if (!Number.isSafeInteger(appId) || appId <= 0 || !appSlug || !privateKey.includes('PRIVATE KEY')) {
    throw new Error('github_manifest_conversion_invalid');
  }

  try {
    const registered = await broker(supabaseUrl, oidcToken, {
      action: 'github_bootstrap_register',
      state,
      app_id: appId,
      app_slug: appSlug,
      app_client_id: appClientId,
      private_key: privateKey,
      request_id: `github-bootstrap-register-${crypto.randomUUID()}`,
      actor: 'github-manifest-callback',
    });
    if (registered.status !== 200) {
      throw new Error(registered.payload?.error || 'github_bootstrap_registration_failed');
    }
  } finally {
    privateKey = '';
    if (app && typeof app === 'object') {
      delete app.pem;
      delete app.client_secret;
      delete app.webhook_secret;
      app = null;
    }
  }

  return `https://github.com/apps/${encodeURIComponent(appSlug)}/installations/new?state=${encodeURIComponent(state)}`;
}

export async function verifyGithubInstallation(
  url: URL,
  supabaseUrl: string,
  oidcToken: string,
): Promise<{ status: number; html: string }> {
  const state = requireState(url.searchParams.get('state'));
  const installationId = Number(url.searchParams.get('installation_id'));
  if (!Number.isSafeInteger(installationId) || installationId <= 0) {
    throw new Error('invalid_or_missing_installation_id');
  }

  const verified = await broker(supabaseUrl, oidcToken, {
    action: 'github_bootstrap_verify_installation',
    state,
    installation_id: installationId,
    request_id: `github-bootstrap-verify-${crypto.randomUUID()}`,
    actor: 'github-installation-callback',
  });

  if (verified.status === 409) {
    const missing = Array.isArray(verified.payload?.missing) ? verified.payload.missing.map(String) : [];
    const extras = Array.isArray(verified.payload?.extras) ? verified.payload.extras.map(String) : [];
    const configureUrl = String(verified.payload?.configure_url || `https://github.com/settings/installations/${installationId}`);
    return {
      status: 409,
      html: page('Repository selection needs correction', `
        <h1 class="warning">Repository selection needs correction</h1>
        <p>Nothing was activated because the installation did not match the approved set.</p>
        <p><strong>Missing:</strong> ${escapeHtml(missing.join(', ') || 'none')}</p>
        <p><strong>Unexpected:</strong> ${escapeHtml(extras.join(', ') || 'none')}</p>
        <a href="${escapeHtml(configureUrl)}">Correct repository access</a>
      `),
    };
  }

  if (verified.status !== 200) {
    throw new Error(verified.payload?.error || 'github_installation_verification_failed');
  }

  const repositories = Array.isArray(verified.payload?.observed_repositories)
    ? verified.payload.observed_repositories.map(String)
    : [];
  const checks = Array.isArray(verified.payload?.live_read_checks)
    ? verified.payload.live_read_checks
    : [];
  return {
    status: 200,
    html: page('Colossus GitHub App activated', `
      <h1 class="ok">Colossus GitHub App activated</h1>
      <p>The permanent App private key is in Supabase Vault. It was not shown, downloaded, copied, committed, or placed into repository secrets.</p>
      <p><strong>Verified repositories:</strong></p>
      <ul>${repositories.map((repository: string) => `<li>${escapeHtml(repository)}</li>`).join('')}</ul>
      <p><strong>Live read checks:</strong> ${escapeHtml(String(checks.length))} passed.</p>
      <p>Future operations mint one-hour tokens for one approved repository and one bounded permission set.</p>
    `),
  };
}

export function githubBootstrapErrorPage(error: unknown): string {
  const message = error instanceof Error ? error.message : 'github_bootstrap_failed';
  return page('Colossus GitHub bootstrap failed', `
    <h1 class="bad">Bootstrap stopped safely</h1>
    <p>No success was recorded. The failure was:</p>
    <p><code>${escapeHtml(message.slice(0, 512))}</code></p>
    <p>The App key is never printed or returned by this page.</p>
  `);
}
