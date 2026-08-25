import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { authorizedHealClass } from "./mechanicsValidate";

describe("TRPG M1 validated item-heal authorization", () => {
  it("NO_TIER_VALID_ITEM_HEAL_AUTHORIZED", () => {
    const result = authorizedHealClass({
      actionType: "use_item",
      body: "구급키트를 사용한다.",
      tier: null,
      sourceInventory: ["구급키트"],
    });
    assert.equal(result.owner, "item");
    assert.notEqual(result.klass, "NONE");
    assert.notEqual(result.reason, "no_tier");
  });

  it("NO_TIER_FIRST_AID_AUTO_SUCCESS=false", () => {
    const result = authorizedHealClass({
      actionType: "support",
      body: "상처를 응급처치한다.",
      tier: null,
    });
    assert.equal(result.klass, "NONE");
    assert.equal(result.reason, "no_tier");
    assert.notEqual(result.owner, "item");
  });

  it("NO_TIER_MISLABELED_FIRST_AID_USE_ITEM still requires a tier", () => {
    const result = authorizedHealClass({
      actionType: "use_item",
      body: "상처를 응급처치한다.",
      tier: null,
    });
    assert.equal(result.klass, "NONE");
    assert.equal(result.reason, "no_tier");
  });

  it("MISSING_ITEM_HEAL_REJECTED", () => {
    const result = authorizedHealClass({
      actionType: "use_item",
      body: "구급키트를 사용한다.",
      tier: null,
      sourceInventory: [],
      startInventory: ["구급키트"],
    });
    assert.equal(result.klass, "NONE");
    assert.equal(result.reason, "ITEM_HEAL_REJECTED_ITEM_MISSING");
  });
});
