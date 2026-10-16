import fs from "node:fs";
import os from "node:os";
import path from "node:path";

export type MemoryVerificationServerRole = "baseline" | "pr";

const DEFAULT_PORTS: Record<MemoryVerificationServerRole, number> = {
  baseline: 3200,
  pr: 3100,
};

/**
 * Canonical env for local production-mode Memory / RP verification servers.
 * Keeps approved chat provider keys from the parent process but disables the
 * derived-cache translation worker and isolates DATA_DIR per role.
 */
export function resolveMemoryVerificationProdServerEnv(input: {
  role: MemoryVerificationServerRole;
  port?: number;
  dataDir?: string;
  sessionSecret?: string;
}): NodeJS.ProcessEnv {
  const dataDir =
    input.dataDir ??
    path.join(
      os.tmpdir(),
      `hav-memory-verify-${input.role}-${process.pid}-${Date.now()}`
    );
  fs.mkdirSync(dataDir, { recursive: true });

  const port = input.port ?? DEFAULT_PORTS[input.role];
  const sessionSecret =
    input.sessionSecret?.trim() ||
    process.env.SESSION_SECRET?.trim() ||
    "local-memory-verification-secret-0123456789abcdef";

  return {
    ...process.env,
    NODE_ENV: "production",
    PORT: String(port),
    DATA_DIR: dataDir,
    PLAYWRIGHT_PROD_SERVER: "1",
    DISABLE_DERIVED_CACHE_WORKER: "1",
    SESSION_SECRET: sessionSecret,
    DISABLE_PAYOUT_SCHEDULER: "1",
    DISABLE_FINANCE_SCHEDULER: "1",
    DISABLE_MAIN_RP_CACHE_TTL_AUDIT: "1",
  };
}

export function defaultMemoryVerificationPort(role: MemoryVerificationServerRole): number {
  return DEFAULT_PORTS[role];
}
