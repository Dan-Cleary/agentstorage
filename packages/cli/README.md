# agentstorage

Zero-install CLI for [AgentStorage](https://github.com/yourusername/agentstorage) — agent onboarding and workspace management.

## Usage

```bash
# First-time setup: creates a workspace and writes credentials to ~/.agentstorage/config.json
npx agentstorage setup --base https://your-deploy.convex.site --name my-project

# Check current workspace status
npx agentstorage status
```

## Commands

### `setup`

Creates a workspace via `POST /v1/workspaces`, writes `~/.agentstorage/config.json` with `0600` permissions, and verifies the connection via `GET /v1/whoami`.

```bash
npx agentstorage setup --base <URL> [--name <name>] [--force]

Options:
  --base    Base URL of your AgentStorage deployment (required)
            Also reads: AGENTSTORAGE_URL, then CONVEX_URL env vars
  --name    Workspace name (default: "default")
  --force   Overwrite existing config
```

### `status`

Reads `~/.agentstorage/config.json` and calls `GET /v1/whoami` to show current workspace state, remaining claim window, and available vs. blocked operations.

```bash
npx agentstorage status
```

## Config file

Credentials are written to `~/.agentstorage/config.json` with mode `0600`:

```json
{
  "baseUrl": "https://your-deploy.convex.site",
  "workspaceId": "...",
  "workspaceName": "my-project",
  "apiKey": "as_...",
  "claimUrl": "https://your-deploy.convex.site/claim/...",
  "createdAt": "2026-02-23T00:00:00.000Z",
  "expiresAt": "2026-03-02T00:00:00.000Z"
}
```

## Pre-claim vs. post-claim

New workspaces start **unclaimed** with conservative limits (50 MB / 500 assets). A human visits the `claimUrl` to claim ownership, which unlocks full limits (10 GB / 100k assets) and additional operations (`sign`, `transform`, key minting).

Unclaimed workspaces expire after **7 days** — set a reminder via `npx agentstorage status`.
