# Colossus Keymaster

Colossus Keymaster stores downstream credentials in Supabase Vault and exposes only opaque `secret_ref` values to tools.

## Permanent trust boundary

Vercel retains only:

- `COLOSSUS_OPERATOR_CODE`
- Vercel-issued `VERCEL_OIDC_TOKEN` workload identity
- the public Supabase project URL, when the built-in default is not used

Supabase Edge Functions retain their own `SUPABASE_SERVICE_ROLE_KEY` inside the Supabase function environment. Downstream provider credentials do not belong in Vercel, GitHub, chat, MemoryPlugin, logs, or committed `.env` files.

## One-time setup

1. Enable Vercel Secure Backend Access / OIDC Federation for the `colossus-gateway` project.
2. Set one strong production value for `COLOSSUS_OPERATOR_CODE`.
3. Deploy the gateway.
4. Open the production route:

   `https://colossus-gateway.vercel.app/keymaster/connect`

5. Enter the operator code, provider metadata, and one credential.
6. Record the returned `secret_ref` in the connector configuration. Never record the raw value.
7. Repeat for each downstream credential.

The browser clears the operator code and secret field before the request completes and uses no local or session storage.

## Recommended inventory

Store separate credential components as separate references.

| Provider | Account label | Purpose | Example scope |
|---|---|---|---|
| `jefs` | `casey` | `username` | `["login","docket-read"]` |
| `jefs` | `casey` | `password` | `["login","docket-read"]` |
| `smithery` | `glaciereq` | `api_key` | `["mcp-discovery","mcp-invoke"]` |
| `browserbase` | `glaciereq` | `api_key` | `["session-create","session-read"]` |
| `browserbase` | `glaciereq` | `project_id` | `["session-create"]` |
| `github` | `glaciereq` | `app_private_key` | Use an exact repository allowlist in scope |
| `supabase` | `backend-ops` | `service_role` | Internal broker only; never tool-facing |
| `box` | `glaciereq` | `access_token` | Exact folder roots and operations |
| `notion` | `glaciereq` | `integration_token` | Exact page/database roots |
| `supermemory` | `glaciereq` | `api_key` | `["search","write"]` |
| `mem0` | `glaciereq` | `api_key` | `["search","write"]` |

Do not store an entire multi-provider `.env` document as one secret. Separate references permit independent scope, verification, replacement, revocation, and rotation.

## Metadata retained outside Vault

For each secret, Colossus stores only:

- `secret_ref`
- provider
- account label
- purpose
- scope
- SHA-256 fingerprint
- verification status and non-secret verification detail
- version
- rotation date
- timestamps and status

The Vault record ID remains internal. Inventory responses never include raw values or Vault ciphertext.

## Tool use

Tools must use `withKeymasterSecret` from `src/keymaster/client.ts`.

```ts
import { withKeymasterSecret } from './keymaster/client.js';

const docket = await withKeymasterSecret(
  {
    secretRef: process.env.JEFS_PASSWORD_REF!,
    provider: 'jefs',
    operation: 'download_docket_225',
  },
  async (password) => {
    return authenticateAndDownload(password);
  },
);
```

The wrapper:

1. resolves the value through the OIDC-bound broker;
2. scopes the value to one server-side callback;
3. blocks results containing the raw value;
4. writes success, failure, or blocked-use receipts;
5. returns only the provider operation result.

There is intentionally no exported `getSecret()` function.

## Replacement and revocation

Use the same page with an existing `secret_ref`:

- **Replace existing** updates the Vault value, fingerprint, version, verification state, rotation date, and receipt.
- **Revoke existing** deletes the Vault value, marks the metadata record revoked, and creates an append-only receipt.

A revoked reference cannot be resolved.

## Receipts

Every insertion, replacement, resolution, use, verification, and revocation is written to `public.apex_keymaster_audit`.

The audit table is append-only. Database triggers reject updates and deletes. Receipt metadata is bounded and must not contain credentials.

## Migration completion rule

The Vercel migration is complete only when:

1. every downstream Vercel secret has a corresponding active Vault `secret_ref`;
2. each consuming adapter uses `withKeymasterSecret` or another broker-only provider adapter;
3. the adapter succeeds using the reference;
4. the use receipt is present;
5. the former Vercel variable is deleted;
6. no committed file or retained setup document contains the raw value;
7. exposed historical credentials are rotated.

Do not delete a working Vercel value before its reference-backed adapter passes a live read-only verification.
