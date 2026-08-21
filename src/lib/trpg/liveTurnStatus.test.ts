import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { actionTypeLabelKo } from "./actionTypes";
import { actionNeedsCheck } from "./actionCheck";
import {
  formatLiveTurnProcessStatus,
  isLiveTurnCinematicMotion,
  isLiveTurnProcessing,
  liveTurnBotProgress,
  liveTurnProcessStage,
  nextLiveTurnElapsedSec,
} from "./liveTurnStatus";

describe("TRPG live turn process status", () => {
  it("keeps elapsed across bot/roll/GM stages and hides during cinematic motion", () => {
    const s1 = liveTurnProcessStage({
      waitingOpening: false,
      narrationRerolling: false,
      workType: "generate_bots",
      phase: "BOT_ACTION",
      viewerLocked: true,
      cinematicMotion: false,
      presentationStarting: false,
      gmTextReady: false,
    });
    assert.equal(s1, "bots");
    const started = nextLiveTurnElapsedSec({ active: true, startedAt: null, now: 1_000 });
    assert.equal(started.elapsedSec, 0);
    const s2 = nextLiveTurnElapsedSec({
      active: true,
      startedAt: started.startedAt,
      now: 9_000,
    });
    assert.equal(s2.elapsedSec, 8);
    assert.equal(s2.startedAt, started.startedAt);
    const s3 = liveTurnProcessStage({
      waitingOpening: false,
      narrationRerolling: false,
      workType: "acquire_gm_lock",
      phase: "ROLLING",
      viewerLocked: true,
      cinematicMotion: false,
      presentationStarting: false,
      gmTextReady: false,
    });
    assert.equal(s3, "rolls");
    const later = nextLiveTurnElapsedSec({
      active: true,
      startedAt: started.startedAt,
      now: 13_000,
    });
    assert.equal(later.elapsedSec, 12);
    assert.equal(isLiveTurnCinematicMotion("cinematic", "actor-action"), true);
    assert.equal(
      liveTurnProcessStage({
        waitingOpening: false,
        narrationRerolling: false,
        workType: "idle",
        phase: "GENERATING_NARRATION",
        viewerLocked: true,
        cinematicMotion: true,
        presentationStarting: false,
        gmTextReady: false,
      }),
      "none"
    );
    assert.equal(
      liveTurnProcessStage({
        waitingOpening: false,
        narrationRerolling: false,
        workType: "idle",
        phase: "GENERATING_NARRATION",
        viewerLocked: true,
        cinematicMotion: false,
        presentationStarting: false,
        gmTextReady: false,
      }),
      "gm"
    );
    assert.equal(
      formatLiveTurnProcessStatus({ stage: "gm", elapsedSec: 19 }),
      "● GM 장면 작성 중 · 19초"
    );
    assert.equal(
      formatLiveTurnProcessStatus({
        stage: "bots",
        elapsedSec: 8,
        botProgress: { done: 1, total: 2 },
      }),
      "● 동료 행동 구성 중 · 1/2 · 8초"
    );
    assert.equal(
      nextLiveTurnElapsedSec({ active: false, startedAt: started.startedAt, now: 20_000 }).elapsedSec,
      0
    );
  });

  it("covers opening, wait, reroll, and bot progress from snapshot ready state", () => {
    assert.equal(
      formatLiveTurnProcessStatus({ stage: "opening", elapsedSec: 7 }),
      "● 오프닝 장면 준비 중 · 7초"
    );
    assert.equal(
      formatLiveTurnProcessStatus({ stage: "wait_humans", elapsedSec: 14 }),
      "● 다른 플레이어 입력 대기 중 · 14초"
    );
    assert.equal(
      formatLiveTurnProcessStatus({ stage: "reroll", elapsedSec: 6 }),
      "● 장면 다시 작성 중 · 6초"
    );
    assert.deepEqual(
      liveTurnBotProgress([
        { kind: "human", canAct: true, status: "active", ready: "submitted" },
        { kind: "ai_character", canAct: true, status: "active", ready: "submitted" },
        { kind: "ai_character", canAct: true, status: "active", ready: "bot_pending" },
      ]),
      { done: 1, total: 2 }
    );
    assert.equal(
      isLiveTurnProcessing({
        waitingOpening: false,
        narrationRerolling: false,
        viewerLocked: true,
        phase: "GENERATING_NARRATION",
        workType: "idle",
        cinematicMotion: true,
        presentationStarting: false,
        gmTextReady: false,
      }),
      true
    );
    const room = readFileSync("src/app/trpg/TrpgCampaignRoom.tsx", "utf8");
    const client = readFileSync("src/app/trpg/[id]/TrpgRoomClient.tsx", "utf8");
    assert.match(room, /formatLiveTurnProcessStatus/);
    assert.match(room, /data-trpg-live-turn-status/);
    assert.doesNotMatch(room, /DeepSeek/);
    assert.match(client, /const POLL_MS = 1500/);
  });
});

describe("TRPG free action display label", () => {
  it("keeps backend free while showing 기타 행동", () => {
    assert.equal(actionTypeLabelKo("free"), "기타 행동");
    assert.equal(actionNeedsCheck({ body: "문을 민다.", actionType: "free" }), true);
    const types = readFileSync("src/lib/trpg/actionTypes.ts", "utf8");
    assert.match(types, /"free"/);
    assert.match(types, /return "기타 행동"/);
    assert.doesNotMatch(types, /자유 행동/);
  });
});
