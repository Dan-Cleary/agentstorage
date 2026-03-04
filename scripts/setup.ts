#!/usr/bin/env tsx

/**
 * AgentStorage Setup
 *
 * Single onboarding entrypoint for agents:
 *   1. Creates a workspace via POST /v1/workspaces
 *   2. Writes ~/.agentstorage/config.json with 0600 permissions
 *   3. Immediately verifies the connection via GET /v1/whoami
 *   4. Prints a clear summary of what's available vs. blocked
 *
 * Usage:
 *   npx tsx scripts/setup.ts --base https://your-deploy.convex.site
 *   npx tsx scripts/setup.ts --base https://your-deploy.convex.site --name my-project
 *   npx tsx scripts/setup.ts --base https://your-deploy.convex.site --force  # overwrite existing config
 *
 *   # or set the env var:
 *   AGENTSTORAGE_URL=https://your-deploy.convex.site npx tsx scripts/setup.ts
 */

import { existsSync, mkdirSync, writeFileSync, chmodSync } from "fs";
import { pathToFileURL } from "url";
import {
  CLAIM_TTL_MS,
  CONFIG_DIR,
  CONFIG_PATH,
  type AgentStorageConfig,
} from "./config.ts";
import { c, errLine, HR, label, locked, ok } from "./outputHelpers.ts";
import { isWhoamiPayload, type WhoamiPayload } from "./whoamiPayload.ts";

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

const FETCH_TIMEOUT_MS = 15_000;

function isCreateWorkspacePayload(value: unknown): value is {
  workspaceId: string;
  apiKey: string;
  claimUrl: string;
} {
  if (typeof value !== "object" || value === null) return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v.workspaceId === "string" &&
    typeof v.apiKey === "string" &&
    typeof v.claimUrl === "string"
  );
}

// ---------------------------------------------------------------------------
// Args
// ---------------------------------------------------------------------------

function parseArgs() {
  const args = process.argv.slice(2);
  const get = (flag: string) => {
    const i = args.indexOf(flag);
    if (i === -1 || i + 1 >= args.length) return undefined;
    const value = args[i + 1];
    return value.startsWith("--") ? undefined : value;
  };
  const base = get("--base") ?? process.env.AGENTSTORAGE_URL ?? process.env.CONVEX_URL;
  const name = get("--name") ?? "default";
  if (args.includes("--base") && !get("--base")) {
    throw new Error("Missing value for --base");
  }
  if (args.includes("--name") && !get("--name")) {
    throw new Error("Missing value for --name");
  }
  return {
    base,
    name,
    force: args.includes("--force"),
  };
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  const { base, name, force } = parseArgs();

  console.log("\n" + c.bold + "AgentStorage — Setup" + c.reset);
  console.log(HR + "\n");

  // Validate base URL
  if (!base) {
    console.error(
      errLine(
        "No base URL provided.\n\n" +
          "  Usage: npx tsx scripts/setup.ts --base https://your-deploy.convex.site\n" +
          "  Or set: AGENTSTORAGE_URL=https://your-deploy.convex.site",
      ),
    );
    process.exit(1);
  }

  const baseUrl = base.replace(/\/$/, "");

  // Check for existing config
  if (existsSync(CONFIG_PATH) && !force) {
    console.error(
      errLine(`Config already exists at ${CONFIG_PATH}`) +
        "\n\n" +
        c.gray +
        "  Run with --force to overwrite, or use `npm run status` to check the current workspace.\n" +
        c.reset,
    );
    process.exit(1);
  }

  // ── Step 1: Create workspace ─────────────────────────────────────────────

  process.stdout.write(
    `  ${c.gray}Calling POST /v1/workspaces ...${c.reset} `,
  );

  let createRes: Response;
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
    try {
      createRes = await fetch(`${baseUrl}/v1/workspaces`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name }),
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timer);
    }
  } catch (e) {
    console.log(c.red + "✗" + c.reset);
    if (e instanceof Error && e.name === "AbortError") {
      console.error(
        errLine(`POST /v1/workspaces timed out after ${FETCH_TIMEOUT_MS}ms.`),
      );
      process.exit(1);
    }
    console.error(
      errLine(
        `Network error — is the deployment reachable?\n  ${e instanceof Error ? e.message : String(e)}`,
      ),
    );
    process.exit(1);
  }

  if (!createRes.ok) {
    console.log(c.red + "✗" + c.reset);
    const body = await createRes.text();
    console.error(
      errLine(`POST /v1/workspaces failed (HTTP ${createRes.status})\n  ${body}`),
    );
    process.exit(1);
  }

  const createdRaw = await createRes.json();
  if (!isCreateWorkspacePayload(createdRaw)) {
    console.log(c.red + "✗" + c.reset);
    console.error(
      errLine(
        "POST /v1/workspaces returned an invalid payload (expected workspaceId, apiKey, claimUrl strings).",
      ),
    );
    process.exit(1);
  }
  const created = createdRaw;

  console.log(c.green + "✓" + c.reset);

  // ── Step 2: Write config ─────────────────────────────────────────────────

  const now = new Date();
  const config: AgentStorageConfig = {
    baseUrl,
    workspaceId: created.workspaceId,
    workspaceName: name,
    apiKey: created.apiKey,
    claimUrl: created.claimUrl,
    createdAt: now.toISOString(),
    expiresAt: new Date(now.getTime() + CLAIM_TTL_MS).toISOString(),
  };

  mkdirSync(CONFIG_DIR, { recursive: true });
  writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2) + "\n", {
    encoding: "utf-8",
    flag: "w",
    mode: 0o600,
  });
  // Ensure mode is set even if file existed (writeFileSync doesn't always apply mode on overwrite)
  chmodSync(CONFIG_PATH, 0o600);

  console.log("\n" + label("workspace", `${c.white}${name}${c.reset}`, `(${created.workspaceId})`));
  console.log(
    label(
      "api key",
      `${c.cyan}${created.apiKey.slice(0, 12)}…${c.reset}`,
      "written once — not shown again",
    ),
  );
  console.log(label("config", CONFIG_PATH, "(mode 0600)"));

  // ── Step 3: Verify with whoami ───────────────────────────────────────────

  process.stdout.write(
    `\n  ${c.gray}Running GET /v1/whoami ...${c.reset} `,
  );

  let whoami: WhoamiPayload;

  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
    const whoamiRes = await (async () => {
      try {
        return await fetch(`${baseUrl}/v1/whoami`, {
          headers: { Authorization: `Bearer ${created.apiKey}` },
          signal: controller.signal,
        });
      } finally {
        clearTimeout(timer);
      }
    })();
    if (!whoamiRes.ok) {
      throw new Error(`HTTP ${whoamiRes.status}: ${await whoamiRes.text()}`);
    }
    const payload = await whoamiRes.json();
    if (!isWhoamiPayload(payload)) {
      throw new Error(`Invalid whoami response: ${JSON.stringify(payload)}`);
    }
    whoami = payload;
    console.log(c.green + "✓" + c.reset);
  } catch (e) {
    console.log(c.red + "✗" + c.reset);
    if (e instanceof Error && e.name === "AbortError") {
      console.error(
        errLine(
          `GET /v1/whoami timed out after ${FETCH_TIMEOUT_MS}ms.\n  Credentials were saved to ${CONFIG_PATH}. Run \`npm run status\` to retry verification.`,
        ),
      );
      process.exit(1);
    }
    console.error(
      errLine(
        `whoami failed: ${e instanceof Error ? e.message : String(e)}\n  Credentials were saved to ${CONFIG_PATH}. Run \`npm run status\` to retry verification.`,
      ),
    );
    process.exit(1);
  }

  // ── Step 4: Print capability summary ────────────────────────────────────

  const workspaceStatus = whoami.workspaceStatus;
  const isUnclaimed = workspaceStatus === "unclaimed";
  const isActive = workspaceStatus === "active";
  const expiresAt = new Date(config.expiresAt);
  const daysLeft = Math.ceil((expiresAt.getTime() - Date.now()) / (1000 * 60 * 60 * 24));
  const expiryStr = expiresAt.toLocaleDateString("en-CA"); // YYYY-MM-DD
  const statusColor = isActive ? c.green : c.yellow;

  console.log("\n  " + label("connected", `${c.green}${baseUrl}${c.reset}`).trimStart());
  console.log("  " + label("status", `${statusColor}${workspaceStatus}${c.reset}`).trimStart());

  console.log("\n  " + ok("Available now"));
  console.log(c.gray + "      read · write · list · search · delete (own assets)" + c.reset);

  if (isUnclaimed) {
    console.log("\n  " + locked("Blocked until claimed"));
    console.log(c.gray + "      sign · transform · key minting" + c.reset);
    console.log(c.gray + "      limits: 50 MB / 500 assets  →  10 GB / 100k after claim" + c.reset);

    const dayLabel = daysLeft === 1 ? "day" : "days";
    console.log(
      `\n  ${c.bold}👤  Claim URL${c.reset} ${c.gray}(${daysLeft} ${dayLabel} — expires ${expiryStr}):${c.reset}`,
    );
    console.log(`  ${c.cyan}${created.claimUrl}${c.reset}`);
    console.log(`\n  ${c.gray}Share this URL with a human to activate the workspace.${c.reset}`);
  } else if (isActive) {
    console.log("\n  " + ok("Full access — workspace is active"));
  }

  console.log("\n" + HR);
  console.log(
    `  Setup complete. Run ${c.cyan}npm run status${c.reset} at any time to recheck.\n`,
  );
}

const isDirectRun =
  !!process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;

if (isDirectRun) {
  main().catch((e) => {
    console.error(errLine(String(e)));
    process.exit(1);
  });
}
