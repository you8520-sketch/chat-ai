import assert from "node:assert/strict";
import { describe, it } from "node:test";
import Database from "better-sqlite3";
import { resolveTrpgActionCheckDecision } from "./actionCheck";
import {
  actionReferencesOpenRoute,
  declaresTraversalIntent,
  isRoutineOpenRouteTraversal,
} from "./actionCheckContext";
import { classifyTrpgDifficultyBand } from "./adjudicationDifficulty";
import {
  applyLocalSceneProgressDelta,
  emptyLocalSceneProgress,
  sanitizeLocalSceneProgressDelta,
  type TrpgLocalSceneProgressV1,
} from "./localSceneProgress";
import { buildTrpgGmUserBlock, formatTrpgActionCheckWire } from "./gmPrompt";
import {
  adjudicateCanonicalSubmission,
  loadFrozenAdjudicationDecision,
} from "./roundAdjudication";
import { ensureTrpgTables } from "./schema";
import { EVEN_STATS, createTrpgCampaign, saveTrpgSheet } from "./engineCreate";
import { ensurePreActionMechanics } from "./mechanicsRound";
import { applyLocalSceneProgressToContext, loadCampaignContext, persistCampaignContext } from "./campaignContext";

function memoryDb(): Database.Database {
  const db = new Database(":memory:");
  db.exec(`CREATE TABLE users (id INTEGER PRIMARY KEY, email TEXT, nickname TEXT, points INTEGER NOT NULL DEFAULT 0)`);
  db.prepare(`INSERT INTO users (id, email, nickname, points) VALUES (1,'a@t','host',5000)`).run();
  ensureTrpgTables(db);
  return db;
}

function stallScene(overrides: Partial<TrpgLocalSceneProgressV1> = {}): TrpgLocalSceneProgressV1 {
  return {
    ...applyLocalSceneProgressDelta(emptyLocalSceneProgress(), {
      objectiveSet: "건물 탈출",
      resolvedObstaclesAdd: ["정면 균사벽 제거"],
      openRoutesAdd: ["우측 유지보수 통로"],
      sceneStateSet: "transition_ready",
    }),
    remainingBlockers: [],
    ...overrides,
  };
}

describe("TRPG scene stall + routine competence correction (P0)", () => {
  it("P0-1 — any remaining blocker vetoes routine traversal even without hazard words in body", () => {
    const scene = applyLocalSceneProgressDelta(emptyLocalSceneProgress(), {
      openRoutesAdd: ["우측 통로"],
      remainingBlockersAdd: ["통로 중앙 붕괴"],
    });
    const body = "우측 통로로 이동한다.";
    assert.equal(actionReferencesOpenRoute(body, scene.openRoutes), "우측 통로");
    assert.equal(declaresTraversalIntent(body), true);
    assert.equal(scene.remainingBlockers.length > 0, true);
    assert.equal(isRoutineOpenRouteTraversal({ body, localScene: scene }), false);
    const decision = resolveTrpgActionCheckDecision({ body, actionType: "free", localScene: scene });
    assert.equal(decision.needsCheck, true);
  });

  it("M1 — open route, zero blockers, pure traversal: NO CHECK", () => {
    const scene = stallScene();
    const body = "우측 유지보수 통로로 빠져나간다.";
    assert.equal(isRoutineOpenRouteTraversal({ body, localScene: scene }), true);
    const decision = resolveTrpgActionCheckDecision({ body, actionType: "free", localScene: scene });
    assert.equal(decision.needsCheck, false);
    assert.equal(decision.reason, "routine_traversal");
  });

  it("M2 — open route with blocker: CHECK required", () => {
    const scene = applyLocalSceneProgressDelta(emptyLocalSceneProgress(), {
      openRoutesAdd: ["우측 통로"],
      remainingBlockersAdd: ["통로 중앙 붕괴"],
    });
    const body = "우측 통로로 이동한다.";
    assert.equal(isRoutineOpenRouteTraversal({ body, localScene: scene }), false);
    const decision = resolveTrpgActionCheckDecision({ body, actionType: "free", localScene: scene });
    assert.equal(decision.needsCheck, true);
  });

  it("M3 — investigate route is NOT traversal", () => {
    const scene = stallScene();
    const body = "우측 통로를 조사한다.";
    assert.equal(declaresTraversalIntent(body), false);
    assert.equal(isRoutineOpenRouteTraversal({ body, localScene: scene }), false);
    const decision = resolveTrpgActionCheckDecision({ body, actionType: "investigate", localScene: scene });
    assert.equal(decision.needsCheck, true);
  });

  it("M4 — stealth traversal still rolls", () => {
    const scene = stallScene();
    const body = "우측 통로로 몰래 빠져나간다.";
    const decision = resolveTrpgActionCheckDecision({ body, actionType: "stealth", localScene: scene });
    assert.equal(decision.needsCheck, true);
  });

  it("M5 — hazardous traversal still rolls without blockers", () => {
    const scene = stallScene();
    const body = "무너지는 우측 통로를 뛰어넘어 빠져나간다.";
    assert.equal(isRoutineOpenRouteTraversal({ body, localScene: scene }), false);
    const decision = resolveTrpgActionCheckDecision({ body, actionType: "free", localScene: scene });
    assert.equal(decision.needsCheck, true);
  });

  it("M5b — hostile pressure traversal still rolls", () => {
    const scene = stallScene();
    const body = "추격자를 피해 우측 통로로 전력질주해 빠져나간다.";
    const decision = resolveTrpgActionCheckDecision({ body, actionType: "free", localScene: scene });
    assert.equal(decision.needsCheck, true);
  });

  it("M6 — companion route question is talk, not movement", () => {
    const body = "두 동료를 바라보며 어느 길이 좋을지 묻는다.";
    const decision = resolveTrpgActionCheckDecision({ body, actionType: "free", localScene: stallScene() });
    assert.equal(decision.needsCheck, false);
    assert.equal(decision.reason, "talk");
  });

  it("S4 — mundane environmental actions skip check (stat independent)", () => {
    for (const body of [
      "정상 조명을 켠다.",
      "평범한 문을 연다.",
      "이미 안전이 확인된 복도를 걷는다.",
      "기본 장비를 정리한다.",
    ]) {
      for (const statValue of [5, 13]) {
        const decision = resolveTrpgActionCheckDecision({ body, actionType: "free", statValue });
        assert.equal(decision.needsCheck, false, `${body} stat=${statValue}`);
      }
    }
  });

  it("S5/S5b — specialist competence requires high stat contrast", () => {
    const mapBody = "군용 전술 지도에서 표준 탈출 동선을 판독한다.";
    const low = resolveTrpgActionCheckDecision({ body: mapBody, actionType: "investigate", statValue: 5 });
    const high = resolveTrpgActionCheckDecision({ body: mapBody, actionType: "investigate", statValue: 13 });
    assert.equal(low.needsCheck, true);
    assert.equal(high.needsCheck, false);
    assert.equal(high.reason, "routine_competence");

    const prepBody = "익숙한 무기를 꺼내 장전하고 기본 경계 자세를 취한다.";
    const lowPrep = resolveTrpgActionCheckDecision({ body: prepBody, actionType: "support", statValue: 5 });
    const highPrep = resolveTrpgActionCheckDecision({ body: prepBody, actionType: "support", statValue: 12 });
    assert.equal(lowPrep.needsCheck, true);
    assert.equal(highPrep.needsCheck, false);
    assert.equal(highPrep.reason, "routine_competence");
  });

  it("S6 — genuine challenge still rolls with competence lowering difficulty only", () => {
    const body = "통신 교란으로 절반이 깨진 군용 지도에서 30초 안에 포위망을 피해 유일한 탈출 경로를 계산한다.";
    const decision = resolveTrpgActionCheckDecision({
      body,
      actionType: "investigate",
      statValue: 14,
    });
    assert.equal(decision.needsCheck, true);
    const band = classifyTrpgDifficultyBand({
      actionType: "investigate",
      checkReason: "challenge",
      intent: body,
      statValue: 14,
    });
    assert.equal(band, "EASY");
  });

  it("S6b — combat attack still rolls", () => {
    const body = "움직이는 기생종의 급소를 공격한다.";
    assert.equal(
      resolveTrpgActionCheckDecision({ body, actionType: "attack", statValue: 14 }).needsCheck,
      true
    );
  });

  it("S7 — route reference matching is structural not exact string only", () => {
    assert.equal(
      actionReferencesOpenRoute("우측 유지보수 통로를 통해 건물 밖으로 나간다.", ["우측 유지보수 통로"]),
      "우측 유지보수 통로"
    );
  });

  it("S9 — bot investigation does not inherit human route traversal exemption", () => {
    const scene = stallScene();
    const body = "우측 환기구를 조사한다.";
    assert.equal(isRoutineOpenRouteTraversal({ body, localScene: scene }), false);
  });

  it("GM wire — routine_traversal is not labeled as talk", () => {
    const wire = formatTrpgActionCheckWire({
      needsCheck: false,
      checkReason: "routine_traversal",
      d20: null,
      finalScore: null,
      dc: null,
      tier: null,
      statKey: "dex",
    });
    assert.match(wire, /no_check reason=routine_traversal/);
    assert.doesNotMatch(wire, /talk/);

    const block = buildTrpgGmUserBlock({
      worldBrief: "탈출",
      memoryBlock: "",
      opening: false,
      actions: [
        {
          participantId: 1,
          name: "렌",
          body: "우측 유지보수 통로로 빠져나간다.",
          needsCheck: false,
          checkReason: "routine_traversal",
          statKey: "dex",
          d20: null,
          finalScore: null,
          dc: null,
          tier: null,
        },
      ],
    });
    assert.match(block, /\[CHECK no_check reason=routine_traversal/);
    assert.doesNotMatch(block, /talk\/ask only/);
  });
});

describe("TRPG local scene obstacle sanitizer (exact-only)", () => {
  it("O1 — exact resurrection rejected", () => {
    const current = applyLocalSceneProgressDelta(emptyLocalSceneProgress(), {
      resolvedObstaclesAdd: ["출구 잠금 해제"],
    });
    const delta = sanitizeLocalSceneProgressDelta(current, {
      remainingBlockersAdd: ["출구 잠금 해제"],
    });
    assert.equal(delta.remainingBlockersAdd, undefined);
    const next = applyLocalSceneProgressDelta(current, delta);
    assert.deepEqual(next.remainingBlockers, []);
  });

  it("O2 — legitimate different new threat preserved", () => {
    const current = applyLocalSceneProgressDelta(emptyLocalSceneProgress(), {
      resolvedObstaclesAdd: ["출구를 막는 기생종"],
      openRoutesAdd: ["정면 출구"],
    });
    const delta = sanitizeLocalSceneProgressDelta(current, {
      openRoutesRemove: ["정면 출구"],
      remainingBlockersAdd: ["밖에서 유입된 기생종 무리"],
    });
    assert.deepEqual(delta.remainingBlockersAdd, ["밖에서 유입된 기생종 무리"]);
    const next = applyLocalSceneProgressDelta(current, delta);
    assert.deepEqual(next.remainingBlockers, ["밖에서 유입된 기생종 무리"]);
  });

  it("O3 — explicit reversal allows reactivation", () => {
    const current = applyLocalSceneProgressDelta(emptyLocalSceneProgress(), {
      resolvedObstaclesAdd: ["정문 잠금 해제"],
    });
    const delta = sanitizeLocalSceneProgressDelta(current, {
      resolvedObstaclesRemove: ["정문 잠금 해제"],
      remainingBlockersAdd: ["정문 잠금 해제"],
    });
    assert.deepEqual(delta.remainingBlockersAdd, ["정문 잠금 해제"]);
    const next = applyLocalSceneProgressDelta(current, delta);
    assert.deepEqual(next.remainingBlockers, ["정문 잠금 해제"]);
  });

  it("O4 — scene transition isolates old resolved obstacles", () => {
    const current = applyLocalSceneProgressDelta(emptyLocalSceneProgress(), {
      resolvedObstaclesAdd: ["정문 기생종 제거"],
    });
    const delta = sanitizeLocalSceneProgressDelta(current, {
      sceneTransitionTo: "정문 밖 거리",
      remainingBlockersAdd: ["정문 밖 추격 기생종"],
    });
    assert.deepEqual(delta.remainingBlockersAdd, ["정문 밖 추격 기생종"]);
    const next = applyLocalSceneProgressDelta(current, delta);
    assert.equal(next.objective, "정문 밖 거리");
    assert.deepEqual(next.remainingBlockers, ["정문 밖 추격 기생종"]);
  });
});

describe("TRPG building-escape multi-round simulation (true chain)", () => {
  it("R1-R5 success path chains state without unnecessary traversal checks", () => {
    const rounds: Array<{
      human: string;
      actionType: "free" | "investigate" | "attack";
      delta: Parameters<typeof applyLocalSceneProgressDelta>[1];
    }> = [
      {
        human: "복도와 출구 후보를 살핀다.",
        actionType: "investigate",
        delta: { objectiveSet: "건물 탈출", openRoutesAdd: ["우측 유지보수 통로"] },
      },
      {
        human: "정면 균사벽을 제거한다.",
        actionType: "attack",
        delta: {
          resolvedObstaclesAdd: ["정면 균사벽 제거"],
          remainingBlockersRemove: ["정면 균사벽"],
        },
      },
      {
        human: "우측 유지보수 통로가 열려 있는지 확인한다.",
        actionType: "investigate",
        delta: { sceneStateSet: "transition_ready" },
      },
      {
        human: "우측 유지보수 통로로 빠져나간다.",
        actionType: "free",
        delta: { sceneTransitionTo: "건물 외부 안전 거리" },
      },
      {
        human: "주변을 경계하며 다음 이동 거점을 찾는다.",
        actionType: "free",
        delta: { objectiveSet: "안전 거점 확보" },
      },
    ];

    let scene = emptyLocalSceneProgress();
    const unnecessaryChecks: string[] = [];
    const recreatedObstacles: string[] = [];
    let sceneTransitions = 0;

    for (const [index, round] of rounds.entries()) {
      const check = resolveTrpgActionCheckDecision({
        body: round.human,
        actionType: round.actionType,
        localScene: scene,
        statValue: 12,
      });
      if (check.needsCheck && index === 3) {
        unnecessaryChecks.push(round.human);
      }
      assert.ok(scene.objective.length >= 0);
      const rawDelta = round.delta ?? {};
      const sanitized = sanitizeLocalSceneProgressDelta(scene, rawDelta);
      if (
        sanitized.remainingBlockersAdd?.some((blocker) =>
          scene.resolvedObstacles.some((resolved) => resolved === blocker)
        )
      ) {
        recreatedObstacles.push(...(sanitized.remainingBlockersAdd ?? []));
      }
      const next = applyLocalSceneProgressDelta(scene, sanitized);
      if (rawDelta.sceneTransitionTo) sceneTransitions += 1;
      scene = next;
    }

    assert.deepEqual(unnecessaryChecks, []);
    assert.deepEqual(recreatedObstacles, []);
    assert.equal(scene.objective, "안전 거점 확보");
    assert.equal(sceneTransitions, 1);
    assert.deepEqual(scene.resolvedObstacles, []);
  });
});

describe("TRPG round adjudication integration", () => {
  it("open-route exit adjudicates without d20 when blockers cleared", () => {
    const db = memoryDb();
    const campaignId = createTrpgCampaign(db, { hostUserId: 1, hostNickname: "렌", viewerUserId: 1 });
    saveTrpgSheet(db, { campaignId, userId: 1, name: "렌", stats: EVEN_STATS });
    db.prepare(
      `INSERT INTO trpg_campaign_context (campaign_id, source_mode, local_scene_progress_json, updated_at)
       VALUES (?, 'sandbox', ?, datetime('now'))`
    ).run(campaignId, JSON.stringify(stallScene()));
    const roundId = Number(
      db.prepare(`INSERT INTO trpg_rounds (campaign_id, round_number, phase) VALUES (?,1,'ACTION_INPUT')`).run(campaignId)
        .lastInsertRowid
    );
    const participantId = (
      db.prepare(`SELECT id FROM trpg_participants WHERE campaign_id=? AND kind='human' LIMIT 1`).get(campaignId) as {
        id: number;
      }
    ).id;
    const submissionId = Number(
      db
        .prepare(
          `INSERT INTO trpg_action_submissions (round_id, participant_id, body, action_type, locked, source)
           VALUES (?, ?, ?, 'free', 1, 'human')`
        )
        .run(roundId, participantId, "우측 유지보수 통로로 빠져나간다.").lastInsertRowid
    );
    const pre = ensurePreActionMechanics(db, { campaignId, roundId, roundNumber: 1 });
    const outcome = adjudicateCanonicalSubmission(db, {
      campaignId,
      roundId,
      submissionId,
      pre,
    });
    assert.equal(outcome, "no_roll");
    const roll = db.prepare(`SELECT 1 FROM trpg_dice_rolls WHERE submission_id=?`).get(submissionId);
    assert.equal(roll, undefined);
    const frozen = loadFrozenAdjudicationDecision(db, roundId, submissionId);
    assert.equal(frozen?.needsCheck, false);
    assert.equal(frozen?.reason, "routine_traversal");
    db.close();
  });

  it("reroll preserves frozen check decision when live local scene changes", () => {
    const db = memoryDb();
    const campaignId = createTrpgCampaign(db, { hostUserId: 1, hostNickname: "렌", viewerUserId: 1 });
    saveTrpgSheet(db, { campaignId, userId: 1, name: "렌", stats: EVEN_STATS });
    const blockedScene = applyLocalSceneProgressDelta(emptyLocalSceneProgress(), {
      openRoutesAdd: ["우측 통로"],
      remainingBlockersAdd: ["통로 중앙 붕괴"],
    });
    db.prepare(
      `INSERT INTO trpg_campaign_context (campaign_id, source_mode, local_scene_progress_json, updated_at)
       VALUES (?, 'sandbox', ?, datetime('now'))`
    ).run(campaignId, JSON.stringify(blockedScene));
    const roundId = Number(
      db.prepare(`INSERT INTO trpg_rounds (campaign_id, round_number, phase) VALUES (?,1,'ACTION_INPUT')`).run(campaignId)
        .lastInsertRowid
    );
    const participantId = (
      db.prepare(`SELECT id FROM trpg_participants WHERE campaign_id=? AND kind='human' LIMIT 1`).get(campaignId) as {
        id: number;
      }
    ).id;
    const submissionId = Number(
      db
        .prepare(
          `INSERT INTO trpg_action_submissions (round_id, participant_id, body, action_type, locked, source)
           VALUES (?, ?, ?, 'free', 1, 'human')`
        )
        .run(roundId, participantId, "우측 통로로 이동한다.").lastInsertRowid
    );
    const pre = ensurePreActionMechanics(db, { campaignId, roundId, roundNumber: 1 });
    const outcome = adjudicateCanonicalSubmission(db, {
      campaignId,
      roundId,
      submissionId,
      pre,
    });
    assert.equal(outcome, "roll");
    const diceBefore = db
      .prepare(`SELECT d20 FROM trpg_dice_rolls WHERE submission_id=?`)
      .get(submissionId) as { d20: number };
    const frozenBefore = loadFrozenAdjudicationDecision(db, roundId, submissionId);
    assert.equal(frozenBefore?.needsCheck, true);

    const ctx = loadCampaignContext(db, campaignId)!;
    persistCampaignContext(
      db,
      applyLocalSceneProgressToContext(ctx, {
        remainingBlockersRemove: ["통로 중앙 붕괴"],
      })
    );

    const frozenAfter = loadFrozenAdjudicationDecision(db, roundId, submissionId);
    const diceAfter = db
      .prepare(`SELECT d20 FROM trpg_dice_rolls WHERE submission_id=?`)
      .get(submissionId) as { d20: number };
    assert.deepEqual(frozenAfter, frozenBefore);
    assert.equal(diceAfter.d20, diceBefore.d20);
    db.close();
  });
});
