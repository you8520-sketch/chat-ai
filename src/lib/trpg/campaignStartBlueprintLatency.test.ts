import assert from "node:assert/strict";
import { buildTrpgGmStructuredWireText } from "./gmStructuredOutput";
import { readFileSync } from "node:fs";
import { join } from "node:path";
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
import { ensureCampaignDirectorContext, isTrpgSandboxDirectorEnabled } from "./sandboxDirector";
import { insertScenarioTemplate } from "./scenarioTemplates";

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

function gmText(narration = "ok"): string {
  return buildTrpgGmStructuredWireText(narration, {
    players: [],
    location: "문턱",
    next_round_context: "다음",
    campaign_finished: false,
  });
}

function startDeps(): TrpgEngineDeps {
  return {
    skipBilling: true,
    gmCall: async () => ({ text: gmText() }),
  };
}

type BlockedWorkerCampaignProof = {
  campaignId: number;
  workerCalls: number;
  gmCalls: number;
  workerReleased: boolean;
};

/** Deterministic proof that campaign start does not await blocked worker Blueprint generation. */
async function assertCampaignStartBeforeWorkerRelease(opts: {
  db: Database.Database;
  worldId: number;
  workerPlanGoal: string;
  gmNarration?: string;
}): Promise<BlockedWorkerCampaignProof> {
  const { db, worldId } = opts;
  const snap = loadWorldSnapshotForBlueprint(db, worldId)!;
  enqueueWorldBlueprintPregenJob(db, worldId);
  const job = claimNextDerivedCacheJob(db)!;
  assert.equal(job.status, "processing");

  let workerCalls = 0;
  let workerReleased = false;
  const workerEntered = defer<void>();
  const workerRelease = defer<void>();
  const gmEntered = defer<void>();

  const workerPromise = refreshWorldBlueprintArtifact(
    db,
    worldId,
    snap.sourceFingerprint,
    TRPG_SANDBOX_BLUEPRINT_DERIVATION_VERSION,
    {
      complete: async () => {
        workerCalls += 1;
        workerEntered.resolve();
        await workerRelease.promise;
        workerReleased = true;
        return (await mockBlueprintComplete(opts.workerPlanGoal)()) as never;
      },
    }
  );

  await workerEntered.promise;

  let gmCalls = 0;
  const campaignId = await startWorldCampaign(db, worldId, {
    ...startDeps(),
    gmCall: async () => {
      gmCalls += 1;
      gmEntered.resolve();
      return { text: gmText(opts.gmNarration ?? "opening") };
    },
  });

  await gmEntered.promise;
  assert.equal(gmCalls, 1, "GM_ENTERED_BEFORE_WORKER_RELEASE=true");
  assert.equal(workerCalls, 1);
  assert.equal(workerReleased, false, "WORKER_STILL_BLOCKED_WHEN_CAMPAIGN_COMPLETED=true");
  assert.equal(loadCampaignContext(db, campaignId)?.directorPlan, null);
  assert.equal(loadWorldBlueprintArtifactRow(db, worldId), null, "CAMPAIGN_START_BLUEPRINT_PROVIDER_CALLS=0");

  workerRelease.resolve();
  await workerPromise;
  completeDerivedCacheJob(db, job.id, { ok: true });

  return { campaignId, workerCalls, gmCalls, workerReleased };
}

async function startWorldCampaign(
  db: Database.Database,
  worldId: number,
  deps: TrpgEngineDeps = startDeps()
): Promise<number> {
  const campaignId = createTrpgCampaign(db, {
    hostUserId: 1,
    hostNickname: "렌",
    viewerUserId: 1,
    worldId,
  });
  saveTrpgSheet(db, { campaignId, userId: 1, name: "렌", stats: EVEN_STATS });
  await startTrpgCampaign(db, { campaignId, userId: 1, deps });
  return campaignId;
}

describe("campaign start sandbox blueprint latency (AFTER contract)", () => {
  it("structural — sandboxDirector never imports campaign-start Blueprint generation", () => {
    const src = readFileSync(join(process.cwd(), "src/lib/trpg/sandboxDirector.ts"), "utf8");
    assert.doesNotMatch(src, /generateWorldSandboxBlueprint/);
    assert.doesNotMatch(src, /resolveSyncFallbackDirectorPlan/);
    assert.doesNotMatch(src, /directorCall/);
  });

  it("structural — no wall-clock latency correctness assertions in this suite", () => {
    const src = readFileSync(join(process.cwd(), "src/lib/trpg/campaignStartBlueprintLatency.test.ts"), "utf8");
    assert.doesNotMatch(src, /Date\.now\(\)\s*-\s*started\s*</);
    assert.doesNotMatch(src, /<\s*500/);
  });

  it("post-#800 — GM completion integrity preserved after rebase", () => {
    const src = readFileSync(join(process.cwd(), "src/lib/trpg/engineAdvance.ts"), "utf8");
    assert.match(src, /assertGmCompletionCanCommit/);
    assert.match(src, /finishReason/);
    assert.match(src, /semanticDone/);
    assert.match(src, /clearGmNarrationDraftForGeneration/);
    assert.doesNotMatch(src, /directorCall/);
    const runGmIdx = src.indexOf("async function runGmForRound");
    assert.ok(runGmIdx >= 0);
    const runGmBody = src.slice(runGmIdx, runGmIdx + 8000);
    const afterGmCall = runGmBody.slice(runGmBody.indexOf("await gmCall"));
    const usageIdx = Math.min(
      ...["appendGmRoundUsageForGeneration", "appendRoundUsage"]
        .map((needle) => afterGmCall.indexOf(needle))
        .filter((idx) => idx >= 0)
    );
    const integrityIdx = afterGmCall.indexOf("assessGmCompletionIntegrity");
    assert.ok(Number.isFinite(usageIdx) && integrityIdx > usageIdx, "GM_USAGE_BEFORE_INTEGRITY_ORDER_PRESERVED=true");
  });

  it("A — valid same-revision artifact: plan copied, GM 1, no campaign-start provider path", async () => {
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
      let gmCalls = 0;
      const campaignId = await startWorldCampaign(db, worldId, {
        ...startDeps(),
        gmCall: async () => {
          gmCalls += 1;
          return { text: gmText("warm") };
        },
      });
      assert.equal(gmCalls, 1);
      const ctx = loadCampaignContext(db, campaignId)!;
      assert.equal(ctx.directorPlan?.goal, playablePlan.goal);
      assert.notEqual(ctx.directorPlan, loadValidWorldBlueprintPlan(db, worldId, snap));
    });
  });

  it("B — missing artifact / no job: directorPlan null, campaign starts", async () => {
    await withSandboxDirectorEnabled(true, async () => {
      const db = memoryDb();
      const worldId = insertWorld(db);
      let gmCalls = 0;
      const campaignId = await startWorldCampaign(db, worldId, {
        ...startDeps(),
        gmCall: async () => {
          gmCalls += 1;
          return { text: gmText("cold") };
        },
      });
      assert.equal(gmCalls, 1);
      assert.equal(loadCampaignContext(db, campaignId)?.directorPlan, null);
      assert.equal(loadWorldBlueprintArtifactRow(db, worldId), null);
    });
  });

  it("C — pending pregen: campaign does not wait or mutate job", async () => {
    await withSandboxDirectorEnabled(true, async () => {
      const db = memoryDb();
      const worldId = insertWorld(db);
      const snap = loadWorldSnapshotForBlueprint(db, worldId)!;
      enqueueWorldBlueprintPregenJob(db, worldId);
      const before = findDerivedCacheJobByIdentity(db, {
        jobKind: WORLD_BLUEPRINT_PREGEN_JOB_KIND,
        entityType: "world",
        entityId: worldId,
        sourceFingerprint: snap.sourceFingerprint,
        derivationVersion: TRPG_SANDBOX_BLUEPRINT_DERIVATION_VERSION,
      })!;
      const campaignId = await startWorldCampaign(db, worldId);
      assert.equal(loadCampaignContext(db, campaignId)?.directorPlan, null);
      const after = findDerivedCacheJobByIdentity(db, {
        jobKind: WORLD_BLUEPRINT_PREGEN_JOB_KIND,
        entityType: "world",
        entityId: worldId,
        sourceFingerprint: snap.sourceFingerprint,
        derivationVersion: TRPG_SANDBOX_BLUEPRINT_DERIVATION_VERSION,
      })!;
      assert.equal(after.id, before.id);
      assert.equal(after.status, "pending");
      assert.equal(after.attempts, before.attempts);
    });
  });

  it("D — processing pregen: campaign does not wait on blocked worker", async () => {
    await withSandboxDirectorEnabled(true, async () => {
      const db = memoryDb();
      const worldId = insertWorld(db);
      const proof = await assertCampaignStartBeforeWorkerRelease({
        db,
        worldId,
        workerPlanGoal: "worker-plan",
      });
      assert.equal(proof.workerCalls, 1);
      assert.equal(proof.gmCalls, 1);
    });
  });

  it("E — stale/invalid artifact: no stale plan, directorPlan null", async () => {
    await withSandboxDirectorEnabled(true, async () => {
      const db = memoryDb();
      const worldId = insertWorld(db, "revision A");
      const snapA = loadWorldSnapshotForBlueprint(db, worldId)!;
      casPublishWorldBlueprintArtifact(db, {
        worldId,
        expectedSourceFingerprint: snapA.sourceFingerprint,
        expectedDerivationVersion: TRPG_SANDBOX_BLUEPRINT_DERIVATION_VERSION,
        plan: { ...playablePlan, goal: "stale-plan" },
      });
      db.prepare(`UPDATE worlds SET content='revision B', updated_at=datetime('now') WHERE id=?`).run(worldId);
      const snapB = loadWorldSnapshotForBlueprint(db, worldId)!;
      assert.notEqual(snapA.sourceFingerprint, snapB.sourceFingerprint);
      assert.equal(loadValidWorldBlueprintPlan(db, worldId, snapB), null);

      const campaignId = await startWorldCampaign(db, worldId);
      assert.equal(loadCampaignContext(db, campaignId)?.directorPlan, null);
      assert.match(loadWorldBlueprintArtifactRow(db, worldId)!.director_plan_json, /stale-plan/);
    });
  });

  it("F — worker disabled equivalent: no artifact → directorPlan null, campaign starts", async () => {
    await withSandboxDirectorEnabled(true, async () => {
      const db = memoryDb();
      const worldId = insertWorld(db);
      const campaignId = await startWorldCampaign(db, worldId);
      assert.equal(loadCampaignContext(db, campaignId)?.directorPlan, null);
      assert.equal(loadWorldBlueprintArtifactRow(db, worldId), null);
    });
  });

  it("G — worker generation failure: campaign start independent, directorPlan null", async () => {
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
            throw new Error("worker provider down");
          },
        }
      );
      completeDerivedCacheJob(db, job.id, outcome);
      assert.equal(outcome.ok, false);

      const campaignId = await startWorldCampaign(db, worldId);
      assert.equal(loadCampaignContext(db, campaignId)?.directorPlan, null);
    });
  });

  it("H — worker finished before click: artifact hit, warm plan copied", async () => {
    await withSandboxDirectorEnabled(true, async () => {
      const db = memoryDb();
      const worldId = insertWorld(db);
      const snap = loadWorldSnapshotForBlueprint(db, worldId)!;
      enqueueWorldBlueprintPregenJob(db, worldId);
      const job = claimNextDerivedCacheJob(db)!;
      let workerCalls = 0;
      const outcome = await refreshWorldBlueprintArtifact(
        db,
        worldId,
        snap.sourceFingerprint,
        TRPG_SANDBOX_BLUEPRINT_DERIVATION_VERSION,
        {
          complete: async () => {
            workerCalls += 1;
            return (await mockBlueprintComplete("warmed")()) as never;
          },
        }
      );
      completeDerivedCacheJob(db, job.id, outcome);
      assert.equal(workerCalls, 1);
      assert.ok(loadValidWorldBlueprintPlan(db, worldId, snap));

      const campaignId = await startWorldCampaign(db, worldId);
      assert.equal(loadCampaignContext(db, campaignId)?.directorPlan?.goal, "warmed");
    });
  });

  it("I — worker completes after first campaign: one-shot null preserved, second campaign uses artifact", async () => {
    await withSandboxDirectorEnabled(true, async () => {
      const db = memoryDb();
      const worldId = insertWorld(db);
      const snap = loadWorldSnapshotForBlueprint(db, worldId)!;
      const campaignA = await startWorldCampaign(db, worldId);
      assert.equal(loadCampaignContext(db, campaignA)?.directorPlan, null);

      const outcome = await refreshWorldBlueprintArtifact(
        db,
        worldId,
        snap.sourceFingerprint,
        TRPG_SANDBOX_BLUEPRINT_DERIVATION_VERSION,
        { complete: mockBlueprintComplete("late-warm") }
      );
      assert.equal(outcome.ok, true);
      assert.ok(loadValidWorldBlueprintPlan(db, worldId, snap));

      await ensureCampaignDirectorContext(db, campaignA);
      assert.equal(loadCampaignContext(db, campaignA)?.directorPlan, null);

      const campaignB = await startWorldCampaign(db, worldId);
      assert.equal(loadCampaignContext(db, campaignB)?.directorPlan?.goal, "late-warm");
    });
  });

  it("J — concurrent worker + campaign start: one worker candidate, campaign not blocked", async () => {
    await withSandboxDirectorEnabled(true, async () => {
      const db = memoryDb();
      const worldId = insertWorld(db);
      const snap = loadWorldSnapshotForBlueprint(db, worldId)!;
      assert.equal(loadWorldBlueprintArtifactRow(db, worldId), null);

      const proof = await assertCampaignStartBeforeWorkerRelease({
        db,
        worldId,
        workerPlanGoal: "concurrent",
      });
      assert.equal(proof.workerCalls, 1, "SANDBOX_BLUEPRINT_PROVIDER_GENERATION_OWNER_COUNT=1");
      assert.ok(loadWorldBlueprintArtifactRow(db, worldId));
      assert.equal(loadValidWorldBlueprintPlan(db, worldId, snap)?.goal, "concurrent");
    });
  });

  it("K — scenario-template campaign: authored plan preserved", async () => {
    await withSandboxDirectorEnabled(true, async () => {
      const db = memoryDb();
      insertWorld(db);
      const templateId = insertScenarioTemplate(db, 7, {
        title: "폐역",
        summary: "유령 기차를 기다리는 공포 TRPG",
        content: "유령 기차",
        visibility: "public",
        scenarioPlan: playablePlan,
      });
      const campaignId = createTrpgCampaign(db, {
        hostUserId: 1,
        hostNickname: "렌",
        viewerUserId: 1,
        templateId,
      });
      saveTrpgSheet(db, { campaignId, userId: 1, name: "렌", stats: EVEN_STATS });
      await startTrpgCampaign(db, { campaignId, userId: 1, deps: startDeps() });
      const ctx = loadCampaignContext(db, campaignId)!;
      assert.equal(ctx.sourceMode, "scenario");
      assert.equal(ctx.directorPlan?.goal, playablePlan.goal);
    });
  });

  it("L — feature flag OFF: sandbox-disabled regression unchanged", async () => {
    await withSandboxDirectorEnabled(false, async () => {
      assert.equal(isTrpgSandboxDirectorEnabled(), false);
      const db = memoryDb();
      const worldId = insertWorld(db);
      const snap = loadWorldSnapshotForBlueprint(db, worldId)!;
      casPublishWorldBlueprintArtifact(db, {
        worldId,
        expectedSourceFingerprint: snap.sourceFingerprint,
        expectedDerivationVersion: TRPG_SANDBOX_BLUEPRINT_DERIVATION_VERSION,
        plan: playablePlan,
      });
      const campaignId = await startWorldCampaign(db, worldId);
      assert.equal(loadCampaignContext(db, campaignId)?.directorPlan, null);
      assert.equal(loadCampaignContext(db, campaignId)?.sourceMode, "sandbox");
    });
  });
});
