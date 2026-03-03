import { homedir } from "os";
import { join } from "path";

// NOTE: This config shape is intentionally duplicated in scripts/ and
// packages/cli/src/. The scripts are standalone utilities and should not depend
// on the CLI package at runtime. If dependencies are refactored later, these
// can be consolidated into a shared module.
export interface AgentStorageConfig {
  baseUrl: string;
  workspaceId: string;
  workspaceName: string;
  apiKey: string;
  claimUrl: string;
  createdAt: string;
  expiresAt: string;
}

export const CONFIG_DIR = join(homedir(), ".agentstorage");
export const CONFIG_PATH = join(CONFIG_DIR, "config.json");
export const CLAIM_TTL_MS = 7 * 24 * 60 * 60 * 1000;
