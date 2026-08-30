import type Database from "better-sqlite3";
import { loadWorldForTrpg } from "./catalog";
import { blueprintSourceFingerprint } from "./blueprintSourceFingerprint";
import { hashWorldSnapshot } from "./scenarioDraft";
import type { TrpgWorldSnapshot } from "./campaignContext";
import {
  blueprintGenerationValidityFromRow,
  currentBlueprintGenerationValidity,
  isStoredBlueprintValidForCurrentGeneration,
  type BlueprintGenerationValidity,
} from "./blueprintValidity";
import { parseTrpgScenarioPlan, type TrpgScenarioPlan } from "./scenarioPlan";

export type WorldBlueprintArtifactRow = {
  world_id: number;
  source_fingerprint: string;
  derivation_version: number;
  generator_model: string;
  schema_version: string;
  director_plan_json: string;
  created_at: string;
  updated_at: string;
};

function tableExists(db: Database.Database, name: string): boolean {
  const row = db
    .prepare(`SELECT 1 AS ok FROM sqlite_master WHERE type='table' AND name=?`)
    .get(name) as { ok: number } | undefined;
  return Boolean(row);
}

export function loadWorldSnapshotForBlueprint(
  db: Database.Database,
  worldId: number | null
): TrpgWorldSnapshot | null {
  if (!worldId || !tableExists(db, "worlds")) return null;
  const world = loadWorldForTrpg(db, worldId);
  if (!world) return null;
  const extra = db
    .prepare(`SELECT name, COALESCE(updated_at, '') AS updated_at FROM worlds WHERE id=?`)
    .get(worldId) as { name?: string; updated_at?: string } | undefined;
  const name = extra?.name ?? "";
  const updatedAt = extra?.updated_at ?? "";
  const summary = world.summary;
  const content = world.content;
  return {
    id: world.id,
    name,
    summary,
    content,
    updatedAt,
    hash: hashWorldSnapshot({ name, summary, content, updatedAt }),
    sourceFingerprint: blueprintSourceFingerprint({ name, summary, content }),
  };
}

export function loadWorldBlueprintArtifactRow(
  db: Database.Database,
  worldId: number
): WorldBlueprintArtifactRow | null {
  return (
    (db
      .prepare(`SELECT * FROM trpg_world_blueprint_artifacts WHERE world_id=?`)
      .get(worldId) as WorldBlueprintArtifactRow | undefined) ?? null
  );
}

export function loadValidWorldBlueprintPlan(
  db: Database.Database,
  worldId: number,
  snapshot: TrpgWorldSnapshot
): TrpgScenarioPlan | null {
  const row = loadWorldBlueprintArtifactRow(db, worldId);
  if (!row) return null;
  const stored = blueprintGenerationValidityFromRow(row);
  if (!isStoredBlueprintValidForCurrentGeneration(stored, snapshot)) return null;
  return parseTrpgScenarioPlan(row.director_plan_json);
}

export function copyWorldBlueprintPlan(plan: TrpgScenarioPlan): TrpgScenarioPlan {
  return parseTrpgScenarioPlan(JSON.stringify(plan)) ?? plan;
}

export function casPublishWorldBlueprintArtifact(
  db: Database.Database,
  opts: {
    worldId: number;
    expectedSourceFingerprint: string;
    expectedDerivationVersion: number;
    plan: TrpgScenarioPlan;
  }
): boolean {
  const snapshot = loadWorldSnapshotForBlueprint(db, opts.worldId);
  if (!snapshot || snapshot.sourceFingerprint !== opts.expectedSourceFingerprint) {
    return false;
  }
  const validity = currentBlueprintGenerationValidity(snapshot);
  if (validity.derivationVersion !== opts.expectedDerivationVersion) {
    return false;
  }
  const planJson = JSON.stringify(opts.plan);
  // Atomic same-revision convergence: a valid artifact for the exact generation identity
  // (sourceFingerprint + derivationVersion + generatorModel + schemaVersion) is canonical
  // and must not be overwritten by a concurrent late writer for the same revision.
  const result = db
    .prepare(
      `INSERT INTO trpg_world_blueprint_artifacts (
          world_id, source_fingerprint, derivation_version, generator_model, schema_version,
          director_plan_json, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, datetime('now'))
        ON CONFLICT(world_id) DO UPDATE SET
          source_fingerprint = excluded.source_fingerprint,
          derivation_version = excluded.derivation_version,
          generator_model = excluded.generator_model,
          schema_version = excluded.schema_version,
          director_plan_json = excluded.director_plan_json,
          updated_at = datetime('now')
        WHERE trpg_world_blueprint_artifacts.source_fingerprint != excluded.source_fingerprint
           OR trpg_world_blueprint_artifacts.derivation_version != excluded.derivation_version
           OR trpg_world_blueprint_artifacts.generator_model != excluded.generator_model
           OR trpg_world_blueprint_artifacts.schema_version != excluded.schema_version`
    )
    .run(
      opts.worldId,
      validity.sourceFingerprint,
      validity.derivationVersion,
      validity.generatorModel,
      validity.schemaVersion,
      planJson
    );
  return result.changes > 0;
}

export function storedBlueprintValidity(row: WorldBlueprintArtifactRow): BlueprintGenerationValidity {
  return blueprintGenerationValidityFromRow(row);
}

/** Single canonical owner: remove world-scoped Blueprint artifact on world deletion. */
export function deleteWorldBlueprintArtifact(db: Database.Database, worldId: number): boolean {
  if (!tableExists(db, "trpg_world_blueprint_artifacts")) return false;
  const result = db.prepare(`DELETE FROM trpg_world_blueprint_artifacts WHERE world_id = ?`).run(worldId);
  return result.changes > 0;
}
