import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { companionSlotViews, remainingAiCompanionSlots } from "./partySlots";
import type { TrpgPublicParticipant } from "./snapshot";

function part(
  opts: Partial<TrpgPublicParticipant> & Pick<TrpgPublicParticipant, "id" | "slotIndex" | "kind" | "displayName">
): TrpgPublicParticipant {
  return {
    userId: opts.kind === "human" ? 1 : null,
    characterId: opts.kind === "ai_character" ? opts.id : null,
    canAct: true,
    status: "active",
    ready: "writing",
    hasSheet: true,
    sheetConfirmed: opts.kind !== "ai_character",
    ...opts,
  };
}

describe("TRPG party slots", () => {
  it("keeps three companion seats but only two player-character seats", () => {
    const host = part({ id: 1, slotIndex: 0, kind: "human", displayName: "렌" });
    assert.equal(remainingAiCompanionSlots([host]), 2);
    assert.equal(companionSlotViews([host]).filter((s) => s.kind === "empty").length, 3);

    const withBots = [
      host,
      part({ id: 2, slotIndex: 1, kind: "ai_character", displayName: "하나" }),
      part({ id: 3, slotIndex: 2, kind: "ai_character", displayName: "두리" }),
    ];
    assert.equal(remainingAiCompanionSlots(withBots), 0);
    const slots = companionSlotViews(withBots);
    assert.equal(slots.filter((s) => s.kind === "ai").length, 2);
    assert.equal(slots.filter((s) => s.kind === "empty").length, 1);

    const withGuest = [
      ...withBots,
      part({ id: 4, slotIndex: 3, kind: "human", displayName: "유나", userId: 2 }),
    ];
    assert.equal(remainingAiCompanionSlots(withGuest), 0);
    assert.equal(companionSlotViews(withGuest).filter((s) => s.kind === "empty").length, 0);
  });
});
