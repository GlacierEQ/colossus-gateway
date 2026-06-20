#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────
# Memory spoke smoke test
# Usage: bash scripts/smoke-test-memory.sh https://your-gateway.vercel.app
# ─────────────────────────────────────────────────────────────
set -e

BASE=${1:-http://localhost:3000}
echo "🔍  Smoke testing memory spoke at $BASE"
echo ""

# 1. ADD
echo "── POST /api/memory/add"
ADD_RES=$(curl -s -X POST "$BASE/api/memory/add" \
  -H "Content-Type: application/json" \
  -d '{
    "containerTag": "glaciereq-session-context",
    "tags": ["apex","glaciereq","smoke-test"],
    "schema": "glaciereq.sessionContext.v1",
    "payload": { "user": "casey.barton", "pillars": ["code","data","agents","justice"], "notes": "Smoke test seed — APEX brain bootstrap." },
    "source": "perplexity"
  }')
echo "$ADD_RES" | python3 -m json.tool 2>/dev/null || echo "$ADD_RES"
MEM_ID=$(echo "$ADD_RES" | python3 -c "import sys,json; print(json.load(sys.stdin).get('id',''))" 2>/dev/null)
echo ""

# 2. SEARCH
echo "── POST /api/memory/search"
curl -s -X POST "$BASE/api/memory/search" \
  -H "Content-Type: application/json" \
  -d '{
    "containerTag": "glaciereq-session-context",
    "query": "APEX pillars bootstrap",
    "tags": ["apex","glaciereq"],
    "limit": 5
  }' | python3 -m json.tool 2>/dev/null
echo ""

# 3. DELETE (if we got an id)
if [ -n "$MEM_ID" ] && [ "$MEM_ID" != "" ]; then
  echo "── POST /api/memory/delete (id=$MEM_ID)"
  curl -s -X POST "$BASE/api/memory/delete" \
    -H "Content-Type: application/json" \
    -d "{\"id\":\"$MEM_ID\",\"containerTag\":\"glaciereq-session-context\"}" \
    | python3 -m json.tool 2>/dev/null
  echo ""
fi

echo "✅  Smoke test complete."
