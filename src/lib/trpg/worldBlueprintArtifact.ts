import type Database from "better-sqlite3";
import { loadWorldForTrpg } from "./catalog";
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
  source_world_hash: string;
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

export function ensureWorldBlueprintArtifactsTable(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS trpg_world_blueprint_artifacts (
      world_id INTEGER PRIMARY KEY,
      source_world_hash TEXT NOT NULL,
      derivation_version INTEGER NOT NULL,
      generator_model TEXT NOT NULL,
      schema_version TEXT NOT NULL,
      director_plan_json TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_trpg_world_blueprint_artifacts_hash
      ON trpg_world_blueprint_artifacts(source_world_hash, derivation_version);
  `);
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
  return {
    id: world.id,
    name,
    summary: world.summary,
    content: world.content,
    updatedAt,
    hash: hashWorldSnapshot({
      name,
      summary: world.summary,
      content: world.content,
      updatedAt,
    }),
  };
}

export function loadWorldBlueprintArtifactRow(
  db: Database.Database,
  worldId: number
): WorldBlueprintArtifactRow | null {
  ensureWorldBlueprintArtifactsTable(db);
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
    expectedSourceWorldHash: string;
    expectedDerivationVersion: number;
    plan: TrpgScenarioPlan;
  }
): boolean {
  ensureWorldBlueprintArtifactsTable(db);
  const snapshot = loadWorldSnapshotForBlueprint(db, opts.worldId);
  if (!snapshot || snapshot.hash !== opts.expectedSourceWorldHash) {
    return false;
  }
  const validity = currentBlueprintGenerationValidity(snapshot);
  if (validity.derivationVersion !== opts.expectedDerivationVersion) {
    return false;
  }
  const planJson = JSON.stringify(opts.plan);
  const result = db
    .prepare(
      `INSERT INTO trpg_world_blueprint_artifacts (
          world_id, source_world_hash, derivation_version, generator_model, schema_version,
          director_plan_json, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, datetime('now'))
        ON CONFLICT(world_id) DO UPDATE SET
          source_world_hash = excluded.source_world_hash,
          derivation_version = excluded.derivation_version,
          generator_model = excluded.generator_model,
          schema_version = excluded.schema_version,
          director_plan_json = excluded.director_plan_json,
          updated_at = datetime('now')`
    )
    .run(
      opts.worldId,
      validity.sourceWorldHash,
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
