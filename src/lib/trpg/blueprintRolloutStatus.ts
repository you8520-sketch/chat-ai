import type Database from "better-sqlite3";
import { WORLD_BLUEPRINT_PREGEN_JOB_KIND } from "@/lib/derivedCache/worldBlueprintPregen";
import type { DerivedJobStatus } from "@/lib/derivedCache/jobs";
import {
  loadValidWorldBlueprintPlan,
  loadWorldBlueprintArtifactRow,
  loadWorldSnapshotForBlueprint,
} from "./worldBlueprintArtifact";

export type BlueprintArtifactState = "valid" | "missing" | "invalid_or_stale";

export type BlueprintRolloutColdWorld = {
  worldId: number;
  updatedAt: string;
  artifactState: "missing" | "invalid_or_stale";
};

export type BlueprintRolloutJobCounts = {
  pending: number;
  processing: number;
  failed: number;
  done: number;
};

export type BlueprintRolloutStatus = {
  ok: true;
  totalWorldCount: number;
  trpgEnabledWorldCount: number;
  trpgDisabledWorldCount: number;
  validArtifactCount: number;
  missingArtifactCount: number;
  invalidOrStaleArtifactCount: number;
  coldWorldCount: number;
  artifactCoveragePercent: number;
  blueprintJobs: BlueprintRolloutJobCounts;
  coldWorlds: BlueprintRolloutColdWorld[];
};

type EnabledWorldRow = {
  id: number;
  updated_at: string;
};

/** Single canonical owner: read-only TRPG Blueprint rollout snapshot aggregation. */
export function classifyWorldBlueprintArtifactState(
  db: Database.Database,
  worldId: number
): BlueprintArtifactState {
  const snapshot = loadWorldSnapshotForBlueprint(db, worldId);
  if (!snapshot) return "invalid_or_stale";

  const row = loadWorldBlueprintArtifactRow(db, worldId);
  if (!row) return "missing";

  const plan = loadValidWorldBlueprintPlan(db, worldId, snapshot);
  return plan ? "valid" : "invalid_or_stale";
}

function emptyJobCounts(): BlueprintRolloutJobCounts {
  return { pending: 0, processing: 0, failed: 0, done: 0 };
}

function loadBlueprintJobCounts(db: Database.Database): BlueprintRolloutJobCounts {
  const rows = db
    .prepare(
      `SELECT status, COUNT(*) AS count
       FROM derived_cache_jobs
       WHERE job_kind = ?
       GROUP BY status`
    )
    .all(WORLD_BLUEPRINT_PREGEN_JOB_KIND) as Array<{ status: DerivedJobStatus; count: number }>;

  const counts = emptyJobCounts();
  for (const row of rows) {
    switch (row.status) {
      case "pending":
        counts.pending = row.count;
        break;
      case "processing":
        counts.processing = row.count;
        break;
      case "failed":
        counts.failed = row.count;
        break;
      case "done":
        counts.done = row.count;
        break;
      default: {
        const unknownStatus: never = row.status;
        throw new Error(`Unexpected derived-cache job status: ${unknownStatus}`);
      }
    }
  }
  return counts;
}

function artifactCoveragePercent(validCount: number, enabledCount: number): number {
  if (enabledCount <= 0) return 0;
  return Math.round((validCount / enabledCount) * 1000) / 10;
}

/** SELECT-only rollout snapshot; reuses canonical Blueprint validity readers. */
export function computeBlueprintRolloutStatus(db: Database.Database): BlueprintRolloutStatus {
  const totalWorldCount = (
    db.prepare(`SELECT COUNT(*) AS count FROM worlds`).get() as { count: number }
  ).count;

  const trpgEnabledWorldCount = (
    db
      .prepare(`SELECT COUNT(*) AS count FROM worlds WHERE COALESCE(trpg_enabled, 0) = 1`)
      .get() as { count: number }
  ).count;

  const trpgDisabledWorldCount = (
    db
      .prepare(`SELECT COUNT(*) AS count FROM worlds WHERE COALESCE(trpg_enabled, 0) = 0`)
      .get() as { count: number }
  ).count;

  const enabledWorlds = db
    .prepare(
      `SELECT id, COALESCE(updated_at, '') AS updated_at
       FROM worlds
       WHERE COALESCE(trpg_enabled, 0) = 1
       ORDER BY id ASC`
    )
    .all() as EnabledWorldRow[];

  let validArtifactCount = 0;
  let missingArtifactCount = 0;
  let invalidOrStaleArtifactCount = 0;
  const coldWorlds: BlueprintRolloutColdWorld[] = [];

  for (const world of enabledWorlds) {
    const state = classifyWorldBlueprintArtifactState(db, world.id);
    switch (state) {
      case "valid":
        validArtifactCount += 1;
        break;
      case "missing":
        missingArtifactCount += 1;
        coldWorlds.push({
          worldId: world.id,
          updatedAt: world.updated_at,
          artifactState: "missing",
        });
        break;
      case "invalid_or_stale":
        invalidOrStaleArtifactCount += 1;
        coldWorlds.push({
          worldId: world.id,
          updatedAt: world.updated_at,
          artifactState: "invalid_or_stale",
        });
        break;
      default: {
        const unknownState: never = state;
        throw new Error(`Unexpected artifact state: ${unknownState}`);
      }
    }
  }

  const coldWorldCount = missingArtifactCount + invalidOrStaleArtifactCount;

  return {
    ok: true,
    totalWorldCount,
    trpgEnabledWorldCount,
    trpgDisabledWorldCount,
    validArtifactCount,
    missingArtifactCount,
    invalidOrStaleArtifactCount,
    coldWorldCount,
    artifactCoveragePercent: artifactCoveragePercent(validArtifactCount, trpgEnabledWorldCount),
    blueprintJobs: loadBlueprintJobCounts(db),
    coldWorlds,
  };
}
