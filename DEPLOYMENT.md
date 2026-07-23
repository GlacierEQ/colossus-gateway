# Colossus Gateway deployment

The gateway is designed to run behind a secret manager. Do not commit `.env`, paste keys into issues, or place credentials in MCP prompts.

## Required values

Set at least one operator credential:

- `COLOSSUS_OPERATOR_CODE` — preferred deployment secret; or
- `COLOSSUS_OPERATOR_GUID` — migration-compatible GUID; or
- `COLOSSUS_TOOL_KEY` — legacy alias, temporary only.

Set one or both memory providers:

- `MEM0_API_KEY` for compact operational memory.
- `SUPERMEMORY_API_KEY` for Case Brain / long-form source-backed memory.

For Composio, set:

- `COMPOSIO_API_KEY`.
- `COMPOSIO_ALLOWED_TOOLS` as comma-separated exact tool slugs.
- `COMPOSIO_CONNECTED_ACCOUNT_ID` or pass a connected account ID per call.

Never use `*` in either allowlist.

## Local preflight

```sh
cp .env.example .env
# fill .env through your local secret manager
npm ci
node scripts/check-config.mjs
npm run build
```

## Vercel

1. Import this repository into the intended Vercel project.
2. Add the values above under **Project Settings → Environment Variables** for Production and Preview as appropriate.
3. Deploy from the hardened branch for the first smoke test.
4. Verify `GET /health` (public) and `GET /mcp` without a bearer token (must return 401).
5. Verify `/mcp` again with the operator bearer token and call `gateway.discover`.
6. Promote only after the authenticated smoke test succeeds.

The gateway does not create connected accounts or export credentials. Create/authorize the Composio connected account in Composio, then store only its ID in the deployment environment.
