import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { isLiveTurnProcessing, liveTurnProcessStage } from "./liveTurnStatus";
import { trpgRetryBotsDisabled, trpgRoomGenerating } from "./roomClientState";

describe("TRPG bot_retry_required client and live status", () => {
  it("A retry UI idle state is not generating and retry stays enabled", () => {
    const generating = trpgRoomGenerating({
      phase: "BOT_ACTION",
      workType: "bot_retry_required",
      botGenerationInFlight: false,
      narrationRerolling: false,
    });
    assert.equal(generating, false);

    const stage = liveTurnProcessStage({
      waitingOpening: false,
      narrationRerolling: false,
      workType: "bot_retry_required",
      phase: "BOT_ACTION",
      viewerLocked: true,
      cinematicMotion: false,
      presentationStarting: false,
      gmTextReady: false,
      botGenerationInFlight: false,
    });
    assert.equal(stage, "none");

    const processing = isLiveTurnProcessing({
      waitingOpening: false,
      narrationRerolling: false,
      viewerLocked: true,
      phase: "BOT_ACTION",
      workType: "bot_retry_required",
      cinematicMotion: false,
      presentationStarting: false,
      gmTextReady: false,
      botGenerationInFlight: false,
    });
    assert.equal(processing, false);

    assert.equal(trpgRetryBotsDisabled({ busy: false, botGenerationInFlight: false }), false);

    const room = readFileSync("src/app/trpg/TrpgCampaignRoom.tsx", "utf8");
    assert.match(room, /disabled=\{busy \|\| snap\.botGenerationInFlight\}/);
    const client = readFileSync("src/app/trpg/[id]/TrpgRoomClient.tsx", "utf8");
    assert.match(client, /trpgRoomGenerating/);
    assert.doesNotMatch(client, /"BOT_ACTION"/);
  });

  it("B explicit retry start may show bots processing and blocks double submit", () => {
    assert.equal(
      trpgRoomGenerating({
        phase: "BOT_ACTION",
        workType: "generate_bots",
        botGenerationInFlight: true,
        narrationRerolling: false,
      }),
      true
    );
    assert.equal(trpgRetryBotsDisabled({ busy: false, botGenerationInFlight: true }), true);
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
        botGenerationInFlight: true,
      }),
      "bots"
    );
  });
});
