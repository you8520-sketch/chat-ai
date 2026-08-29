import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { resolveTrpgActionCheckDecision } from "./actionCheck";
import {
  classifyTrpgDifficultyBand,
  difficultyDcFromAnchor,
  resolveTrpgAdjudicationDifficulty,
} from "./adjudicationDifficulty";
import { pickStatForAction, pickStatForActionDetailed } from "./actionTypes";
import { bucketTrpgSuccessTier, exhaustiveD20Buckets, resolveTrpgRoll } from "./dice";
import { statModifier } from "./stats";
import { defsFromKeys, DEFAULT_TRPG_STAT_DEFS } from "./stats";
import { DEFAULT_TRPG_DICE_RULES } from "./types";

function rate(count: number): number {
  return count / 20;
}

const INVESTIGATE_SHEET = defsFromKeys(["str", "dex", "con", "int", "per", "ins", "wis"]);
const SUPPORT_SHEET = defsFromKeys(["str", "dex", "con", "int", "wis", "cha"]);
const DEFEND_SHEET = defsFromKeys(["str", "dex", "con", "grd", "res", "wil"]);

describe("TRPG adjudication fairness — stat selection", () => {
  it("Case 1: investigate + 도주 경로 does not pick DEX", () => {
    const intent = "포자 흐름을 확인해서 안전한 도주 경로를 찾는다";
    const result = pickStatForActionDetailed({
      actionType: "investigate",
      selectedStat: null,
      body: intent,
      defs: INVESTIGATE_SHEET,
    });
    assert.notEqual(result.statKey, "dex");
    assert.ok(["int", "per", "ins", "wis", "tec"].includes(result.statKey));
    assert.equal(result.reason, "method");
  });

  it("Case 2: support + machete cut picks STR not WIS", () => {
    const intent = "렌이 붙잡은 균사 신경 연결부를 마체테로 내리찍어 절단한다";
    const stat = pickStatForAction({
      actionType: "support",
      selectedStat: null,
      body: intent,
      defs: SUPPORT_SHEET,
    });
    assert.equal(stat, "str");
  });

  it("Case 3: defend hold picks con/grd/res family", () => {
    const intent = "넓은 체구로 통로를 막고 버틴다";
    const stat = pickStatForAction({
      actionType: "defend",
      selectedStat: null,
      body: intent,
      defs: DEFEND_SHEET,
    });
    assert.ok(["con", "grd", "res", "wil", "dex", "siz"].includes(stat));
  });

  it("Case 4: explicit selectedStat wins", () => {
    const result = pickStatForActionDetailed({
      actionType: "investigate",
      selectedStat: "wis",
      body: "포자 흐름을 확인해서 안전한 도주 경로를 찾는다",
      defs: INVESTIGATE_SHEET,
    });
    assert.equal(result.statKey, "wis");
    assert.equal(result.reason, "selected");
  });
});

describe("TRPG adjudication fairness — difficulty bands", () => {
  it("maps anchor DC 11 to EASY=7 STANDARD=9 HARD=11", () => {
    assert.equal(difficultyDcFromAnchor(11, "EASY"), 7);
    assert.equal(difficultyDcFromAnchor(11, "STANDARD"), 9);
    assert.equal(difficultyDcFromAnchor(11, "HARD"), 11);
  });

  it("clamps DC floor at 5", () => {
    assert.equal(difficultyDcFromAnchor(6, "EASY"), 5);
  });

  it("classifies investigate as STANDARD and attack as HARD", () => {
    assert.equal(
      classifyTrpgDifficultyBand({
        actionType: "investigate",
        checkReason: "explicit_resolution",
      }),
      "STANDARD"
    );
    assert.equal(
      classifyTrpgDifficultyBand({
        actionType: "attack",
        checkReason: "explicit_resolution",
      }),
      "HARD"
    );
  });

  it("Fixture B: support machete cut is STANDARD not HARD", () => {
    const intent = "렌이 붙잡은 균사 신경 연결부를 마체테로 내리찍어 절단한다";
    const decision = resolveTrpgActionCheckDecision({
      body: intent,
      actionType: "support",
      intent,
    });
    const diff = resolveTrpgAdjudicationDifficulty({
      anchorDc: 11,
      actionType: "support",
      checkReason: decision.reason,
      intent,
    });
    assert.ok(diff.effectiveDc <= 9);
  });

  it("Fixture C: investigate path analysis uses STANDARD DC", () => {
    const diff = resolveTrpgAdjudicationDifficulty({
      anchorDc: 11,
      actionType: "investigate",
      checkReason: "explicit_resolution",
    });
    assert.equal(diff.band, "STANDARD");
    assert.equal(diff.effectiveDc, 9);
  });

  it("Fixture D: normal defend positioning uses STANDARD", () => {
    const diff = resolveTrpgAdjudicationDifficulty({
      anchorDc: 11,
      actionType: "defend",
      checkReason: "explicit_resolution",
    });
    assert.equal(diff.band, "STANDARD");
    assert.equal(diff.effectiveDc, 9);
  });
});

describe("TRPG adjudication fairness — exhaustive d20 probability", () => {
  const rules = DEFAULT_TRPG_DICE_RULES;

  function bucketsAtDc(dc: number, modifier: number) {
    return exhaustiveD20Buckets({ modifier, rules: { ...rules, dc } });
  }

  it("STANDARD DC9 mod0/1/2/4 rates", () => {
    const mod0 = bucketsAtDc(9, 0);
    const mod1 = bucketsAtDc(9, 1);
    const mod2 = bucketsAtDc(9, 2);
    const mod4 = bucketsAtDc(9, 4);
    assert.equal(rate(mod0.FULL_FAILURE), 0.25);
    assert.equal(rate(mod0.PARTIAL), 0.15);
    assert.equal(rate(mod0.SUCCESS_OR_BETTER), 0.6);
    assert.equal(rate(mod1.FULL_FAILURE), 0.2);
    assert.equal(rate(mod1.PARTIAL), 0.15);
    assert.equal(rate(mod1.SUCCESS_OR_BETTER), 0.65);
    assert.equal(rate(mod2.FULL_FAILURE), 0.15);
    assert.equal(rate(mod2.PARTIAL), 0.15);
    assert.equal(rate(mod2.SUCCESS_OR_BETTER), 0.7);
    assert.equal(rate(mod4.FULL_FAILURE), 0.05);
    assert.equal(rate(mod4.PARTIAL), 0.15);
    assert.equal(rate(mod4.SUCCESS_OR_BETTER), 0.8);
  });

  it("EASY DC7 mod0/2/5 rates", () => {
    const mod0 = bucketsAtDc(7, 0);
    const mod2 = bucketsAtDc(7, 2);
    const mod5 = bucketsAtDc(7, 5);
    assert.equal(rate(mod0.FULL_FAILURE), 0.15);
    assert.equal(rate(mod0.PARTIAL), 0.15);
    assert.equal(rate(mod0.SUCCESS_OR_BETTER), 0.7);
    assert.equal(rate(mod2.FULL_FAILURE), 0.05);
    assert.equal(rate(mod2.PARTIAL), 0.15);
    assert.equal(rate(mod2.SUCCESS_OR_BETTER), 0.8);
    assert.equal(rate(mod5.FULL_FAILURE), 0.05);
    assert.equal(rate(mod5.SUCCESS_OR_BETTER), 0.95);
  });

  it("HARD DC11 mod0/2/5 preserves existing V2 math", () => {
    const mod0 = bucketsAtDc(11, 0);
    const mod2 = bucketsAtDc(11, 2);
    const mod5 = bucketsAtDc(11, 5);
    assert.equal(rate(mod0.FULL_FAILURE), 0.35);
    assert.equal(rate(mod0.PARTIAL), 0.15);
    assert.equal(rate(mod0.SUCCESS_OR_BETTER), 0.5);
    assert.equal(rate(mod2.FULL_FAILURE), 0.25);
    assert.equal(rate(mod2.PARTIAL), 0.15);
    assert.equal(rate(mod2.SUCCESS_OR_BETTER), 0.6);
    assert.equal(rate(mod5.FULL_FAILURE), 0.1);
    assert.equal(rate(mod5.PARTIAL), 0.15);
    assert.equal(rate(mod5.SUCCESS_OR_BETTER), 0.75);
  });

  it("preserves nat1/nat20 critical and partialWindow", () => {
    const nat1 = resolveTrpgRoll({ d20: 1, statModifier: 5, dc: 9, rules });
    const nat20 = resolveTrpgRoll({ d20: 20, statModifier: -5, dc: 9, rules });
    assert.equal(nat1.tier, "CRITICAL_FAILURE");
    assert.equal(nat20.tier, "CRITICAL_SUCCESS");
    assert.equal(bucketTrpgSuccessTier(resolveTrpgRoll({ d20: 8, statModifier: 0, dc: 9, rules }).tier), "PARTIAL");
    assert.equal(rules.partialWindow, 3);
  });
});

describe("TRPG adjudication fairness — user scenario fixtures", () => {
  it("Fixture A: risky attack at HARD DC11 with STR 10 d20=10 succeeds", () => {
    const mod = statModifier(10);
    assert.equal(mod, 2);
    const roll = resolveTrpgRoll({
      d20: 10,
      statModifier: mod,
      dc: 11,
      rules: DEFAULT_TRPG_DICE_RULES,
    });
    assert.equal(roll.finalScore, 12);
    assert.equal(roll.tier, "SUCCESS");
  });

  it("Fixture B: support machete uses physical stat", () => {
    const intent = "마체테로 연결부 절단 지원";
    const stat = pickStatForAction({
      actionType: "support",
      selectedStat: null,
      body: intent,
      defs: SUPPORT_SHEET,
    });
    assert.equal(stat, "str");
  });

  it("Fixture C: investigate escape route analysis uses investigation stat", () => {
    const stat = pickStatForAction({
      actionType: "investigate",
      selectedStat: null,
      body: "안전한 도주 경로를 분석",
      defs: INVESTIGATE_SHEET,
    });
    assert.notEqual(stat, "dex");
    assert.ok(["int", "per", "ins", "wis", "tec"].includes(stat));
  });
});
