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
import { refreshWorldBlueprintArtifact } from "@/lib/derivedCache/worldBlueprintPregen";
import { createTrpgCampaign, saveTrpgSheet, EVEN_STATS } from "./engineCreate";
import { startTrpgCampaign, type TrpgEngineDeps } from "./engineAdvance";
import { loadCampaignContext } from "./campaignContext";
import { ensureCampaignDirectorContext } from "./sandboxDirector";

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

function defer<T = void>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

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
  return db;
}

function sharedMemoryDbs(): { db1: Database.Database; db2: Database.Database } {
  const uri = `file:blueprint-convergence-${Date.now()}-${Math.random()}?mode=memory&cache=shared`;
  const db1 = new Database(uri);
  const db2 = new Database(uri);
  db1.exec(`
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
  ensureTrpgTables(db1);
  return { db1, db2 };
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

function planWithGoal(goal: string) {
  return parseTrpgScenarioPlan({ ...playablePlan, goal })!;
}

function createCampaign(db: Database.Database, worldId: number, suffix: string): number {
  const campaignId = createTrpgCampaign(db, {
    hostUserId: 1,
    hostNickname: "렌",
    viewerUserId: 1,
    worldId,
  });
  saveTrpgSheet(db, { campaignId, userId: 1, name: `렌-${suffix}`, stats: EVEN_STATS });
  return campaignId;
}

describe("world blueprint canonical convergence", () => {
  it("T1 A publishes first → B sync fallback adopts PLAN_A (same-revision convergence)", async () => {
    await withSandboxDirectorEnabled(true, async () => {
      const db = memoryDb();
      const worldId = insertWorld(db);
      const campaignA = createCampaign(db, worldId, "A");
      let providerCalls = 0;

      await ensureCampaignDirectorContext(db, campaignA, {
        directorCall: async () => {
          providerCalls += 1;
          return (await mockBlueprintComplete("PLAN_A")()) as never;
        },
      });

      const campaignB = createCampaign(db, worldId, "B");
      await ensureCampaignDirectorContext(db, campaignB, {
        directorCall: async () => {
          providerCalls += 1;
          return (await mockBlueprintComplete("PLAN_B")()) as never;
        },
      });

      const snap = loadWorldSnapshotForBlueprint(db, worldId)!;
      const ctxA = loadCampaignContext(db, campaignA)!;
      const ctxB = loadCampaignContext(db, campaignB)!;
      const artifact = loadValidWorldBlueprintPlan(db, worldId, snap)!;

      assert.equal(providerCalls, 1);
      assert.equal(ctxA.directorPlan?.goal, "PLAN_A");
      assert.equal(ctxB.directorPlan?.goal, "PLAN_A");
      assert.equal(artifact.goal, "PLAN_A");
    });
  });

  it("T1b A publishes first → B uses warm artifact path with zero provider calls", async () => {
    await withSandboxDirectorEnabled(true, async () => {
      const db = memoryDb();
      const worldId = insertWorld(db);
      const campaignA = createCampaign(db, worldId, "A");

      await ensureCampaignDirectorContext(db, campaignA, {
        directorCall: async () => (await mockBlueprintComplete("PLAN_A")()) as never,
      });

      const campaignB = createCampaign(db, worldId, "B");
      let bCalls = 0;
      await ensureCampaignDirectorContext(db, campaignB, {
        directorCall: async () => {
          bCalls += 1;
          throw new Error("must not call provider");
        },
      });

      assert.equal(bCalls, 0);
      assert.equal(loadCampaignContext(db, campaignB)?.directorPlan?.goal, "PLAN_A");
    });
  });

  it("T2 B publishes first → A sync fallback adopts PLAN_B (same-revision convergence)", async () => {
    await withSandboxDirectorEnabled(true, async () => {
      const db = memoryDb();
      const worldId = insertWorld(db);
      const campaignB = createCampaign(db, worldId, "B");

      await ensureCampaignDirectorContext(db, campaignB, {
        directorCall: async () => (await mockBlueprintComplete("PLAN_B")()) as never,
      });

      const campaignA = createCampaign(db, worldId, "A");
      await ensureCampaignDirectorContext(db, campaignA, {
        directorCall: async () => (await mockBlueprintComplete("PLAN_A")()) as never,
      });

      const snap = loadWorldSnapshotForBlueprint(db, worldId)!;
      assert.equal(loadCampaignContext(db, campaignA)?.directorPlan?.goal, "PLAN_B");
      assert.equal(loadCampaignContext(db, campaignB)?.directorPlan?.goal, "PLAN_B");
      assert.equal(loadValidWorldBlueprintPlan(db, worldId, snap)?.goal, "PLAN_B");
    });
  });

  it("T2b sync fallback adopts pre-published canonical winner over local candidate", async () => {
    await withSandboxDirectorEnabled(true, async () => {
      const db = memoryDb();
      const worldId = insertWorld(db);
      const snap = loadWorldSnapshotForBlueprint(db, worldId)!;
      const campaignB = createCampaign(db, worldId, "B");

      await ensureCampaignDirectorContext(db, campaignB, {
        directorCall: async () => {
          casPublishWorldBlueprintArtifact(db, {
            worldId,
            expectedSourceFingerprint: snap.sourceFingerprint,
            expectedDerivationVersion: TRPG_SANDBOX_BLUEPRINT_DERIVATION_VERSION,
            plan: planWithGoal("CANONICAL_WINNER"),
          });
          return (await mockBlueprintComplete("LATE_CANDIDATE")()) as never;
        },
      });

      assert.equal(loadCampaignContext(db, campaignB)?.directorPlan?.goal, "CANONICAL_WINNER");
      assert.equal(loadValidWorldBlueprintPlan(db, worldId, snap)?.goal, "CANONICAL_WINNER");
    });
  });

  it("T3 same-generation late writer cannot overwrite valid canonical artifact", () => {
    const db = memoryDb();
    const worldId = insertWorld(db);
    const snap = loadWorldSnapshotForBlueprint(db, worldId)!;
    const planA = planWithGoal("CANONICAL_A");
    const planB = planWithGoal("LATE_B");

    assert.equal(
      casPublishWorldBlueprintArtifact(db, {
        worldId,
        expectedSourceFingerprint: snap.sourceFingerprint,
        expectedDerivationVersion: TRPG_SANDBOX_BLUEPRINT_DERIVATION_VERSION,
        plan: planA,
      }),
      true
    );
    assert.equal(
      casPublishWorldBlueprintArtifact(db, {
        worldId,
        expectedSourceFingerprint: snap.sourceFingerprint,
        expectedDerivationVersion: TRPG_SANDBOX_BLUEPRINT_DERIVATION_VERSION,
        plan: planB,
      }),
      false
    );
    assert.equal(loadValidWorldBlueprintPlan(db, worldId, snap)?.goal, "CANONICAL_A");
  });

  it("T3b two SQLite connections — first publish wins, second same-generation publish no-ops", () => {
    const { db1, db2 } = sharedMemoryDbs();
    const worldId = insertWorld(db1);
    const snap = loadWorldSnapshotForBlueprint(db1, worldId)!;
    const planA = planWithGoal("CONN_A");
    const planB = planWithGoal("CONN_B");
    const publish = (db: Database.Database, plan: ReturnType<typeof planWithGoal>) =>
      casPublishWorldBlueprintArtifact(db, {
        worldId,
        expectedSourceFingerprint: snap.sourceFingerprint,
        expectedDerivationVersion: TRPG_SANDBOX_BLUEPRINT_DERIVATION_VERSION,
        plan,
      });

    assert.equal(publish(db1, planA), true);
    assert.equal(publish(db2, planB), false);
    assert.equal(loadValidWorldBlueprintPlan(db2, worldId, snap)?.goal, "CONN_A");
  });

  it("T4 pregen in-flight + sync fallback → one canonical artifact, campaign adopts winner", async () => {
    await withSandboxDirectorEnabled(true, async () => {
      const db = memoryDb();
      const worldId = insertWorld(db);
      const snap = loadWorldSnapshotForBlueprint(db, worldId)!;
      const campaignId = createCampaign(db, worldId, "sync");

      const pregenEntered = defer();
      const pregenRelease = defer();
      const syncEntered = defer();
      const syncRelease = defer();

      const pregenPromise = refreshWorldBlueprintArtifact(
        db,
        worldId,
        snap.sourceFingerprint,
        TRPG_SANDBOX_BLUEPRINT_DERIVATION_VERSION,
        {
          complete: async () => {
            pregenEntered.resolve();
            await syncEntered.promise;
            await pregenRelease.promise;
            return (await mockBlueprintComplete("PREGEN_PLAN")()) as never;
          },
        }
      );

      await pregenEntered.promise;
      const syncPromise = ensureCampaignDirectorContext(db, campaignId, {
        directorCall: async () => {
          syncEntered.resolve();
          await syncRelease.promise;
          return (await mockBlueprintComplete("SYNC_PLAN")()) as never;
        },
      });

      syncRelease.resolve();
      await syncPromise;
      pregenRelease.resolve();
      await pregenPromise;

      const artifact = loadValidWorldBlueprintPlan(db, worldId, snap)!;
      const ctx = loadCampaignContext(db, campaignId)!;
      assert.equal(artifact.goal, "SYNC_PLAN");
      assert.equal(ctx.directorPlan?.goal, "SYNC_PLAN");
    });
  });

  it("T5 pregen completes before sync fallback → canonical PREGEN_PLAN adopted by campaign", async () => {
    await withSandboxDirectorEnabled(true, async () => {
      const db = memoryDb();
      const worldId = insertWorld(db);
      const snap = loadWorldSnapshotForBlueprint(db, worldId)!;
      const campaignId = createCampaign(db, worldId, "sync");

      const pregenEntered = defer();
      const pregenRelease = defer();
      const syncEntered = defer();

      const pregenPromise = refreshWorldBlueprintArtifact(
        db,
        worldId,
        snap.sourceFingerprint,
        TRPG_SANDBOX_BLUEPRINT_DERIVATION_VERSION,
        {
          complete: async () => {
            pregenEntered.resolve();
            await pregenRelease.promise;
            return (await mockBlueprintComplete("PREGEN_PLAN")()) as never;
          },
        }
      );

      await pregenEntered.promise;
      pregenRelease.resolve();
      await pregenPromise;

      await ensureCampaignDirectorContext(db, campaignId, {
        directorCall: async () => {
          syncEntered.resolve();
          throw new Error("must not call provider");
        },
      });

      const artifact = loadValidWorldBlueprintPlan(db, worldId, snap)!;
      assert.equal(artifact.goal, "PREGEN_PLAN");
      assert.equal(loadCampaignContext(db, campaignId)?.directorPlan?.goal, "PREGEN_PLAN");
    });
  });

  it("T6 world revision changes during generation → stale result cannot publish, campaign keeps generated plan", async () => {
    await withSandboxDirectorEnabled(true, async () => {
      const db = memoryDb();
      const worldId = insertWorld(db, "revision A");
      const campaignId = createCampaign(db, worldId, "stale");

      await ensureCampaignDirectorContext(db, campaignId, {
        directorCall: async () => {
          db.prepare(`UPDATE worlds SET content='revision B', updated_at=datetime('now') WHERE id=?`).run(worldId);
          return (await mockBlueprintComplete("plan-from-A")()) as never;
        },
      });

      const ctx = loadCampaignContext(db, campaignId)!;
      assert.equal(ctx.directorPlan?.goal, "plan-from-A");
      assert.equal(loadWorldBlueprintArtifactRow(db, worldId), null);
    });
  });

  it("T7 artifact publication/storage failure → campaign still starts with generated plan", async () => {
    await withSandboxDirectorEnabled(true, async () => {
      const db = memoryDb();
      const worldId = insertWorld(db);
      const campaignId = createCampaign(db, worldId, "fail");
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

      await startTrpgCampaign(db, {
        campaignId,
        userId: 1,
        deps: {
          skipBilling: true,
          directorCall: mockBlueprintComplete("persisted-plan"),
          gmCall: async () => ({ text: gmText() }),
        },
      });

      const ctx = loadCampaignContext(db, campaignId)!;
      assert.equal(ctx.directorPlan?.goal, "persisted-plan");
      assert.equal(loadWorldBlueprintArtifactRow(db, worldId), null);
    });
  });

  it("T8 sequential baseline → Campaign A heals, Campaign B provider 0", async () => {
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
      const campaignA = createCampaign(db, worldId, "A");
      await startTrpgCampaign(db, { campaignId: campaignA, userId: 1, deps });
      assert.equal(directorCalls, 1);

      const campaignB = createCampaign(db, worldId, "B");
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
      assert.equal(loadCampaignContext(db, campaignB)?.directorPlan?.goal, "campaign-a");
    });
  });

  it("T9 valid artifact baseline → provider 0", async () => {
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
      const campaignId = createCampaign(db, worldId, "warm");
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
});

describe("canonical convergence reproduction (before-fix semantics)", () => {
  it("R1 — late same-generation CAS publish would have overwritten without WHERE guard", () => {
    const db = memoryDb();
    const worldId = insertWorld(db);
    const snap = loadWorldSnapshotForBlueprint(db, worldId)!;
    casPublishWorldBlueprintArtifact(db, {
      worldId,
      expectedSourceFingerprint: snap.sourceFingerprint,
      expectedDerivationVersion: TRPG_SANDBOX_BLUEPRINT_DERIVATION_VERSION,
      plan: planWithGoal("FIRST"),
    });
    const second = casPublishWorldBlueprintArtifact(db, {
      worldId,
      expectedSourceFingerprint: snap.sourceFingerprint,
      expectedDerivationVersion: TRPG_SANDBOX_BLUEPRINT_DERIVATION_VERSION,
      plan: planWithGoal("SECOND"),
    });
    assert.equal(second, false, "after fix: second same-generation publish is rejected");
    assert.equal(loadValidWorldBlueprintPlan(db, worldId, snap)?.goal, "FIRST");
  });
});
