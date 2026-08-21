import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { actionTypeLabelKo, pickStatForAction } from "./actionTypes";
import { defsFromKeys, DEFAULT_TRPG_STAT_DEFS } from "./stats";

describe("TRPG action stat pick", () => {
  it("uses body keywords on the scenario sheet before the action-type default", () => {
    const withMagic = defsFromKeys(["str", "dex", "con", "int", "wis", "cha", "mag"]);
    assert.equal(
      pickStatForAction({ actionType: "attack", selectedStat: null, body: "화염 주문을 외운다", defs: withMagic }),
      "mag"
    );
    assert.equal(
      pickStatForAction({ actionType: "attack", selectedStat: null, body: "화염 주문을 외운다", defs: DEFAULT_TRPG_STAT_DEFS }),
      "str"
    );
  });

  it("falls back to action prefs that exist on the sheet", () => {
    const noStr = defsFromKeys(["mag", "dex", "wil"]);
    assert.equal(
      pickStatForAction({ actionType: "attack", selectedStat: null, body: "", defs: noStr }),
      "mag"
    );
  });

  it("honors an explicit selected stat on the sheet", () => {
    assert.equal(
      pickStatForAction({
        actionType: "attack",
        selectedStat: "cha",
        body: "검을 휘두른다",
        defs: DEFAULT_TRPG_STAT_DEFS,
      }),
      "cha"
    );
  });

  it("shows 기타 행동 for backend free without changing the key", () => {
    assert.equal(actionTypeLabelKo("free"), "기타 행동");
    assert.notEqual(actionTypeLabelKo("free"), "자유 행동");
  });
});
