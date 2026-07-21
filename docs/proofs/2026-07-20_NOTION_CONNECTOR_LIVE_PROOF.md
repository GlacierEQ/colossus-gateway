# Notion Connector Handoff — Live Production Proof

Date: 2026-07-20

## Production surface

- Gateway: `https://colossus-gateway.vercel.app`
- Notion handoff: `POST /notion-handoff`
- Deployment commit: `396dc95679b610a4293b5ee457783fff1dff4520`
- Endpoint implementation commit: `458fcba1881b63575b6a8cd61060ec5924d77a2f`
- Vercel deployment: `dpl_5X8LBaXBSYtew4dGTHGPNzfa6Xzi`

## Security model

The endpoint does not accept, persist, or log Notion integration tokens. It accepts only a bounded JSON result payload produced by the approved Notion connector, verifies the exact SHA-256, and requires an atomic one-use Supabase capability bound to:

- allowed tool: `notion_handoff`
- expected payload SHA-256
- expiry
- unused nonce hash

The capability is consumed before results are returned. Reuse fails closed.

## Live result

- Request ID: `apex-notion-proof-20260720-002`
- Connector source: `notion-connected-workspace`
- Query: `APEX Deployment Assets`
- Result count: `1`
- Result page ID: `3a3b1e4f-3223-811e-94e1-f67f7b44c589`
- Result title: `APEX Deployment Assets`
- Result last edited: `2026-07-20T21:23:00.000Z`
- Verified payload SHA-256: `8aca6967dcd2f0bf5cebf646d18610d616dc2874387f655ac3e1976d8161d0bf`
- HTTP status: `200`
- Response flags: `connector=notion`, `connector_handoff=true`

## Capability proof

- Capability row ID: `5`
- Consumed at: `2026-07-21 00:18:00.774374+00`
- Replay request ID: `apex-notion-proof-20260720-002-replay`
- Replay HTTP status: `401`
- Replay response: `{"error":"unauthorized"}`

## Audit proof

Supabase recorded both lifecycle events under the exact request ID:

- started event: `3b5d8510-4251-4793-a713-187dba67f8ae`
- succeeded event: `a56466b7-275e-4590-ac65-76a19083fa2d`
- actor: `chatgpt-approved-notion-connector`
- source: `https-function-call:approved-notion-connector-handoff`
- target provider: `notion`
- target query: `APEX Deployment Assets`
- arguments SHA-256: `1fb1243f64cb5b8c28e0851437875a35a37cf622e95100bf06aa0202f21f4c55`
- succeeded result SHA-256: `bdfd84aec4dd3a8b135c3ecfa1e74963476683f1da731663b7a1af9d1f25543d`

## Credential handling

A raw Notion integration token supplied in chat was not persisted to GitHub, Vercel, Supabase rows, or the gateway audit ledger. The live connection uses the authenticated Notion connector and a one-use verified handoff instead.
