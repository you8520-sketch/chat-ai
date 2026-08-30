import type Database from "better-sqlite3";
import { enqueueDerivedCacheJobReplacingTerminal } from "@/lib/derivedCache/jobs";
import { TRPG_SANDBOX_BLUEPRINT_DERIVATION_VERSION } from "@/lib/trpg/blueprintValidity";
import { loadWorldForTrpg } from "@/lib/trpg/catalog";
import {
  casPublishWorldBlueprintArtifact,
  loadValidWorldBlueprintPlan,
  loadWorldSnapshotForBlueprint,
} from "@/lib/trpg/worldBlueprintArtifact";
import { generateWorldSandboxBlueprint } from "@/lib/trpg/worldBlueprintGeneration";
import type { TrpgAuthoringComplete } from "@/lib/trpg/scenarioDraftCall";
import { isTrpgSandboxDirectorEnabled } from "@/lib/trpg/sandboxDirector";

export const WORLD_BLUEPRINT_PREGEN_JOB_KIND = "trpg_sandbox_blueprint_pregen" as const;

export type WorldBlueprintPregenTriggerInput = {
  previousTrpgEnabled: boolean;
  nextTrpgEnabled: boolean;
  nameChanged: boolean;
  summaryChanged: boolean;
  contentChanged: boolean;
};

/** Single canonical execution-eligibility owner for queued Blueprint pregen jobs. */
export function canExecuteWorldBlueprintPregen(db: Database.Database, worldId: number): boolean {
  if (!isTrpgSandboxDirectorEnabled()) return false;
  const world = loadWorldForTrpg(db, worldId);
  if (!world) return false;
  return world.trpg_enabled === 1;
}

/** Single canonical trigger-policy owner for POST and PATCH world mutations. */
export function shouldEnqueueWorldBlueprintPregen(opts: WorldBlueprintPregenTriggerInput): boolean {
  if (!isTrpgSandboxDirectorEnabled()) return false;
  if (!opts.nextTrpgEnabled) return false;
  const becomingTrpg = !opts.previousTrpgEnabled && opts.nextTrpgEnabled;
  return becomingTrpg || opts.nameChanged || opts.summaryChanged || opts.contentChanged;
}

/** Single canonical enqueue-policy owner: validity-aware, terminal-row replacement. */
export function enqueueWorldBlueprintPregenJob(db: Database.Database, worldId: number): boolean {
  const snapshot = loadWorldSnapshotForBlueprint(db, worldId);
  if (!snapshot) return false;
  if (loadValidWorldBlueprintPlan(db, worldId, snapshot)) {
    return false;
  }
  return enqueueDerivedCacheJobReplacingTerminal(db, {
    jobKind: WORLD_BLUEPRINT_PREGEN_JOB_KIND,
    entityType: "world",
    entityId: worldId,
    sourceFingerprint: snapshot.sourceFingerprint,
    derivationVersion: TRPG_SANDBOX_BLUEPRINT_DERIVATION_VERSION,
  });
}

/**
 * Enqueue using the committed world snapshot. Call only after durable INSERT/UPDATE.
 * Trigger policy is evaluated separately via `shouldEnqueueWorldBlueprintPregen`.
 */
export function maybeEnqueueWorldBlueprintPregenAfterCommit(
  db: Database.Database,
  opts: WorldBlueprintPregenTriggerInput & { worldId: number }
): boolean {
  if (!shouldEnqueueWorldBlueprintPregen(opts)) return false;
  return enqueueWorldBlueprintPregenJob(db, opts.worldId);
}

export async function refreshWorldBlueprintArtifact(
  db: Database.Database,
  worldId: number,
  expectedSourceFingerprint: string,
  expectedDerivationVersion: number,
  deps?: { complete?: TrpgAuthoringComplete }
): Promise<{ ok: true } | { ok: false; error: string; retryable?: boolean }> {
  const snapshot = loadWorldSnapshotForBlueprint(db, worldId);
  if (!snapshot || snapshot.sourceFingerprint !== expectedSourceFingerprint) {
    return { ok: true };
  }
  if (expectedDerivationVersion !== TRPG_SANDBOX_BLUEPRINT_DERIVATION_VERSION) {
    return { ok: true };
  }

  const generated = await generateWorldSandboxBlueprint(
    {
      worldId: snapshot.id ?? worldId,
      worldName: snapshot.name,
      worldSummary: snapshot.summary,
      worldContent: snapshot.content,
      worldUpdatedAt: snapshot.updatedAt,
      worldHash: snapshot.hash,
    },
    { complete: deps?.complete }
  );
  if (!generated.ok) {
    return {
      ok: false,
      error: generated.error,
      retryable: generated.retryable,
    };
  }

  const published = casPublishWorldBlueprintArtifact(db, {
    worldId,
    expectedSourceFingerprint,
    expectedDerivationVersion,
    plan: generated.plan,
  });
  if (!published) {
    return { ok: true };
  }
  return { ok: true };
}
