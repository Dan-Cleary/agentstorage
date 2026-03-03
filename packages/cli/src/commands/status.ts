import { existsSync, readFileSync } from "fs";
import { type AgentStorageConfig, CONFIG_PATH } from "../config.js";
import { c, HR, label, ok, locked, fail } from "../output.js";

const FETCH_TIMEOUT_MS = 10_000;

export async function runStatus(): Promise<void> {
  console.log("\n" + c.bold + "AgentStorage — Status" + c.reset);
  console.log(HR + "\n");

  // ── Read config ────────────────────────────────────────────────────────────

  if (!existsSync(CONFIG_PATH)) {
    console.error(
      fail(
        `No config found at ${CONFIG_PATH}\n\n` +
          "  Run setup first:\n" +
          "  npx agentstorage setup --base https://your-deploy.convex.site",
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
        fail(
          `Config at ${CONFIG_PATH} is missing required fields or has invalid types.`,
        ),
      );
      process.exit(1);
    }
    config = raw as AgentStorageConfig;
  } catch {
    console.error(fail(`Could not parse ${CONFIG_PATH} — file may be corrupted.`));
    process.exit(1);
  }

  const { baseUrl, workspaceId, workspaceName, apiKey, claimUrl, expiresAt } = config;

  console.log(label("config", CONFIG_PATH));
  console.log(label("workspace", `${c.white}${workspaceName}${c.reset}  ${c.gray}(${workspaceId})${c.reset}`));
  console.log(label("base url", `${c.cyan}${baseUrl}${c.reset}`));

  // ── GET /v1/whoami ─────────────────────────────────────────────────────────

  process.stdout.write(`\n  ${c.gray}Running GET /v1/whoami ...${c.reset} `);

  let whoami: {
    keyName: string;
    prefixScopes: string[];
    allowedOps: string[];
    workspaceStatus: string;
  };

  try {
    const res = await fetch(`${baseUrl}/v1/whoami`, {
      headers: { Authorization: `Bearer ${apiKey}` },
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });

    if (res.status === 401) {
      console.log(c.red + "✗" + c.reset);
      console.error(
        fail(
          "Key is invalid or revoked (401).\n" +
            "  The workspace may have been deleted or the key was rotated.\n" +
            "  Run `npx agentstorage setup` to start fresh.",
        ),
      );
      process.exit(1);
    }

    if (!res.ok) throw new Error(`HTTP ${res.status}: ${await res.text()}`);
    whoami = (await res.json()) as typeof whoami;
    console.log(c.green + "✓" + c.reset);
  } catch (e) {
    console.log(c.red + "✗" + c.reset);
    if (e instanceof Error && (e.name === "AbortError" || e.name === "TimeoutError")) {
      console.error(fail(`GET /v1/whoami timed out after ${FETCH_TIMEOUT_MS}ms.`));
    } else {
      console.error(fail(`whoami failed: ${e instanceof Error ? e.message : String(e)}`));
    }
    process.exit(1);
  }

  // ── Summary ────────────────────────────────────────────────────────────────

  const isActive = whoami.workspaceStatus === "active";
  const expiresDate = new Date(expiresAt);
  const msLeft = expiresDate.getTime() - Date.now();
  const daysLeft = msLeft > 0 ? Math.ceil(msLeft / (1000 * 60 * 60 * 24)) : null;
  const expiryStr = expiresDate.toLocaleDateString("en-CA");
  const statusColor = isActive ? c.green : c.yellow;

  console.log("\n  " + label("status", `${statusColor}${whoami.workspaceStatus}${c.reset}`).trimStart());
  console.log("  " + label("key name", whoami.keyName).trimStart());
  console.log("  " + label("scopes", whoami.prefixScopes.join(", ")).trimStart());
  console.log("  " + label("ops", whoami.allowedOps.join(" · ")).trimStart());

  console.log("\n  " + ok("Available now"));
  console.log(c.gray + "      read · write · list · search · delete (own assets)" + c.reset);

  if (!isActive) {
    console.log("\n  " + locked("Blocked until claimed"));
    console.log(c.gray + "      sign · transform · key minting" + c.reset);
    console.log(c.gray + "      limits: 50 MB / 500 assets  →  10 GB / 100k after claim" + c.reset);

    if (msLeft <= 0) {
      console.log(`\n  ${c.red}✗  Claim window expired ${expiryStr} — workspace will be deleted soon.${c.reset}`);
      console.log(`  ${c.gray}Run \`npx agentstorage setup\` to start fresh.${c.reset}`);
    } else {
      const dayCount = daysLeft ?? 0;
      console.log(
        `\n  ${c.bold}👤  Claim URL${c.reset} ${c.gray}(${dayCount} day${dayCount !== 1 ? "s" : ""} remaining — expires ${expiryStr}):${c.reset}`,
      );
      console.log(`  ${c.cyan}${claimUrl}${c.reset}`);
    }
  } else {
    console.log("\n  " + ok("Full access — workspace is active"));
  }

  console.log("\n" + HR + "\n");
}
