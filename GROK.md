# GROK.md — How to Wire Grok (or Any Agent) to Colossus Gateway v2.1

This document explains exactly how to call the Colossus Gateway REST endpoint from Grok or any LLM agent, with copy-pasteable JSON for every supported `toolName`.

---

## 1. Endpoint

```
POST https://<your-deployment>.vercel.app/api/mcp
Content-Type: application/json
Authorization: Bearer <GATEWAY_SECRET>   # only if GATEWAY_SECRET env is set
```

- This is a **REST endpoint**, not a stdio MCP transport.
- All calls are `POST /api/mcp` with a JSON body of shape:

```json
{ "toolName": "<tool>", "payload": { ... } }
```

- Response shape: `200 { ...result }` on success, `4xx/5xx { error, stack? }` on failure.

---

## 2. Why Grok was returning "bad call"

Grok's native MCP client speaks **JSON-RPC over stdio / SSE**, not plain REST.
Colossus Gateway exposes a **REST shim** at `/api/mcp`. To use it from Grok:

- Register the gateway as an **HTTP tool / function**, not as an MCP server.
- Provide the schema below so Grok knows the exact body to POST.
- Or run `src/index.ts` locally for true stdio MCP.

---

## 3. Tool Catalog — Copy-Paste JSON

### 3.1 `notion.search`
```json
{
  "toolName": "notion.search",
  "payload": { "query": "DH0 Master Brief", "limit": 10 }
}
```

### 3.2 `notion.append`
```json
{
  "toolName": "notion.append",
  "payload": {
    "pageId": "<notion_page_id>",
    "blocks": [
      { "type": "paragraph", "text": "New evidence row appended by Grok." }
    ]
  }
}
```

### 3.3 `dropbox.list`
```json
{
  "toolName": "dropbox.list",
  "payload": { "path": "/Evidence/DH0" }
}
```

### 3.4 `dropbox.read`
```json
{
  "toolName": "dropbox.read",
  "payload": { "path": "/Evidence/DH0/E-001.pdf" }
}
```

### 3.5 `supabase.insert`
```json
{
  "toolName": "supabase.insert",
  "payload": {
    "table": "apex_integration_events",
    "row": { "actor": "grok", "event": "hash_drop", "ref": "E-001" }
  }
}
```

### 3.6 `supabase.query`
```json
{
  "toolName": "supabase.query",
  "payload": {
    "table": "apex_integration_events",
    "filter": { "actor": "grok" },
    "limit": 50
  }
}
```

### 3.7 `hash.canonical`
```json
{
  "toolName": "hash.canonical",
  "payload": {
    "object": { "any": "json", "will": ["be", "hashed", "deterministically"] }
  }
}
```
Returns `{ "sha256": "<hex>", "canonical": "<sorted_json>" }`.

---

## 4. Grok HTTP Tool Registration (example)

```json
{
  "name": "colossus_gateway",
  "description": "Universal bridge to Notion, Dropbox, Supabase, hashing.",
  "http": {
    "method": "POST",
    "url": "https://<your-deployment>.vercel.app/api/mcp",
    "headers": {
      "Content-Type": "application/json",
      "Authorization": "Bearer ${GATEWAY_SECRET}"
    },
    "body_schema": {
      "type": "object",
      "required": ["toolName"],
      "properties": {
        "toolName": { "type": "string" },
        "payload": { "type": "object" }
      }
    }
  }
}
```

---

## 5. Smoke Test (curl)

```bash
curl -X POST https://<your-deployment>.vercel.app/api/mcp \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $GATEWAY_SECRET" \
  -d '{"toolName":"hash.canonical","payload":{"object":{"a":1,"b":2}}}'
```

Expected: `200` with `{ "sha256": "...", "canonical": "{\"a\":1,\"b\":2}" }`.

---

## 6. Errors

| Code | Meaning |
|------|---------|
| 400  | `toolName is required` or invalid payload |
| 401  | Bearer token missing / wrong |
| 405  | Wrong HTTP method (must be POST) |
| 500  | Internal — see `error` and (in dev) `stack` |

---

## 7. Notes for Agents

- Always send `toolName` exactly as listed above (case-sensitive).
- `payload` is required for all tools except trivial ones; send `{}` if unsure.
- Keep round-trips under 30s (Vercel `maxDuration`).
- For long Dropbox + Notion chains, batch via multiple sequential calls.

