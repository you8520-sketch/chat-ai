import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
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
});
