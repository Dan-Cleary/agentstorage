import { homedir } from "os";
import { join } from "path";

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
