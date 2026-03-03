# AgentStorage Skill

**version:** 3  
**api_base:** `https://<your-deployment>.convex.site`  
**description:** Agent-first file storage. Store, retrieve, sign, and transform assets. Agents create workspaces and start working immediately — humans claim to unlock the full surface area.

---

## Onboarding (recommended — one command)

**With Node ≥ 18 (npx):**
```bash
npx agentstorage setup --base https://<your-deployment>.convex.site --name my-project

# Check status at any time
npx agentstorage status
```

**Without Node (curl + jq):**
```bash
# Review the script before running: curl -fsSL https://<your-deployment>.convex.site/setup.sh
curl -fsSL https://<your-deployment>.convex.site/setup.sh | bash -s -- --name my-project
```

Both paths write credentials to `~/.agentstorage/config.json` with mode `0600` and immediately verify the connection via `GET /v1/whoami`.

Output of `npx agentstorage setup`:
```text
AgentStorage — Setup
────────────────────────────────────────────────────────────────────────────────
  workspace      my-project  (abc123)
  api key        ask_a1b2c3…  ← written to ~/.agentstorage/config.json (shown once)
  config         /Users/you/.agentstorage/config.json  (mode 0600)

  Running GET /v1/whoami ... ✓

  connected      https://your-deployment.convex.site
  status         unclaimed

✅  Available now
      read · write · list · search · delete (own assets)
🔒  Blocked until claimed
      sign · transform · key minting

👤  Claim URL (expires in 7 days):
      https://your-app.com/claim?token=clm_...&workspaceId=abc123

  Share this URL with a human to activate the workspace.
```

The config is stored at `~/.agentstorage/config.json` with `0600` permissions. The `apiKey` is written once and never printed again.

---

## Quickstart (raw HTTP — no repo required)

```bash
BASE="https://<your-deployment>.convex.site"

# 1. Create a workspace — no auth required
RESP=$(curl -s -X POST $BASE/v1/workspaces \
  -H "Content-Type: application/json" \
  -d '{"name":"my-project"}')

API_KEY=$(echo $RESP | jq -r .apiKey)
WORKSPACE_ID=$(echo $RESP | jq -r .workspaceId)
CLAIM_URL=$(echo $RESP | jq -r .claimUrl)

echo "apiKey: $API_KEY"
echo "Share with human: $CLAIM_URL"

# 2. Verify connection
curl -s $BASE/v1/whoami -H "Authorization: Bearer $API_KEY"

# 3. Upload a file (base64, ≤ 2 MB)
B64=$(base64 -i photo.jpg)
BODY=$(printf '{"path":"/projects/my-project/inputs/photo.jpg","mimeType":"image/jpeg","data":"%s"}' "$B64")
ASSET=$(curl -s -X POST $BASE/v1/assets/base64 \
  -H "Authorization: Bearer $API_KEY" \
  -H "Content-Type: application/json" \
  -d "$BODY")

ASSET_ID=$(echo $ASSET | jq -r .assetId)

# 4. List your assets
curl -s "$BASE/v1/assets?prefix=/projects/my-project/" \
  -H "Authorization: Bearer $API_KEY"

# 5. Human visits CLAIM_URL to unlock sign/transform/keys
# After claim, the same API_KEY gains full power:

# 6. Sign (post-claim) — expiring
curl -s -X POST $BASE/v1/assets/$ASSET_ID/sign \
  -H "Authorization: Bearer $API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"expiresInSeconds": 3600}'

# Or permanent (revocable via DELETE /v1/signed-links/$TOKEN)
curl -s -X POST $BASE/v1/assets/$ASSET_ID/sign \
  -H "Authorization: Bearer $API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"permanent": true}'
```

---

## Registration flow

```text
POST /v1/workspaces   →  { workspaceId, apiKey, claimUrl }
                              ↓
                    agent works immediately (pre-claim)
                              ↓
                    human visits claimUrl
                              ↓
                    POST /v1/workspaces/:id/claim  →  { status: "active" }
                              ↓
                    same apiKey now has full access
```

**The apiKey never changes.** Claiming unlocks capabilities server-side.

---

## What the apiKey can do

| Operation | Pre-claim | Post-claim |
|-----------|:---------:|:----------:|
| `GET /v1/whoami` | ✅ | ✅ |
| `GET /v1/usage` | ✅ | ✅ |
| `GET /v1/assets`, `GET /v1/search` | ✅ | ✅ |
| `POST /v1/assets` (register) | ✅ | ✅ |
| `POST /v1/assets/base64` (≤ 2 MB) | ✅ | ✅ |
| `POST /v1/assets/append` (text/log primitive) | ✅ | ✅ |
| `POST /v1/assets/:id/finalize` | ✅ | ✅ |
| `DELETE /v1/assets/:id` (own assets only) | ✅ | ✅ |
| `POST /v1/assets/:id/sign` | ❌ | ✅ |
| `DELETE /v1/signed-links/:token` | ❌ | ✅ |
| `POST /v1/assets/:id/transform` | ❌ | ✅ |
| `POST /v1/keys` | ❌ | ✅ |

---

## Plans and limits

Limits are enforced **per workspace**. All monthly counters reset on a rolling 30-day window.

| | Pre-claim (sandbox) | Free | Starter | Pro |
|---|---|---|---|---|
| **Storage** | 50 MB | 1 GB | 20 GB | 200 GB |
| **Assets** | 500 | 1,000 | 50,000 | 500,000 |
| **Egress / month** | 500 MB | 5 GB | 100 GB | 1 TB |
| **Transforms / month** | 0 | 100 | 1,000 | 10,000 |

**Pre-claim:** No sign, transform, or key minting. Workspace auto-deletes after 7 days if unclaimed.  
**Free:** Full API surface. Limits are hard-capped — no silent overages.  
**Starter / Pro:** Same API, higher limits. Upgrade via the dashboard billing page.

> **Transform counter** increments when a job is **enqueued**, not when it completes. This prevents spam. Check remaining quota with `GET /v1/usage`. ⚠️ Unclaimed workspaces are hard-deleted after 7 days. Always surface `claimUrl` to a human promptly.

---

## Endpoints

### POST /v1/workspaces
Create a workspace. No auth required.

> **Rate limit:** max 20 workspace creations per IP per 24 hours.

```bash
curl -s -X POST $BASE/v1/workspaces \
  -H "Content-Type: application/json" \
  -d '{"name": "my-project"}'
```

```json
{
  "workspaceId": "abc123",
  "apiKey": "ask_...",
  "claimUrl": "https://app.example.com/claim?token=clm_...&workspaceId=abc123",
  "note": "Store apiKey securely — it will not be shown again."
}
```

> Supports `Idempotency-Key` header for safe retries.

---

### POST /v1/workspaces/:id/claim
Attach human ownership to an unclaimed workspace.

**This is a web-only, human-driven flow. Agents do not call this endpoint.**

The intended sequence:
1. Agent creates a workspace → receives `claimUrl`
2. Agent surfaces `claimUrl` to the human (email, chat, UI)
3. Human opens `claimUrl` in a browser and signs in
4. The AgentStorage claim page calls the backend with `{ claimToken }` — **`ownerId` is derived server-side from the authenticated session, never from the request body**

```json
{ "workspaceId": "abc123", "status": "active" }
```

- `claimToken` — the token from the `claimUrl` query param; single-use, 7-day TTL. Treat it as a secret — anyone with it can initiate the claim flow.
- The endpoint requires a valid Convex auth session. Callers who are not signed in receive `401 UNAUTHORIZED`.

---

### GET /v1/whoami
Verify key identity and inspect scopes.

```bash
curl -s $BASE/v1/whoami -H "Authorization: Bearer $API_KEY"
```

```json
{
  "workspaceId": "abc123",
  "keyId": "key456",
  "keyName": "default",
  "prefixScopes": ["/"],
  "allowedOps": ["read", "write", "sign", "transform", "delete"],
  "workspaceStatus": "unclaimed"
}
```

---

### GET /v1/usage
Current usage metrics for the workspace — plan, storage, egress, and transforms with reset timestamps.

```bash
curl -s $BASE/v1/usage -H "Authorization: Bearer $API_KEY"
```

```json
{
  "plan": "free",
  "storage": {
    "usedBytes": 52428800,
    "limitBytes": 1073741824
  },
  "egress": {
    "usedBytes": 10485760,
    "limitBytes": 5368709120,
    "resetsAt": 1711929600000
  },
  "transforms": {
    "used": 12,
    "limit": 100,
    "resetsAt": 1711929600000
  }
}
```

**Reset windows:** Egress and transform counters use a rolling 30-day window anchored to first use — they do not reset on the 1st of the month. `resetsAt` is the exact Unix timestamp (ms) when the current window expires.

**Transform counter semantics:** The counter increments when a job is **enqueued**, not when it completes. Failed jobs still consume a slot. `used` reflects "transform jobs requested this window," not "successful transforms." Check this before submitting bulk jobs.

**Storage:** Cumulative; reclaimed when assets are deleted. No rolling window.

Call this proactively before large batches. Exceeding a limit returns `LIMIT_EXCEEDED` (429) with `details.limit` identifying which counter was hit.

---

### POST /v1/assets/base64
Inline upload for small files (hard cap: 2 MB). Registers + uploads + finalizes in one call.

```bash
curl -s -X POST $BASE/v1/assets/base64 \
  -H "Authorization: Bearer $API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "path": "/projects/demo/inputs/photo.jpg",
    "mimeType": "image/jpeg",
    "data": "<base64-encoded-bytes>"
  }'
```

```json
{ "assetId": "asset_..." }
```

For files > 2 MB use the three-step upload flow below.

---

### Three-step upload (large files)

**Step 1 — Register**
```bash
curl -s -X POST $BASE/v1/assets \
  -H "Authorization: Bearer $API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"path": "/projects/demo/inputs/video.mp4", "mimeType": "video/mp4"}'
# → { "assetId": "...", "upload": { "url": "...", "method": "POST" } }
```

**Step 2 — Upload bytes** (include the same Authorization header)
```bash
curl -s -X POST "<upload.url>" \
  -H "Authorization: Bearer $API_KEY" \
  -H "Content-Type: video/mp4" \
  --data-binary @video.mp4
# → { "blobId": "..." }
```

**Step 3 — Finalize**
```bash
curl -s -X POST $BASE/v1/assets/$ASSET_ID/finalize \
  -H "Authorization: Bearer $API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"storageId": "<blobId>", "sizeBytes": 10485760}'
# → { "assetId": "...", "status": "ready" }
```

> `sizeBytes` is **required** — supply the exact byte count of the uploaded file. The server uses this for storage accounting and to enforce plan limits. For Convex-native storage (dev), the server also cross-checks it against the stored blob metadata. Supports `Idempotency-Key` on `POST /v1/assets`.

---

### GET /v1/assets
List assets by path prefix with cursor pagination.

```bash
curl -s "$BASE/v1/assets?prefix=/projects/demo/&limit=20" \
  -H "Authorization: Bearer $API_KEY"
```

```json
{
  "assets": [{ "id": "...", "path": "...", "status": "ready", "sizeBytes": 204800 }],
  "nextCursor": "<string or null>",
  "isDone": true
}
```

---

### GET /v1/assets/:id
Fetch a single asset.

```bash
curl -s $BASE/v1/assets/$ASSET_ID -H "Authorization: Bearer $API_KEY"
```

```json
{
  "id": "...", "path": "...", "status": "ready",
  "mimeType": "image/jpeg", "sizeBytes": 204800,
  "downloadUrl": "https://...", "createdAt": 1708000000000
}
```

`downloadUrl` is a **direct blob URL** — unguessable, no auth required, not revocable. Use it for trusted internal systems. For public sharing with revocation capability, use `POST /v1/assets/:id/sign` instead.

---

### POST /v1/assets/:id/sign *(post-claim only)*
Issue a shareable download URL — expiring or permanent.

**Expiring (default 1 hour, max 7 days):**
```bash
curl -s -X POST $BASE/v1/assets/$ASSET_ID/sign \
  -H "Authorization: Bearer $API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"expiresInSeconds": 3600}'
```

```json
{ "signedUrl": "https://.../v1/dl/<token>", "permanent": false, "expiresAt": 1708003600000, "expiresIn": 3600 }
```

**Permanent (never expires, but revocable):**
```bash
curl -s -X POST $BASE/v1/assets/$ASSET_ID/sign \
  -H "Authorization: Bearer $API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"permanent": true}'
```

```json
{ "signedUrl": "https://.../v1/dl/<token>", "permanent": true, "expiresAt": null }
```

You can also pass `{"expiresInSeconds": null}` as an alias for `{"permanent": true}`.

Signed URLs serve the asset **inline** by default — correct `Content-Type` is set, so images/PDFs/text render in the browser and are embeddable via `<img src="...">`. Append `?download=1` to force a file-save dialog:

```text
GET /v1/dl/<token>            → inline (renders in browser, embeddable)
GET /v1/dl/<token>?download=1 → attachment (Save As dialog)
```

> **Egress metering:** All bytes served through `/v1/dl/<token>` count against your monthly egress quota. The direct `downloadUrl` from `GET /v1/assets/:id` is not metered — it bypasses the proxy and any revocation controls.

---

### DELETE /v1/signed-links/:token *(post-claim only)*
Revoke a signed link — expiring or permanent. After revocation the `/v1/dl/:token` URL returns 404.

```bash
curl -s -X DELETE $BASE/v1/signed-links/$TOKEN \
  -H "Authorization: Bearer $API_KEY"
# → { "revoked": true }
```

---

### POST /v1/assets/:id/transform *(post-claim only)*
Resize and compress an image. Runs async using **jimp** (pure JS, no native bindings). Output is registered as a new derived asset.

```bash
curl -s -X POST $BASE/v1/assets/$ASSET_ID/transform \
  -H "Authorization: Bearer $API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"maxWidth": 640, "quality": 80}'
# → { "jobId": "...", "status": "queued" }
```

Poll for completion:
```bash
curl -s $BASE/v1/transforms/$JOB_ID -H "Authorization: Bearer $API_KEY"
# → { "status": "completed", "outputAssetId": "..." }
```

`status`: `queued | running | completed | failed`

**Params:**

| Param | Default | Notes |
|-------|---------|-------|
| `maxWidth` | 1280 | Maximum output width in pixels. Images narrower than the target are never upscaled. |
| `quality` | 85 | 1–100. Controls JPEG compression. Ignored for PNG output (lossless). |

**Output format:**

| Input | Output | Notes |
|-------|--------|-------|
| JPEG | JPEG | `quality` applied |
| PNG | PNG | Lossless; `quality` ignored |
| WebP | JPEG | jimp has no WebP encoder — WebP inputs are always re-encoded as JPEG |
| Other | JPEG | Fallback |

The output path gets a width suffix before the extension: `photo.jpg` → `photo_640w.jpg`. WebP files get `.jpg`: `banner.webp` → `banner_640w.jpg`.

**Webhooks:** Fires `transform.completed` or `transform.failed` on job finish.

> **Transform quota:** The counter increments when the job is **enqueued** (not on completion). Failed jobs still consume a slot. Check `GET /v1/usage` before submitting bulk jobs.

---

### DELETE /v1/assets/:id
Delete an asset. Pre-claim: only assets created by your own key. Post-claim: any asset in scope.

```bash
curl -s -X DELETE $BASE/v1/assets/$ASSET_ID \
  -H "Authorization: Bearer $API_KEY"
# → { "deleted": true, "assetId": "..." }
```

---

### POST /v1/assets/append
Atomically append text to an existing asset (or create it if missing). Designed for memory logs, JSONL streams, and scratchpad files. Available pre-claim.

```bash
curl -s -X POST $BASE/v1/assets/append \
  -H "Authorization: Bearer $API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "path": "/projects/demo/memory/session.jsonl",
    "mimeType": "application/jsonl",
    "content": "{\"role\": \"assistant\", \"text\": \"Done.\"}",
    "separator": "\n",
    "createIfMissing": true
  }'
```

> The `content` value is a JSON string. Use `\"` to embed quotes inside it (as shown above). `"separator": "\n"` inserts a newline between the existing content and the new text.

```json
{ "assetId": "...", "bytesAppended": 42 }
```

| Field | Default | Notes |
|-------|---------|-------|
| `path` | — | Required |
| `mimeType` | — | Required. Must be `text/plain`, `text/markdown`, `application/json`, or `application/jsonl` |
| `content` | — | Required. String to append |
| `separator` | `""` | Inserted between old content and new content (e.g. `"\n"`) |
| `createIfMissing` | `true` | If `false`, returns 404 when the path does not exist |

---

### GET /v1/search
Search assets by **caption text** and/or **tag filters**.

> ⚠️ Search matches against the asset's `caption` field and structured `tags` — **not file paths or names**. Assets uploaded without a caption will not appear in text searches. Use `GET /v1/assets?prefix=...` to list assets by path.

> **Scope:** Results are filtered to paths covered by the API key's `prefixScopes`. A key scoped to `/projects/alice/` will not see assets under `/projects/bob/`.

```bash
curl -s "$BASE/v1/search?q=smiling+outdoors&background=light&limit=20" \
  -H "Authorization: Bearer $API_KEY"
```

| Param | Description |
|-------|-------------|
| `q` | Full-text search on the `caption` field (omit or leave empty to match all) |
| `glasses` | `true\|false` — filter by glasses tag |
| `smile` | `true\|false` — filter by smile tag |
| `background` | `light\|dark\|transparent` — filter by background tag |
| `limit` | Page size, max 100 |
| `cursor` | Pagination cursor |

---

### POST /v1/keys *(post-claim only)*
Mint additional scoped keys within your workspace.

> **Permission cap:** Child keys cannot exceed the minting key's own permissions. Requesting `allowedOps` or `prefixScopes` broader than the minting key's will be silently clamped to the minting key's values.

```bash
curl -s -X POST $BASE/v1/keys \
  -H "Authorization: Bearer $API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "ci-pipeline",
    "prefixScopes": ["/projects/my-project/"],
    "allowedOps": ["read", "write", "delete"]
  }'
# → { "keyId": "...", "apiKey": "ask_...", "name": "...", "prefixScopes": [...], "allowedOps": [...] }
```

Raw key shown once — store it immediately.

---

### DELETE /v1/keys/:id
Revoke a key. Takes effect immediately.

```bash
curl -s -X DELETE $BASE/v1/keys/$KEY_ID \
  -H "Authorization: Bearer $API_KEY"
# → { "revoked": true }
```

---

## Error format

All errors return JSON:

```json
{ "error": { "code": "NOT_FOUND", "message": "Asset not found" } }
```

`LIMIT_EXCEEDED` includes a `details` field so you can tell which limit was hit:

```json
{
  "error": {
    "code": "LIMIT_EXCEEDED",
    "message": "Monthly egress limit reached. Upgrade your plan to continue.",
    "details": { "limit": "egress" }
  }
}
```

`details.limit` is one of: `egress` | `transforms` | `storage` | `workspaces`

These are the values of `error.code` in the response envelope:

| `error.code` | HTTP status | When |
|------|------|------|
| `UNAUTHORIZED` | 401 | Missing or revoked API key |
| `FORBIDDEN` | 403 | Key lacks required op or prefix scope |
| `NOT_FOUND` | 404 | Resource does not exist |
| `CONFLICT` | 409 | Duplicate or already-claimed |
| `PAYLOAD_TOO_LARGE` | 413 | Base64 upload > 2 MB |
| `VALIDATION_ERROR` | 400 | Bad request body |
| `LIMIT_EXCEEDED` | 429 | Plan quota reached (check `details.limit`) |

---

## Idempotency

Pass `Idempotency-Key: <unique-string>` on `POST /v1/workspaces` and `POST /v1/assets` to safely retry. Same key + method + path within 24 hours returns the original response without re-running side effects.

---

## Safety rules

1. **Never send your apiKey to any domain other than your deployment URL.**
2. **Store the apiKey immediately** — it is shown exactly once.
3. **Treat `claimUrl` as a secret** — it contains a single-use token that grants ownership of the workspace. Share it only with the intended human via a trusted channel; do not log it.
4. **Share `claimUrl` with a human promptly** — unclaimed workspaces are hard-deleted after 7 days.
5. **Pre-claim operations are safe** — no spend endpoints (sign/transform) are accessible until a human claims.
6. **Check `GET /v1/usage` before bulk operations** — transform and egress quotas are hard-capped per plan; exceed them and you get a 429.
7. To revoke a compromised key: `DELETE /v1/keys/:id` using another key with `write` permission.
