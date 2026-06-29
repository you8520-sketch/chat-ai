import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  expandPossessionTransferRemovals,
  formatGroupedPossessionsForPrompt,
  groupPossessionsByPerson,
  parsePossessionEntry,
} from "@/lib/relationshipMetaItems";

describe("relationshipMetaItems", () => {
  it("parses person and comma-separated items", () => {
    assert.deepEqual(parsePossessionEntry("민수: 반지, 목걸이"), {
      person: "민수",
      items: ["반지", "목걸이"],
    });
    assert.deepEqual(parsePossessionEntry("민수 소지: 검"), {
      person: "민수",
      items: ["검"],
    });
  });

  it("groups multiple entries by person", () => {
    const grouped = groupPossessionsByPerson(["민수: 반지", "민수: 검", "영희: 지갑"]);
    assert.equal(grouped.length, 2);
    assert.equal(grouped[0]!.person, "민수");
    assert.deepEqual(
      grouped[0]!.items.map((i) => i.name),
      ["반지", "검"]
    );
    assert.equal(grouped[1]!.person, "영희");
  });

  it("formats prompt lines with comma separation", () => {
    const text = formatGroupedPossessionsForPrompt(["민수: 반지, 목걸이", "영희: 지갑"]);
    assert.equal(text, "민수: 반지, 목걸이\n영희: 지갑");
  });

  it("derives sender removal when item is transferred", () => {
    const prev = ["레온: 반지, 지갑", "민수: 열쇠"];
    const delta = ["레온→민수: 반지"];
    const patch = expandPossessionTransferRemovals(prev, delta);
    assert.deepEqual(patch.itemsRemove, ["레온: 반지, 지갑"]);
    assert.deepEqual(patch.itemsRevise, ["레온: 지갑"]);
  });

  it("resolves 캐릭터/유저 labels in transfer removals", () => {
    const prev = ["레온: 반지, 지갑"];
    const delta = ["캐릭터→유저: 반지"];
    const patch = expandPossessionTransferRemovals(prev, delta, {
      charName: "레온",
      userName: "민수",
    });
    assert.deepEqual(patch.itemsRemove, ["레온: 반지, 지갑"]);
    assert.deepEqual(patch.itemsRevise, ["레온: 지갑"]);
  });
});
