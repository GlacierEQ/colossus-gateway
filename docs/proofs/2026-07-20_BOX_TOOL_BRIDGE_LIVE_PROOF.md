# Box Tool Bridge — Live Production Proof

Date: 2026-07-20

## Production surfaces

- Gateway: `https://colossus-gateway.vercel.app`
- Function schema: `GET /functions`
- Function execution: `POST /call`
- MCP: `POST /mcp`
- Raw download: `GET /download`

## Implemented function surface

- `box_search`
- `box_get`
- `box_download`
- `box_create_folder`
- `box_create_document`
- `box_rename`
- `box_move`
- `box_upload`
- `box_spreadsheet_update`
- `knowledge_retrieve`
- `action_record`
- `audit_log`

The live `/functions` endpoint returned all twelve strict function schemas with HTTP 200.

## Approved connector handoff test

A real file was created through the approved Box connector:

- Folder ID: `401660135704`
- Folder: `APEX Tool Bridge Proof 2026-07-20`
- File ID: `2358683238188`
- File version ID: `2613236516588`
- File: `apex-tool-bridge-real-result-20260720-001.txt`
- Size: `298` bytes
- Box SHA-1: `905fd1a53cb9a3d6daa713a6d0f06acfd62f1e74`
- SHA-256: `f6ccd112e3a3132ed498be98d16a481190506ebec194281c7f12695c3279028f`

The exact bytes were relayed to the deployed HTTPS function gateway using:

```json
{
  "name": "box_get",
  "arguments": {
    "item_id": "2358683238188",
    "item_type": "file",
    "include_content": true,
    "max_bytes": 1048576,
    "connector_file_name": "apex-tool-bridge-real-result-20260720-001.txt",
    "connector_content_type": "text/plain",
    "connector_sha256": "f6ccd112e3a3132ed498be98d16a481190506ebec194281c7f12695c3279028f",
    "connector_source": "box-approved-api"
  }
}
```

The omitted `connector_content_base64` contained the exact 298 file bytes. Authorization used a one-use Supabase capability bound to `box_get` and the exact SHA-256. The capability value is not preserved in this proof.

## Live response

Request ID: `apex-box-real-proof-20260720-001`

HTTP status: `200`

```json
{
  "ok": true,
  "request_id": "apex-box-real-proof-20260720-001",
  "tool": "box_get",
  "result": {
    "item_id": "2358683238188",
    "content": {
      "file_name": "apex-tool-bridge-real-result-20260720-001.txt",
      "content_type": "text/plain",
      "size": 298,
      "sha256": "f6ccd112e3a3132ed498be98d16a481190506ebec194281c7f12695c3279028f",
      "connector_handoff": true,
      "connector_source": "box-approved-api"
    }
  },
  "audit": {
    "request_id": "apex-box-real-proof-20260720-001",
    "supabase": "recorded_publishable_rpc",
    "notion": "not_configured"
  }
}
```

The returned text contained the marker:

```text
APEX-BOX-BRIDGE-REAL-RESULT-20260720-001
```

## Capability and audit proof

Supabase capability row `3` was consumed at `2026-07-20 23:28:27.500854+00`.

Supabase recorded two immutable events for the request:

1. `started` — event `0bd48cbc-069b-424a-af4d-52146842afbf`
2. `succeeded` — event `b0081a2e-633b-4f45-b156-9483f5548d4d`

Both events bind:

- actor: `chatgpt-approved-box-connector`
- source: `https-function-call:approved-connector-handoff`
- target provider: `box`
- target item ID: `2358683238188`
- arguments SHA-256: `a77baedd999d1e890d4473981232eefe725c947f646bc1d09a5f8db908d64c5c`

The completed event result SHA-256 is:

`26d30eb0d6808e57bb6a38b5465026f8235498c7ce2632f6337771e54dba7d7f`

## Replay protection

A second call using the consumed capability returned:

```text
HTTP 401
{"error":"unauthorized"}
```

## Decision

The gateway is an active production function/MCP bridge, not a passive health service. Real approved Box connector bytes were received, hash-verified, returned by `box_get`, recorded in Supabase, and protected against replay.
