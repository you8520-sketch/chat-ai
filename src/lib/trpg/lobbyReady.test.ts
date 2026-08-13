import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { trpgStartBlockedReason } from "./lobbyReady";
import type { TrpgPublicParticipant } from "./snapshot";

function part(
  opts: Partial<TrpgPublicParticipant> & Pick<TrpgPublicParticipant, "id" | "kind" | "displayName">
): TrpgPublicParticipant {
  return {
    slotIndex: opts.id,
    userId: opts.kind === "human" ? opts.id : null,
    characterId: opts.kind === "ai_character" ? opts.id : null,
    canAct: true,
    status: "active",
    ready: "writing",
    hasSheet: true,
    sheetConfirmed: true,
    ...opts,
  };
}

describe("trpgStartBlockedReason", () => {
  it("allows start when the host allocated a valid sheet and companions have sheets", () => {
    const host = part({ id: 1, kind: "human", displayName: "렌", hasSheet: false });
    const bot = part({ id: 2, kind: "ai_character", displayName: "유나" });
    assert.equal(
      trpgStartBlockedReason({
        participants: [host, bot],
        viewerParticipantId: 1,
        editingId: 1,
        remaining: 0,
      }),
      null
    );
  });

  it("blocks when leftover points went negative", () => {
    const host = part({ id: 1, kind: "human", displayName: "렌" });
    assert.match(
      trpgStartBlockedReason({
        participants: [host],
        viewerParticipantId: 1,
        editingId: 1,
        remaining: -2,
      }) ?? "",
      /합계가 넘/
    );
  });

  it("blocks when the host is editing a companion and never saved their own sheet", () => {
    const host = part({ id: 1, kind: "human", displayName: "렌", hasSheet: false });
    const bot = part({ id: 2, kind: "ai_character", displayName: "유나" });
    assert.match(
      trpgStartBlockedReason({
        participants: [host, bot],
        viewerParticipantId: 1,
        editingId: 2,
        remaining: 0,
      }) ?? "",
      /내 시트/
    );
  });
});
