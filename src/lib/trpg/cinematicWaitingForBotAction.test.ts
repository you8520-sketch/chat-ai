import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import {
  liveTurnProcessStage,
  resolveCinematicWaitingForBotAction,
} from "./liveTurnStatus";

const baseStage = {
  waitingOpening: false,
  narrationRerolling: false,
  viewerLocked: true,
  cinematicMotion: true,
  presentationStarting: false,
  gmTextReady: false,
  botGenerationInFlight: true,
  presentationMode: "cinematic" as const,
  presentationPhase: "actor-action" as const,
};

describe("resolveCinematicWaitingForBotAction — canonical predicate owner", () => {
  it("Human slot + generate_bots → false (no companion mislabel on human)", () => {
    assert.equal(
      resolveCinematicWaitingForBotAction({
        cinematicActorAction: true,
        cinematicAiActionActive: false,
        activePresentationActionKind: "human",
        activePresentationActorHasAction: true,
        activePresentationActionAvailable: true,
        botGenerationInFlight: true,
        workType: "generate_bots",
      }),
      false
    );
    assert.equal(
      liveTurnProcessStage({
        ...baseStage,
        workType: "generate_bots",
        phase: "BOT_ACTION",
        cinematicAiActionActive: false,
        cinematicWaitingForBotAction: false,
      }),
      "none",
      "human actor-action stays none — not companion copy"
    );
  });

  it("missing Bot1 slot + generate_bots → true → bots stage", () => {
    const waiting = resolveCinematicWaitingForBotAction({
      cinematicActorAction: true,
      cinematicAiActionActive: false,
      activePresentationActionKind: null,
      activePresentationActorHasAction: false,
      activePresentationActionAvailable: false,
      botGenerationInFlight: true,
      workType: "generate_bots",
    });
    assert.equal(waiting, true);
    assert.equal(
      liveTurnProcessStage({
        ...baseStage,
        cinematicWaitingForBotAction: waiting,
      }),
      "bots"
    );
  });

  it("Bot1 revealing + Bot2 backend generation → PRESENTING wins", () => {
    assert.equal(
      resolveCinematicWaitingForBotAction({
        cinematicActorAction: true,
        cinematicAiActionActive: true,
        activePresentationActionKind: "ai_character",
        activePresentationActorHasAction: true,
        activePresentationActionAvailable: true,
        botGenerationInFlight: true,
        workType: "generate_bots",
      }),
      false
    );
    assert.equal(
      liveTurnProcessStage({
        ...baseStage,
        cinematicAiActionActive: true,
        cinematicWaitingForBotAction: false,
      }),
      "presenting"
    );
  });

  it("Bot1 complete, missing Bot2 slot + generate_bots → bots stage", () => {
    const waiting = resolveCinematicWaitingForBotAction({
      cinematicActorAction: true,
      cinematicAiActionActive: false,
      activePresentationActionKind: null,
      activePresentationActorHasAction: false,
      activePresentationActionAvailable: false,
      botGenerationInFlight: true,
      workType: "generate_bots",
    });
    assert.equal(waiting, true);
    assert.equal(
      liveTurnProcessStage({
        ...baseStage,
        cinematicWaitingForBotAction: waiting,
      }),
      "bots"
    );
  });

  it("botGenerationInFlight=false and workType idle → none at bot slot", () => {
    assert.equal(
      resolveCinematicWaitingForBotAction({
        cinematicActorAction: true,
        cinematicAiActionActive: false,
        activePresentationActionKind: null,
        activePresentationActorHasAction: false,
        activePresentationActionAvailable: false,
        botGenerationInFlight: false,
        workType: "idle",
      }),
      false
    );
    assert.equal(
      liveTurnProcessStage({
        ...baseStage,
        workType: "idle",
        botGenerationInFlight: false,
        cinematicWaitingForBotAction: false,
      }),
      "none"
    );
  });

  it("second round parity — same predicate boundaries", () => {
    const round2Waiting = resolveCinematicWaitingForBotAction({
      cinematicActorAction: true,
      cinematicAiActionActive: false,
      activePresentationActionKind: null,
      activePresentationActorHasAction: false,
      activePresentationActionAvailable: false,
      botGenerationInFlight: true,
      workType: "generate_bots",
    });
    assert.equal(round2Waiting, true);
    assert.equal(
      liveTurnProcessStage({
        ...baseStage,
        cinematicWaitingForBotAction: round2Waiting,
      }),
      "bots"
    );
  });

  it("multi-human party: human slot never resolves as waiting-for-bot", () => {
    for (const kind of ["human"] as const) {
      assert.equal(
        resolveCinematicWaitingForBotAction({
          cinematicActorAction: true,
          cinematicAiActionActive: false,
          activePresentationActionKind: kind,
          activePresentationActorHasAction: true,
          activePresentationActionAvailable: true,
          botGenerationInFlight: true,
          workType: "generate_bots",
        }),
        false
      );
    }
  });

  it("PRODUCTION_PREDICATE_OWNER_COUNT=1 — room calls canonical helper", () => {
    const room = readFileSync("src/app/trpg/TrpgCampaignRoom.tsx", "utf8");
    const status = readFileSync("src/lib/trpg/liveTurnStatus.ts", "utf8");
    assert.match(room, /resolveCinematicWaitingForBotAction\(/);
    assert.match(status, /export function resolveCinematicWaitingForBotAction/);
    assert.doesNotMatch(
      room,
      /activePresentationAction\?\.kind !== "human"[\s\S]{0,120}activePresentationActor\?\.action == null/
    );
  });
});
