# 🧊 COLOSSUS GATEWAY v2.1

**Universal MCP Bridge — APEX Engine**  
Case `1FDV-23-0001009` · GlacierEQ · Casey Barton · May 2026

---

## What This Is

A single MCP server that bridges **GitHub · Notion · Dropbox · Supabase** into one unified `universal.execute` tool, with SHA-256 forensic hashing and Aspen Grove Supabase logging on every operation.

## Quick Deploy

```bash
git clone https://github.com/GlacierEQ/colossus-gateway
cd colossus-gateway
npm install
npm run build
npm start
```

## Required Secrets

| Variable | Source |
|---|---|
| `DROPBOX_TOKEN` | Dropbox App Console → OAuth2 token |
| `NOTION_TOKEN` | Notion Integrations → Internal Integration Secret |
| `NOTION_DATABASE_ID` | From Notion database URL |
| `GITHUB_TOKEN` | GitHub Settings → Personal Access Tokens |
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase project → Settings → API |

## Tool: `universal.execute`

| `toolName` | Action |
|---|---|
| `github.write_file` | Create/update file in any GlacierEQ repo |
| `github.list_repos` | List all accessible repos |
| `notion.create_page` | Create a Notion page |
| `notion.query_db` | Query the APEX Notion database |
| `dropbox.upload` | Upload file to Dropbox (`/APEX-Legal/...`) |
| `dropbox.list` | List folder contents |
| `apex.timeline` | Fetch full Supabase event log for case |
| `apex.ingest` | Manually ingest an event to Aspen Grove |

## MCP Config (Claude Desktop / Cursor)

```json
{
  "mcpServers": {
    "colossus-gateway": {
      "command": "node",
      "args": ["/path/to/colossus-gateway/dist/index.js"],
      "env": {
        "DROPBOX_TOKEN": "...",
        "NOTION_TOKEN": "...",
        "NOTION_DATABASE_ID": "...",
        "GITHUB_TOKEN": "...",
        "SUPABASE_SERVICE_ROLE_KEY": "..."
      }
    }
  }
}
```

## Railway Deploy

```bash
railway login
railway link  # link to your project
railway up
```

Set the 5 env vars in Railway dashboard → Variables.

---

*Part of the APEX ENGINE · Pillar II Memory Layer · Pillar V Voice Chains*
