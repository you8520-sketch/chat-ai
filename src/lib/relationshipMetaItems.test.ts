import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  expandPossessionTransferRemovals,
  filterPossessionEntryItems,
  formatGroupedPossessionsForPrompt,
  groupPossessionsByPerson,
  isNonPossessionItemName,
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

  it("detects furniture/fixture/uniform names as non-possessions", () => {
    for (const name of ["침대", "간이 침대", "세면대", "의자", "제복", "거울", "손거울"]) {
      assert.equal(isNonPossessionItemName(name), true, name);
    }
    for (const name of ["펜", "추천서 초안", "반지", "S-기어", "에메랄드 귀걸이(한 짝)"]) {
      assert.equal(isNonPossessionItemName(name), false, name);
    }
  });

  it("filters non-possession items out of an entry, keeping real ones", () => {
    assert.equal(
      filterPossessionEntryItems(
        "레온: 펜, 의자, 추천서 초안, 서류, 제복, 금박 휘장, 간이 침대, 세면대, 거울"
      ),
      "레온: 펜, 추천서 초안, 서류, 금박 휘장"
    );
  });

  it("drops the whole entry when every item is a non-possession", () => {
    assert.equal(filterPossessionEntryItems("레온: 침대, 의자"), "");
  });

  it("keeps entries without parseable structure untouched", () => {
    assert.equal(filterPossessionEntryItems("그냥 문자열"), "그냥 문자열");
  });

  it("keeps normal entries unchanged", () => {
    assert.equal(filterPossessionEntryItems("백하율: S-기어, 넥타이"), "백하율: S-기어, 넥타이");
  });

  it("treats clothing/footwear as non-possessions", () => {
    for (const name of [
      "자수가 박힌 등이 깊게 파인 옷",
      "드레스",
      "연회용 정장",
      "가죽 구두",
      "망토",
    ]) {
      assert.equal(isNonPossessionItemName(name), true, name);
    }
    assert.equal(
      filterPossessionEntryItems("렌: 자수가 박힌 등이 깊게 파인 옷, 청금석 귀걸이, 은팔찌"),
      "렌: 청금석 귀걸이, 은팔찌"
    );
  });
});
