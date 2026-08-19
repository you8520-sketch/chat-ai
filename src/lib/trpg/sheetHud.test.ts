import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { applyValidatedStateDelta, buildPartySheetHud } from "./sheetView";
import {
  compactConditions,
  hpBarClass,
  hpRiskLevel,
  inventoryCount,
  selfHudAriaLabel,
} from "./sheetHud";
import type { TrpgSheetSnapshot } from "./types";

function sheet(partial: Partial<TrpgSheetSnapshot> = {}): TrpgSheetSnapshot {
  return {
    participantId: 1,
    name: "렌",
    playerName: "유저",
    level: 1,
    hp: 32,
    maxHp: 40,
    stats: { str: 10, dex: 12 },
    conditions: ["경미한 출혈"],
    inventory: ["손전등", "밧줄", "단검", "붕대"],
    location: "북부 폐도시",
    modifiersNote: "dex+2",
    ...partial,
  };
}

describe("TRPG self sheet HUD helpers", () => {
  it("uses the structured sheet as the only source", () => {
    const cards = buildPartySheetHud({ viewerParticipantId: 1, sheets: [sheet()] });
    assert.equal(cards[0]?.isSelf, true);
    assert.equal(cards[0]?.sheet.hp, 32);
    assert.equal(cards[0]?.sheet.location, "북부 폐도시");
    assert.doesNotMatch(JSON.stringify(cards[0]?.sheet), /<div|<span/);
  });

  it("reflects HP, inventory, conditions, and location from the structured sheet", () => {
    const before = sheet();
    const applied = applyValidatedStateDelta([before], {
      players: [
        {
          participantId: 1,
          hp: 8,
          conditions: ["중상"],
          inventoryAdd: ["열쇠"],
          inventoryRemove: ["붕대"],
          location: "지하 통로",
        },
      ],
    });
    assert.equal(applied.ok, true);
    if (!applied.ok) return;
    const next = applied.next[0]!;
    assert.equal(next.hp, 8);
    assert.equal(hpRiskLevel(next.hp, next.maxHp), "critical");
    assert.deepEqual(next.conditions, ["중상"]);
    assert.equal(inventoryCount(next.inventory), 4);
    assert.equal(next.location, "지하 통로");
    assert.match(selfHudAriaLabel(next), /HP 8\/40/);
    assert.match(selfHudAriaLabel(next), /지하 통로/);
  });

  it("keeps compact condition/inventory summaries for mobile", () => {
    const row = sheet({ conditions: ["출혈", "독"], inventory: ["a", "b", "c"] });
    assert.deepEqual(compactConditions(row.conditions, 1), ["출혈"]);
    assert.equal(inventoryCount(row.inventory), 3);
    assert.equal(hpBarClass(32, 40), "bg-emerald-400");
    assert.equal(hpBarClass(16, 40), "bg-amber-400");
    assert.equal(hpBarClass(8, 40), "bg-rose-400");
  });

  it("labels inventory count as 소지품 instead of an emoji badge", () => {
    const hud = readFileSync("src/app/trpg/TrpgSelfSheetHud.tsx", "utf8");
    assert.match(hud, /소지품 \{itemCount\}/);
    assert.match(hud, /현재 소지품 \$\{itemCount\}개/);
    assert.doesNotMatch(hud, /🎒/);
  });
});
