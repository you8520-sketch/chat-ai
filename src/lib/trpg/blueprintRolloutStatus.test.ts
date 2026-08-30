import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import Database from "better-sqlite3";
import { ensureDerivedCacheJobsTable, enqueueDerivedCacheJob } from "@/lib/derivedCache/jobs";
import { WORLD_BLUEPRINT_PREGEN_JOB_KIND } from "@/lib/derivedCache/worldBlueprintPregen";
import {
  TRPG_SANDBOX_BLUEPRINT_DERIVATION_VERSION,
  currentBlueprintGenerationValidity,
} from "./blueprintValidity";
import { ensureTrpgTables } from "./schema";
import {
  casPublishWorldBlueprintArtifact,
  loadWorldSnapshotForBlueprint,
} from "./worldBlueprintArtifact";
import { parseTrpgScenarioPlan, TRPG_SCENARIO_PLAN_SCHEMA_VERSION } from "./scenarioPlan";
import { TRPG_SCENARIO_DRAFT_MODEL } from "./scenarioDraft";
import { computeBlueprintRolloutStatus } from "./blueprintRolloutStatus";

const playablePlan = parseTrpgScenarioPlan({
  startingSituation: "폐도시에 들어간다",
  centralConflict: "코어와 인간 세력",
  goal: "원인을 밝힌다",
  secret: "WORLDSECRET",
  endingConditions: ["코어를 봉쇄한다"],
  clues: ["통신 기록"],
  endingCandidates: ["봉쇄"],
  gmDirection: "탐험",
})!;

function memoryDb(): Database.Database {
  const db = new Database(":memory:");
  db.exec(`
    CREATE TABLE worlds (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      creator_id INTEGER NOT NULL,
      name TEXT NOT NULL,
      summary TEXT NOT NULL DEFAULT '',
      content TEXT NOT NULL DEFAULT '',
      trpg_enabled INTEGER NOT NULL DEFAULT 0,
      trpg_visibility TEXT NOT NULL DEFAULT 'private',
      genres TEXT NOT NULL DEFAULT '[]',
      cover_url TEXT NOT NULL DEFAULT '',
      shared_from_nickname TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);
  ensureTrpgTables(db);
  ensureDerivedCacheJobsTable(db);
  return db;
}

function insertWorld(
  db: Database.Database,
  opts: {
    name?: string;
    summary?: string;
    content?: string;
    trpgEnabled?: number;
    updatedAt?: string;
  } = {}
): number {
  const result = db
    .prepare(
      `INSERT INTO worlds (creator_id, name, summary, content, trpg_enabled, trpg_visibility, genres, cover_url, updated_at)
       VALUES (2, ?, ?, ?, ?, 'public', '[]', '', COALESCE(?, datetime('now')))`
    )
    .run(
      opts.name ?? "북부",
      opts.summary ?? "요약",
      opts.content ?? "본문",
      opts.trpgEnabled ?? 1,
      opts.updatedAt ?? null
    );
  return Number(result.lastInsertRowid);
}

function publishValidArtifact(db: Database.Database, worldId: number): void {
  const snapshot = loadWorldSnapshotForBlueprint(db, worldId)!;
  const ok = casPublishWorldBlueprintArtifact(db, {
    worldId,
    expectedSourceFingerprint: snapshot.sourceFingerprint,
    expectedDerivationVersion: TRPG_SANDBOX_BLUEPRINT_DERIVATION_VERSION,
    plan: playablePlan,
  });
  assert.equal(ok, true);
}

function insertStaleArtifact(db: Database.Database, worldId: number): void {
  const snapshot = loadWorldSnapshotForBlueprint(db, worldId)!;
  const validity = currentBlueprintGenerationValidity(snapshot);
  db.prepare(
    `INSERT INTO trpg_world_blueprint_artifacts (
      world_id, source_fingerprint, derivation_version, generator_model, schema_version, director_plan_json
    ) VALUES (?, ?, ?, ?, ?, ?)`
  ).run(
    worldId,
    "stale-fingerprint-not-current",
    validity.derivationVersion,
    validity.generatorModel,
    validity.schemaVersion,
    JSON.stringify(playablePlan)
  );
}

function insertMalformedArtifact(db: Database.Database, worldId: number): void {
  const snapshot = loadWorldSnapshotForBlueprint(db, worldId)!;
  const validity = currentBlueprintGenerationValidity(snapshot);
  db.prepare(
    `INSERT INTO trpg_world_blueprint_artifacts (
      world_id, source_fingerprint, derivation_version, generator_model, schema_version, director_plan_json
    ) VALUES (?, ?, ?, ?, ?, ?)`
  ).run(
    worldId,
    validity.sourceFingerprint,
    validity.derivationVersion,
    validity.generatorModel,
    validity.schemaVersion,
    "{not-valid-json"
  );
}

function dbInventory(db: Database.Database): {
  worlds: number;
  artifacts: number;
  jobs: string;
} {
  const worlds = (db.prepare(`SELECT COUNT(*) AS c FROM worlds`).get() as { c: number }).c;
  const artifacts = (
    db.prepare(`SELECT COUNT(*) AS c FROM trpg_world_blueprint_artifacts`).get() as { c: number }
  ).c;
  const jobs = (
    db
      .prepare(
        `SELECT job_kind || ':' || status || ':' || entity_id AS key
         FROM derived_cache_jobs ORDER BY id`
      )
      .all() as Array<{ key: string }>
  )
    .map((row) => row.key)
    .join("|");
  return { worlds, artifacts, jobs };
}

describe("blueprint rollout status snapshot", () => {
  it("T1 zero worlds returns reconciled empty counts", () => {
    const db = memoryDb();
    const snap = computeBlueprintRolloutStatus(db);
    assert.equal(snap.totalWorldCount, 0);
    assert.equal(snap.trpgEnabledWorldCount, 0);
    assert.equal(snap.trpgDisabledWorldCount, 0);
    assert.equal(snap.validArtifactCount, 0);
    assert.equal(snap.missingArtifactCount, 0);
    assert.equal(snap.invalidOrStaleArtifactCount, 0);
    assert.equal(snap.coldWorldCount, 0);
    assert.equal(snap.artifactCoveragePercent, 0);
    assert.deepEqual(snap.blueprintJobs, { pending: 0, processing: 0, failed: 0, done: 0 });
    assert.deepEqual(snap.coldWorlds, []);
  });

  it("T2 TRPG-enabled world with valid current artifact counts as valid", () => {
    const db = memoryDb();
    const worldId = insertWorld(db, { updatedAt: "2026-01-01 00:00:00" });
    publishValidArtifact(db, worldId);

    const snap = computeBlueprintRolloutStatus(db);
    assert.equal(snap.trpgEnabledWorldCount, 1);
    assert.equal(snap.validArtifactCount, 1);
    assert.equal(snap.missingArtifactCount, 0);
    assert.equal(snap.invalidOrStaleArtifactCount, 0);
    assert.equal(snap.coldWorldCount, 0);
    assert.equal(snap.artifactCoveragePercent, 100);
    assert.deepEqual(snap.coldWorlds, []);
  });

  it("T3 TRPG-enabled world with no artifact counts as missing cold world", () => {
    const db = memoryDb();
    const worldId = insertWorld(db, { updatedAt: "2026-02-01 12:00:00" });

    const snap = computeBlueprintRolloutStatus(db);
    assert.equal(snap.missingArtifactCount, 1);
    assert.equal(snap.coldWorldCount, 1);
    assert.deepEqual(snap.coldWorlds, [
      { worldId, updatedAt: "2026-02-01 12:00:00", artifactState: "missing" },
    ]);
  });

  it("T4 stale fingerprint artifact counts as invalid_or_stale", () => {
    const db = memoryDb();
    const worldId = insertWorld(db);
    insertStaleArtifact(db, worldId);

    const snap = computeBlueprintRolloutStatus(db);
    assert.equal(snap.invalidOrStaleArtifactCount, 1);
    assert.equal(snap.coldWorldCount, 1);
    assert.equal(snap.coldWorlds[0]?.artifactState, "invalid_or_stale");
  });

  it("T5 malformed director_plan_json counts as invalid_or_stale", () => {
    const db = memoryDb();
    const worldId = insertWorld(db);
    insertMalformedArtifact(db, worldId);

    const snap = computeBlueprintRolloutStatus(db);
    assert.equal(snap.invalidOrStaleArtifactCount, 1);
    assert.equal(snap.validArtifactCount, 0);
  });

  it("T6 mixed valid/missing/stale counts reconcile with TRPG-enabled total", () => {
    const db = memoryDb();
    const validId = insertWorld(db, { name: "valid" });
    const missingId = insertWorld(db, { name: "missing" });
    const staleId = insertWorld(db, { name: "stale" });
    insertWorld(db, { name: "disabled", trpgEnabled: 0 });

    publishValidArtifact(db, validId);
    insertStaleArtifact(db, staleId);

    const snap = computeBlueprintRolloutStatus(db);
    assert.equal(snap.totalWorldCount, 4);
    assert.equal(snap.trpgEnabledWorldCount, 3);
    assert.equal(snap.trpgDisabledWorldCount, 1);
    assert.equal(
      snap.validArtifactCount + snap.missingArtifactCount + snap.invalidOrStaleArtifactCount,
      snap.trpgEnabledWorldCount
    );
    assert.equal(snap.validArtifactCount, 1);
    assert.equal(snap.missingArtifactCount, 1);
    assert.equal(snap.invalidOrStaleArtifactCount, 1);
    assert.equal(snap.coldWorldCount, 2);
    assert.equal(snap.coldWorlds.some((row) => row.worldId === missingId), true);
    assert.equal(snap.coldWorlds.some((row) => row.worldId === staleId), true);
    assert.equal(snap.coldWorlds.some((row) => row.worldId === validId), false);
  });

  it("T7 blueprint job statuses aggregate correctly", () => {
    const db = memoryDb();
    const worldId = insertWorld(db);
    const snapshot = loadWorldSnapshotForBlueprint(db, worldId)!;

    db.prepare(
      `INSERT INTO derived_cache_jobs
        (job_kind, entity_type, entity_id, source_fingerprint, derivation_version, status)
       VALUES (?, 'world', ?, ?, ?, 'pending')`
    ).run(
      WORLD_BLUEPRINT_PREGEN_JOB_KIND,
      worldId,
      snapshot.sourceFingerprint,
      TRPG_SANDBOX_BLUEPRINT_DERIVATION_VERSION
    );
    db.prepare(
      `INSERT INTO derived_cache_jobs
        (job_kind, entity_type, entity_id, source_fingerprint, derivation_version, status)
       VALUES (?, 'world', ?, ?, ?, 'processing')`
    ).run(
      WORLD_BLUEPRINT_PREGEN_JOB_KIND,
      worldId + 100,
      "fp-processing",
      TRPG_SANDBOX_BLUEPRINT_DERIVATION_VERSION
    );
    db.prepare(
      `INSERT INTO derived_cache_jobs
        (job_kind, entity_type, entity_id, source_fingerprint, derivation_version, status)
       VALUES (?, 'world', ?, ?, ?, 'failed')`
    ).run(
      WORLD_BLUEPRINT_PREGEN_JOB_KIND,
      worldId + 200,
      "fp-failed",
      TRPG_SANDBOX_BLUEPRINT_DERIVATION_VERSION
    );
    db.prepare(
      `INSERT INTO derived_cache_jobs
        (job_kind, entity_type, entity_id, source_fingerprint, derivation_version, status)
       VALUES (?, 'world', ?, ?, ?, 'done')`
    ).run(
      WORLD_BLUEPRINT_PREGEN_JOB_KIND,
      worldId + 300,
      "fp-done",
      TRPG_SANDBOX_BLUEPRINT_DERIVATION_VERSION
    );

    const snap = computeBlueprintRolloutStatus(db);
    assert.deepEqual(snap.blueprintJobs, { pending: 1, processing: 1, failed: 1, done: 1 });
  });

  it("T8 non-blueprint derived-cache jobs are excluded from blueprintJobs", () => {
    const db = memoryDb();
    const worldId = insertWorld(db);
    enqueueDerivedCacheJob(db, {
      jobKind: "world_translate",
      entityType: "world",
      entityId: worldId,
      sourceFingerprint: "translate-fp",
      derivationVersion: 1,
    });

    const snap = computeBlueprintRolloutStatus(db);
    assert.deepEqual(snap.blueprintJobs, { pending: 0, processing: 0, failed: 0, done: 0 });
  });

  it("T9 snapshot leaves DB rows unchanged", () => {
    const db = memoryDb();
    const worldId = insertWorld(db);
    publishValidArtifact(db, worldId);
    const snapshot = loadWorldSnapshotForBlueprint(db, worldId)!;
    enqueueDerivedCacheJob(db, {
      jobKind: WORLD_BLUEPRINT_PREGEN_JOB_KIND,
      entityType: "world",
      entityId: worldId,
      sourceFingerprint: snapshot.sourceFingerprint,
      derivationVersion: TRPG_SANDBOX_BLUEPRINT_DERIVATION_VERSION,
    });

    const before = dbInventory(db);
    computeBlueprintRolloutStatus(db);
    const after = dbInventory(db);
    assert.deepEqual(after, before);
  });

  it("T10 sensitive blueprint/world fields absent from returned payload", () => {
    const db = memoryDb();
    const worldId = insertWorld(db, {
      name: "SECRET_WORLD_NAME",
      summary: "secret summary",
      content: "secret content body",
    });
    publishValidArtifact(db, worldId);

    const snap = computeBlueprintRolloutStatus(db);
    const serialized = JSON.stringify(snap);
    assert.doesNotMatch(serialized, /SECRET_WORLD_NAME/);
    assert.doesNotMatch(serialized, /secret summary/);
    assert.doesNotMatch(serialized, /secret content body/);
    assert.doesNotMatch(serialized, /director_plan_json/);
    assert.doesNotMatch(serialized, /WORLDSECRET/);
    assert.doesNotMatch(serialized, /startingSituation/);
    for (const cold of snap.coldWorlds) {
      assert.ok("worldId" in cold);
      assert.ok("updatedAt" in cold);
      assert.ok("artifactState" in cold);
      assert.equal(Object.keys(cold).length, 3);
    }
  });
});

describe("trpg blueprint rollout status admin route", () => {
  it("uses requireAdminUser and returns 403 for non-admin (source contract)", () => {
    const route = readFileSync("src/app/api/admin/trpg-blueprint-rollout-status/route.ts", "utf8");
    assert.match(route, /requireAdminUser\(\)/);
    assert.match(route, /status: 403/);
    assert.match(route, /관리자 권한이 필요합니다/);
    assert.match(route, /Cache-Control.*no-store/);
    assert.doesNotMatch(route, /FULL_DB_MIGRATION_TOKEN/);
    assert.doesNotMatch(route, /generateWorldSandboxBlueprint/);
    assert.doesNotMatch(route, /enqueueWorldBlueprintPregenJob/);
    assert.doesNotMatch(route, /POST|PUT|PATCH|DELETE/);
  });

  it("helper route contract avoids generation and mutation owners", () => {
    const helper = readFileSync("src/lib/trpg/blueprintRolloutStatus.ts", "utf8");
    assert.doesNotMatch(helper, /generateWorldSandboxBlueprint/);
    assert.doesNotMatch(helper, /enqueueWorldBlueprintPregenJob/);
    assert.doesNotMatch(helper, /kickDerivedCacheWorker/);
    assert.doesNotMatch(helper, /INSERT INTO|UPDATE |DELETE FROM/);
    assert.match(helper, /loadValidWorldBlueprintPlan/);
  });
});
