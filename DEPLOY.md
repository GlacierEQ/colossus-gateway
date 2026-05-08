# COLOSSUS GATEWAY v2.1 — Vercel + Supabase Deploy Guide

## Step 1 — Run the Supabase Migration

1. Go to [supabase.com/dashboard](https://supabase.com/dashboard)
2. Select project `kjebemdgvjvuutzvhbtp`
3. Left sidebar → **SQL Editor** → **New Query**
4. Paste the contents of `supabase/migrations/001_apex_events.sql`
5. Click **Run**
6. Verify: you should see `apex_integration_events` and `smb_sync_log` returned

## Step 2 — Get Your Supabase Service Role Key

1. Supabase Dashboard → **Settings** → **API**
2. Copy the **service_role** key (NOT the anon key)
3. Keep this — you'll add it to Vercel in Step 4

## Step 3 — Deploy to Vercel

### Option A: Vercel CLI (fastest)
```bash
npm i -g vercel
vercel login
vercel --prod
```
When prompted:
- **Set up and deploy?** → Yes
- **Which scope?** → GlacierEQ (or your personal account)
- **Link to existing project?** → No → name it `colossus-gateway`
- **Directory?** → `./` (current directory)

### Option B: Vercel Dashboard
1. Go to [vercel.com/new](https://vercel.com/new)
2. Import → **GlacierEQ/colossus-gateway** (from GitHub)
3. Framework Preset → **Other**
4. Build Command → `npm run build`
5. Click **Deploy**

## Step 4 — Add Environment Variables

In Vercel Dashboard → Your Project → **Settings** → **Environment Variables**:

| Name | Value | Environments |
|---|---|---|
| `DROPBOX_TOKEN` | Your Dropbox OAuth2 token | Production, Preview |
| `NOTION_TOKEN` | `secret_...` from Notion Integrations | Production, Preview |
| `NOTION_DATABASE_ID` | From your Notion APEX DB URL | Production, Preview |
| `GITHUB_TOKEN` | `ghp_...` PAT with `repo` scope | Production, Preview |
| `SUPABASE_URL` | `https://kjebemdgvjvuutzvhbtp.supabase.co` | Production, Preview |
| `SUPABASE_SERVICE_ROLE_KEY` | From Step 2 | Production, Preview |
| `GATEWAY_SECRET` | Any strong random string (optional auth) | Production |

## Step 5 — Verify Live Endpoints

After deploy, your URLs will be:
```
https://colossus-gateway.vercel.app/api/health   ← should return {status:"ok"}
https://colossus-gateway.vercel.app/api/mcp      ← POST endpoint
https://colossus-gateway.vercel.app/api/voice    ← iOS Shortcut endpoint
```

Test health:
```bash
curl https://colossus-gateway.vercel.app/api/health
```

Test mcp:
```bash
curl -X POST https://colossus-gateway.vercel.app/api/mcp \
  -H "Content-Type: application/json" \
  -d '{"toolName": "apex.timeline", "payload": {"limit": 5}}'
```

## Step 6 — Wire iOS Shortcut

Update your iOS Shortcut URL from Railway to:
```
https://colossus-gateway.vercel.app/api/voice
```

## Step 7 — Update APEX Chain References

In `aspen-grove-operator-v7`, update any hardcoded Railway URLs:
```python
APEX_GATEWAY_URL = "https://colossus-gateway.vercel.app/api/mcp"
APEX_VOICE_URL   = "https://colossus-gateway.vercel.app/api/voice"
```

## Architecture After This Deploy

```
[Grok Voice / iOS Shortcut]
         ↓
[/api/voice — intent classify]
         ↓
[/api/mcp — universal.execute]
    ↙    ↓    ↘    ↘
 GitHub Notion Dropbox Supabase
                         ↓
              apex_integration_events
              (Aspen Grove forensic log)
```

---

*APEX ENGINE · Case 1FDV-23-0001009 · GlacierEQ*
