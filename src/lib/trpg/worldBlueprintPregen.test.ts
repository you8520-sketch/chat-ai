import { buildTrpgGmStructuredWireText } from "./gmStructuredOutput";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import Database from "better-sqlite3";
import {
  TRPG_SANDBOX_BLUEPRINT_DERIVATION_VERSION,
  currentBlueprintGenerationValidity,
  isStoredBlueprintValidForCurrentGeneration,
} from "./blueprintValidity";
import { blueprintSourceFingerprint } from "./blueprintSourceFingerprint";
import { ensureTrpgTables } from "./schema";
import {
  casPublishWorldBlueprintArtifact,
  copyWorldBlueprintPlan,
  deleteWorldBlueprintArtifact,
  loadValidWorldBlueprintPlan,
  loadWorldBlueprintArtifactRow,
  loadWorldSnapshotForBlueprint,
} from "./worldBlueprintArtifact";
import { hashWorldSnapshot } from "./scenarioDraft";
import { TRPG_SCENARIO_DRAFT_MODEL } from "./scenarioDraft";
import { parseTrpgScenarioPlan, TRPG_SCENARIO_PLAN_SCHEMA_VERSION } from "./scenarioPlan";
import {
  enqueueWorldBlueprintPregenJob,
  maybeEnqueueWorldBlueprintPregenAfterCommit,
  refreshWorldBlueprintArtifact,
  shouldEnqueueWorldBlueprintPregen,
  canExecuteWorldBlueprintPregen,
  WORLD_BLUEPRINT_PREGEN_JOB_KIND,
} from "@/lib/derivedCache/worldBlueprintPregen";
import {
  claimNextDerivedCacheJob,
  completeDerivedCacheJob,
  discardDerivedCacheJob,
  enqueueDerivedCacheJob,
  enqueueDerivedCacheJobReplacingTerminal,
  ensureDerivedCacheJobsTable,
  findDerivedCacheJobByIdentity,
  maxAttemptsForDerivedJobKind,
} from "@/lib/derivedCache/jobs";
import { processDerivedCacheJob } from "@/lib/derivedCache/worker";
import { createTrpgCampaign, saveTrpgSheet, EVEN_STATS } from "./engineCreate";
import { startTrpgCampaign, type TrpgEngineDeps } from "./engineAdvance";
import { loadCampaignContext, persistCampaignContext } from "./campaignContext";
import { ensureCampaignDirectorContext } from "./sandboxDirector";
import { rowToWorldListItem } from "@/lib/worlds";
import { loadTrpgCatalog } from "./catalog";

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
    coverUrl?: string;
    genres?: string;
  } = {}
): number {
  const result = db
    .prepare(
      `INSERT INTO worlds (creator_id, name, summary, content, trpg_enabled, trpg_visibility, genres, cover_url)
       VALUES (2, ?, ?, ?, ?, 'public', ?, ?)`
    )
    .run(
      opts.name ?? "북부",
      opts.summary ?? "요약",
      opts.content ?? "본문",
      opts.trpgEnabled ?? 1,
      opts.genres ?? "[]",
      opts.coverUrl ?? ""
    );
  return Number(result.lastInsertRowid);
}

async function withSandboxDirectorEnabled<T>(enabled: boolean, fn: () => Promise<T>): Promise<T> {
  const prev = process.env.TRPG_SANDBOX_DIRECTOR_ENABLED;
  process.env.TRPG_SANDBOX_DIRECTOR_ENABLED = enabled ? "1" : "0";
  try {
    return await fn();
  } finally {
    if (prev === undefined) delete process.env.TRPG_SANDBOX_DIRECTOR_ENABLED;
    else process.env.TRPG_SANDBOX_DIRECTOR_ENABLED = prev;
  }
}

function blueprintJobCount(db: Database.Database): number {
  return (
    db
      .prepare(`SELECT COUNT(*) AS c FROM derived_cache_jobs WHERE job_kind='trpg_sandbox_blueprint_pregen'`)
      .get() as { c: number }
  ).c;
}

function blueprintJobRow(db: Database.Database): { source_fingerprint: string; id: number } | undefined {
  return db
    .prepare(
      `SELECT id, source_fingerprint FROM derived_cache_jobs WHERE job_kind='trpg_sandbox_blueprint_pregen' ORDER BY id DESC LIMIT 1`
    )
    .get() as { source_fingerprint: string; id: number } | undefined;
}

function mockBlueprintComplete(goal: string) {
  return async () => ({
    text: JSON.stringify({
      startingSituation: playablePlan.startingSituation,
      centralConflict: playablePlan.centralConflict,
      goal,
      secret: playablePlan.secret,
      endingConditions: playablePlan.endingConditions,
      clues: playablePlan.clues,
      endingCandidates: playablePlan.endingCandidates,
      gmDirection: playablePlan.gmDirection,
    }),
    latencyMs: 1,
    model: TRPG_SCENARIO_DRAFT_MODEL,
  });
}

/** Fixed-route semantic PATCH: UPDATE first, then post-commit enqueue. */
function applyPostCommitContentPatch(db: Database.Database, worldId: number, newContent: string): void {
  const before = loadWorldSnapshotForBlueprint(db, worldId)!;
  const contentChanged = newContent !== before.content;
  db.prepare(`UPDATE worlds SET content=?, updated_at=datetime('now') WHERE id=?`).run(newContent, worldId);
  maybeEnqueueWorldBlueprintPregenAfterCommit(db, {
    worldId,
    previousTrpgEnabled: true,
    nextTrpgEnabled: true,
    nameChanged: false,
    summaryChanged: false,
    contentChanged,
  });
}

/** Buggy pre-#749-correction PATCH order: enqueue before UPDATE. */
function applyPreCommitContentPatch(db: Database.Database, worldId: number, newContent: string): void {
  const before = loadWorldSnapshotForBlueprint(db, worldId)!;
  const contentChanged = newContent !== before.content;
  maybeEnqueueWorldBlueprintPregenAfterCommit(db, {
    worldId,
    previousTrpgEnabled: true,
    nextTrpgEnabled: true,
    nameChanged: false,
    summaryChanged: false,
    contentChanged,
  });
  db.prepare(`UPDATE worlds SET content=?, updated_at=datetime('now') WHERE id=?`).run(newContent, worldId);
}

/** Production-equivalent world DELETE cleanup owner. */
function deleteWorldLikeRoute(db: Database.Database, worldId: number, creatorId: number): boolean {
  const deleted = db.prepare("DELETE FROM worlds WHERE id = ? AND creator_id = ?").run(worldId, creatorId);
  if (deleted.changes > 0) {
    deleteWorldBlueprintArtifact(db, worldId);
    return true;
  }
  return false;
}

type JobIdentity = {
  jobKind: typeof WORLD_BLUEPRINT_PREGEN_JOB_KIND;
  entityType: "world";
  entityId: number;
  sourceFingerprint: string;
  derivationVersion: number;
  jobFlags?: string;
};

function sampleJobIdentity(db: Database.Database, worldId: number): JobIdentity {
  const snap = loadWorldSnapshotForBlueprint(db, worldId)!;
  return {
    jobKind: WORLD_BLUEPRINT_PREGEN_JOB_KIND,
    entityType: "world",
    entityId: worldId,
    sourceFingerprint: snap.sourceFingerprint,
    derivationVersion: TRPG_SANDBOX_BLUEPRINT_DERIVATION_VERSION,
  };
}

function insertTerminalJob(
  db: Database.Database,
  identity: JobIdentity,
  status: "done" | "failed",
  opts: { attempts?: number; jobFlags?: string } = {}
): number {
  const result = db
    .prepare(
      `INSERT INTO derived_cache_jobs
        (job_kind, entity_type, entity_id, source_fingerprint, derivation_version, job_flags, status, attempts, last_error)
       VALUES (?, 'world', ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      identity.jobKind,
      identity.entityId,
      identity.sourceFingerprint,
      identity.derivationVersion,
      opts.jobFlags ?? "",
      status,
      opts.attempts ?? 1,
      status === "failed" ? "transport timeout" : ""
    );
  return Number(result.lastInsertRowid);
}

function pendingJobsForIdentity(db: Database.Database, identity: JobIdentity): number {
  return (
    db
      .prepare(
        `SELECT COUNT(*) AS c FROM derived_cache_jobs
         WHERE job_kind=? AND entity_type='world' AND entity_id=?
           AND source_fingerprint=? AND derivation_version=? AND status='pending'`
      )
      .get(
        identity.jobKind,
        identity.entityId,
        identity.sourceFingerprint,
        identity.derivationVersion
      ) as { c: number }
  ).c;
}

function openSharedQueueDb(dbPath: string): Database.Database {
  const db = new Database(dbPath);
  db.exec(`
    CREATE TABLE IF NOT EXISTS worlds (
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

describe("world Blueprint pregeneration corrections", () => {
  it("T15 — table DDL has exactly one canonical owner", () => {
    const schema = readFileSync("src/lib/trpg/schema.ts", "utf8");
    const artifact = readFileSync("src/lib/trpg/worldBlueprintArtifact.ts", "utf8");
    const ddlMatches = schema.match(/CREATE TABLE IF NOT EXISTS trpg_world_blueprint_artifacts/g) ?? [];
    assert.equal(ddlMatches.length, 1);
    assert.doesNotMatch(artifact, /CREATE TABLE IF NOT EXISTS trpg_world_blueprint_artifacts/);
  });

  it("semantic fingerprint excludes updated_at", () => {
    const a = blueprintSourceFingerprint({ name: "n", summary: "s", content: "c" });
    const b = blueprintSourceFingerprint({ name: "n", summary: "s", content: "c" });
    assert.equal(a, b);
    const hashA = hashWorldSnapshot({ name: "n", summary: "s", content: "c", updatedAt: "t1" });
    const hashB = hashWorldSnapshot({ name: "n", summary: "s", content: "c", updatedAt: "t2" });
    assert.notEqual(hashA, hashB);
  });

  it("T1 flag OFF + new TRPG world POST path → zero Blueprint jobs", async () => {
    await withSandboxDirectorEnabled(false, async () => {
      const db = memoryDb();
      const worldId = insertWorld(db);
      const enqueued = maybeEnqueueWorldBlueprintPregenAfterCommit(db, {
        worldId,
        previousTrpgEnabled: false,
        nextTrpgEnabled: true,
        nameChanged: false,
        summaryChanged: false,
        contentChanged: false,
      });
      assert.equal(enqueued, false);
      assert.equal(blueprintJobCount(db), 0);
    });
  });

  it("T2 flag OFF + PATCH enable TRPG → zero Blueprint jobs", async () => {
    await withSandboxDirectorEnabled(false, async () => {
      const db = memoryDb();
      const worldId = insertWorld(db, { trpgEnabled: 0 });
      db.prepare(`UPDATE worlds SET trpg_enabled=1 WHERE id=?`).run(worldId);
      const enqueued = maybeEnqueueWorldBlueprintPregenAfterCommit(db, {
        worldId,
        previousTrpgEnabled: false,
        nextTrpgEnabled: true,
        nameChanged: false,
        summaryChanged: false,
        contentChanged: false,
      });
      assert.equal(enqueued, false);
      assert.equal(blueprintJobCount(db), 0);
    });
  });

  it("T3 flag ON + new TRPG world → exactly one job", async () => {
    await withSandboxDirectorEnabled(true, async () => {
      const db = memoryDb();
      const worldId = insertWorld(db);
      assert.equal(
        maybeEnqueueWorldBlueprintPregenAfterCommit(db, {
          worldId,
          previousTrpgEnabled: false,
          nextTrpgEnabled: true,
          nameChanged: false,
          summaryChanged: false,
          contentChanged: false,
        }),
        true
      );
      assert.equal(blueprintJobCount(db), 1);
      assert.equal(enqueueWorldBlueprintPregenJob(db, worldId), false);
      assert.equal(blueprintJobCount(db), 1);
    });
  });

  it("T4 cover-only change keeps artifact valid and skips pregen", async () => {
    await withSandboxDirectorEnabled(true, async () => {
      const db = memoryDb();
      const worldId = insertWorld(db);
      const snap = loadWorldSnapshotForBlueprint(db, worldId)!;
      casPublishWorldBlueprintArtifact(db, {
        worldId,
        expectedSourceFingerprint: snap.sourceFingerprint,
        expectedDerivationVersion: TRPG_SANDBOX_BLUEPRINT_DERIVATION_VERSION,
        plan: playablePlan,
      });
      db.prepare(`UPDATE worlds SET cover_url='https://x/y.png', updated_at='2026-08-30 12:00:01' WHERE id=?`).run(worldId);
      const after = loadWorldSnapshotForBlueprint(db, worldId)!;
      assert.notEqual(after.updatedAt, snap.updatedAt);
      assert.equal(after.sourceFingerprint, snap.sourceFingerprint);
      assert.ok(loadValidWorldBlueprintPlan(db, worldId, after));
      assert.equal(
        maybeEnqueueWorldBlueprintPregenAfterCommit(db, {
          worldId,
          previousTrpgEnabled: true,
          nextTrpgEnabled: true,
          nameChanged: false,
          summaryChanged: false,
          contentChanged: false,
        }),
        false
      );
    });
  });

  it("T5 genre-only change keeps artifact valid and skips pregen", async () => {
    await withSandboxDirectorEnabled(true, async () => {
      const db = memoryDb();
      const worldId = insertWorld(db);
      const snap = loadWorldSnapshotForBlueprint(db, worldId)!;
      casPublishWorldBlueprintArtifact(db, {
        worldId,
        expectedSourceFingerprint: snap.sourceFingerprint,
        expectedDerivationVersion: TRPG_SANDBOX_BLUEPRINT_DERIVATION_VERSION,
        plan: playablePlan,
      });
      db.prepare(`UPDATE worlds SET genres='["fantasy"]', updated_at=datetime('now') WHERE id=?`).run(worldId);
      const after = loadWorldSnapshotForBlueprint(db, worldId)!;
      assert.ok(loadValidWorldBlueprintPlan(db, worldId, after));
      assert.equal(
        shouldEnqueueWorldBlueprintPregen({
          previousTrpgEnabled: true,
          nextTrpgEnabled: true,
          nameChanged: false,
          summaryChanged: false,
          contentChanged: false,
        }),
        false
      );
    });
  });

  it("T6 name change invalidates artifact and schedules replacement job", async () => {
    await withSandboxDirectorEnabled(true, async () => {
      const db = memoryDb();
      const worldId = insertWorld(db);
      const snap = loadWorldSnapshotForBlueprint(db, worldId)!;
      casPublishWorldBlueprintArtifact(db, {
        worldId,
        expectedSourceFingerprint: snap.sourceFingerprint,
        expectedDerivationVersion: TRPG_SANDBOX_BLUEPRINT_DERIVATION_VERSION,
        plan: playablePlan,
      });
      db.prepare(`UPDATE worlds SET name='남부', updated_at=datetime('now') WHERE id=?`).run(worldId);
      const after = loadWorldSnapshotForBlueprint(db, worldId)!;
      assert.equal(loadValidWorldBlueprintPlan(db, worldId, after), null);
      assert.equal(
        maybeEnqueueWorldBlueprintPregenAfterCommit(db, {
          worldId,
          previousTrpgEnabled: true,
          nextTrpgEnabled: true,
          nameChanged: true,
          summaryChanged: false,
          contentChanged: false,
        }),
        true
      );
    });
  });

  it("T7 summary change invalidates and enqueues", async () => {
    await withSandboxDirectorEnabled(true, async () => {
      const db = memoryDb();
      const worldId = insertWorld(db);
      const snap = loadWorldSnapshotForBlueprint(db, worldId)!;
      casPublishWorldBlueprintArtifact(db, {
        worldId,
        expectedSourceFingerprint: snap.sourceFingerprint,
        expectedDerivationVersion: TRPG_SANDBOX_BLUEPRINT_DERIVATION_VERSION,
        plan: playablePlan,
      });
      db.prepare(`UPDATE worlds SET summary='새요약', updated_at=datetime('now') WHERE id=?`).run(worldId);
      const after = loadWorldSnapshotForBlueprint(db, worldId)!;
      assert.equal(loadValidWorldBlueprintPlan(db, worldId, after), null);
      assert.equal(
        maybeEnqueueWorldBlueprintPregenAfterCommit(db, {
          worldId,
          previousTrpgEnabled: true,
          nextTrpgEnabled: true,
          nameChanged: false,
          summaryChanged: true,
          contentChanged: false,
        }),
        true
      );
    });
  });

  it("T8 content change invalidates and enqueues", async () => {
    await withSandboxDirectorEnabled(true, async () => {
      const db = memoryDb();
      const worldId = insertWorld(db);
      const snap = loadWorldSnapshotForBlueprint(db, worldId)!;
      casPublishWorldBlueprintArtifact(db, {
        worldId,
        expectedSourceFingerprint: snap.sourceFingerprint,
        expectedDerivationVersion: TRPG_SANDBOX_BLUEPRINT_DERIVATION_VERSION,
        plan: playablePlan,
      });
      db.prepare(`UPDATE worlds SET content='본문CHANGED', updated_at=datetime('now') WHERE id=?`).run(worldId);
      const after = loadWorldSnapshotForBlueprint(db, worldId)!;
      assert.equal(loadValidWorldBlueprintPlan(db, worldId, after), null);
      assert.equal(
        maybeEnqueueWorldBlueprintPregenAfterCommit(db, {
          worldId,
          previousTrpgEnabled: true,
          nextTrpgEnabled: true,
          nameChanged: false,
          summaryChanged: false,
          contentChanged: true,
        }),
        true
      );
    });
  });

  it("T9 Blueprint retryable failure does not requeue derived job", async () => {
    const db = memoryDb();
    const worldId = insertWorld(db);
    const snap = loadWorldSnapshotForBlueprint(db, worldId)!;
    enqueueWorldBlueprintPregenJob(db, worldId);
    const job = claimNextDerivedCacheJob(db)!;
    assert.equal(maxAttemptsForDerivedJobKind(job.job_kind), 1);
    completeDerivedCacheJob(db, job.id, { ok: false, error: "transport timeout", retryable: true });
    const row = db.prepare(`SELECT status, attempts FROM derived_cache_jobs WHERE id=?`).get(job.id) as {
      status: string;
      attempts: number;
    };
    assert.equal(row.status, "failed");
    assert.equal(row.attempts, 1);
  });

  it("T10 translation retryable failure still requeues", async () => {
    const db = memoryDb();
    ensureDerivedCacheJobsTable(db);
    db.prepare(
      `INSERT INTO derived_cache_jobs (job_kind, entity_type, entity_id, source_fingerprint, derivation_version, status)
       VALUES ('world_translate', 'world', 1, 'abc', 1, 'processing')`
    ).run();
    const job = db.prepare(`SELECT id FROM derived_cache_jobs`).get() as { id: number };
    db.prepare(`UPDATE derived_cache_jobs SET attempts=1 WHERE id=?`).run(job.id);
    completeDerivedCacheJob(db, job.id, { ok: false, error: "translation timeout", retryable: true });
    const row = db.prepare(`SELECT status FROM derived_cache_jobs WHERE id=?`).get(job.id) as { status: string };
    assert.equal(row.status, "pending");
    assert.equal(maxAttemptsForDerivedJobKind("world_translate"), 8);
  });

  it("T11 stale semantic generation cannot overwrite current revision", () => {
    const db = memoryDb();
    const worldId = insertWorld(db);
    const snapV1 = loadWorldSnapshotForBlueprint(db, worldId)!;
    casPublishWorldBlueprintArtifact(db, {
      worldId,
      expectedSourceFingerprint: snapV1.sourceFingerprint,
      expectedDerivationVersion: TRPG_SANDBOX_BLUEPRINT_DERIVATION_VERSION,
      plan: playablePlan,
    });
    db.prepare(`UPDATE worlds SET content='본문CHANGED', updated_at=datetime('now') WHERE id=?`).run(worldId);
    assert.equal(
      casPublishWorldBlueprintArtifact(db, {
        worldId,
        expectedSourceFingerprint: snapV1.sourceFingerprint,
        expectedDerivationVersion: TRPG_SANDBOX_BLUEPRINT_DERIVATION_VERSION,
        plan: { ...playablePlan, goal: "stale" },
      }),
      false
    );
    assert.match(loadWorldBlueprintArtifactRow(db, worldId)!.director_plan_json, /원인을 밝힌다/);
  });

  it("T12 valid artifact campaign start → zero provider calls", async () => {
    await withSandboxDirectorEnabled(true, async () => {
      const db = memoryDb();
      const worldId = insertWorld(db);
      const snap = loadWorldSnapshotForBlueprint(db, worldId)!;
      casPublishWorldBlueprintArtifact(db, {
        worldId,
        expectedSourceFingerprint: snap.sourceFingerprint,
        expectedDerivationVersion: TRPG_SANDBOX_BLUEPRINT_DERIVATION_VERSION,
        plan: playablePlan,
      });
      const deps: TrpgEngineDeps = {
        skipBilling: true,
        gmCall: async () => ({
          text: buildTrpgGmStructuredWireText("ok", {"players":[],"location":"x","next_round_context":"y","campaign_finished":false,"storyPhase":"DEVELOPMENT"}),
        }),
      };
      const campaignId = createTrpgCampaign(db, {
        hostUserId: 1,
        hostNickname: "렌",
        viewerUserId: 1,
        worldId,
      });
      saveTrpgSheet(db, { campaignId, userId: 1, name: "렌", stats: EVEN_STATS });
      await startTrpgCampaign(db, { campaignId, userId: 1, deps });
    });
  });

  it("T13 campaign copy is independent from world artifact", async () => {
    await withSandboxDirectorEnabled(true, async () => {
      const db = memoryDb();
      const worldId = insertWorld(db);
      const snap = loadWorldSnapshotForBlueprint(db, worldId)!;
      casPublishWorldBlueprintArtifact(db, {
        worldId,
        expectedSourceFingerprint: snap.sourceFingerprint,
        expectedDerivationVersion: TRPG_SANDBOX_BLUEPRINT_DERIVATION_VERSION,
        plan: playablePlan,
      });
      const campaignId = createTrpgCampaign(db, {
        hostUserId: 1,
        hostNickname: "렌",
        viewerUserId: 1,
        worldId,
      });
      await ensureCampaignDirectorContext(db, campaignId);
      const ctx = loadCampaignContext(db, campaignId)!;
      ctx.directorPlan!.goal = "MUTATED";
      persistCampaignContext(db, ctx);
      assert.equal(loadValidWorldBlueprintPlan(db, worldId, snap)?.goal, playablePlan.goal);
    });
  });

  it("T14 public projections expose no GM-only Blueprint fields", () => {
    const db = memoryDb();
    const worldId = insertWorld(db);
    const snap = loadWorldSnapshotForBlueprint(db, worldId)!;
    casPublishWorldBlueprintArtifact(db, {
      worldId,
      expectedSourceFingerprint: snap.sourceFingerprint,
      expectedDerivationVersion: TRPG_SANDBOX_BLUEPRINT_DERIVATION_VERSION,
      plan: { ...playablePlan, secret: "LEAKME" },
    });
    const row = db
      .prepare(
        `SELECT id, creator_id, name, summary, content, created_at, updated_at,
                trpg_enabled, trpg_visibility, genres, cover_url,
                COALESCE(shared_from_nickname, '') AS shared_from_nickname
         FROM worlds WHERE id=?`
      )
      .get(worldId) as Record<string, unknown>;
    const serialized = JSON.stringify({ listItem: rowToWorldListItem(row as never), catalog: loadTrpgCatalog(db, 1) });
    assert.doesNotMatch(serialized, /LEAKME/);
    assert.doesNotMatch(serialized, /director_plan/);
    assert.doesNotMatch(serialized, /endingConditions/);
  });

  it("validity uses sourceFingerprint not updated_at hash", () => {
    const db = memoryDb();
    const worldId = insertWorld(db);
    const snap = loadWorldSnapshotForBlueprint(db, worldId)!;
    const stored = currentBlueprintGenerationValidity(snap);
    db.prepare(`UPDATE worlds SET updated_at=datetime('now','+1 hour') WHERE id=?`).run(worldId);
    const after = loadWorldSnapshotForBlueprint(db, worldId)!;
    assert.notEqual(after.hash, snap.hash);
    assert.equal(after.sourceFingerprint, snap.sourceFingerprint);
    assert.equal(isStoredBlueprintValidForCurrentGeneration(stored, after), true);
  });

  it("artifact row stores generator model and schema version", () => {
    const db = memoryDb();
    const worldId = insertWorld(db);
    const snap = loadWorldSnapshotForBlueprint(db, worldId)!;
    casPublishWorldBlueprintArtifact(db, {
      worldId,
      expectedSourceFingerprint: snap.sourceFingerprint,
      expectedDerivationVersion: TRPG_SANDBOX_BLUEPRINT_DERIVATION_VERSION,
      plan: playablePlan,
    });
    const row = loadWorldBlueprintArtifactRow(db, worldId)!;
    assert.equal(row.source_fingerprint, snap.sourceFingerprint);
    assert.equal(row.generator_model, TRPG_SCENARIO_DRAFT_MODEL);
    assert.equal(row.schema_version, TRPG_SCENARIO_PLAN_SCHEMA_VERSION);
  });

  it("R1 frozen — pre-commit PATCH queues stale fingerprint and worker skips generation", async () => {
    await withSandboxDirectorEnabled(true, async () => {
      const db = memoryDb();
      const worldId = insertWorld(db, { content: "C1" });
      const snapC1 = loadWorldSnapshotForBlueprint(db, worldId)!;
      casPublishWorldBlueprintArtifact(db, {
        worldId,
        expectedSourceFingerprint: snapC1.sourceFingerprint,
        expectedDerivationVersion: TRPG_SANDBOX_BLUEPRINT_DERIVATION_VERSION,
        plan: playablePlan,
      });

      // Historical buggy PATCH: job fingerprint read before durable UPDATE.
      enqueueDerivedCacheJob(db, {
        jobKind: WORLD_BLUEPRINT_PREGEN_JOB_KIND,
        entityType: "world",
        entityId: worldId,
        sourceFingerprint: snapC1.sourceFingerprint,
        derivationVersion: TRPG_SANDBOX_BLUEPRINT_DERIVATION_VERSION,
      });
      db.prepare(`UPDATE worlds SET content='C2', updated_at=datetime('now') WHERE id=?`).run(worldId);
      const snapC2 = loadWorldSnapshotForBlueprint(db, worldId)!;
      const job = blueprintJobRow(db)!;

      assert.equal(job.source_fingerprint, snapC1.sourceFingerprint);
      assert.notEqual(job.source_fingerprint, snapC2.sourceFingerprint);

      const claimed = claimNextDerivedCacheJob(db)!;
      await processDerivedCacheJob(db, claimed);

      const status = db.prepare(`SELECT status FROM derived_cache_jobs WHERE id=?`).get(claimed.id) as {
        status: string;
      };
      assert.equal(status.status, "done");
      assert.equal(loadValidWorldBlueprintPlan(db, worldId, snapC2), null);
    });
  });

  it("T16 semantic PATCH queues POST-COMMIT fingerprint", async () => {
    await withSandboxDirectorEnabled(true, async () => {
      const db = memoryDb();
      const worldId = insertWorld(db, { content: "C1" });
      const snapC1 = loadWorldSnapshotForBlueprint(db, worldId)!;
      casPublishWorldBlueprintArtifact(db, {
        worldId,
        expectedSourceFingerprint: snapC1.sourceFingerprint,
        expectedDerivationVersion: TRPG_SANDBOX_BLUEPRINT_DERIVATION_VERSION,
        plan: playablePlan,
      });

      applyPostCommitContentPatch(db, worldId, "C2");
      const snapC2 = loadWorldSnapshotForBlueprint(db, worldId)!;
      const job = blueprintJobRow(db)!;

      assert.notEqual(snapC2.sourceFingerprint, snapC1.sourceFingerprint);
      assert.equal(job.source_fingerprint, snapC2.sourceFingerprint);
    });
  });

  it("T17 semantic PATCH worker produces NEW valid artifact", async () => {
    await withSandboxDirectorEnabled(true, async () => {
      const db = memoryDb();
      const worldId = insertWorld(db, { content: "C1" });
      const snapC1 = loadWorldSnapshotForBlueprint(db, worldId)!;
      casPublishWorldBlueprintArtifact(db, {
        worldId,
        expectedSourceFingerprint: snapC1.sourceFingerprint,
        expectedDerivationVersion: TRPG_SANDBOX_BLUEPRINT_DERIVATION_VERSION,
        plan: playablePlan,
      });

      applyPostCommitContentPatch(db, worldId, "C2");
      const snapC2 = loadWorldSnapshotForBlueprint(db, worldId)!;
      const job = claimNextDerivedCacheJob(db)!;
      assert.equal(job.source_fingerprint, snapC2.sourceFingerprint);

      let providerCalls = 0;
      await refreshWorldBlueprintArtifact(
        db,
        worldId,
        job.source_fingerprint,
        job.derivation_version,
        {
          complete: async () => {
            providerCalls += 1;
            return (await mockBlueprintComplete("NEW_REVISION_GOAL")()) as never;
          },
        }
      );
      completeDerivedCacheJob(db, job.id, { ok: true });

      assert.equal(providerCalls, 1);
      const plan = loadValidWorldBlueprintPlan(db, worldId, snapC2);
      assert.ok(plan);
      assert.equal(plan.goal, "NEW_REVISION_GOAL");
    });
  });

  it("T18 failed DB mutation creates zero Blueprint job", async () => {
    await withSandboxDirectorEnabled(true, async () => {
      const db = memoryDb();
      const worldId = insertWorld(db, { content: "C1" });
      const trigger = {
        previousTrpgEnabled: true,
        nextTrpgEnabled: true,
        nameChanged: false,
        summaryChanged: false,
        contentChanged: true,
      };
      assert.equal(shouldEnqueueWorldBlueprintPregen(trigger), true);

      const failed = db
        .prepare(`UPDATE worlds SET content='C2' WHERE id=? AND creator_id=?`)
        .run(worldId, 999);
      assert.equal(failed.changes, 0);
      assert.equal(blueprintJobCount(db), 0);

      db.prepare(`UPDATE worlds SET content='C2', updated_at=datetime('now') WHERE id=?`).run(worldId);
      assert.equal(maybeEnqueueWorldBlueprintPregenAfterCommit(db, { worldId, ...trigger }), true);
      assert.equal(blueprintJobCount(db), 1);
    });
  });

  it("T19 flag ON enqueue → flag OFF → process → zero Blueprint provider calls", async () => {
    const db = memoryDb();
    const worldId = insertWorld(db);
    await withSandboxDirectorEnabled(true, async () => {
      enqueueWorldBlueprintPregenJob(db, worldId);
    });

    await withSandboxDirectorEnabled(false, async () => {
      const job = claimNextDerivedCacheJob(db)!;
      const jobId = job.id;
      await processDerivedCacheJob(db, job);
      const row = db.prepare(`SELECT id FROM derived_cache_jobs WHERE id=?`).get(jobId);
      assert.equal(row, undefined);
      assert.equal(loadWorldBlueprintArtifactRow(db, worldId), null);
    });
  });

  it("T20 stale A + committed B → A cannot publish, B survives and publishes", async () => {
    await withSandboxDirectorEnabled(true, async () => {
      const db = memoryDb();
      const worldId = insertWorld(db, { content: "A" });
      const snapA = loadWorldSnapshotForBlueprint(db, worldId)!;
      enqueueWorldBlueprintPregenJob(db, worldId);
      const jobA = blueprintJobRow(db)!;
      assert.equal(jobA.source_fingerprint, snapA.sourceFingerprint);

      applyPostCommitContentPatch(db, worldId, "B");
      const snapB = loadWorldSnapshotForBlueprint(db, worldId)!;
      const jobB = blueprintJobRow(db)!;
      assert.equal(jobB.source_fingerprint, snapB.sourceFingerprint);

      await refreshWorldBlueprintArtifact(
        db,
        worldId,
        jobA.source_fingerprint,
        TRPG_SANDBOX_BLUEPRINT_DERIVATION_VERSION,
        { complete: mockBlueprintComplete("STALE_A") as never }
      );
      assert.equal(loadValidWorldBlueprintPlan(db, worldId, snapB), null);

      await refreshWorldBlueprintArtifact(
        db,
        worldId,
        jobB.source_fingerprint,
        TRPG_SANDBOX_BLUEPRINT_DERIVATION_VERSION,
        { complete: mockBlueprintComplete("CURRENT_B") as never }
      );
      const plan = loadValidWorldBlueprintPlan(db, worldId, snapB);
      assert.ok(plan);
      assert.equal(plan.goal, "CURRENT_B");
    });
  });

  it("T21 transport-classified Blueprint failure keeps max job attempts at 1", async () => {
    await withSandboxDirectorEnabled(true, async () => {
      const db = memoryDb();
      const worldId = insertWorld(db);
      const snap = loadWorldSnapshotForBlueprint(db, worldId)!;
      enqueueWorldBlueprintPregenJob(db, worldId);
      const job = claimNextDerivedCacheJob(db)!;

      const outcome = await refreshWorldBlueprintArtifact(
        db,
        worldId,
        snap.sourceFingerprint,
        TRPG_SANDBOX_BLUEPRINT_DERIVATION_VERSION,
        {
          complete: async () => {
            throw new Error("503 upstream timeout");
          },
        }
      );
      assert.equal(outcome.ok, false);
      assert.equal(outcome.retryable, true);
      completeDerivedCacheJob(db, job.id, outcome);

      const row = db.prepare(`SELECT status, attempts FROM derived_cache_jobs WHERE id=?`).get(job.id) as {
        status: string;
        attempts: number;
      };
      assert.equal(maxAttemptsForDerivedJobKind(job.job_kind), 1);
      assert.equal(row.status, "failed");
      assert.equal(row.attempts, 1);
      assert.equal(maxAttemptsForDerivedJobKind("world_translate"), 8);
    });
  });

  it("T22 provenance sourceWorldHash uses audit hash not semantic fingerprint", async () => {
    await withSandboxDirectorEnabled(true, async () => {
      const db = memoryDb();
      const worldId = insertWorld(db);
      const snap = loadWorldSnapshotForBlueprint(db, worldId)!;
      assert.notEqual(snap.hash, snap.sourceFingerprint);

      await refreshWorldBlueprintArtifact(
        db,
        worldId,
        snap.sourceFingerprint,
        TRPG_SANDBOX_BLUEPRINT_DERIVATION_VERSION,
        { complete: mockBlueprintComplete("PROV_GOAL") as never }
      );
      const row = loadWorldBlueprintArtifactRow(db, worldId)!;
      const plan = parseTrpgScenarioPlan(row.director_plan_json)!;
      assert.equal(plan.provenance?.sourceWorldHash, snap.hash);
      assert.notEqual(plan.provenance?.sourceWorldHash, snap.sourceFingerprint);
    });
  });

  it("T23 field-boundary fingerprint collision is unreachable with JSON serialization", () => {
    const left = blueprintSourceFingerprint({ name: "N", summary: "A\nB", content: "C" });
    const right = blueprintSourceFingerprint({ name: "N", summary: "A", content: "B\nC" });
    assert.notEqual(left, right);
  });

  it("T24 flag OFF discards job so same revision can re-enqueue when flag returns ON", async () => {
    const db = memoryDb();
    const worldId = insertWorld(db);
    const snap = loadWorldSnapshotForBlueprint(db, worldId)!;

    await withSandboxDirectorEnabled(true, async () => {
      assert.equal(enqueueWorldBlueprintPregenJob(db, worldId), true);
    });

    await withSandboxDirectorEnabled(false, async () => {
      const job = claimNextDerivedCacheJob(db)!;
      assert.equal(job.source_fingerprint, snap.sourceFingerprint);
      await processDerivedCacheJob(db, job);
      assert.equal(blueprintJobCount(db), 0);
      assert.equal(loadWorldBlueprintArtifactRow(db, worldId), null);
    });

    await withSandboxDirectorEnabled(true, async () => {
      assert.equal(enqueueWorldBlueprintPregenJob(db, worldId), true);
      assert.equal(blueprintJobCount(db), 1);
    });
  });

  it("T25 flag OFF skip does not busy-reclaim the same Blueprint job", async () => {
    const db = memoryDb();
    const worldId = insertWorld(db);
    await withSandboxDirectorEnabled(true, async () => {
      enqueueWorldBlueprintPregenJob(db, worldId);
    });

    await withSandboxDirectorEnabled(false, async () => {
      const job = claimNextDerivedCacheJob(db)!;
      await processDerivedCacheJob(db, job);
      assert.equal(claimNextDerivedCacheJob(db), null);
      assert.equal(blueprintJobCount(db), 0);
    });
  });

  it("T26 world delete removes Blueprint artifact", () => {
    const db = memoryDb();
    const worldId = insertWorld(db);
    const snap = loadWorldSnapshotForBlueprint(db, worldId)!;
    casPublishWorldBlueprintArtifact(db, {
      worldId,
      expectedSourceFingerprint: snap.sourceFingerprint,
      expectedDerivationVersion: TRPG_SANDBOX_BLUEPRINT_DERIVATION_VERSION,
      plan: playablePlan,
    });
    assert.ok(loadWorldBlueprintArtifactRow(db, worldId));

    assert.equal(deleteWorldLikeRoute(db, worldId, 2), true);
    assert.equal(db.prepare(`SELECT id FROM worlds WHERE id=?`).get(worldId), undefined);
    assert.equal(loadWorldBlueprintArtifactRow(db, worldId), null);
  });

  it("T27 failed world deletion preserves world and Blueprint artifact", () => {
    const db = memoryDb();
    const worldId = insertWorld(db);
    const snap = loadWorldSnapshotForBlueprint(db, worldId)!;
    casPublishWorldBlueprintArtifact(db, {
      worldId,
      expectedSourceFingerprint: snap.sourceFingerprint,
      expectedDerivationVersion: TRPG_SANDBOX_BLUEPRINT_DERIVATION_VERSION,
      plan: playablePlan,
    });

    assert.equal(deleteWorldLikeRoute(db, worldId, 999), false);
    assert.ok(db.prepare(`SELECT id FROM worlds WHERE id=?`).get(worldId));
    assert.ok(loadWorldBlueprintArtifactRow(db, worldId));
  });

  it("T28 pending Blueprint job after world delete discards queue row with zero provider calls", async () => {
    await withSandboxDirectorEnabled(true, async () => {
      const db = memoryDb();
      const worldId = insertWorld(db);
      enqueueWorldBlueprintPregenJob(db, worldId);
      assert.equal(deleteWorldLikeRoute(db, worldId, 2), true);

      const job = claimNextDerivedCacheJob(db)!;
      await processDerivedCacheJob(db, job);
      assert.equal(blueprintJobCount(db), 0);
      assert.equal(loadWorldBlueprintArtifactRow(db, worldId), null);
    });
  });

  it("T29 failed Blueprint job allows later explicit re-enqueue without automatic retry", async () => {
    await withSandboxDirectorEnabled(true, async () => {
      const db = memoryDb();
      const worldId = insertWorld(db);
      const snap = loadWorldSnapshotForBlueprint(db, worldId)!;
      assert.equal(enqueueWorldBlueprintPregenJob(db, worldId), true);
      const job = claimNextDerivedCacheJob(db)!;
      const outcome = await refreshWorldBlueprintArtifact(
        db,
        worldId,
        snap.sourceFingerprint,
        TRPG_SANDBOX_BLUEPRINT_DERIVATION_VERSION,
        { complete: async () => { throw new Error("503 upstream timeout"); } }
      );
      assert.equal(outcome.ok, false);
      completeDerivedCacheJob(db, job.id, outcome);
      const failed = db.prepare(`SELECT status, attempts FROM derived_cache_jobs WHERE id=?`).get(job.id) as {
        status: string;
        attempts: number;
      };
      assert.equal(failed.status, "failed");
      assert.equal(failed.attempts, 1);
      assert.equal(loadWorldBlueprintArtifactRow(db, worldId), null);
      assert.equal(claimNextDerivedCacheJob(db), null);
      assert.equal(enqueueWorldBlueprintPregenJob(db, worldId), true);
      const replacement = findDerivedCacheJobByIdentity(db, {
        jobKind: WORLD_BLUEPRINT_PREGEN_JOB_KIND,
        entityType: "world",
        entityId: worldId,
        sourceFingerprint: snap.sourceFingerprint,
        derivationVersion: TRPG_SANDBOX_BLUEPRINT_DERIVATION_VERSION,
      })!;
      assert.equal(replacement.status, "pending");
      assert.equal(replacement.attempts, 0);
    });
  });

  it("T30 valid artifact + done job does not create regeneration enqueue", async () => {
    await withSandboxDirectorEnabled(true, async () => {
      const db = memoryDb();
      const worldId = insertWorld(db);
      const snap = loadWorldSnapshotForBlueprint(db, worldId)!;
      casPublishWorldBlueprintArtifact(db, {
        worldId,
        expectedSourceFingerprint: snap.sourceFingerprint,
        expectedDerivationVersion: TRPG_SANDBOX_BLUEPRINT_DERIVATION_VERSION,
        plan: playablePlan,
      });
      db.prepare(
        `INSERT INTO derived_cache_jobs (job_kind, entity_type, entity_id, source_fingerprint, derivation_version, status)
         VALUES (?, 'world', ?, ?, ?, 'done')`
      ).run(
        WORLD_BLUEPRINT_PREGEN_JOB_KIND,
        worldId,
        snap.sourceFingerprint,
        TRPG_SANDBOX_BLUEPRINT_DERIVATION_VERSION
      );
      assert.equal(enqueueWorldBlueprintPregenJob(db, worldId), false);
    });
  });

  it("T31 invalid artifact (model mismatch) + done job allows explicit re-enqueue", async () => {
    await withSandboxDirectorEnabled(true, async () => {
      const db = memoryDb();
      const worldId = insertWorld(db);
      const snap = loadWorldSnapshotForBlueprint(db, worldId)!;
      casPublishWorldBlueprintArtifact(db, {
        worldId,
        expectedSourceFingerprint: snap.sourceFingerprint,
        expectedDerivationVersion: TRPG_SANDBOX_BLUEPRINT_DERIVATION_VERSION,
        plan: playablePlan,
      });
      db.prepare(`UPDATE trpg_world_blueprint_artifacts SET generator_model='stale-model' WHERE world_id=?`).run(
        worldId
      );
      assert.equal(loadValidWorldBlueprintPlan(db, worldId, snap), null);
      db.prepare(
        `INSERT INTO derived_cache_jobs (job_kind, entity_type, entity_id, source_fingerprint, derivation_version, status)
         VALUES (?, 'world', ?, ?, ?, 'done')`
      ).run(
        WORLD_BLUEPRINT_PREGEN_JOB_KIND,
        worldId,
        snap.sourceFingerprint,
        TRPG_SANDBOX_BLUEPRINT_DERIVATION_VERSION
      );
      assert.equal(enqueueWorldBlueprintPregenJob(db, worldId), true);
    });
  });

  it("T32 invalid artifact (schema mismatch) + done job allows explicit re-enqueue", async () => {
    await withSandboxDirectorEnabled(true, async () => {
      const db = memoryDb();
      const worldId = insertWorld(db);
      const snap = loadWorldSnapshotForBlueprint(db, worldId)!;
      casPublishWorldBlueprintArtifact(db, {
        worldId,
        expectedSourceFingerprint: snap.sourceFingerprint,
        expectedDerivationVersion: TRPG_SANDBOX_BLUEPRINT_DERIVATION_VERSION,
        plan: playablePlan,
      });
      db.prepare(`UPDATE trpg_world_blueprint_artifacts SET schema_version='stale-schema' WHERE world_id=?`).run(
        worldId
      );
      assert.equal(loadValidWorldBlueprintPlan(db, worldId, snap), null);
      db.prepare(
        `INSERT INTO derived_cache_jobs (job_kind, entity_type, entity_id, source_fingerprint, derivation_version, status)
         VALUES (?, 'world', ?, ?, ?, 'done')`
      ).run(
        WORLD_BLUEPRINT_PREGEN_JOB_KIND,
        worldId,
        snap.sourceFingerprint,
        TRPG_SANDBOX_BLUEPRINT_DERIVATION_VERSION
      );
      assert.equal(enqueueWorldBlueprintPregenJob(db, worldId), true);
    });
  });

  it("T33 pending/processing same identity does not create duplicate job", async () => {
    await withSandboxDirectorEnabled(true, async () => {
      const db = memoryDb();
      const worldId = insertWorld(db);
      assert.equal(enqueueWorldBlueprintPregenJob(db, worldId), true);
      assert.equal(enqueueWorldBlueprintPregenJob(db, worldId), false);
      const job = claimNextDerivedCacheJob(db)!;
      assert.equal(enqueueWorldBlueprintPregenJob(db, worldId), false);
      discardDerivedCacheJob(db, job.id);
    });
  });

  it("T34 world disabled before worker discards job and allows re-enqueue when artifact missing", async () => {
    const db = memoryDb();
    const worldId = insertWorld(db);
    await withSandboxDirectorEnabled(true, async () => {
      assert.equal(enqueueWorldBlueprintPregenJob(db, worldId), true);
    });
    db.prepare(`UPDATE worlds SET trpg_enabled=0 WHERE id=?`).run(worldId);
    assert.equal(canExecuteWorldBlueprintPregen(db, worldId), false);
    const job = claimNextDerivedCacheJob(db)!;
    await processDerivedCacheJob(db, job);
    assert.equal(blueprintJobCount(db), 0);
    db.prepare(`UPDATE worlds SET trpg_enabled=1 WHERE id=?`).run(worldId);
    await withSandboxDirectorEnabled(true, async () => {
      assert.equal(enqueueWorldBlueprintPregenJob(db, worldId), true);
    });
  });

  it("T35 pending job after world delete discards row with zero provider calls", async () => {
    await withSandboxDirectorEnabled(true, async () => {
      const db = memoryDb();
      const worldId = insertWorld(db);
      enqueueWorldBlueprintPregenJob(db, worldId);
      deleteWorldLikeRoute(db, worldId, 2);
      const job = claimNextDerivedCacheJob(db)!;
      await processDerivedCacheJob(db, job);
      assert.equal(blueprintJobCount(db), 0);
    });
  });

  it("R2 frozen — non-atomic terminal replacement UNIQUE-fails under interleaved callers", () => {
    const db = memoryDb();
    const worldId = insertWorld(db);
    const identity = sampleJobIdentity(db, worldId);
    const terminalId = insertTerminalJob(db, identity, "failed");

    // Caller B completes full legacy replacement first.
    discardDerivedCacheJob(db, terminalId);
    db.prepare(
      `INSERT INTO derived_cache_jobs
        (job_kind, entity_type, entity_id, source_fingerprint, derivation_version, job_flags, status, run_after, updated_at)
       VALUES (?, 'world', ?, ?, ?, '', 'pending', datetime('now'), datetime('now'))`
    ).run(
      identity.jobKind,
      identity.entityId,
      identity.sourceFingerprint,
      identity.derivationVersion
    );

    // Caller A continues from stale terminal snapshot without re-reading queue state.
    discardDerivedCacheJob(db, terminalId);
    assert.throws(
      () => {
        db.prepare(
          `INSERT INTO derived_cache_jobs
            (job_kind, entity_type, entity_id, source_fingerprint, derivation_version, job_flags, status, run_after, updated_at)
           VALUES (?, 'world', ?, ?, ?, '', 'pending', datetime('now'), datetime('now'))`
        ).run(
          identity.jobKind,
          identity.entityId,
          identity.sourceFingerprint,
          identity.derivationVersion
        );
      },
      /UNIQUE constraint failed/
    );
  });

  it("T36 failed terminal + concurrent explicit enqueue x2 → one pending, attempts=0", () => {
    const dir = mkdtempSync(join(tmpdir(), "derived-cache-race-"));
    const dbPath = join(dir, "queue.db");
    try {
      const db1 = openSharedQueueDb(dbPath);
      const db2 = new Database(dbPath);
      const worldId = insertWorld(db1);
      const identity = sampleJobIdentity(db1, worldId);
      insertTerminalJob(db1, identity, "failed", { attempts: 1 });

      assert.doesNotThrow(() => {
        enqueueDerivedCacheJobReplacingTerminal(db1, identity);
        enqueueDerivedCacheJobReplacingTerminal(db2, identity);
      });
      assert.equal(pendingJobsForIdentity(db1, identity), 1);
      const row = findDerivedCacheJobByIdentity(db1, identity)!;
      assert.equal(row.status, "pending");
      assert.equal(row.attempts, 0);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("T37 done terminal + concurrent explicit enqueue x2 → one pending", () => {
    const dir = mkdtempSync(join(tmpdir(), "derived-cache-race-"));
    const dbPath = join(dir, "queue.db");
    try {
      const db1 = openSharedQueueDb(dbPath);
      const db2 = new Database(dbPath);
      const worldId = insertWorld(db1);
      const identity = sampleJobIdentity(db1, worldId);
      insertTerminalJob(db1, identity, "done", { attempts: 1 });

      assert.doesNotThrow(() => {
        enqueueDerivedCacheJobReplacingTerminal(db1, identity);
        enqueueDerivedCacheJobReplacingTerminal(db2, identity);
      });
      assert.equal(pendingJobsForIdentity(db1, identity), 1);
      assert.equal(findDerivedCacheJobByIdentity(db1, identity)!.status, "pending");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("T38 pending identity + concurrent enqueue → no duplicate, pending not reset", () => {
    const db = memoryDb();
    const worldId = insertWorld(db);
    const identity = sampleJobIdentity(db, worldId);
    db.prepare(
      `INSERT INTO derived_cache_jobs
        (job_kind, entity_type, entity_id, source_fingerprint, derivation_version, job_flags, status, attempts, run_after)
       VALUES (?, 'world', ?, ?, ?, 'keep-flag', 'pending', 0, datetime('now', '+5 minutes'))`
    ).run(
      identity.jobKind,
      identity.entityId,
      identity.sourceFingerprint,
      identity.derivationVersion
    );
    assert.equal(enqueueDerivedCacheJobReplacingTerminal(db, identity), false);
    assert.equal(enqueueDerivedCacheJobReplacingTerminal(db, identity), false);
    assert.equal(pendingJobsForIdentity(db, identity), 1);
    const row = findDerivedCacheJobByIdentity(db, identity)!;
    assert.equal(row.job_flags, "keep-flag");
    assert.equal(row.attempts, 0);
  });

  it("T39 processing identity + concurrent enqueue → no duplicate, processing preserved", () => {
    const db = memoryDb();
    const worldId = insertWorld(db);
    const identity = sampleJobIdentity(db, worldId);
    db.prepare(
      `INSERT INTO derived_cache_jobs
        (job_kind, entity_type, entity_id, source_fingerprint, derivation_version, job_flags, status, attempts, locked_at, run_after)
       VALUES (?, 'world', ?, ?, ?, 'proc-flag', 'processing', 2, datetime('now'), datetime('now'))`
    ).run(
      identity.jobKind,
      identity.entityId,
      identity.sourceFingerprint,
      identity.derivationVersion
    );
    assert.equal(enqueueDerivedCacheJobReplacingTerminal(db, identity), false);
    assert.equal(enqueueDerivedCacheJobReplacingTerminal(db, identity), false);
    assert.equal(pendingJobsForIdentity(db, identity), 0);
    const row = findDerivedCacheJobByIdentity(db, identity)!;
    assert.equal(row.status, "processing");
    assert.equal(row.attempts, 2);
    assert.equal(row.job_flags, "proc-flag");
  });

  it("T40 terminal replacement updates job_flags to current explicit request", () => {
    const db = memoryDb();
    const worldId = insertWorld(db);
    const identity = sampleJobIdentity(db, worldId);
    insertTerminalJob(db, identity, "failed", { jobFlags: "old-flag", attempts: 1 });
    assert.equal(
      enqueueDerivedCacheJobReplacingTerminal(db, { ...identity, jobFlags: "new-flag" }),
      true
    );
    const row = findDerivedCacheJobByIdentity(db, identity)!;
    assert.equal(row.status, "pending");
    assert.equal(row.job_flags, "new-flag");
    assert.equal(row.attempts, 0);
  });
});
