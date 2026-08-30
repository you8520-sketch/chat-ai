import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
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
  shouldEnqueueWorldBlueprintPregen,
} from "@/lib/derivedCache/worldBlueprintPregen";
import {
  claimNextDerivedCacheJob,
  completeDerivedCacheJob,
  ensureDerivedCacheJobsTable,
  maxAttemptsForDerivedJobKind,
} from "@/lib/derivedCache/jobs";
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
      let directorCalls = 0;
      const deps: TrpgEngineDeps = {
        skipBilling: true,
        directorCall: async () => {
          directorCalls += 1;
          throw new Error("must not call provider");
        },
        gmCall: async () => ({
          text: `<<<NARRATION>>>\nok\n<<<DELTA>>>\n{"players":[],"location":"x","next_round_context":"y","campaign_finished":false,"storyPhase":"DEVELOPMENT"}`,
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
      assert.equal(directorCalls, 0);
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
});
