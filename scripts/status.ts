#!/usr/bin/env tsx

/**
 * AgentStorage Status
 *
 * Reads ~/.agentstorage/config.json and verifies the connection:
 *   - GET /v1/whoami to confirm the key is still valid
 *   - Prints current workspace status (unclaimed / active)
 *   - Shows what's available vs. blocked and the remaining claim window
 *
 * Usage:
 *   npx tsx scripts/status.ts
 *   npm run status
 */

import { existsSync, readFileSync } from "fs";
import type { AgentStorageConfig } from "./setup.ts";
import { CONFIG_PATH } from "./setup.ts";

// ---------------------------------------------------------------------------
// Output helpers (mirrors setup.ts)
// ---------------------------------------------------------------------------

const c = {
  reset: "\x1b[0m",
  bold: "\x1b[1m",
  dim: "\x1b[2m",
  green: "\x1b[32m",
  red: "\x1b[31m",
  yellow: "\x1b[33m",
  cyan: "\x1b[36m",
  white: "\x1b[37m",
  gray: "\x1b[90m",
};

const HR = c.gray + "─".repeat(72) + c.reset;

function label(key: string, value: string) {
  const pad = "  " + key.padEnd(14);
  return `${c.gray}${pad}${c.reset}${value}`;
}

function ok(msg: string) {
  return `${c.green}✅${c.reset}  ${msg}`;
}
function locked(msg: string) {
  return `${c.yellow}🔒${c.reset}  ${msg}`;
}
function errLine(msg: string) {
  return `${c.red}✗${c.reset}  ${msg}`;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  console.log("\n" + c.bold + "AgentStorage — Status" + c.reset);
  console.log(HR + "\n");

  // ── Read config ─────────────────────────────────────────────────────────

  if (!existsSync(CONFIG_PATH)) {
    console.error(
      errLine(
        `No config found at ${CONFIG_PATH}\n\n` +
          "  Run setup first:\n" +
          "  npx tsx scripts/setup.ts --base https://your-deploy.convex.site\n" +
          "  npm run setup -- --base https://your-deploy.convex.site",
      ),
    );
    process.exit(1);
  }

  let config: AgentStorageConfig;
  try {
    config = JSON.parse(readFileSync(CONFIG_PATH, "utf-8")) as AgentStorageConfig;
  } catch {
    console.error(errLine(`Could not parse ${CONFIG_PATH} — file may be corrupted.`));
    process.exit(1);
  }

  const { baseUrl, workspaceId, workspaceName, apiKey, claimUrl, expiresAt } = config;

  console.log(label("config", CONFIG_PATH));
  console.log(label("workspace", `${c.white}${workspaceName}${c.reset}  ${c.gray}(${workspaceId})${c.reset}`));
  console.log(label("base url", `${c.cyan}${baseUrl}${c.reset}`));

  // ── GET /v1/whoami ───────────────────────────────────────────────────────

  process.stdout.write(`\n  ${c.gray}Running GET /v1/whoami ...${c.reset} `);

  let whoami: {
    workspaceId: string;
    keyId: string;
    keyName: string;
    prefixScopes: string[];
    allowedOps: string[];
    workspaceStatus: string;
  };

  try {
    const res = await fetch(`${baseUrl}/v1/whoami`, {
      headers: { Authorization: `Bearer ${apiKey}` },
    });

    if (res.status === 401) {
      console.log(c.red + "✗" + c.reset);
      console.error(
        errLine(
          "Key is invalid or revoked (401).\n" +
            "  The workspace may have been deleted or the key was rotated.\n" +
            "  Run `npm run setup` to create a new workspace.",
        ),
      );
      process.exit(1);
    }

    if (!res.ok) {
      throw new Error(`HTTP ${res.status}: ${await res.text()}`);
    }

    whoami = (await res.json()) as typeof whoami;
    console.log(c.green + "✓" + c.reset);
  } catch (e) {
    console.log(c.red + "✗" + c.reset);
    console.error(
      errLine(`whoami failed: ${e instanceof Error ? e.message : String(e)}`),
    );
    process.exit(1);
  }

  // ── Capability summary ───────────────────────────────────────────────────

  const isActive = whoami.workspaceStatus === "active";
  const expiresDate = new Date(expiresAt);
  const msLeft = expiresDate.getTime() - Date.now();
  const daysLeft = Math.ceil(msLeft / (1000 * 60 * 60 * 24));
  const expiryStr = expiresDate.toLocaleDateString("en-CA");

  const statusColor = isActive ? c.green : c.yellow;
  console.log(
    "\n  " +
      label("status", `${statusColor}${whoami.workspaceStatus}${c.reset}`).trimStart(),
  );
  console.log("  " + label("key name", whoami.keyName).trimStart());
  console.log(
    "  " + label("scopes", whoami.prefixScopes.join(", ")).trimStart(),
  );
  console.log(
    "  " + label("ops", whoami.allowedOps.join(" · ")).trimStart(),
  );

  console.log("\n  " + ok("Available now"));
  console.log(c.gray + "      read · write · list · search · delete (own assets)" + c.reset);

  if (!isActive) {
    console.log("\n  " + locked("Blocked until claimed"));
    console.log(c.gray + "      sign · transform · key minting" + c.reset);
    console.log(c.gray + "      limits: 50 MB / 500 assets  →  10 GB / 100k after claim" + c.reset);

    if (msLeft <= 0) {
      console.log(`\n  ${c.red}✗  Claim window expired ${expiryStr} — workspace will be deleted soon.${c.reset}`);
      console.log(`  ${c.gray}Run \`npm run setup\` to start fresh.${c.reset}`);
    } else {
      console.log(
        `\n  ${c.bold}👤  Claim URL${c.reset} ${c.gray}(${daysLeft} day${daysLeft !== 1 ? "s" : ""} remaining — expires ${expiryStr}):${c.reset}`,
      );
      console.log(`  ${c.cyan}${claimUrl}${c.reset}`);
    }
  } else {
    console.log("\n  " + ok("Full access — workspace is active"));
  }

  console.log("\n" + HR + "\n");
}

main().catch((e) => {
  console.error(errLine(String(e)));
  process.exit(1);
});
