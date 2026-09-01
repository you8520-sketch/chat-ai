import assert from "node:assert/strict";
import { describe, it } from "node:test";
import Database from "better-sqlite3";
import { resolveTrpgActionCheckDecision } from "./actionCheck";
import {
  actionReferencesOpenRoute,
  isResolvedObstacleRecurrence,
  isRoutineOpenRouteTraversal,
  sanitizeLocalSceneProgressDelta,
} from "./actionCheckContext";
import { classifyTrpgDifficultyBand } from "./adjudicationDifficulty";
import {
  applyLocalSceneProgressDelta,
  emptyLocalSceneProgress,
  type TrpgLocalSceneProgressV1,
} from "./localSceneProgress";
import { adjudicateCanonicalSubmission } from "./roundAdjudication";
import { ensureTrpgTables } from "./schema";
import { EVEN_STATS, createTrpgCampaign, saveTrpgSheet } from "./engineCreate";
import { ensurePreActionMechanics } from "./mechanicsRound";

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

describe("TRPG scene stall + routine competence (P0)", () => {
  it("S1 — open exit, no blockers: routine traversal skips check", () => {
    const scene = stallScene();
    const body = "우측 유지보수 통로로 빠져나간다.";
    assert.equal(isRoutineOpenRouteTraversal({ body, localScene: scene }), true);
    const decision = resolveTrpgActionCheckDecision({ body, actionType: "free", localScene: scene });
    assert.equal(decision.needsCheck, false);
    assert.equal(decision.reason, "routine_traversal");
  });

  it("S2 — hazardous crossing with blocker: check required", () => {
    const scene = applyLocalSceneProgressDelta(emptyLocalSceneProgress(), {
      objectiveSet: "탈출",
      openRoutesAdd: ["우측 통로"],
      remainingBlockersAdd: ["통로 중앙 붕괴"],
    });
    const body = "무너지는 구간을 뛰어넘는다.";
    assert.equal(isRoutineOpenRouteTraversal({ body, localScene: scene }), false);
    const decision = resolveTrpgActionCheckDecision({ body, actionType: "free", localScene: scene });
    assert.equal(decision.needsCheck, true);
  });

  it("S3 — resolved obstacle cannot be re-added as blocker via sanitize", () => {
    const current = applyLocalSceneProgressDelta(emptyLocalSceneProgress(), {
      resolvedObstaclesAdd: ["출구를 막는 기생종"],
      openRoutesAdd: ["정면 출구"],
    });
    const delta = sanitizeLocalSceneProgressDelta(current, {
      remainingBlockersAdd: ["출구를 막는 기생종"],
    });
    assert.equal(delta.remainingBlockersAdd, undefined);
    const next = applyLocalSceneProgressDelta(current, delta);
    assert.deepEqual(next.remainingBlockers, []);
  });

  it("S4 — mundane environmental actions skip check", () => {
    for (const body of [
      "정상 조명을 켠다.",
      "평범한 문을 연다.",
      "이미 안전이 확인된 복도를 걷는다.",
      "기본 장비를 정리한다.",
    ]) {
      const decision = resolveTrpgActionCheckDecision({ body, actionType: "free" });
      assert.equal(decision.needsCheck, false, body);
    }
  });

  it("S5 — specialist routine with high stat skips spurious investigate check", () => {
    const body = "보유 중인 군용 지도에서 현재 위치와 가장 가까운 출구를 확인한다.";
    const decision = resolveTrpgActionCheckDecision({
      body,
      actionType: "investigate",
      statValue: 13,
    });
    assert.equal(decision.needsCheck, false);
    assert.equal(decision.reason, "no_meaningful_uncertainty");
  });

  it("S5b — specialist equipment prep skips support check", () => {
    const body = "익숙한 무기를 꺼내 장전하고 기본 경계 자세를 취한다.";
    const decision = resolveTrpgActionCheckDecision({
      body,
      actionType: "support",
      statValue: 12,
    });
    assert.equal(decision.needsCheck, false);
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

  it("S8 — question does not imply traversal check", () => {
    const body = "두 동료를 바라보며 어느 길이 좋을지 묻는다.";
    const decision = resolveTrpgActionCheckDecision({ body, actionType: "free", localScene: stallScene() });
    assert.equal(decision.needsCheck, false);
  });

  it("S9 — bot own action does not inherit human route traversal exemption", () => {
    const scene = stallScene();
    const body = "우측 환기구를 조사한다.";
    assert.equal(isRoutineOpenRouteTraversal({ body, localScene: scene }), false);
  });

  it("transition_ready derives when routes open and blockers cleared", () => {
    const active = applyLocalSceneProgressDelta(emptyLocalSceneProgress(), {
      objectiveSet: "건물 탈출",
      resolvedObstaclesAdd: ["균사벽 제거"],
      openRoutesAdd: ["우측 통로"],
    });
    assert.equal(active.sceneState, "transition_ready");
  });

  it("obstacle recurrence detection catches functional duplicates", () => {
    assert.equal(isResolvedObstacleRecurrence(["출구를 막는 기생종"], "다른 기생종이 출구를 막음"), true);
    assert.equal(isResolvedObstacleRecurrence(["정면 균사벽 제거"], "우측 환풍구"), false);
  });
});

describe("TRPG building-escape multi-round simulation", () => {
  it("R1-R5 success path accumulates progress without obstacle resurrection or unnecessary checks", () => {
    const rounds: Array<{
      human: string;
      sceneBefore: TrpgLocalSceneProgressV1;
      delta: Parameters<typeof applyLocalSceneProgressDelta>[1];
    }> = [
      {
        human: "복도와 출구 후보를 살핀다.",
        sceneBefore: emptyLocalSceneProgress(),
        delta: { objectiveSet: "건물 탈출", openRoutesAdd: ["우측 유지보수 통로"] },
      },
      {
        human: "정면 균사벽을 제거한다.",
        sceneBefore: applyLocalSceneProgressDelta(emptyLocalSceneProgress(), {
          objectiveSet: "건물 탈출",
          openRoutesAdd: ["우측 유지보수 통로"],
        }),
        delta: {
          resolvedObstaclesAdd: ["정면 균사벽 제거"],
          remainingBlockersRemove: ["정면 균사벽"],
        },
      },
      {
        human: "우측 유지보수 통로가 열려 있는지 확인한다.",
        sceneBefore: applyLocalSceneProgressDelta(emptyLocalSceneProgress(), {
          objectiveSet: "건물 탈출",
          openRoutesAdd: ["우측 유지보수 통로"],
          resolvedObstaclesAdd: ["정면 균사벽 제거"],
        }),
        delta: { sceneStateSet: "transition_ready" },
      },
      {
        human: "우측 유지보수 통로로 빠져나간다.",
        sceneBefore: stallScene(),
        delta: { sceneTransitionTo: "건물 외부 안전 거리" },
      },
      {
        human: "주변을 경계하며 다음 이동 거점을 찾는다.",
        sceneBefore: applyLocalSceneProgressDelta(emptyLocalSceneProgress(), {
          sceneTransitionTo: "건물 외부 안전 거리",
        }),
        delta: { objectiveSet: "안전 거점 확보" },
      },
    ];

    let scene = emptyLocalSceneProgress();
    const progressEvents: string[] = [];
    const unnecessaryChecks: string[] = [];
    const recreatedObstacles: string[] = [];

    for (const [index, round] of rounds.entries()) {
      scene = round.sceneBefore;
      const check = resolveTrpgActionCheckDecision({
        body: round.human,
        actionType: index === 1 ? "attack" : index === 0 || index === 2 ? "investigate" : "free",
        localScene: scene,
        statValue: 12,
      });
      if (check.needsCheck && index === 3) {
        unnecessaryChecks.push(round.human);
      }
      const rawDelta = round.delta ?? {};
      const sanitized = sanitizeLocalSceneProgressDelta(scene, rawDelta);
      if (sanitized.remainingBlockersAdd?.some((b) => isResolvedObstacleRecurrence(scene.resolvedObstacles, b))) {
        recreatedObstacles.push(...(sanitized.remainingBlockersAdd ?? []));
      }
      const next = applyLocalSceneProgressDelta(scene, sanitized);
      if (next.objective !== scene.objective) progressEvents.push(`objective:${next.objective}`);
      if (next.sceneState !== scene.sceneState) progressEvents.push(`sceneState:${next.sceneState}`);
      if (next.openRoutes.length > scene.openRoutes.length) progressEvents.push(`openRoutes:+${next.openRoutes.at(-1)}`);
      if (next.resolvedObstacles.length > scene.resolvedObstacles.length) {
        progressEvents.push(`resolved:+${next.resolvedObstacles.at(-1)}`);
      }
      if (rawDelta.sceneTransitionTo) progressEvents.push(`transition:${rawDelta.sceneTransitionTo}`);
      scene = next;
    }

    assert.deepEqual(unnecessaryChecks, []);
    assert.deepEqual(recreatedObstacles, []);
    assert.equal(scene.objective, "안전 거점 확보");
    assert.match(progressEvents.join("|"), /transition:건물 외부 안전 거리/);
    assert.match(progressEvents.join("|"), /resolved:\+정면 균사벽 제거/);
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
    db.close();
  });
});
