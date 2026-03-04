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
import { pathToFileURL } from "url";
import { CONFIG_PATH, type AgentStorageConfig } from "./config.ts";
import { c, errLine, HR, label, locked, ok } from "./outputHelpers.ts";
import { isWhoamiPayload, type WhoamiPayload } from "./whoamiPayload.ts";

const FETCH_TIMEOUT_MS = 10_000;

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
    const raw = JSON.parse(readFileSync(CONFIG_PATH, "utf-8"));
    const isValid =
      typeof raw === "object" &&
      raw !== null &&
      typeof (raw as Record<string, unknown>).baseUrl === "string" &&
      typeof (raw as Record<string, unknown>).workspaceId === "string" &&
      typeof (raw as Record<string, unknown>).workspaceName === "string" &&
      typeof (raw as Record<string, unknown>).apiKey === "string" &&
      typeof (raw as Record<string, unknown>).claimUrl === "string" &&
      typeof (raw as Record<string, unknown>).createdAt === "string" &&
      typeof (raw as Record<string, unknown>).expiresAt === "string";
    if (!isValid) {
      console.error(
        errLine(
          `Config at ${CONFIG_PATH} is missing required fields or has invalid types.`,
        ),
      );
      process.exit(1);
    }
    config = raw as AgentStorageConfig;
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

  let whoami: WhoamiPayload;

  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
    const res = await (async () => {
      try {
        return await fetch(`${baseUrl}/v1/whoami`, {
          headers: { Authorization: `Bearer ${apiKey}` },
          signal: controller.signal,
        });
      } finally {
        clearTimeout(timer);
      }
    })();

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

    const payload = await res.json();
    if (!isWhoamiPayload(payload)) {
      throw new Error(`Invalid whoami response: ${JSON.stringify(payload)}`);
    }
    whoami = payload;
    console.log(c.green + "✓" + c.reset);
  } catch (e) {
    console.log(c.red + "✗" + c.reset);
    const credsHint = `Credentials were saved to ${CONFIG_PATH}. Run \`agentstorage status\` to retry verification.`;
    if (e instanceof Error && e.name === "AbortError") {
      console.error(
        errLine(`GET /v1/whoami timed out after ${FETCH_TIMEOUT_MS}ms.\n  ${credsHint}`),
      );
      process.exit(1);
    }
    console.error(
      errLine(`whoami failed: ${e instanceof Error ? e.message : String(e)}\n  ${credsHint}`),
    );
    process.exit(1);
  }

  // ── Capability summary ───────────────────────────────────────────────────

  const workspaceStatus = whoami.workspaceStatus;
  const isUnclaimed = workspaceStatus === "unclaimed";
  const isActive = workspaceStatus === "active";
  const expiresDate = new Date(expiresAt);
  const expiresTs = expiresDate.getTime();
  if (!Number.isFinite(expiresTs)) {
    console.error(errLine(`Config at ${CONFIG_PATH} has invalid expiresAt: ${expiresAt}`));
    process.exit(1);
  }
  const msLeft = expiresTs - Date.now();
  const daysLeft = msLeft > 0 ? Math.ceil(msLeft / (1000 * 60 * 60 * 24)) : null;
  const expiryStr = expiresDate.toLocaleDateString("en-CA");

  const statusColor = isActive ? c.green : c.yellow;
  console.log(
    "\n  " +
      label("status", `${statusColor}${workspaceStatus}${c.reset}`).trimStart(),
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

  if (isUnclaimed) {
    console.log("\n  " + locked("Blocked until claimed"));
    console.log(c.gray + "      sign · transform · key minting" + c.reset);
    console.log(c.gray + "      limits: 50 MB / 500 assets  →  10 GB / 100k after claim" + c.reset);

    if (msLeft <= 0) {
      console.log(`\n  ${c.red}✗  Claim window expired ${expiryStr} — workspace will be deleted soon.${c.reset}`);
      console.log(`  ${c.gray}Run \`npm run setup\` to start fresh.${c.reset}`);
    } else {
      const dayCount = daysLeft ?? 0;
      console.log(`\n  ${c.bold}👤  Claim URL${c.reset} ${c.gray}(${dayCount} day${dayCount !== 1 ? "s" : ""} remaining — expires ${expiryStr}):${c.reset}`);
      console.log(`  ${c.cyan}${claimUrl}${c.reset}`);
    }
  } else {
    console.log("\n  " + ok("Full access — workspace is active"));
  }

  console.log("\n" + HR + "\n");
}

const isDirectRun =
  !!process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;

if (isDirectRun) {
  main().catch((e) => {
    console.error(errLine(String(e)));
    process.exit(1);
  });
}
