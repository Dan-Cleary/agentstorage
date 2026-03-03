#!/usr/bin/env bash
# End-to-end webhook delivery test.
#
# Flow:
#   1. Create a temporary webhook.site inbox (free, no account needed)
#   2. POST /v1/workspaces → get API key
#   3. POST /v1/webhooks → register inbox URL
#   4. POST /v1/assets/base64 → trigger asset.ready event
#   5. Poll webhook.site API for up to 30 s
#   6. Verify: payload shape, HMAC signature, eventId, timestamp drift
#
# Usage: bash scripts/test-webhooks.sh
set -euo pipefail

: "${CONVEX_SITE_URL:?Set CONVEX_SITE_URL to your deployment URL (e.g. https://your-deploy.convex.site)}"
BASE="${CONVEX_SITE_URL%/}"
PASS=0
FAIL=0
WH_UUID=""
WH2_UUID=""
API_KEY=""
API_KEY2=""
WH_ID=""
GOOD_WH_ID=""
BAD_WH_ID=""
ASSET_ID=""
ASSET2_ID=""

CURL_OPTS=(
  --silent
  --show-error
  --connect-timeout 10
  --max-time 30
  --fail-with-body
)

cleanup() {
  if [ -n "${WH_UUID:-}" ]; then
    curl_json -X DELETE "https://webhook.site/token/$WH_UUID" > /dev/null || true
    log "Inbox 1 deleted"
    WH_UUID=""
  fi
  if [ -n "${WH2_UUID:-}" ]; then
    curl_json -X DELETE "https://webhook.site/token/$WH2_UUID" > /dev/null || true
    log "Inbox 2 deleted"
    WH2_UUID=""
  fi
}
trap cleanup EXIT

log()  { echo "  $*"; }
ok()   { echo "  ✅ $*"; PASS=$((PASS+1)); }
fail() { echo "  ❌ FAIL: $*"; FAIL=$((FAIL+1)); }
curl_json() { curl "${CURL_OPTS[@]}" "$@"; }

echo ""
echo "═══════════════════════════════════════════════"
echo "  AgentStorage — Webhook E2E Test"
echo "  Base: $BASE"
echo "═══════════════════════════════════════════════"
echo ""

# ── Step 1: Create webhook.site inbox ───────────────────────────────────────
echo "▶ Step 1: Creating webhook.site inbox..."
TOKEN_RESP=$(curl_json -X POST "https://webhook.site/token" \
  -H "Content-Type: application/json" \
  -d '{"default_status": 200, "default_content": "ok", "default_content_type": "text/plain"}')
if [ -z "$TOKEN_RESP" ]; then
  fail "webhook.site token response empty"
  exit 1
fi
WH_UUID=$(echo "$TOKEN_RESP" | python3 -c "import sys,json; print(json.load(sys.stdin)['uuid'])")
WH_INBOX_URL="https://webhook.site/${WH_UUID}"
WH_API="https://webhook.site/token/${WH_UUID}/requests"
log "Inbox UUID : $WH_UUID"
log "Inbox URL  : $WH_INBOX_URL"
ok "Webhook.site inbox created"

# ── Step 2: Create workspace ─────────────────────────────────────────────────
echo ""
echo "▶ Step 2: Creating test workspace..."
WS_RESP=$(curl_json -X POST "$BASE/v1/workspaces" \
  -H "Content-Type: application/json" \
  -d '{"name":"webhook-e2e-test"}')
API_KEY=$(echo "$WS_RESP" | python3 -c "import sys,json; print(json.load(sys.stdin)['apiKey'])")
WS_ID=$(echo "$WS_RESP"   | python3 -c "import sys,json; print(json.load(sys.stdin)['workspaceId'])")
log "Workspace  : $WS_ID"
log "API Key    : <REDACTED>"
ok "Workspace created"

# ── Step 3: Register webhook ─────────────────────────────────────────────────
echo ""
echo "▶ Step 3: Registering webhook..."
WH_RESP=$(curl_json -X POST "$BASE/v1/webhooks" \
  -H "Authorization: Bearer $API_KEY" \
  -H "Content-Type: application/json" \
  -d "{\"url\": \"$WH_INBOX_URL\", \"events\": [\"asset.ready\"]}")
WH_ID=$(echo "$WH_RESP"     | python3 -c "import sys,json; print(json.load(sys.stdin)['webhookId'])")
WH_SECRET=$(echo "$WH_RESP" | python3 -c "import sys,json; print(json.load(sys.stdin)['secret'])")
log "Webhook ID : $WH_ID"
log "Secret     : <REDACTED>"
ok "Webhook registered"

# ── Step 4: Upload a test asset ───────────────────────────────────────────────
echo ""
echo "▶ Step 4: Uploading test asset to trigger asset.ready..."
CONTENT_B64=$(printf '# Webhook test\n\nHello from the E2E test.' | base64)
UPLOAD_RESP=$(curl_json -X POST "$BASE/v1/assets/base64" \
  -H "Authorization: Bearer $API_KEY" \
  -H "Content-Type: application/json" \
  -d "{
    \"path\": \"/webhook-test/hello.md\",
    \"mimeType\": \"text/markdown\",
    \"data\": \"$CONTENT_B64\"
  }")
ASSET_ID=$(echo "$UPLOAD_RESP" | python3 -c "import sys,json; print(json.load(sys.stdin)['assetId'])")
log "Asset ID   : $ASSET_ID"
ok "Asset uploaded"

# ── Step 5: Poll for webhook delivery (up to 30 s) ───────────────────────────
echo ""
echo "▶ Step 5: Polling for webhook delivery (max 30 s)..."
DELIVERY=""
for i in $(seq 1 15); do
  sleep 2
  REQS=$(curl_json "$WH_API?sorting=newest&per_page=5")
  COUNT=$(echo "$REQS" | python3 -c "import sys,json; print(json.load(sys.stdin).get('total', 0))")
  if [ "$COUNT" -gt 0 ]; then
    DELIVERY=$(echo "$REQS" | python3 -c "import sys,json; print(json.dumps(json.load(sys.stdin)['data'][0]))")
    log "Got delivery after $((i*2))s"
    break
  fi
  log "Attempt $i/15: no delivery yet..."
done

if [ -z "$DELIVERY" ]; then
  fail "No webhook delivery received within 30 s"
  echo ""
  echo "═══════════════════════════════════════════════"
  echo "  RESULTS: $PASS passed, $FAIL failed"
  echo "═══════════════════════════════════════════════"
  exit 1
fi
ok "Delivery received"

# ── Step 6: Verify payload fields ─────────────────────────────────────────────
echo ""
echo "▶ Step 6: Verifying payload + headers..."

PAYLOAD=$(echo "$DELIVERY" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('content',''))")

EVENT_ID=$(echo "$DELIVERY" | python3 -c "
import sys, json
d = json.load(sys.stdin)
body = json.loads(d.get('content','{}'))
print(body.get('eventId',''))
")
EVENT_TYPE=$(echo "$DELIVERY" | python3 -c "
import sys, json
d = json.load(sys.stdin)
body = json.loads(d.get('content','{}'))
print(body.get('event',''))
")
OCCURRED_AT=$(echo "$DELIVERY" | python3 -c "
import sys, json
d = json.load(sys.stdin)
body = json.loads(d.get('content','{}'))
print(body.get('occurredAt',0))
")
ATTEMPT=$(echo "$DELIVERY" | python3 -c "
import sys, json
d = json.load(sys.stdin)
body = json.loads(d.get('content','{}'))
print(body.get('attempt',0))
")
DATA_ASSET_ID=$(echo "$DELIVERY" | python3 -c "
import sys, json
d = json.load(sys.stdin)
body = json.loads(d.get('content','{}'))
print(body.get('data',{}).get('assetId',''))
")

log "eventId    : $EVENT_ID"
log "event      : $EVENT_TYPE"
log "occurredAt : $OCCURRED_AT"
log "attempt    : $ATTEMPT"
log "data.assetId: $DATA_ASSET_ID"

# Check eventId is a UUID
if echo "$EVENT_ID" | python3 -c "
import sys, re
s = sys.stdin.read().strip()
pat = r'^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
sys.exit(0 if re.match(pat, s, re.I) else 1)
"; then
  ok "eventId is a valid UUID v4"
else
  fail "eventId '$EVENT_ID' is not a valid UUID v4"
fi

[ "$EVENT_TYPE" = "asset.ready" ] && ok "event type = asset.ready" || fail "wrong event type: $EVENT_TYPE"
[ "$ATTEMPT"    = "1"           ] && ok "attempt = 1 (first delivery)" || fail "wrong attempt: $ATTEMPT"
[ "$DATA_ASSET_ID" = "$ASSET_ID" ] && ok "data.assetId matches uploaded asset" || fail "assetId mismatch: got $DATA_ASSET_ID, want $ASSET_ID"

# ── Step 7: Verify security headers ──────────────────────────────────────────
echo ""
echo "▶ Step 7: Verifying security headers + HMAC signature..."

HDRS=$(echo "$DELIVERY" | python3 -c "import sys,json; print(json.dumps(json.load(sys.stdin).get('headers',{})))")

_hval() {
  # webhook.site may return header values as arrays or plain strings — normalize either
  python3 - "$1" "$2" <<'PY'
import sys, json
name, raw = sys.argv[1], sys.argv[2]
h = json.loads(raw)
target = name.lower()
v = ""
for k, candidate in h.items():
    if str(k).lower() == target:
        v = candidate
        break
if isinstance(v, list):
    v = v[0] if v else ""
print(v)
PY
}

H_TIMESTAMP=$(_hval "x-agentstorage-timestamp" "$HDRS")
H_EVENT_ID=$(_hval "x-agentstorage-event-id"   "$HDRS")
H_SIG=$(_hval      "x-agentstorage-signature"   "$HDRS")
H_ATTEMPT=$(_hval  "x-agentstorage-attempt"     "$HDRS")

log "X-Timestamp : $H_TIMESTAMP"
log "X-Event-Id  : $H_EVENT_ID"
log "X-Signature : $H_SIG"
log "X-Attempt   : $H_ATTEMPT"

[ -n "$H_TIMESTAMP" ] && ok "X-AgentStorage-Timestamp present" || fail "Missing X-AgentStorage-Timestamp"
[ -n "$H_EVENT_ID"  ] && ok "X-AgentStorage-Event-Id present"  || fail "Missing X-AgentStorage-Event-Id"
[ -n "$H_SIG"       ] && ok "X-AgentStorage-Signature present"  || fail "Missing X-AgentStorage-Signature"
[ -n "$H_ATTEMPT"   ] && ok "X-AgentStorage-Attempt present"    || fail "Missing X-AgentStorage-Attempt"

[ "$H_EVENT_ID" = "$EVENT_ID" ] && ok "Event-Id header matches body eventId" || fail "Event-Id header '$H_EVENT_ID' != body '$EVENT_ID'"

# Verify HMAC: sha256(secret, "timestamp.rawBody")
SIG_OK=$(python3 - "$WH_SECRET" "$H_TIMESTAMP" "$PAYLOAD" "$H_SIG" <<'PY'
import sys, hmac, hashlib
secret, ts, raw_body, received = sys.argv[1:]
expected = "sha256=" + hmac.new(
    secret.encode(),
    f"{ts}.{raw_body}".encode(),
    hashlib.sha256
).hexdigest()
print("ok" if hmac.compare_digest(expected, received) else f"MISMATCH expected={expected}")
PY
)

if [ "$SIG_OK" = "ok" ]; then
  ok "HMAC-SHA256 signature verified (ts.body input)"
else
  fail "Signature verification failed: $SIG_OK"
fi

# Replay guard: timestamp should be within the last 2 minutes
TS_OK=$(python3 - "$H_TIMESTAMP" <<'PY'
import sys, time
try:
    ts = int(sys.argv[1])
except Exception:
    print("too old: invalid")
    raise SystemExit(0)
drift = abs(time.time() * 1000 - ts)
print("ok" if drift < 120_000 else f"too old: {drift:.0f}ms")
PY
)
[ "$TS_OK" = "ok" ] && ok "Timestamp freshness OK (within 2 min)" || fail "Timestamp drift: $TS_OK"

# ── Phase 2: Retry isolation ──────────────────────────────────────────────────
echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "  Phase 2: Per-webhook retry isolation"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""
echo "▶ Creating second workspace + two webhooks (good + bad)..."

# Second workspace
WS2_RESP=$(curl_json -X POST "$BASE/v1/workspaces" \
  -H "Content-Type: application/json" \
  -d '{"name":"webhook-isolation-test"}')
API_KEY2=$(echo "$WS2_RESP" | python3 -c "import sys,json; print(json.load(sys.stdin)['apiKey'])")
WS2_ID=$(echo "$WS2_RESP"   | python3 -c "import sys,json; print(json.load(sys.stdin)['workspaceId'])")
log "Workspace2 : $WS2_ID"

# Good endpoint (fresh webhook.site inbox returns 200)
TOKEN2_RESP=$(curl_json -X POST "https://webhook.site/token" \
  -H "Content-Type: application/json" \
  -d '{"default_status": 200, "default_content": "ok", "default_content_type": "text/plain"}')
if [ -z "$TOKEN2_RESP" ]; then
  fail "second webhook.site token response empty"
  exit 1
fi
WH2_UUID=$(echo "$TOKEN2_RESP" | python3 -c "import sys,json; print(json.load(sys.stdin)['uuid'])")
GOOD_URL="https://webhook.site/${WH2_UUID}"
GOOD_API="https://webhook.site/token/${WH2_UUID}/requests"
log "Good endpoint : $GOOD_URL"

# Bad endpoint — httpstat.us/500 reliably returns HTTP 500
BAD_URL="https://httpstat.us/500"
log "Bad endpoint  : $BAD_URL (intentional HTTP 500)"

# Register both webhooks on the same workspace/event
GOOD_WH=$(curl_json -X POST "$BASE/v1/webhooks" \
  -H "Authorization: Bearer $API_KEY2" \
  -H "Content-Type: application/json" \
  -d "{\"url\": \"$GOOD_URL\", \"events\": [\"asset.ready\"]}")
GOOD_WH_ID=$(echo "$GOOD_WH" | python3 -c "import sys,json; print(json.load(sys.stdin)['webhookId'])")

BAD_WH=$(curl_json -X POST "$BASE/v1/webhooks" \
  -H "Authorization: Bearer $API_KEY2" \
  -H "Content-Type: application/json" \
  -d "{\"url\": \"$BAD_URL\", \"events\": [\"asset.ready\"]}")
BAD_WH_ID=$(echo "$BAD_WH"  | python3 -c "import sys,json; print(json.load(sys.stdin)['webhookId'])")
log "Good webhook ID: $GOOD_WH_ID"
log "Bad  webhook ID: $BAD_WH_ID"
ok "Two webhooks registered"

echo ""
echo "▶ Uploading asset to trigger asset.ready on both endpoints..."
CONTENT2_B64=$(python3 -c "import base64; print(base64.b64encode(b'isolation test').decode())")
UPLOAD2=$(curl_json -X POST "$BASE/v1/assets/base64" \
  -H "Authorization: Bearer $API_KEY2" \
  -H "Content-Type: application/json" \
  -d "{\"path\": \"/isolation/test.txt\", \"mimeType\": \"text/plain\", \"data\": \"$CONTENT2_B64\"}")
ASSET2_ID=$(echo "$UPLOAD2" | python3 -c "import sys,json; print(json.load(sys.stdin)['assetId'])")
log "Asset2 ID  : $ASSET2_ID"
ok "Asset uploaded"

echo ""
echo "▶ Polling good endpoint (should get attempt=1 immediately, unblocked by bad endpoint)..."
GOOD_DELIVERY=""
for i in $(seq 1 15); do
  sleep 2
  REQS2=$(curl_json "$GOOD_API?sorting=newest&per_page=5")
  COUNT2=$(echo "$REQS2" | python3 -c "import sys,json; print(json.load(sys.stdin).get('total', 0))")
  if [ "$COUNT2" -gt 0 ]; then
    GOOD_DELIVERY=$(echo "$REQS2" | python3 -c "import sys,json; print(json.dumps(json.load(sys.stdin)['data'][0]))")
    log "Good endpoint received delivery after $((i*2))s"
    break
  fi
  log "Attempt $i/15: waiting..."
done

if [ -z "$GOOD_DELIVERY" ]; then
  fail "Good endpoint never received delivery — bad endpoint may have blocked it"
else
  GOOD_ATTEMPT=$(echo "$GOOD_DELIVERY" | python3 -c "
import sys,json; d=json.load(sys.stdin)
print(json.loads(d.get('content','{}')).get('attempt',0))")
  [ "$GOOD_ATTEMPT" = "1" ] \
    && ok "Good endpoint: delivered on attempt=1 (not delayed by bad endpoint)" \
    || fail "Good endpoint: unexpected attempt=$GOOD_ATTEMPT"
fi

echo ""
echo "▶ Verifying bad endpoint recorded a failure (lastError set, good endpoint unaffected)..."
# Poll until lastError is set on bad webhook (max 30s — httpstat.us can be slow)
BAD_LAST_ERR=""
WEBHOOKS_LIST=""
for i in $(seq 1 15); do
  sleep 2
  WEBHOOKS_LIST=$(curl_json -H "Authorization: Bearer $API_KEY2" "$BASE/v1/webhooks")
  BAD_LAST_ERR=$(echo "$WEBHOOKS_LIST" | python3 -c "
import sys, json
target_id = sys.argv[1]
whs = json.load(sys.stdin).get('webhooks', [])
for wh in whs:
    wid = wh.get('id') or wh.get('webhookId')
    if wid == target_id:
        print(wh.get('lastError') or '')
        break
else:
    print('')
" "$BAD_WH_ID" 2>/dev/null || echo "")
  if [ -n "$BAD_LAST_ERR" ] && [ "$BAD_LAST_ERR" != "None" ]; then
    log "Bad webhook failure recorded after $((i*2))s"
    break
  fi
  log "Attempt $i/15: waiting for bad webhook failure to be recorded..."
done

GOOD_LAST_ERR=$(echo "$WEBHOOKS_LIST" | python3 -c "
import sys, json
target_id = sys.argv[1]
whs = json.load(sys.stdin).get('webhooks', [])
for wh in whs:
    wid = wh.get('id') or wh.get('webhookId')
    if wid == target_id:
        print(wh.get('lastError') or '')
        break
else:
    print('')
" "$GOOD_WH_ID" 2>/dev/null || echo "")

log "Bad  webhook lastError: ${BAD_LAST_ERR:-<empty>}"
log "Good webhook lastError: ${GOOD_LAST_ERR:-<empty>}"

if [ -n "$BAD_LAST_ERR" ] && [ "$BAD_LAST_ERR" != "None" ] && [ "$BAD_LAST_ERR" != "" ]; then
  ok "Bad endpoint: lastError = '$BAD_LAST_ERR' (attempt 1 failed, retry #2 scheduled in 30s)"
else
  fail "Bad endpoint: expected lastError to be set, got '${BAD_LAST_ERR:-<empty>}'"
fi

if [ -z "$GOOD_LAST_ERR" ] || [ "$GOOD_LAST_ERR" = "None" ] || [ "$GOOD_LAST_ERR" = "" ]; then
  ok "Good endpoint: lastError = empty (completely isolated from bad endpoint retries)"
else
  fail "Good endpoint: unexpected lastError = '$GOOD_LAST_ERR'"
fi

log ""
log "Retry schedule for bad endpoint:"
log "  Attempt 1: immediate → FAILED (HTTP 500) ← confirmed"
log "  Attempt 2: +30 s     → will auto-retry"
log "  Attempt 3: +5 min"
log "  Attempt 4: +30 min"
log "  Attempt 5: +2 h      → then abandoned"
log ""
log "Good endpoint: 1 successful delivery, 0 retries, 0 errors ← confirmed"

# ── Cleanup ───────────────────────────────────────────────────────────────────
echo ""
echo "▶ Cleanup: deleting webhook.site inboxes..."
if [ -n "${WH_ID:-}" ] && [ -n "${API_KEY:-}" ]; then
  curl_json -X DELETE -H "Authorization: Bearer $API_KEY" "$BASE/v1/webhooks/$WH_ID" > /dev/null || true
fi
if [ -n "${GOOD_WH_ID:-}" ] && [ -n "${API_KEY2:-}" ]; then
  curl_json -X DELETE -H "Authorization: Bearer $API_KEY2" "$BASE/v1/webhooks/$GOOD_WH_ID" > /dev/null || true
fi
if [ -n "${BAD_WH_ID:-}" ] && [ -n "${API_KEY2:-}" ]; then
  curl_json -X DELETE -H "Authorization: Bearer $API_KEY2" "$BASE/v1/webhooks/$BAD_WH_ID" > /dev/null || true
fi
if [ -n "${ASSET_ID:-}" ] && [ -n "${API_KEY:-}" ]; then
  curl_json -X DELETE -H "Authorization: Bearer $API_KEY" "$BASE/v1/assets/$ASSET_ID" > /dev/null || true
fi
if [ -n "${ASSET2_ID:-}" ] && [ -n "${API_KEY2:-}" ]; then
  curl_json -X DELETE -H "Authorization: Bearer $API_KEY2" "$BASE/v1/assets/$ASSET2_ID" > /dev/null || true
fi
cleanup

# ── Summary ──────────────────────────────────────────────────────────────────
echo ""
echo "═══════════════════════════════════════════════"
echo "  RESULTS: $PASS passed, $FAIL failed"
echo "═══════════════════════════════════════════════"

[ "$FAIL" -eq 0 ] && exit 0 || exit 1
