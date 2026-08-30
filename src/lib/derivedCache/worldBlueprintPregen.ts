import type Database from "better-sqlite3";
import { enqueueDerivedCacheJob } from "@/lib/derivedCache/jobs";
import { TRPG_SANDBOX_BLUEPRINT_DERIVATION_VERSION } from "@/lib/trpg/blueprintValidity";
import {
  casPublishWorldBlueprintArtifact,
  loadWorldSnapshotForBlueprint,
} from "@/lib/trpg/worldBlueprintArtifact";
import { generateWorldSandboxBlueprint } from "@/lib/trpg/worldBlueprintGeneration";
import { isTrpgSandboxDirectorEnabled } from "@/lib/trpg/sandboxDirector";

export const WORLD_BLUEPRINT_PREGEN_JOB_KIND = "trpg_sandbox_blueprint_pregen" as const;

export function shouldEnqueueWorldBlueprintPregen(opts: {
  previousTrpgEnabled: boolean;
  nextTrpgEnabled: boolean;
  nameChanged: boolean;
  summaryChanged: boolean;
  contentChanged: boolean;
}): boolean {
  if (!isTrpgSandboxDirectorEnabled()) return false;
  if (!opts.nextTrpgEnabled) return false;
  const becomingTrpg = !opts.previousTrpgEnabled && opts.nextTrpgEnabled;
  return becomingTrpg || opts.nameChanged || opts.summaryChanged || opts.contentChanged;
}

export function enqueueWorldBlueprintPregenJob(db: Database.Database, worldId: number): boolean {
  const snapshot = loadWorldSnapshotForBlueprint(db, worldId);
  if (!snapshot) return false;
  return enqueueDerivedCacheJob(db, {
    jobKind: WORLD_BLUEPRINT_PREGEN_JOB_KIND,
    entityType: "world",
    entityId: worldId,
    sourceFingerprint: snapshot.hash,
    derivationVersion: TRPG_SANDBOX_BLUEPRINT_DERIVATION_VERSION,
  });
}

export async function refreshWorldBlueprintArtifact(
  db: Database.Database,
  worldId: number,
  expectedSourceWorldHash: string,
  expectedDerivationVersion: number
): Promise<{ ok: true } | { ok: false; error: string; retryable?: boolean }> {
  const snapshot = loadWorldSnapshotForBlueprint(db, worldId);
  if (!snapshot || snapshot.hash !== expectedSourceWorldHash) {
    return { ok: true };
  }
  if (expectedDerivationVersion !== TRPG_SANDBOX_BLUEPRINT_DERIVATION_VERSION) {
    return { ok: true };
  }

  const generated = await generateWorldSandboxBlueprint({
    worldId: snapshot.id ?? worldId,
    worldName: snapshot.name,
    worldSummary: snapshot.summary,
    worldContent: snapshot.content,
    worldUpdatedAt: snapshot.updatedAt,
    worldHash: snapshot.hash,
  });
  if (!generated.ok) {
    return {
      ok: false,
      error: generated.error,
      retryable: generated.retryable !== false,
    };
  }

  const published = casPublishWorldBlueprintArtifact(db, {
    worldId,
    expectedSourceWorldHash,
    expectedDerivationVersion,
    plan: generated.plan,
  });
  if (!published) {
    return { ok: true };
  }
  return { ok: true };
}
