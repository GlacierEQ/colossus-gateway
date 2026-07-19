# Colossus Active Tool Bridge

This is an active HTTPS function-calling and Streamable HTTP MCP gateway. It performs real Box file operations and records retrieval/action evidence through Supabase and optional Notion.

## Production endpoints

```text
GET  /functions   OpenAI-compatible function schemas
POST /call        Execute one named function
POST /mcp         Streamable HTTP MCP transport
GET  /download    Authenticated raw Box download
GET  /box/status  Connection state without secret values
```

Canonical URL:

```text
https://colossus-gateway.vercel.app
```

MCP URL:

```text
https://colossus-gateway.vercel.app/mcp
```

## Active functions

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

Spreadsheet mutation supports CSV, TSV, and XLSX. XLSX updates operate directly on Open XML parts and do not require a heavyweight workbook runtime.

## HTTPS function calling

List schemas:

```bash
curl https://colossus-gateway.vercel.app/functions
```

Execute with the gateway bearer key and either the configured Box token or a per-request approved Box OAuth token:

```bash
curl -sS https://colossus-gateway.vercel.app/call \
  -H "Authorization: Bearer $COLOSSUS_TOOL_KEY" \
  -H "X-Box-Access-Token: $BOX_ACCESS_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"name":"box_search","arguments":{"query":"motion","type":"file","ancestor_folder_id":null,"limit":10,"file_extensions":["pdf"]}}'
```

A time-limited Box download capability may be used for a bounded unauthenticated read test. That exception accepts only `box_get` or `box_download`, only HTTPS Box domains, and at most 1 MiB. The URL is redacted from audit metadata and must never be persisted.

## MCP connection

Configure an approved remote MCP client with:

```text
Server URL: https://colossus-gateway.vercel.app/mcp
Authorization: Bearer <COLOSSUS_TOOL_KEY>
```

For direct Box operations, supply `X-Box-Access-Token` on the MCP HTTPS request or configure `BOX_ACCESS_TOKEN` in the Vercel project. The Box credential is never returned by a tool.

## Retrieval and recording

`knowledge_retrieve` searches Box and Notion concurrently.

Every active operation records request ID, action/status, actor/source, bounded target metadata, argument and result SHA-256, timestamps, and redacted failure details.

The default Supabase sink is `apex_integration_events`. `AUDIT_TABLE` may select a compatible dedicated table. Completed actions may also be written to the Notion page configured by `NOTION_ACTION_PARENT_PAGE_ID`.

## Security boundaries

- Gateway bearer authentication protects normal function and MCP execution.
- Box writes require an approved direct access token.
- Delegated Box download URLs permit read-only bounded capability calls, never writes.
- Content, base64 bodies, tokens, secrets, and download URLs are hashed or redacted in audit records.
- Downloads are bounded and use `no-store` responses.
- No passive success is returned when a provider is absent; the operation reports the exact unavailable sink or credential.
