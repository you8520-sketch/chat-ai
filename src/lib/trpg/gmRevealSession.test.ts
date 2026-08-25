import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  resolveEffectiveGmRevealComplete,
  resolveTrpgLiveFollowOwner,
  shouldShowTrpgReplySuggestions,
  type GmRevealReport,
} from "./followLatest";

function effectiveComplete(freshGmRound: number | null, report: GmRevealReport | null): boolean {
  return resolveEffectiveGmRevealComplete({ freshGmRound, report });
}

describe("TRPG GM reveal session lifecycle", () => {
  it("A: progressive new GM does not inherit old completion and eventually completes", () => {
    let report: GmRevealReport = { roundNumber: 3, complete: true, progressive: false };
    let freshGmRound = 3;
    assert.equal(effectiveComplete(freshGmRound, report), true);

    freshGmRound = 4;
    assert.equal(effectiveComplete(freshGmRound, report), false);

    report = { roundNumber: 4, complete: false, progressive: true };
    assert.equal(effectiveComplete(freshGmRound, report), false);

    report = { roundNumber: 4, complete: true, progressive: false };
    assert.equal(effectiveComplete(freshGmRound, report), true);
    assert.equal(
      resolveTrpgLiveFollowOwner({
        cinematicMotion: false,
        freshGmRound: 4,
        gmRevealComplete: true,
        nextActionVisible: true,
      }),
      "NEXT_ACTION"
    );
  });

  it("B: instant new GM child report is not overwritten by stale parent reset", () => {
    let report: GmRevealReport = { roundNumber: 3, complete: true, progressive: false };
    let freshGmRound = 3;
    assert.equal(effectiveComplete(freshGmRound, report), true);

    freshGmRound = 4;
    assert.equal(effectiveComplete(freshGmRound, report), false);

    report = { roundNumber: 4, complete: true, progressive: false };
    assert.equal(effectiveComplete(freshGmRound, report), true);
    assert.equal(
      resolveTrpgLiveFollowOwner({
        cinematicMotion: false,
        freshGmRound: 4,
        gmRevealComplete: true,
        nextActionVisible: true,
      }),
      "NEXT_ACTION"
    );
    assert.equal(
      shouldShowTrpgReplySuggestions({
        suggestionsEnabled: true,
        freshGmRound: 4,
        gmRevealComplete: true,
        hasSuggestions: true,
        hasSuggestionsError: false,
      }),
      true
    );
  });

  it("C: reduced-motion new GM behaves like instant completion", () => {
    const report: GmRevealReport = { roundNumber: 5, complete: true, progressive: false };
    assert.equal(effectiveComplete(5, report), true);
    assert.equal(
      resolveTrpgLiveFollowOwner({
        cinematicMotion: false,
        freshGmRound: 5,
        gmRevealComplete: true,
        nextActionVisible: true,
      }),
      "NEXT_ACTION"
    );
  });

  it("D: persisted GM completion survives snap round advance without new GM session", () => {
    const report: GmRevealReport = { roundNumber: 3, complete: true, progressive: false };
    const freshGmRound = 3;
    const snapRoundAfterAdvance = 4;
    assert.equal(snapRoundAfterAdvance, freshGmRound + 1);
    assert.equal(effectiveComplete(freshGmRound, report), true);
    assert.equal(
      resolveTrpgLiveFollowOwner({
        cinematicMotion: true,
        freshGmRound,
        gmRevealComplete: true,
        nextActionVisible: false,
      }),
      "CURRENT_ACTOR"
    );
  });

  it("rejects reports from a different fresh GM round", () => {
    assert.equal(
      effectiveComplete(4, { roundNumber: 3, complete: true, progressive: false }),
      false
    );
    assert.equal(
      effectiveComplete(4, { roundNumber: null, complete: true, progressive: false }),
      false
    );
  });
});
