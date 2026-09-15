import assert from "node:assert/strict";
import { describe, it } from "node:test";
import Database from "better-sqlite3";
import { EVEN_STATS, createTrpgCampaign, saveTrpgSheet } from "./engineCreate";
import {
  advanceTrpgCampaign,
  startTrpgCampaign,
  submitTrpgAction,
  type TrpgEngineDeps,
} from "./engineAdvance";
import { buildTrpgGmStructuredWireText } from "./gmStructuredOutput";
import {
  applyLocalSceneProgressToContext,
  loadCampaignContext,
  persistCampaignContext,
} from "./campaignContext";
import {
  resolveRoutineTraversalSceneTransition,
  type TrpgLocalSceneProgressV1,
} from "./localSceneProgress";
import { collectAcceptedRoutineTraversalRoutes } from "./roundAdjudication";
import { ensureTrpgTables } from "./schema";

const ROUTE = "우측 환풍구";

function memoryDb(): Database.Database {
  const db = new Database(":memory:");
  ensureTrpgTables(db);
  return db;
}

function gmText(opts?: { narration?: string; sceneTransitionTo?: string }): string {
  const delta: Record<string, unknown> = {
    players: [],
    location: "폐허",
    next_round_context: "다음을 고른다",
    campaign_finished: false,
  };
  if (opts?.sceneTransitionTo) delta.localScene = { sceneTransitionTo: opts.sceneTransitionTo };
  return buildTrpgGmStructuredWireText(
    opts?.narration ?? "폐허가 고요하다. 바람만 분다.",
    delta as never
  );
}

async function setupSolo(db: Database.Database, deps: TrpgEngineDeps): Promise<number> {
  const campaignId = createTrpgCampaign(db, { hostUserId: 1, hostNickname: "렌", viewerUserId: 1 });
  saveTrpgSheet(db, { campaignId, userId: 1, name: "렌", stats: EVEN_STATS });
  await startTrpgCampaign(db, { campaignId, userId: 1, deps });
  return campaignId;
}

function seedLocalScene(
  db: Database.Database,
  campaignId: number,
  scene: {
    objective: string;
    openRoutes?: string[];
    remainingBlockers?: string[];
    resolvedObstacles?: string[];
    sceneState?: TrpgLocalSceneProgressV1["sceneState"];
  }
): void {
  const ctx = loadCampaignContext(db, campaignId);
  assert.ok(ctx, "campaign context must exist after start");
  const next = applyLocalSceneProgressToContext(ctx!, {
    objectiveSet: scene.objective,
    openRoutesAdd: scene.openRoutes,
    remainingBlockersAdd: scene.remainingBlockers,
    resolvedObstaclesAdd: scene.resolvedObstacles,
    sceneStateSet: scene.sceneState,
  });
  persistCampaignContext(db, next);
}

function readLocalScene(db: Database.Database, campaignId: number): TrpgLocalSceneProgressV1 {
  const ctx = loadCampaignContext(db, campaignId);
  assert.ok(ctx);
  return ctx!.localSceneProgress;
}

/** Deterministic engine-shaped fixture: ready scene + open route, no blockers. */
async function readySceneCampaign(
  db: Database.Database,
  gmSceneTransitionTo?: string
): Promise<{ campaignId: number; deps: TrpgEngineDeps }> {
  const deps: TrpgEngineDeps = {
    skipBilling: true,
    rollD20: () => 14,
    rollDie: () => 4,
    gmCall: async () => ({ text: gmText({ sceneTransitionTo: gmSceneTransitionTo }) }),
  };
  const campaignId = await setupSolo(db, deps);
  seedLocalScene(db, campaignId, {
    objective: "경비 초소 돌파",
    openRoutes: [ROUTE],
    remainingBlockers: [],
    resolvedObstacles: ["잠긴 문"],
    sceneState: "transition_ready",
  });
  return { campaignId, deps };
}

describe("PHASE2 pure resolver — resolveRoutineTraversalSceneTransition", () => {
  it("GM already transitioned → null (GM wins, no double)", () => {
    assert.equal(
      resolveRoutineTraversalSceneTransition({ gmEmittedTransition: true, acceptedRoutineRoutes: [ROUTE] }),
      null
    );
  });

  it("no accepted routine traversal → null", () => {
    assert.equal(
      resolveRoutineTraversalSceneTransition({ gmEmittedTransition: false, acceptedRoutineRoutes: [] }),
      null
    );
  });

  it("exactly one accepted route → that route", () => {
    assert.equal(
      resolveRoutineTraversalSceneTransition({ gmEmittedTransition: false, acceptedRoutineRoutes: [ROUTE] }),
      ROUTE
    );
  });

  it("same route from multiple actors dedups → single route", () => {
    assert.equal(
      resolveRoutineTraversalSceneTransition({
        gmEmittedTransition: false,
        acceptedRoutineRoutes: [ROUTE, ROUTE],
      }),
      ROUTE
    );
  });

  it("multiple distinct routes → null (no silent choice)", () => {
    assert.equal(
      resolveRoutineTraversalSceneTransition({
        gmEmittedTransition: false,
        acceptedRoutineRoutes: [ROUTE, "지하 배수로"],
      }),
      null
    );
  });

  it("blank route labels are ignored", () => {
    assert.equal(
      resolveRoutineTraversalSceneTransition({ gmEmittedTransition: false, acceptedRoutineRoutes: ["  "] }),
      null
    );
  });
});

describe("PHASE2 collector — accepted routine traversal fact (adjudication owner)", () => {
  function collectorFixture(
    db: Database.Database,
    campaignId: number,
    subs: Array<{ participantId: number; body: string; reason?: string; needsCheck?: boolean }>
  ): { roundId: number } {
    const roundId = Number(
      db
        .prepare(`INSERT INTO trpg_rounds (campaign_id, round_number, phase) VALUES (?,?,?)`)
        .run(campaignId, 5, "ACTION_INPUT").lastInsertRowid
    );
    const snapshot: {
      adjudicationMarks: Record<string, string>;
      adjudicationDecisions: Record<string, { needsCheck: boolean; reason: string }>;
    } = { adjudicationMarks: {}, adjudicationDecisions: {} };
    for (const sub of subs) {
      const sid = Number(
        db
          .prepare(
            `INSERT INTO trpg_action_submissions (round_id, participant_id, body, action_type, locked, source)
             VALUES (?,?,?,?,1,'manual')`
          )
          .run(roundId, sub.participantId, sub.body, "free").lastInsertRowid
      );
      snapshot.adjudicationMarks[String(sid)] = "no_roll";
      snapshot.adjudicationDecisions[String(sid)] = {
        needsCheck: sub.needsCheck ?? false,
        reason: sub.reason ?? "routine_traversal",
      };
    }
    db.prepare(`UPDATE trpg_rounds SET input_snapshot_json=? WHERE id=?`).run(
      JSON.stringify(snapshot),
      roundId
    );
    return { roundId };
  }

  /** Host occupies slot 0; added fixtures use slots >= 1. */
  function addParticipant(db: Database.Database, campaignId: number, slot: number, kind: string): number {
    return Number(
      db
        .prepare(
          `INSERT INTO trpg_participants (campaign_id, slot_index, kind, display_name) VALUES (?,?,?,?)`
        )
        .run(campaignId, slot, kind, kind === "ai_character" ? "카이" : "렌").lastInsertRowid
    );
  }

  it("T6: two actors choose DIFFERENT routes → two distinct labels (ambiguous)", () => {
    const db = memoryDb();
    const campaignId = createTrpgCampaign(db, { hostUserId: 1, hostNickname: "렌", viewerUserId: 1 });
    const a = addParticipant(db, campaignId, 1, "human");
    const b = addParticipant(db, campaignId, 2, "human");
    const { roundId } = collectorFixture(db, campaignId, [
      { participantId: a, body: `${ROUTE}로 들어간다` },
      { participantId: b, body: "지하 배수로로 내려간다" },
    ]);
    const routes = collectAcceptedRoutineTraversalRoutes({
      db,
      roundId,
      openRoutes: [ROUTE, "지하 배수로"],
    });
    assert.equal(routes.length, 2);
    assert.equal(
      resolveRoutineTraversalSceneTransition({ gmEmittedTransition: false, acceptedRoutineRoutes: routes }),
      null,
      "ambiguous multi-route must not silently choose"
    );
    db.close();
  });

  it("T7: two actors same route → dedup to one transition", () => {
    const db = memoryDb();
    const campaignId = createTrpgCampaign(db, { hostUserId: 1, hostNickname: "렌", viewerUserId: 1 });
    const a = addParticipant(db, campaignId, 1, "human");
    const b = addParticipant(db, campaignId, 2, "human");
    const { roundId } = collectorFixture(db, campaignId, [
      { participantId: a, body: `${ROUTE}로 들어간다` },
      { participantId: b, body: `${ROUTE}을 통과한다` },
    ]);
    const routes = collectAcceptedRoutineTraversalRoutes({ db, roundId, openRoutes: [ROUTE] });
    assert.deepEqual(routes, [ROUTE, ROUTE]);
    assert.equal(
      resolveRoutineTraversalSceneTransition({ gmEmittedTransition: false, acceptedRoutineRoutes: routes }),
      ROUTE,
      "same route collapses to a single transition"
    );
    db.close();
  });

  it("T8: bot canonical attempt (INTENT) referencing a route is collected", () => {
    const db = memoryDb();
    const campaignId = createTrpgCampaign(db, { hostUserId: 1, hostNickname: "렌", viewerUserId: 1 });
    const bot = addParticipant(db, campaignId, 2, "ai_character");
    const { roundId } = collectorFixture(db, campaignId, [
      { participantId: bot, body: `카이가 앞장선다.\n\n<<<INTENT>>>\n${ROUTE}로 들어간다` },
    ]);
    const routes = collectAcceptedRoutineTraversalRoutes({ db, roundId, openRoutes: [ROUTE] });
    assert.deepEqual(routes, [ROUTE], "bot canonical INTENT reaches the same owner");
    db.close();
  });

  it("rolled traversal (needsCheck) is not an accepted routine traversal", () => {
    const db = memoryDb();
    const campaignId = createTrpgCampaign(db, { hostUserId: 1, hostNickname: "렌", viewerUserId: 1 });
    const a = addParticipant(db, campaignId, 1, "human");
    const { roundId } = collectorFixture(db, campaignId, [
      { participantId: a, body: `${ROUTE}로 들어간다`, needsCheck: true, reason: "challenge" },
    ]);
    assert.deepEqual(collectAcceptedRoutineTraversalRoutes({ db, roundId, openRoutes: [ROUTE] }), []);
    db.close();
  });
});

describe("PHASE2 engine integration — routine traversal consumes local scene", () => {
  it("T1: accepted routine traversal + GM omission → stale scene does not persist", async () => {
    const db = memoryDb();
    const { campaignId, deps } = await readySceneCampaign(db);
    submitTrpgAction(db, { campaignId, userId: 1, body: `${ROUTE}로 들어간다`, actionType: "free" });
    await advanceTrpgCampaign(db, { campaignId, userId: 1, deps });
    const after = readLocalScene(db, campaignId);
    assert.equal(after.objective, ROUTE, "server floor promotes the accepted canonical route");
    assert.deepEqual(after.openRoutes, [], "old open routes reset");
    assert.deepEqual(after.resolvedObstacles, [], "old resolved obstacles reset");
    assert.deepEqual(after.remainingBlockers, [], "old blockers reset");
    assert.equal(after.sceneState, "active");
    db.close();
  });

  it("T2: GM emitted transition wins; server fallback not duplicated", async () => {
    const db = memoryDb();
    const { campaignId, deps } = await readySceneCampaign(db, "지상 안전 거점");
    submitTrpgAction(db, { campaignId, userId: 1, body: `${ROUTE}로 들어간다`, actionType: "free" });
    await advanceTrpgCampaign(db, { campaignId, userId: 1, deps });
    const after = readLocalScene(db, campaignId);
    assert.equal(after.objective, "지상 안전 거점", "GM-authored transition is canonical");
    assert.notEqual(after.objective, ROUTE, "server floor must not override the GM transition");
    db.close();
  });

  it("T3: investigation is not movement → no transition", async () => {
    const db = memoryDb();
    const { campaignId, deps } = await readySceneCampaign(db);
    submitTrpgAction(db, { campaignId, userId: 1, body: `${ROUTE}를 살펴본다`, actionType: "investigate" });
    await advanceTrpgCampaign(db, { campaignId, userId: 1, deps });
    assert.equal(readLocalScene(db, campaignId).objective, "경비 초소 돌파");
    db.close();
  });

  it("T4: blocked route keeps the uncertainty path → no routine fallback", async () => {
    const db = memoryDb();
    const { campaignId, deps } = await readySceneCampaign(db);
    seedLocalScene(db, campaignId, {
      objective: "경비 초소 돌파",
      openRoutes: [ROUTE],
      remainingBlockers: ["경비 로봇"],
    });
    submitTrpgAction(db, { campaignId, userId: 1, body: `${ROUTE}로 들어간다`, actionType: "free" });
    await advanceTrpgCampaign(db, { campaignId, userId: 1, deps });
    assert.equal(readLocalScene(db, campaignId).objective, "경비 초소 돌파");
    db.close();
  });

  it("T5: rolled traversal (always-roll type) → no deterministic scene entry", async () => {
    const db = memoryDb();
    const { campaignId, deps } = await readySceneCampaign(db);
    submitTrpgAction(db, { campaignId, userId: 1, body: `${ROUTE}로 몰래 들어간다`, actionType: "stealth" });
    await advanceTrpgCampaign(db, { campaignId, userId: 1, deps });
    assert.equal(readLocalScene(db, campaignId).objective, "경비 초소 돌파");
    db.close();
  });

  it("T9: transition_ready with no submitted movement → no forced movement", async () => {
    const db = memoryDb();
    const { campaignId, deps } = await readySceneCampaign(db);
    submitTrpgAction(db, { campaignId, userId: 1, body: "잠시 숨을 고르며 주변을 살핀다", actionType: "free" });
    await advanceTrpgCampaign(db, { campaignId, userId: 1, deps });
    const after = readLocalScene(db, campaignId);
    assert.equal(after.objective, "경비 초소 돌파");
    assert.equal(after.sceneState, "transition_ready");
    db.close();
  });

  it("T10: transition uses existing reset semantics (no stale leak)", async () => {
    const db = memoryDb();
    const { campaignId, deps } = await readySceneCampaign(db);
    seedLocalScene(db, campaignId, {
      objective: "경비 초소 돌파",
      openRoutes: [ROUTE],
      resolvedObstacles: ["잠긴 문"],
      remainingBlockers: [],
    });
    submitTrpgAction(db, { campaignId, userId: 1, body: `${ROUTE}로 들어간다`, actionType: "free" });
    await advanceTrpgCampaign(db, { campaignId, userId: 1, deps });
    const after = readLocalScene(db, campaignId);
    assert.equal(after.objective, ROUTE);
    assert.deepEqual(after.resolvedObstacles, []);
    assert.deepEqual(after.openRoutes, []);
    assert.deepEqual(after.remainingBlockers, []);
    db.close();
  });
});
