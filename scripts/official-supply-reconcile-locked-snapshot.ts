import "server-only";

import fs from "node:fs";
import path from "node:path";

import { getDatabasePath } from "@/lib/dataDir";
import {
  applyLockedSnapshot,
  inspectLockedSnapshot,
  isLockedSnapshotApplyAuthorized,
  WOLFGANG_V4_LOCKED_SNAPSHOT_TARGET,
} from "@/lib/officialSupply/lockedSnapshotReconcileOperator";
import { OfficialSupplyGateError } from "@/lib/officialSupply/store";

const APPLY_ENV = "OFFICIAL_LOCKED_SNAPSHOT_APPLY";
const SHA_ENV = "OFFICIAL_LOCKED_SNAPSHOT_EXPECTED_DEPLOY_SHA";
const BACKUP_ENV = "OFFICIAL_LOCKED_SNAPSHOT_BACKUP_PATH";

function resolveDbPath(env: NodeJS.ProcessEnv): string | null {
  const explicit = env.OFFICIAL_LOCKED_SNAPSHOT_DB?.trim();
  if (explicit) return explicit;
  if (env.DATA_DIR?.trim()) return getDatabasePath();
  if (fs.existsSync("/data/app.db")) return "/data/app.db";
  return null;
}

function main(): void {
  const argv = process.argv.slice(2);
  const dbPath = resolveDbPath(process.env);
  if (!dbPath || !fs.existsSync(dbPath)) {
    console.log(
      `[official-locked-snapshot] NOT_RUN: inspect needs an existing SQLite file; apply also needs ${APPLY_ENV}=1 apply`
    );
    return;
  }
  const expectedSha = process.env[SHA_ENV]?.trim() || process.env.RAILWAY_GIT_COMMIT_SHA?.trim() || "";
  const runtimeSha = process.env.RAILWAY_GIT_COMMIT_SHA?.trim() || expectedSha;
  if (!expectedSha || !runtimeSha) {
    throw new OfficialSupplyGateError(
      "locked_snapshot_sha_mismatch",
      `${SHA_ENV} or RAILWAY_GIT_COMMIT_SHA is required`
    );
  }
  if (isLockedSnapshotApplyAuthorized(argv, process.env)) {
    const backupPath = process.env[BACKUP_ENV]?.trim() || "";
    const result = applyLockedSnapshot({
      dbPath,
      expectedSha,
      runtimeSha,
      backupPath,
      argv,
      env: process.env,
    });
    console.log(JSON.stringify(result));
    return;
  }
  if (argv.includes("apply")) {
    throw new OfficialSupplyGateError(
      "locked_snapshot_apply_forbidden",
      `apply argv without ${APPLY_ENV}=1 stays inspect-only`
    );
  }
  const report = inspectLockedSnapshot({
    dbPath,
    expectedSha,
    runtimeSha,
    env: process.env,
  });
  console.log(
    JSON.stringify({
      ...report,
      draftKey: WOLFGANG_V4_LOCKED_SNAPSHOT_TARGET.draftKey,
      sourceDraftKey: WOLFGANG_V4_LOCKED_SNAPSHOT_TARGET.sourceDraftKey,
      db: path.basename(dbPath),
    })
  );
}

try {
  main();
} catch (error) {
  const code = error instanceof OfficialSupplyGateError ? error.code : "locked_snapshot_operator";
  console.error(
    "[official-locked-snapshot] STOP:",
    code,
    error instanceof Error ? error.message : String(error)
  );
  process.exit(1);
}
