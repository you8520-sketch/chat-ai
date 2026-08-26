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

  it("keeps elapsed across bot/roll/GM stages and prefers cinematic AI copy", () => {
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
        presentationMode: "cinematic",
        presentationPhase: "actor-action",
        cinematicAiActionActive: true,
      }),
      "presenting",
      "PRESENTATION_STATE_OVERRIDES_BACKEND_STATUS_COPY"
    );
    assert.equal(
      formatLiveTurnProcessStatus({ stage: "presenting", elapsedSec: 19 }),
      "● 동료 행동 표시 중 · 19초"
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
        presentationMode: "idle",
        presentationPhase: "idle",
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
    assert.match(room, /cinematicAiActionActive/);
    assert.doesNotMatch(room, /DeepSeek/);
    assert.match(client, /const POLL_MS = 1500/);
  });

  it("T_PROCESS_TIMER: elapsed stays; AI actor-action copy wins over GM generation", () => {
    const processStartedAtMs = 1_000_000;
    const base = {
      waitingOpening: false,
      narrationRerolling: false,
      workType: "idle",
      viewerLocked: true,
      gmTextReady: false,
      botGenerationInFlight: false,
    };

    assert.equal(processElapsedSecFromStartedAt(processStartedAtMs, processStartedAtMs), 0);
    assert.equal(processElapsedSecFromStartedAt(processStartedAtMs, processStartedAtMs + 3_000), 3);

    assert.equal(
      liveTurnProcessStage({
        ...base,
        phase: "BOT_ACTION",
        workType: "generate_bots",
        cinematicMotion: false,
        presentationStarting: false,
      }),
      "bots"
    );
    assert.equal(
      liveTurnProcessStage({
        ...base,
        phase: "GENERATING_NARRATION",
        cinematicMotion: true,
        presentationStarting: false,
        presentationMode: "cinematic",
        presentationPhase: "actor-action",
        cinematicAiActionActive: true,
      }),
      "presenting"
    );
    assert.equal(
      shouldHideProcessTimerForPresentation({
        overlayVisible: true,
        presentationMode: "cinematic",
        presentationPhase: "actor-dice",
        gmProseRevealing: false,
      }),
      true
    );
    assert.equal(
      liveTurnProcessStage({
        ...base,
        phase: "GENERATING_NARRATION",
        cinematicMotion: true,
        presentationStarting: false,
        overlayVisible: true,
        presentationMode: "cinematic",
        presentationPhase: "actor-dice",
      }),
      "none"
    );
    assert.equal(
      liveTurnProcessStage({
        ...base,
        phase: "GENERATING_NARRATION",
        cinematicMotion: true,
        presentationStarting: false,
        presentationMode: "cinematic",
        presentationPhase: "actor-result",
      }),
      "none"
    );
    assert.equal(
      liveTurnProcessStage({
        ...base,
        phase: "GENERATING_NARRATION",
        cinematicMotion: false,
        presentationStarting: false,
        presentationMode: "cinematic",
        presentationPhase: "gm-narration",
        gmTextReady: false,
        gmProseRevealing: false,
      }),
      "gm"
    );
    assert.equal(
      liveTurnProcessStage({
        ...base,
        phase: "GENERATING_NARRATION",
        cinematicMotion: false,
        presentationStarting: false,
        presentationMode: "cinematic",
        presentationPhase: "gm-narration",
        gmTextReady: true,
        gmProseRevealing: true,
      }),
      "none"
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
      true,
      "elapsed anchor stays active while pill may hide"
    );
  });

  it("WAIT_HUMANS stays a distinct copy owner and does not serialize process timer", () => {
    assert.equal(
      liveTurnProcessStage({
        waitingOpening: false,
        narrationRerolling: false,
        workType: "wait_humans",
        phase: "ACTION_INPUT",
        viewerLocked: true,
        cinematicMotion: false,
        presentationStarting: false,
        gmTextReady: false,
      }),
      "wait_humans"
    );
    assert.equal(
      isLiveTurnProcessing({
        waitingOpening: false,
        narrationRerolling: false,
        viewerLocked: false,
        phase: "ACTION_INPUT",
        workType: "wait_humans",
        cinematicMotion: false,
        presentationStarting: false,
        gmTextReady: false,
      }),
      false
    );
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
