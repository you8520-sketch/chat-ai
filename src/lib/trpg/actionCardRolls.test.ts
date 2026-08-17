import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { mergeTrpgActionRolls, orphanTrpgRolls } from "./actionCardRolls";
import type { TrpgPublicRoll } from "./snapshot";

function roll(participantId: number, d20: number): TrpgPublicRoll {
  return {
    participantId,
    name: `P${participantId}`,
    d20,
    statKey: "dex",
    finalScore: d20,
    dc: 12,
    tier: "SUCCESS",
    success: true,
    actionBody: "should-not-reprint",
    actionType: "investigate",
    kind: "ai_character",
  };
}

describe("TRPG action-card rolls", () => {
  it("keeps pending current rolls on the same participant card", () => {
    const map = mergeTrpgActionRolls({
      rowRolls: [],
      liveRolls: [roll(7, 16)],
    });
    assert.equal(map.get(7)?.d20, 16);
    assert.equal(orphanTrpgRolls({ currentRolls: [roll(7, 16)], revealedActionParticipantIds: [7] }).length, 0);
  });

  it("only falls back to a dice strip for rolls without a revealed action", () => {
    const orphans = orphanTrpgRolls({
      currentRolls: [roll(1, 10), roll(2, 18)],
      revealedActionParticipantIds: [1],
    });
    assert.equal(orphans.length, 1);
    assert.equal(orphans[0]?.participantId, 2);
  });
});
