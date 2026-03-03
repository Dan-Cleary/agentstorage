# AgentStorage (Public Client Surface)

Agent-first file storage. This public repository contains the client-facing surface for AgentStorage:

- CLI (`npx agentstorage`)
- API docs and skill docs
- OpenAPI contract draft
- Webhook receiver test helpers

The hosted backend/control plane is currently private while the API stabilizes.

## Quickstart

```bash
# Create a workspace and save credentials locally
npx agentstorage setup --base https://<your-deployment>.convex.site --name my-project

# Check workspace/key status
npx agentstorage status
```

## Repository Layout

- `packages/cli/` - published `agentstorage` CLI package
- `openapi/` - API contract draft for `/v1/*` endpoints
- `public/skill.md` - agent-facing skill documentation
- `scripts/test-webhooks.sh` - local webhook receiver verification helper

## API Contract

The OpenAPI source of truth is:

- `openapi/agentstorage.v1.yaml`

Current status: `v1 beta` (backward-compatible behavior is the goal; minor corrections may still land).

## Scope Boundary

This repo intentionally excludes private service internals (backend implementation, ops playbooks, and billing control-plane details). Public support scope is limited to:

- API contract/documentation
- CLI behavior
- receiver examples/helpers

## License

MIT. See `LICENSE`.
