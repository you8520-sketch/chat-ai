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
  shouldHideProcessTimerForPresentation,
} from "./liveTurnStatus";
import { processElapsedSecFromStartedAt } from "./processTimer";

describe("TRPG live turn process status", () => {
  it("bot_retry_required idle stops live processing and bots stage", () => {
    assert.equal(
      liveTurnProcessStage({
        waitingOpening: false,
        narrationRerolling: false,
        workType: "bot_retry_required",
        phase: "BOT_ACTION",
        viewerLocked: true,
        cinematicMotion: false,
        presentationStarting: false,
        gmTextReady: false,
        botGenerationInFlight: false,
      }),
      "none"
    );
    assert.equal(
      isLiveTurnProcessing({
        waitingOpening: false,
        narrationRerolling: false,
        viewerLocked: true,
        phase: "BOT_ACTION",
        workType: "bot_retry_required",
        cinematicMotion: false,
        presentationStarting: false,
        gmTextReady: false,
        botGenerationInFlight: false,
      }),
      false
    );
    assert.equal(
      formatLiveTurnProcessStatus({
        stage: "none",
        elapsedSec: 12,
      }),
      null
    );
  });

  it("generate_bots work type owns bots stage without relying on BOT_ACTION phase alone", () => {
    assert.equal(
      liveTurnProcessStage({
        waitingOpening: false,
        narrationRerolling: false,
        workType: "generate_bots",
        phase: "BOT_ACTION",
        viewerLocked: true,
        cinematicMotion: false,
        presentationStarting: false,
        gmTextReady: false,
        botGenerationInFlight: false,
      }),
      "bots"
    );
    assert.equal(
      liveTurnProcessStage({
        waitingOpening: false,
        narrationRerolling: false,
        workType: "bot_retry_required",
        phase: "BOT_ACTION",
        viewerLocked: true,
        cinematicMotion: false,
        presentationStarting: false,
        gmTextReady: false,
        botGenerationInFlight: true,
      }),
      "bots"
    );
  });

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

  it("T_PROCESS_TIMER_AI_REVEAL: elapsed ticks and stays visible through sequential reveal", () => {
    const processStartedAtMs = 1_000_000;
    const baseStage = {
      waitingOpening: false,
      narrationRerolling: false,
      workType: "idle",
      viewerLocked: true,
      gmTextReady: false,
      botGenerationInFlight: false,
      sequentialActionRevealPending: true,
    };

    assert.equal(processElapsedSecFromStartedAt(processStartedAtMs, processStartedAtMs), 0, "0초 at T0");
    assert.equal(
      processElapsedSecFromStartedAt(processStartedAtMs, processStartedAtMs + 1_000),
      1,
      "PROCESS_ELAPSED_SEC_TICKS_WHILE_AI_REVEAL"
    );
    assert.equal(processElapsedSecFromStartedAt(processStartedAtMs, processStartedAtMs + 2_000), 2);
    assert.equal(processElapsedSecFromStartedAt(processStartedAtMs, processStartedAtMs + 3_000), 3);

    const t0Stage = liveTurnProcessStage({
      ...baseStage,
      phase: "BOT_ACTION",
      cinematicMotion: false,
      presentationStarting: false,
    });
    assert.equal(t0Stage, "bots");
    assert.equal(
      formatLiveTurnProcessStatus({ stage: t0Stage, elapsedSec: 0 }),
      "● 동료 행동 구성 중 · 0초"
    );
    assert.equal(
      isLiveTurnProcessing({
        waitingOpening: baseStage.waitingOpening,
        narrationRerolling: baseStage.narrationRerolling,
        viewerLocked: baseStage.viewerLocked,
        phase: "BOT_ACTION",
        workType: baseStage.workType,
        cinematicMotion: false,
        presentationStarting: false,
        gmTextReady: baseStage.gmTextReady,
        botGenerationInFlight: baseStage.botGenerationInFlight,
        sequentialActionRevealPending: true,
      }),
      true
    );

    const rollsPersistStage = liveTurnProcessStage({
      ...baseStage,
      phase: "ROLLING",
      cinematicMotion: false,
      presentationStarting: true,
    });
    assert.notEqual(rollsPersistStage, "none", "timer STILL visible when presentationStarting during sequential reveal");
    assert.equal(
      formatLiveTurnProcessStatus({
        stage: rollsPersistStage,
        elapsedSec: processElapsedSecFromStartedAt(processStartedAtMs, processStartedAtMs + 2_000),
      }),
      "● 라운드 판정 준비 중 · 2초"
    );
    assert.equal(
      shouldHideProcessTimerForPresentation({
        cinematicMotion: false,
        presentationStarting: true,
        sequentialActionRevealPending: true,
      }),
      false
    );

    const ai2Stage = liveTurnProcessStage({
      ...baseStage,
      phase: "ROLLING",
      presentationStarting: true,
      cinematicMotion: false,
    });
    assert.notEqual(ai2Stage, "none", "timer STILL visible while AI2 reveal");
    assert.equal(
      formatLiveTurnProcessStatus({
        stage: ai2Stage,
        elapsedSec: processElapsedSecFromStartedAt(processStartedAtMs, processStartedAtMs + 3_000),
      }),
      "● 라운드 판정 준비 중 · 3초"
    );

    const queueDrainedStage = liveTurnProcessStage({
      ...baseStage,
      sequentialActionRevealPending: false,
      phase: "ROLLING",
      presentationStarting: true,
      cinematicMotion: false,
    });
    assert.equal(queueDrainedStage, "none", "process status hides after queue drained + presentation owns row");
    assert.equal(
      shouldHideProcessTimerForPresentation({
        cinematicMotion: false,
        presentationStarting: true,
        sequentialActionRevealPending: false,
      }),
      true
    );

    const cinematicAfterDrain = liveTurnProcessStage({
      waitingOpening: false,
      narrationRerolling: false,
      workType: "idle",
      phase: "GENERATING_NARRATION",
      viewerLocked: true,
      gmTextReady: false,
      cinematicMotion: true,
      presentationStarting: false,
      sequentialActionRevealPending: false,
    });
    assert.equal(cinematicAfterDrain, "none");
  });

  it("production room passes sequentialActionRevealPending into process timer owners", () => {
    const room = readFileSync("src/app/trpg/TrpgCampaignRoom.tsx", "utf8");
    assert.match(room, /sequentialActionRevealPending,/);
    assert.match(room, /liveTurnProcessStage\(\{[\s\S]*sequentialActionRevealPending/);
    assert.match(room, /isLiveTurnProcessing\(\{[\s\S]*sequentialActionRevealPending/);
    assert.match(room, /!overlayPlayback\.visible/);
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
