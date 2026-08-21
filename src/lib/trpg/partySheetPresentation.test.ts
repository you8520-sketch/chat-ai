import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import {
  partyDetailedSheetCards,
  viewerSelfSheetCard,
} from "./partySheetPresentation";
import type { TrpgSheetHudCard } from "./sheetView";

function card(
  participantId: number,
  name: string,
  isSelf: boolean
): TrpgSheetHudCard {
  return {
    participantId,
    isSelf,
    html: `<div>${name}</div>`,
    sheet: {
      participantId,
      name,
      playerName: name,
      level: 1,
      hp: 20,
      maxHp: 25,
      stats: { str: 8 },
      conditions: [],
      inventory: [],
      location: "",
      modifiersNote: "",
    },
  };
}

describe("TRPG party sheet rail presentation", () => {
  it("A. excludes self detail while keeping two AI companion cards", () => {
    const detailed = partyDetailedSheetCards(
      [
        card(1, "렌", true),
        card(2, "권태현", false),
        card(3, "강이현", false),
      ],
      1
    );
    assert.deepEqual(
      detailed.map((item) => item.participantId),
      [2, 3]
    );
  });

  it("B. keeps another human and AI while excluding the viewer", () => {
    const detailed = partyDetailedSheetCards(
      [
        card(10, "뷰어", true),
        card(11, "다른 사람", false),
        card(12, "AI 동료", false),
      ],
      10
    );
    assert.equal(detailed.some((item) => item.participantId === 10), false);
    assert.equal(detailed.some((item) => item.participantId === 11), true);
    assert.equal(detailed.some((item) => item.participantId === 12), true);
  });

  it("C. solo keeps no duplicate detail and renders the party empty state", () => {
    assert.deepEqual(
      partyDetailedSheetCards([card(1, "렌", true)], 1),
      []
    );
    const rail = readFileSync("src/app/trpg/TrpgCampaignRail.tsx", "utf8");
    assert.match(rail, /snap\.participants\.map/);
    assert.match(rail, /다른 파티원이 없습니다\./);
    assert.match(rail, /파티원 시트 · 내 시트는 화면 아래 고정/);
  });

  it("D/E. desktop and mobile share the filter while self HUD remains rendered", () => {
    const room = readFileSync("src/app/trpg/TrpgCampaignRoom.tsx", "utf8");
    const rail = readFileSync("src/app/trpg/TrpgCampaignRail.tsx", "utf8");
    assert.match(room, /<TrpgSelfSheetHud/);
    assert.match(room, /<TrpgCampaignRail \{\.\.\.railProps\} \/>/);
    assert.match(room, /<TrpgCampaignRail \{\.\.\.railProps\} compact \/>/);
    assert.match(rail, /partyDetailedSheetCards\(\s*snap\.sheets,\s*snap\.viewerParticipantId/);
    assert.match(room, /viewerSelfSheetCard/);
    assert.doesNotMatch(rail, /snap\.sheets\.filter\([^)]*name/);
  });

  it("F. same-name participants are filtered by isSelf rather than text", () => {
    const detailed = partyDetailedSheetCards(
      [
        card(21, "동명이인", true),
        card(22, "동명이인", false),
      ],
      21
    );
    assert.deepEqual(
      detailed.map((item) => item.participantId),
      [22]
    );
  });

  it("uses viewer participant identity as a stale-isSelf fallback", () => {
    const staleCards = [
      card(31, "뷰어", false),
      card(32, "동료", false),
    ];
    assert.deepEqual(
      partyDetailedSheetCards(staleCards, 31).map(
        (item) => item.participantId
      ),
      [32]
    );
    assert.equal(viewerSelfSheetCard(staleCards, 31)?.participantId, 31);
  });
});
