#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────
# Colossus Gateway — Vercel env setup
# Run once: bash scripts/setup-vercel-env.sh
# Requires: vercel CLI logged in, .env file present
# ─────────────────────────────────────────────────────────────
set -e

if [ ! -f .env ]; then
  echo "❌  .env not found. Copy .env.example → .env and fill in your keys."
  exit 1
fi

echo "📦  Pushing env vars to Vercel production..."

push_var() {
  local key=$1
  local val
  val=$(grep "^${key}=" .env | cut -d'=' -f2-)
  if [ -z "$val" ]; then
    echo "⚠️   Skipping $key (empty)"
    return
  fi
  echo "$val" | vercel env add "$key" production --force 2>/dev/null && echo "✅  $key" || echo "⚠️   $key (already set or error)"
}

# Memory
push_var SUPERMEMORY_API_KEY
push_var SUPERMEMORY_BASE_URL

# Supabase
push_var SUPABASE_URL
push_var SUPABASE_KEY

# Pinecone
push_var PINECONE_API_KEY
push_var PINECONE_INDEX
push_var PINECONE_ENVIRONMENT

echo ""
echo "🚀  Triggering production deploy..."
vercel --prod --yes

echo ""
echo "✅  Done. Run scripts/smoke-test-memory.sh <YOUR_VERCEL_URL> to verify."
