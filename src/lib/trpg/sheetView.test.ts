import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { applyValidatedStateDelta, buildPartySheetHud, sheetToWidgetValues } from "./sheetView";
import type { TrpgSheetSnapshot } from "./types";

function sheet(id: number, name: string): TrpgSheetSnapshot {
  return {
    participantId: id,
    name,
    playerName: `p${id}`,
    level: 1,
    hp: 20,
    maxHp: 25,
    stats: { str: 5, dex: 5, int: 5, wis: 5, cha: 5, con: 5 },
    conditions: [],
    inventory: ["횃불"],
    location: "여관",
    modifiersNote: "+0",
  };
}

describe("TRPG sheet HUD", () => {
  it("compiles status-window HTML from structured sheets, not the other way around", () => {
    const hud = buildPartySheetHud({
      viewerParticipantId: 1,
      sheets: [sheet(1, "렌"), sheet(2, "유나")],
    });
    assert.equal(hud.length, 2);
    assert.equal(hud[0]?.isSelf, true);
    assert.equal(hud[1]?.isSelf, false);
    assert.match(hud[0]?.html ?? "", /렌/);
    assert.equal(hud[0]?.sheet.hp, 20);
    assert.equal(sheetToWidgetValues(hud[0]!.sheet).hp, "20 / 25");
  });

  it("rejects HP outside 0..max and deleting items that do not exist", () => {
    const start = [sheet(1, "렌")];
    const hp = applyValidatedStateDelta(start, { players: [{ participantId: 1, hp: 99 }] });
    assert.equal(hp.ok, false);
    const missing = applyValidatedStateDelta(start, {
      players: [{ participantId: 1, inventoryRemove: ["왕관"] }],
    });
    assert.equal(missing.ok, false);
    const ok = applyValidatedStateDelta(start, {
      players: [{ participantId: 1, hp: 10, inventoryRemove: ["횃불"] }],
    });
    assert.equal(ok.ok, true);
    if (ok.ok) {
      assert.equal(ok.next[0]?.hp, 10);
      assert.deepEqual(ok.next[0]?.inventory, []);
    }
  });
});
