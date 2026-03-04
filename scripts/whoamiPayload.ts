export type WhoamiPayload = {
  workspaceId: string;
  keyId: string;
  keyName: string;
  prefixScopes: string[];
  allowedOps: string[];
  workspaceStatus: string;
};

export function isWhoamiPayload(value: unknown): value is WhoamiPayload {
  if (typeof value !== "object" || value === null) return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v.workspaceId === "string" &&
    typeof v.keyId === "string" &&
    typeof v.keyName === "string" &&
    Array.isArray(v.prefixScopes) &&
    v.prefixScopes.every((s) => typeof s === "string") &&
    Array.isArray(v.allowedOps) &&
    v.allowedOps.every((s) => typeof s === "string") &&
    typeof v.workspaceStatus === "string"
  );
}
