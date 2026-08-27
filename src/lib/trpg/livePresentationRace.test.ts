import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  afterSnapshotObservationSettled,
  foldSnapshotObservations,
  shouldLaunchAdvanceKick,
  TRPG_SNAPSHOT_POLL_MS,
} from "./snapshotObserver";
import {
  resolveTrpgGmPacingSource,
  resolveTrpgGmRevealActive,
  resolveTrpgGmShownNarration,
} from "./gmProviderStreamDisplay";
import {
  advanceAfterActorAction,
  advanceAfterActorResult,
  advanceAfterDiceDismiss,
  buildRoundPresentationActors,
  shouldShowGmNarration,
  startCinematicPresentation,
  type RoundPresentationState,
} from "./roundPresentation";
import { resolveTrpgRevealVisibleCount } from "./revealTiming";

/**
 * Deterministic long-GM timeline (no live provider):
 * t=0 bots+rolls ready → cinematic starts
 * t=13s first GM narration draft
 * t=68s canonical complete
 */
describe("TRPG long-GM presentation + observer race", () => {
  it("PRESENTATION_BEGINS_BEFORE_GM_COMPLETE while GENERATING_NARRATION", () => {
    let state: RoundPresentationState = {
      mode: "cinematic",
      ...startCinematicPresentation(),
    };
    const actors = buildRoundPresentationActors({
      resolutionOrder: [1, 2, 3],
      actions: [
        {
          participantId: 1,
          name: "user",
          body: "간다",
          revealed: true,
          kind: "human",
          actionType: "free",
        },
        {
          participantId: 2,
          name: "bot1",
          body: "본다",
          revealed: true,
          kind: "ai_character",
          actionType: "free",
        },
        {
          participantId: 3,
          name: "bot2",
          body: "따른다",
          revealed: true,
          kind: "ai_character",
          actionType: "free",
        },
      ],
      rolls: [
        {
          participantId: 1,
          name: "user",
          d20: 12,
          dc: 10,
          tier: "SUCCESS",
          statKey: "str",
          finalScore: 14,
          success: true,
          actionBody: "간다",
          actionType: "free",
          kind: "human",
        },
        {
          participantId: 2,
          name: "bot1",
          d20: 10,
          dc: 10,
          tier: "SUCCESS",
          statKey: "str",
          finalScore: 12,
          success: true,
          actionBody: "본다",
          actionType: "free",
          kind: "ai_character",
        },
        {
          participantId: 3,
          name: "bot2",
          d20: 8,
          dc: 10,
          tier: "FAILURE",
          statKey: "str",
          finalScore: 10,
          success: false,
          actionBody: "따른다",
          actionType: "free",
          kind: "ai_character",
        },
      ],
    });

    assert.equal(shouldShowGmNarration(state), false);
    for (let i = 0; i < actors.length; i += 1) {
      state = {
        mode: "cinematic",
        ...advanceAfterActorAction({ actors, presentationIndex: state.presentationIndex }),
      };
      if (state.phase === "actor-dice") {
        state = {
          mode: "cinematic",
          ...advanceAfterDiceDismiss({ actors, presentationIndex: state.presentationIndex }),
        };
      }
      if (state.phase === "actor-result") {
        state = {
          mode: "cinematic",
          ...advanceAfterActorResult({ actors, presentationIndex: state.presentationIndex }),
        };
      }
    }
    assert.equal(shouldShowGmNarration(state), true, "GM slot opens after actors");
  });

  it("GM slot opens mid-provider: paced reveal from 0, then continues on draft growth", () => {
    const t13 = resolveTrpgGmPacingSource({
      gmStreamDraft: "첫 문장",
      canonicalNarration: null,
    });
    assert.equal(
      resolveTrpgGmRevealActive({
        allowGm: true,
        skipDecorativeReveal: false,
        isFreshLogKey: true,
      }),
      true
    );
    assert.equal(
      resolveTrpgGmShownNarration({
        allowGm: true,
        skipDecorativeReveal: false,
        pacingSource: t13,
        visibleCursorText: "",
      }),
      "",
      "starts at cursor 0"
    );
    const grown = resolveTrpgGmPacingSource({
      gmStreamDraft: "첫 문장 그리고 더",
      canonicalNarration: null,
    });
    const continued = resolveTrpgRevealVisibleCount({
      previousSession: { text: t13, active: true, kind: "gm" },
      nextSession: { text: grown, active: true, kind: "gm" },
      storedCount: 2,
      finishOwned: false,
      reducedMotion: false,
    });
    assert.equal(continued, 2, "cursor continues across draft growth");
  });

  it("GM canonical before slot: paced from 0 not instant full text", () => {
    const canonical = resolveTrpgGmPacingSource({
      gmStreamDraft: undefined,
      canonicalNarration: "x".repeat(80),
    });
    assert.equal(
      resolveTrpgGmShownNarration({
        allowGm: true,
        skipDecorativeReveal: false,
        pacingSource: canonical,
        visibleCursorText: "",
      }),
      "",
      "GM_CANONICAL_INSTANT_JUMP=false"
    );
  });

  it("COMMAND/OBSERVER: pending advance does not block next poll schedule", () => {
    const duringPending = afterSnapshotObservationSettled({
      setup: false,
      shouldKickAdvance: true,
      advanceKickInFlight: true,
      pollMs: TRPG_SNAPSHOT_POLL_MS,
    });
    assert.equal(duringPending.launchAdvanceKick, false, "no duplicate kick");
    assert.equal(duringPending.scheduleNextMs, TRPG_SNAPSHOT_POLL_MS);
    assert.equal(
      shouldLaunchAdvanceKick({
        setup: false,
        shouldKickAdvance: true,
        advanceKickInFlight: true,
      }),
      false
    );
    assert.equal(
      shouldLaunchAdvanceKick({
        setup: false,
        shouldKickAdvance: true,
        advanceKickInFlight: false,
      }),
      true
    );
  });

  it("OUT-OF-ORDER GET fold cannot regress generating draft state", () => {
    const final = foldSnapshotObservations([
      { seq: 10, roundNumber: 5, progress: 4_200_050 },
      { seq: 9, roundNumber: 5, progress: 2_001_000 },
      { seq: 8, roundNumber: 5, progress: 100 },
    ]);
    assert.equal(final?.appliedSeq, 10);
    assert.ok((final?.progress ?? 0) >= 4_200_050);
  });
});
