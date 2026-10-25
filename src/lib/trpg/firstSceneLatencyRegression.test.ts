import assert from "node:assert/strict";
import { describe, it } from "node:test";
import Database from "better-sqlite3";
import {
  claimNextDerivedCacheJob,
  completeDerivedCacheJob,
  ensureDerivedCacheJobsTable,
  findDerivedCacheJobByIdentity,
} from "@/lib/derivedCache/jobs";
import {
  enqueueWorldBlueprintPregenJob,
  refreshWorldBlueprintArtifact,
  WORLD_BLUEPRINT_PREGEN_JOB_KIND,
} from "@/lib/derivedCache/worldBlueprintPregen";
import { TRPG_SANDBOX_BLUEPRINT_DERIVATION_VERSION } from "./blueprintValidity";
import { loadCampaignContext } from "./campaignContext";
import { createTrpgCampaign, EVEN_STATS, saveTrpgSheet } from "./engineCreate";
import { startTrpgCampaign, type TrpgEngineDeps } from "./engineAdvance";
import { TRPG_SCENARIO_DRAFT_MODEL } from "./scenarioDraft";
import { parseTrpgScenarioPlan } from "./scenarioPlan";
import { ensureTrpgTables } from "./schema";
import {
  casPublishWorldBlueprintArtifact,
  loadValidWorldBlueprintPlan,
  loadWorldBlueprintArtifactRow,
  loadWorldSnapshotForBlueprint,
} from "./worldBlueprintArtifact";

const DIRECTOR_DELAY_MS = 800;
const GM_DELAY_MS = 400;

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

type FirstSceneTimeline = {
  campaignStartAt: number;
  directorCallAt: number | null;
  directorDoneAt: number | null;
  gmCallAt: number | null;
  campaignDoneAt: number;
  directorProviderCalls: number;
  gmProviderCalls: number;
};

export type FirstSceneWaitClass =
  | "DIRECTOR_WAIT"
  | "GM_WAIT"
  | "DIRECTOR_PLUS_GM"
  | "UNKNOWN";

export function classifyFirstSceneWait(timeline: FirstSceneTimeline): FirstSceneWaitClass {
  const directorMs =
    timeline.directorCallAt != null && timeline.directorDoneAt != null
      ? timeline.directorDoneAt - timeline.directorCallAt
      : 0;
  const gmMs =
    timeline.gmCallAt != null ? timeline.campaignDoneAt - timeline.gmCallAt : 0;
  const directorHeavy = directorMs >= 200;
  const gmHeavy = gmMs >= 200;
  if (directorHeavy && gmHeavy) return "DIRECTOR_PLUS_GM";
  if (directorHeavy) return "DIRECTOR_WAIT";
  if (gmHeavy) return "GM_WAIT";
  return "UNKNOWN";
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

function gmText(): string {
  return `<<<NARRATION>>>\nok\n<<<DELTA>>>\n{"players":[],"location":"x","next_round_context":"y","campaign_finished":false,"storyPhase":"DEVELOPMENT"}`;
}

function mockBlueprintComplete(goal: string, delayMs = 0) {
  return async () => {
    if (delayMs > 0) await new Promise((r) => setTimeout(r, delayMs));
    return {
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
      latencyMs: delayMs,
      model: TRPG_SCENARIO_DRAFT_MODEL,
    };
  };
}

async function runCampaignStartTimeline(
  db: Database.Database,
  worldId: number,
  opts: {
    directorDelayMs?: number;
    gmDelayMs?: number;
    directorShouldFail?: boolean;
    goal?: string;
  } = {}
): Promise<FirstSceneTimeline> {
  const timeline: FirstSceneTimeline = {
    campaignStartAt: 0,
    directorCallAt: null,
    directorDoneAt: null,
    gmCallAt: null,
    campaignDoneAt: 0,
    directorProviderCalls: 0,
    gmProviderCalls: 0,
  };
  let directorInFlight = false;

  const deps: TrpgEngineDeps = {
    skipBilling: true,
    directorCall: async () => {
      timeline.directorProviderCalls += 1;
      timeline.directorCallAt = Date.now();
      directorInFlight = true;
      if (opts.directorShouldFail) {
        directorInFlight = false;
        timeline.directorDoneAt = Date.now();
        throw new Error("blueprint generation failed");
      }
      const result = await mockBlueprintComplete(opts.goal ?? "harness-goal", opts.directorDelayMs ?? 0)();
      directorInFlight = false;
      timeline.directorDoneAt = Date.now();
      return result as never;
    },
    gmCall: async () => {
      assert.equal(directorInFlight, false, "GM must not start while director provider is in flight");
      timeline.gmProviderCalls += 1;
      timeline.gmCallAt = Date.now();
      if ((opts.gmDelayMs ?? 0) > 0) await new Promise((r) => setTimeout(r, opts.gmDelayMs));
      return { text: gmText() };
    },
  };

  const campaignId = createTrpgCampaign(db, {
    hostUserId: 1,
    hostNickname: "렌",
    viewerUserId: 1,
    worldId,
  });
  saveTrpgSheet(db, { campaignId, userId: 1, name: "렌", stats: EVEN_STATS });

  timeline.campaignStartAt = Date.now();
  await startTrpgCampaign(db, { campaignId, userId: 1, deps });
  timeline.campaignDoneAt = Date.now();

  return timeline;
}

describe("first-scene latency regression harness", () => {
  it("S1 — valid artifact exists → campaign-start provider calls 0, GM starts immediately", async () => {
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

      const timeline = await runCampaignStartTimeline(db, worldId, { directorDelayMs: DIRECTOR_DELAY_MS });
      assert.equal(timeline.directorProviderCalls, 0);
      assert.equal(timeline.gmProviderCalls, 1);
      assert.ok(timeline.gmCallAt != null);
      assert.equal(classifyFirstSceneWait(timeline), "UNKNOWN");
      assert.ok(loadValidWorldBlueprintPlan(db, worldId, snap));
    });
  });

  it("S2 — artifact missing, no job → sync fallback provider call 1, GM after director", async () => {
    await withSandboxDirectorEnabled(true, async () => {
      const db = memoryDb();
      const worldId = insertWorld(db);
      const timeline = await runCampaignStartTimeline(db, worldId, {
        directorDelayMs: DIRECTOR_DELAY_MS,
        goal: "cold-miss",
      });

      assert.equal(timeline.directorProviderCalls, 1);
      assert.equal(timeline.gmProviderCalls, 1);
      assert.ok(timeline.directorDoneAt != null && timeline.gmCallAt != null);
      assert.ok(timeline.gmCallAt! >= timeline.directorDoneAt!);
      assert.equal(classifyFirstSceneWait(timeline), "DIRECTOR_WAIT");

      const snap = loadWorldSnapshotForBlueprint(db, worldId)!;
      assert.ok(loadValidWorldBlueprintPlan(db, worldId, snap));
    });
  });

  it("S3 — pending pregen ignored → sync fallback still calls provider (duplicate work risk)", async () => {
    await withSandboxDirectorEnabled(true, async () => {
      const db = memoryDb();
      const worldId = insertWorld(db);
      enqueueWorldBlueprintPregenJob(db, worldId);

      const timeline = await runCampaignStartTimeline(db, worldId, { directorDelayMs: DIRECTOR_DELAY_MS });
      assert.equal(timeline.directorProviderCalls, 1);

      const snap = loadWorldSnapshotForBlueprint(db, worldId)!;
      const job = findDerivedCacheJobByIdentity(db, {
        jobKind: WORLD_BLUEPRINT_PREGEN_JOB_KIND,
        entityType: "world",
        entityId: worldId,
        sourceFingerprint: snap.sourceFingerprint,
        derivationVersion: TRPG_SANDBOX_BLUEPRINT_DERIVATION_VERSION,
      });
      assert.equal(job?.status, "pending");
    });
  });

  it("S4 — processing pregen ignored → sync fallback parallel provider candidate", async () => {
    await withSandboxDirectorEnabled(true, async () => {
      const db = memoryDb();
      const worldId = insertWorld(db);
      enqueueWorldBlueprintPregenJob(db, worldId);
      const job = claimNextDerivedCacheJob(db);
      assert.ok(job);
      assert.equal(job.status, "processing");

      const timeline = await runCampaignStartTimeline(db, worldId, { directorDelayMs: DIRECTOR_DELAY_MS });
      assert.equal(timeline.directorProviderCalls, 1);
      assert.equal(job.status, "processing");
    });
  });

  it("S5 — stale artifact → treated as missing, sync fallback runs", async () => {
    await withSandboxDirectorEnabled(true, async () => {
      const db = memoryDb();
      const worldId = insertWorld(db);
      const snap = loadWorldSnapshotForBlueprint(db, worldId)!;
      casPublishWorldBlueprintArtifact(db, {
        worldId,
        expectedSourceFingerprint: "stale-fingerprint",
        expectedDerivationVersion: TRPG_SANDBOX_BLUEPRINT_DERIVATION_VERSION,
        plan: playablePlan,
      });
      assert.equal(loadValidWorldBlueprintPlan(db, worldId, snap), null);

      const timeline = await runCampaignStartTimeline(db, worldId, { directorDelayMs: DIRECTOR_DELAY_MS });
      assert.equal(timeline.directorProviderCalls, 1);
      assert.ok(loadValidWorldBlueprintPlan(db, worldId, snap));
    });
  });

  it("S6 — blueprint generation failure → campaign still starts, directorPlan null", async () => {
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

      let gmCalled = false;
      await startTrpgCampaign(db, {
        campaignId,
        userId: 1,
        deps: {
          skipBilling: true,
          directorCall: async () => ({
            text: JSON.stringify({ goal: "incomplete" }),
            latencyMs: 1,
            model: TRPG_SCENARIO_DRAFT_MODEL,
          }),
          gmCall: async () => {
            gmCalled = true;
            return { text: gmText() };
          },
        },
      });

      assert.equal(gmCalled, true);
      const ctx = loadCampaignContext(db, campaignId);
      assert.equal(ctx?.directorPlan, null);
      assert.ok(ctx?.directorError);
      assert.equal(loadWorldBlueprintArtifactRow(db, worldId), null);
    });
  });

  it("S7 — concurrent campaign start + worker → duplicate provider candidates, single artifact", async () => {
    await withSandboxDirectorEnabled(true, async () => {
      const db = memoryDb();
      const worldId = insertWorld(db);
      const snap = loadWorldSnapshotForBlueprint(db, worldId)!;
      enqueueWorldBlueprintPregenJob(db, worldId);

      let workerCalls = 0;
      let syncCalls = 0;
      const workerGate = { release: () => {} };
      const workerStarted = new Promise<void>((resolve) => {
        workerGate.release = resolve;
      });

      const campaignId = createTrpgCampaign(db, {
        hostUserId: 1,
        hostNickname: "렌",
        viewerUserId: 1,
        worldId,
      });
      saveTrpgSheet(db, { campaignId, userId: 1, name: "렌", stats: EVEN_STATS });

      const workerPromise = (async () => {
        const job = claimNextDerivedCacheJob(db);
        assert.ok(job);
        workerGate.release();
        const outcome = await refreshWorldBlueprintArtifact(
          db,
          worldId,
          job.source_fingerprint,
          job.derivation_version,
          {
            complete: async () => {
              workerCalls += 1;
              await new Promise((r) => setTimeout(r, DIRECTOR_DELAY_MS));
              return (await mockBlueprintComplete("worker-plan")()) as never;
            },
          }
        );
        completeDerivedCacheJob(db, job.id, outcome);
      })();

      await workerStarted;
      await startTrpgCampaign(db, {
        campaignId,
        userId: 1,
        deps: {
          skipBilling: true,
          directorCall: async () => {
            syncCalls += 1;
            await new Promise((r) => setTimeout(r, DIRECTOR_DELAY_MS));
            return (await mockBlueprintComplete("sync-plan")()) as never;
          },
          gmCall: async () => ({ text: gmText() }),
        },
      });
      await workerPromise;

      assert.equal(workerCalls, 1);
      assert.equal(syncCalls, 1);
      const artifact = loadValidWorldBlueprintPlan(db, worldId, snap);
      assert.ok(artifact);
      assert.ok(artifact.goal === "sync-plan" || artifact.goal === "worker-plan");
    });
  });

  it("telemetry gap — existing logs cannot correlate director vs GM without shared trace id", () => {
    const directorLog = { kind: "sandbox_blueprint", latencyMs: 120_000, stage: "primary" };
    const gmLog = { elapsedMs: 95_000, firstContentMs: 12_000 };
    const canSplit =
      typeof directorLog.latencyMs === "number" &&
      typeof gmLog.elapsedMs === "number" &&
      "campaignId" in directorLog &&
      "campaignId" in gmLog;
    assert.equal(canSplit, false);
  });

  it("combined delay — DIRECTOR_PLUS_GM when both mocked slow", async () => {
    await withSandboxDirectorEnabled(true, async () => {
      const db = memoryDb();
      const worldId = insertWorld(db);
      const timeline = await runCampaignStartTimeline(db, worldId, {
        directorDelayMs: DIRECTOR_DELAY_MS,
        gmDelayMs: GM_DELAY_MS,
      });
      assert.equal(classifyFirstSceneWait(timeline), "DIRECTOR_PLUS_GM");
      assert.ok(timeline.campaignDoneAt - timeline.campaignStartAt >= DIRECTOR_DELAY_MS + GM_DELAY_MS - 50);
    });
  });
});
