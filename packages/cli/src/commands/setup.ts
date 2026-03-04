import { existsSync, mkdirSync, writeFileSync, chmodSync } from "fs";
import {
  type AgentStorageConfig,
  CONFIG_DIR,
  CONFIG_PATH,
  CLAIM_TTL_MS,
} from "../config.js";
import { c, HR, label, ok, locked, fail } from "../output.js";

interface SetupArgs {
  base: string | undefined;
  name: string;
  force: boolean;
}

class HttpError extends Error {
  status: number;
  body: string;

  constructor(status: number, body: string) {
    super(`HTTP_ERROR:${status}`);
    this.status = status;
    this.body = body;
  }
}

class InvalidPayloadError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InvalidPayloadError";
  }
}

const FETCH_TIMEOUT_MS = 30_000;

function isTimeoutError(e: unknown): e is Error {
  return (
    e instanceof Error &&
    (e.name === "AbortError" || e.name === "TimeoutError")
  );
}

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

function isWhoamiPayload(value: unknown): value is { workspaceStatus: string } {
  if (typeof value !== "object" || value === null) return false;
  const v = value as Record<string, unknown>;
  return typeof v.workspaceStatus === "string";
}

export function parseSetupArgs(argv: string[]): SetupArgs {
  const get = (flag: string) => {
    const i = argv.indexOf(flag);
    if (i === -1 || i + 1 >= argv.length) return undefined;
    const value = argv[i + 1];
    return value.startsWith("--") ? undefined : value;
  };
  const base = get("--base") ?? process.env.AGENTSTORAGE_URL ?? process.env.CONVEX_URL;
  const name = get("--name") ?? "default";
  if (argv.includes("--base") && !get("--base")) {
    throw new Error("Missing value for --base");
  }
  if (argv.includes("--name") && !get("--name")) {
    throw new Error("Missing value for --name");
  }
  return {
    base,
    name,
    force: argv.includes("--force"),
  };
}

export async function runSetup(argv: string[]): Promise<void> {
  const { base, name, force } = parseSetupArgs(argv);

  console.log("\n" + c.bold + "AgentStorage — Setup" + c.reset);
  console.log(HR + "\n");

  if (!base) {
    console.error(
      fail(
        "No base URL provided.\n\n" +
          "  Usage: npx agentstorage setup --base https://your-deploy.convex.site\n" +
          "  Or set: AGENTSTORAGE_URL=https://your-deploy.convex.site",
      ),
    );
    process.exit(1);
  }

  const baseUrl = base.replace(/\/$/, "");

  if (existsSync(CONFIG_PATH) && !force) {
    console.error(
      fail(`Config already exists at ${CONFIG_PATH}\n\n`) +
        c.gray +
        "  Run with --force to overwrite, or run `agentstorage status` to check the current workspace.\n" +
        c.reset,
    );
    process.exit(1);
  }

  // ── Step 1: Create workspace ───────────────────────────────────────────────

  process.stdout.write(`  ${c.gray}Calling POST /v1/workspaces ...${c.reset} `);

  let created: { workspaceId: string; apiKey: string; claimUrl: string };
  try {
    const res = await fetch(`${baseUrl}/v1/workspaces`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name }),
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
    if (!res.ok) {
      throw new HttpError(res.status, await res.text());
    }
    const payload = await res.json();
    if (!isCreateWorkspacePayload(payload)) {
      throw new InvalidPayloadError(
        "POST /v1/workspaces returned an invalid payload.",
      );
    }
    created = payload;
    console.log(c.green + "✓" + c.reset);
  } catch (e) {
    console.log(c.red + "✗" + c.reset);
    if (e instanceof HttpError) {
      console.error(
        fail(
          `POST /v1/workspaces failed (HTTP ${e.status})\n  ${e.body}`,
        ),
      );
    } else if (isTimeoutError(e)) {
      console.error(
        fail(`POST /v1/workspaces timed out after ${FETCH_TIMEOUT_MS}ms.`),
      );
    } else if (e instanceof InvalidPayloadError) {
      console.error(fail(e.message));
    } else {
      console.error(
        fail(
          `Network error — is the deployment reachable?\n  ${e instanceof Error ? e.message : String(e)}`,
        ),
      );
    }
    process.exit(1);
  }

  // ── Step 2: Write config ───────────────────────────────────────────────────

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
  chmodSync(CONFIG_PATH, 0o600);

  console.log("\n" + label("workspace", `${c.white}${name}${c.reset}`, `(${created.workspaceId})`));
  console.log(label("api key", `${c.cyan}${created.apiKey.slice(0, 12)}…${c.reset}`, "written once — not shown again"));
  console.log(label("config", CONFIG_PATH, "(mode 0600)"));

  // ── Step 3: Verify with whoami ─────────────────────────────────────────────

  process.stdout.write(`\n  ${c.gray}Running GET /v1/whoami ...${c.reset} `);

  let whoami: { workspaceStatus: string };
  try {
    const res = await fetch(`${baseUrl}/v1/whoami`, {
      headers: { Authorization: `Bearer ${created.apiKey}` },
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}: ${await res.text()}`);
    const payload = await res.json();
    if (!isWhoamiPayload(payload)) {
      throw new Error(
        `Invalid whoami response: ${JSON.stringify(payload)}`,
      );
    }
    whoami = payload;
    console.log(c.green + "✓" + c.reset);
  } catch (e) {
    console.log(c.red + "✗" + c.reset);
    if (isTimeoutError(e)) {
      console.error(
        fail(
          `GET /v1/whoami timed out after ${FETCH_TIMEOUT_MS}ms.\n  Credentials were saved to ${CONFIG_PATH}. Run \`agentstorage status\` to retry verification.`,
        ),
      );
    } else {
      console.error(
        fail(
          `whoami failed: ${e instanceof Error ? e.message : String(e)}\n  Credentials were saved to ${CONFIG_PATH}. Run \`agentstorage status\` to retry verification.`,
        ),
      );
    }
    process.exit(1);
  }

  // ── Step 4: Capability summary ─────────────────────────────────────────────

  const workspaceStatus = whoami.workspaceStatus;
  const isUnclaimed = workspaceStatus === "unclaimed";
  const isActive = workspaceStatus === "active";
  const expiresAt = new Date(config.expiresAt);
  const daysLeft = Math.ceil((expiresAt.getTime() - Date.now()) / (1000 * 60 * 60 * 24));
  const expiryStr = expiresAt.toLocaleDateString("en-CA");
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
    console.log(`\n  ${c.bold}👤  Claim URL${c.reset} ${c.gray}(${daysLeft} ${dayLabel} — expires ${expiryStr}):${c.reset}`);
    console.log(`  ${c.cyan}${created.claimUrl}${c.reset}`);
    console.log(`\n  ${c.gray}Share this URL with a human to activate the workspace.${c.reset}`);
  } else if (isActive) {
    console.log("\n  " + ok("Full access — workspace is active"));
  } else {
    console.log(`\n  ${c.yellow}⚠  Workspace is ${workspaceStatus}.${c.reset}`);
    console.log(c.gray + "      Access may be restricted until it returns to active." + c.reset);
  }

  console.log("\n" + HR);
  console.log(`  Setup complete. Run ${c.cyan}agentstorage status${c.reset} at any time to recheck.\n`);
}
