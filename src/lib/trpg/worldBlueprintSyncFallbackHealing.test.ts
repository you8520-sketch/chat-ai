import assert from "node:assert/strict";
import { describe, it } from "node:test";
import Database from "better-sqlite3";
import { TRPG_SANDBOX_BLUEPRINT_DERIVATION_VERSION } from "./blueprintValidity";
import { ensureTrpgTables } from "./schema";
import {
  casPublishWorldBlueprintArtifact,
  loadValidWorldBlueprintPlan,
  loadWorldBlueprintArtifactRow,
  loadWorldSnapshotForBlueprint,
} from "./worldBlueprintArtifact";
import { TRPG_SCENARIO_DRAFT_MODEL } from "./scenarioDraft";
import { parseTrpgScenarioPlan } from "./scenarioPlan";
import {
  enqueueWorldBlueprintPregenJob,
  refreshWorldBlueprintArtifact,
  WORLD_BLUEPRINT_PREGEN_JOB_KIND,
} from "@/lib/derivedCache/worldBlueprintPregen";
import {
  claimNextDerivedCacheJob,
  completeDerivedCacheJob,
  ensureDerivedCacheJobsTable,
  findDerivedCacheJobByIdentity,
} from "@/lib/derivedCache/jobs";
import { createTrpgCampaign, saveTrpgSheet, EVEN_STATS } from "./engineCreate";
import { startTrpgCampaign, type TrpgEngineDeps } from "./engineAdvance";
import { loadCampaignContext } from "./campaignContext";
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

function insertWorld(db: Database.Database, content = "본문"): number {
  const result = db
    .prepare(
      `INSERT INTO worlds (creator_id, name, summary, content, trpg_enabled, trpg_visibility, genres, cover_url)
       VALUES (2, '북부', '요약', ?, 1, 'public', '[]', '')`
    )
    .run(content);
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

function gmText(): string {
  return `<<<NARRATION>>>\nok\n<<<DELTA>>>\n{"players":[],"location":"x","next_round_context":"y","campaign_finished":false,"storyPhase":"DEVELOPMENT"}`;
}

function dbWithFailingArtifactPublish(db: Database.Database): Database.Database {
  const originalPrepare = db.prepare.bind(db);
  db.prepare = ((sql: string) => {
    const stmt = originalPrepare(sql);
    if (sql.includes("trpg_world_blueprint_artifacts") && /\b(INSERT|UPDATE|DELETE)\b/i.test(sql)) {
      return {
        run: () => {
          throw new Error("storage failure");
        },
      } as ReturnType<typeof originalPrepare>;
    }
    return stmt;
  }) as typeof db.prepare;
  return db;
}

describe("world blueprint sync-fallback artifact healing", () => {
  it("T1 artifact absent → Campaign A fallback succeeds → artifact healed", async () => {
    await withSandboxDirectorEnabled(true, async () => {
      const db = memoryDb();
      const worldId = insertWorld(db);
      let directorCalls = 0;
      const deps: TrpgEngineDeps = {
        skipBilling: true,
        directorCall: async () => {
          directorCalls += 1;
          return (await mockBlueprintComplete("healed-goal")()) as never;
        },
        gmCall: async () => ({ text: gmText() }),
      };
      const campaignId = createTrpgCampaign(db, {
        hostUserId: 1,
        hostNickname: "렌",
        viewerUserId: 1,
        worldId,
      });
      saveTrpgSheet(db, { campaignId, userId: 1, name: "렌", stats: EVEN_STATS });
      await startTrpgCampaign(db, { campaignId, userId: 1, deps });

      assert.equal(directorCalls, 1);
      const snap = loadWorldSnapshotForBlueprint(db, worldId)!;
      const artifact = loadValidWorldBlueprintPlan(db, worldId, snap);
      assert.ok(artifact);
      assert.equal(artifact.goal, "healed-goal");
      assert.ok(loadCampaignContext(db, campaignId)?.directorPlan);
    });
  });

  it("T2 same revision Campaign B → provider calls 0 → artifact copy used", async () => {
    await withSandboxDirectorEnabled(true, async () => {
      const db = memoryDb();
      const worldId = insertWorld(db);
      let directorCalls = 0;
      const deps: TrpgEngineDeps = {
        skipBilling: true,
        directorCall: async () => {
          directorCalls += 1;
          return (await mockBlueprintComplete("campaign-a")()) as never;
        },
        gmCall: async () => ({ text: gmText() }),
      };
      const campaignA = createTrpgCampaign(db, {
        hostUserId: 1,
        hostNickname: "렌",
        viewerUserId: 1,
        worldId,
      });
      saveTrpgSheet(db, { campaignId: campaignA, userId: 1, name: "렌", stats: EVEN_STATS });
      await startTrpgCampaign(db, { campaignId: campaignA, userId: 1, deps });
      assert.equal(directorCalls, 1);

      const campaignB = createTrpgCampaign(db, {
        hostUserId: 1,
        hostNickname: "렌",
        viewerUserId: 1,
        worldId,
      });
      saveTrpgSheet(db, { campaignId: campaignB, userId: 1, name: "렌2", stats: EVEN_STATS });
      await startTrpgCampaign(db, {
        campaignId: campaignB,
        userId: 1,
        deps: {
          skipBilling: true,
          directorCall: async () => {
            directorCalls += 1;
            throw new Error("must not call provider");
          },
          gmCall: async () => ({ text: gmText() }),
        },
      });

      assert.equal(directorCalls, 1);
      const ctxB = loadCampaignContext(db, campaignB);
      assert.equal(ctxB?.directorPlan?.goal, "campaign-a");
    });
  });

  it("T3 pending pregen + valid artifact before execution → provider calls 0", async () => {
    await withSandboxDirectorEnabled(true, async () => {
      const db = memoryDb();
      const worldId = insertWorld(db);
      const snap = loadWorldSnapshotForBlueprint(db, worldId)!;
      enqueueWorldBlueprintPregenJob(db, worldId);
      casPublishWorldBlueprintArtifact(db, {
        worldId,
        expectedSourceFingerprint: snap.sourceFingerprint,
        expectedDerivationVersion: TRPG_SANDBOX_BLUEPRINT_DERIVATION_VERSION,
        plan: playablePlan,
      });

      let providerCalls = 0;
      const result = await refreshWorldBlueprintArtifact(
        db,
        worldId,
        snap.sourceFingerprint,
        TRPG_SANDBOX_BLUEPRINT_DERIVATION_VERSION,
        { complete: async () => {
          providerCalls += 1;
          throw new Error("must not call provider");
        } }
      );

      assert.equal(providerCalls, 0);
      assert.equal(result.ok, true);
    });
  });

  it("T4 pending pregen → sync fallback heals → worker provider calls 0", async () => {
    await withSandboxDirectorEnabled(true, async () => {
      const db = memoryDb();
      const worldId = insertWorld(db);
      enqueueWorldBlueprintPregenJob(db, worldId);

      let syncCalls = 0;
      const campaignId = createTrpgCampaign(db, {
        hostUserId: 1,
        hostNickname: "렌",
        viewerUserId: 1,
        worldId,
      });
      saveTrpgSheet(db, { campaignId, userId: 1, name: "렌", stats: EVEN_STATS });
      await startTrpgCampaign(db, {
        campaignId,
        userId: 1,
        deps: {
          skipBilling: true,
          directorCall: async () => {
            syncCalls += 1;
            return (await mockBlueprintComplete("sync-heal")()) as never;
          },
          gmCall: async () => ({ text: gmText() }),
        },
      });
      assert.equal(syncCalls, 1);

      const snap = loadWorldSnapshotForBlueprint(db, worldId)!;
      assert.ok(loadValidWorldBlueprintPlan(db, worldId, snap));

      let workerCalls = 0;
      const job = claimNextDerivedCacheJob(db);
      assert.ok(job);
      const outcome = await refreshWorldBlueprintArtifact(
        db,
        worldId,
        job.source_fingerprint,
        job.derivation_version,
        {
          complete: async () => {
            workerCalls += 1;
            throw new Error("must not call provider");
          },
        }
      );
      completeDerivedCacheJob(db, job.id, outcome);

      assert.equal(workerCalls, 0);
      const row = findDerivedCacheJobByIdentity(db, {
        jobKind: WORLD_BLUEPRINT_PREGEN_JOB_KIND,
        entityType: "world",
        entityId: worldId,
        sourceFingerprint: snap.sourceFingerprint,
        derivationVersion: TRPG_SANDBOX_BLUEPRINT_DERIVATION_VERSION,
      });
      assert.equal(row?.status, "done");
    });
  });

  it("T5 world A changes to B during fallback → A plan preserved, A artifact cannot overwrite B", async () => {
    await withSandboxDirectorEnabled(true, async () => {
      const db = memoryDb();
      const worldId = insertWorld(db, "revision A");
      const snapA = loadWorldSnapshotForBlueprint(db, worldId)!;

      const campaignId = createTrpgCampaign(db, {
        hostUserId: 1,
        hostNickname: "렌",
        viewerUserId: 1,
        worldId,
      });
      saveTrpgSheet(db, { campaignId, userId: 1, name: "렌", stats: EVEN_STATS });
      await ensureCampaignDirectorContext(db, campaignId, {
        directorCall: async () => {
          db.prepare(`UPDATE worlds SET content='revision B', updated_at=datetime('now') WHERE id=?`).run(worldId);
          return (await mockBlueprintComplete("plan-from-A")()) as never;
        },
      });

      const ctx = loadCampaignContext(db, campaignId)!;
      assert.equal(ctx.directorPlan?.goal, "plan-from-A");

      const snapB = loadWorldSnapshotForBlueprint(db, worldId)!;
      assert.notEqual(snapB.sourceFingerprint, snapA.sourceFingerprint);
      assert.equal(loadValidWorldBlueprintPlan(db, worldId, snapB), null);
      assert.equal(loadWorldBlueprintArtifactRow(db, worldId), null);
    });
  });

  it("T6 artifact healing storage failure → successful fallback campaign still persists", async () => {
    await withSandboxDirectorEnabled(true, async () => {
      const db = dbWithFailingArtifactPublish(memoryDb());
      const worldId = insertWorld(db);
      const campaignId = createTrpgCampaign(db, {
        hostUserId: 1,
        hostNickname: "렌",
        viewerUserId: 1,
        worldId,
      });
      saveTrpgSheet(db, { campaignId, userId: 1, name: "렌", stats: EVEN_STATS });
      await startTrpgCampaign(db, {
        campaignId,
        userId: 1,
        deps: {
          skipBilling: true,
          directorCall: mockBlueprintComplete("persisted-plan"),
          gmCall: async () => ({ text: gmText() }),
        },
      });

      const ctx = loadCampaignContext(db, campaignId);
      assert.ok(ctx?.directorPlan);
      assert.equal(ctx.directorPlan?.goal, "persisted-plan");
      assert.equal(loadWorldBlueprintArtifactRow(db, worldId), null);
    });
  });

  it("T7 fallback generation failure → artifact absent, prior failure policy unchanged", async () => {
    await withSandboxDirectorEnabled(true, async () => {
      const db = memoryDb();
      const worldId = insertWorld(db);
      const campaignId = createTrpgCampaign(db, {
        hostUserId: 1,
        hostNickname: "렌",
        viewerUserId: 1,
        worldId,
      });
      saveTrpgSheet(db, { campaignId, userId: 1, name: "렌", stats: EVEN_STATS });
      await ensureCampaignDirectorContext(db, campaignId, {
        directorCall: async () => ({
          text: JSON.stringify({ goal: "missing required fields" }),
          latencyMs: 1,
          model: TRPG_SCENARIO_DRAFT_MODEL,
        }),
      });

      const ctx = loadCampaignContext(db, campaignId)!;
      assert.equal(ctx.directorPlan, null);
      assert.ok(ctx.directorError);
      assert.equal(loadWorldBlueprintArtifactRow(db, worldId), null);
    });
  });

  it("T8 valid artifact baseline → provider calls 0", async () => {
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
      const campaignId = createTrpgCampaign(db, {
        hostUserId: 1,
        hostNickname: "렌",
        viewerUserId: 1,
        worldId,
      });
      saveTrpgSheet(db, { campaignId, userId: 1, name: "렌", stats: EVEN_STATS });
      await startTrpgCampaign(db, {
        campaignId,
        userId: 1,
        deps: {
          skipBilling: true,
          directorCall: async () => {
            directorCalls += 1;
            throw new Error("must not call provider");
          },
          gmCall: async () => ({ text: gmText() }),
        },
      });
      assert.equal(directorCalls, 0);
    });
  });

  it("T9 public / borrowed artifact privacy remains clean", async () => {
    await withSandboxDirectorEnabled(true, async () => {
      const db = memoryDb();
      const worldId = insertWorld(db);
      const campaignId = createTrpgCampaign(db, {
        hostUserId: 1,
        hostNickname: "렌",
        viewerUserId: 1,
        worldId,
      });
      saveTrpgSheet(db, { campaignId, userId: 1, name: "렌", stats: EVEN_STATS });
      await startTrpgCampaign(db, {
        campaignId,
        userId: 1,
        deps: {
          skipBilling: true,
          directorCall: async () => ({
            text: JSON.stringify({
              ...playablePlan,
              secret: "HEALEDSECRET",
            }),
            latencyMs: 1,
            model: TRPG_SCENARIO_DRAFT_MODEL,
          }),
          gmCall: async () => ({ text: gmText() }),
        },
      });

      const row = db
        .prepare(
          `SELECT id, creator_id, name, summary, content, created_at, updated_at,
                  trpg_enabled, trpg_visibility, genres, cover_url,
                  COALESCE(shared_from_nickname, '') AS shared_from_nickname
           FROM worlds WHERE id=?`
        )
        .get(worldId) as Record<string, unknown>;
      const serialized = JSON.stringify({
        listItem: rowToWorldListItem(row as never),
        catalog: loadTrpgCatalog(db, 1),
      });
      assert.doesNotMatch(serialized, /HEALEDSECRET/);
      assert.doesNotMatch(serialized, /director_plan/);
    });
  });
});

describe("sync-fallback healing reproduction (before-fix semantics)", () => {
  it("R1 — second campaign on same revision would re-call provider without healing", async () => {
    await withSandboxDirectorEnabled(true, async () => {
      const db = memoryDb();
      const worldId = insertWorld(db);
      const snap = loadWorldSnapshotForBlueprint(db, worldId)!;

      const campaignA = createTrpgCampaign(db, {
        hostUserId: 1,
        hostNickname: "렌",
        viewerUserId: 1,
        worldId,
      });
      saveTrpgSheet(db, { campaignId: campaignA, userId: 1, name: "렌", stats: EVEN_STATS });
      await ensureCampaignDirectorContext(db, campaignA, {
        directorCall: mockBlueprintComplete("a-plan"),
      });
      assert.ok(loadCampaignContext(db, campaignA)?.directorPlan);

      const healed = loadValidWorldBlueprintPlan(db, worldId, snap);
      assert.ok(healed, "after fix: artifact is healed by sync fallback");
    });
  });

  it("R2 — pregen skips provider when valid artifact exists at execution time", async () => {
    await withSandboxDirectorEnabled(true, async () => {
      const db = memoryDb();
      const worldId = insertWorld(db);
      const snap = loadWorldSnapshotForBlueprint(db, worldId)!;
      enqueueWorldBlueprintPregenJob(db, worldId);
      casPublishWorldBlueprintArtifact(db, {
        worldId,
        expectedSourceFingerprint: snap.sourceFingerprint,
        expectedDerivationVersion: TRPG_SANDBOX_BLUEPRINT_DERIVATION_VERSION,
        plan: playablePlan,
      });

      let calls = 0;
      await refreshWorldBlueprintArtifact(
        db,
        worldId,
        snap.sourceFingerprint,
        TRPG_SANDBOX_BLUEPRINT_DERIVATION_VERSION,
        { complete: async () => {
          calls += 1;
          throw new Error("must not call");
        } }
      );
      assert.equal(calls, 0);
    });
  });
});
