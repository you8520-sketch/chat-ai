import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { committedActionText, isCommittedItemConsumption, uncommittedActionWire } from "./actionSemantics";
import { findCommittedTreatmentItem } from "./mechanicsIntent";
import { resolveTrpgActionCheckDecision } from "./actionCheck";
import { pickStatForActionDetailed, resolveServerHumanActionType } from "./actionTypes";
import { buildTrpgGmUserBlock, formatTrpgActionCheckWire } from "./gmPrompt";
import { isTreatmentItemIntent } from "./mechanicsIntent";
import { healOwnerKind } from "./mechanicsValidate";
import { DEFAULT_TRPG_STAT_DEFS } from "./stats";

const defs = DEFAULT_TRPG_STAT_DEFS;

function judge(body: string) {
  const actionType = resolveServerHumanActionType(body);
  const stat = pickStatForActionDetailed({
    actionType,
    selectedStat: null,
    body: committedActionText(body),
    defs,
  });
  const check = resolveTrpgActionCheckDecision({ body, actionType });
  return { actionType, stat: stat.statKey, reason: stat.reason, needsCheck: check.needsCheck, check: check.reason };
}

describe("free-text human adjudication", () => {
  it("classifies the fixture sentences without a client stat or action type", () => {
    const door = judge("무거운 철문을 힘껏 밀어 연다");
    assert.equal(door.stat, "str");
    assert.equal(door.needsCheck, true);

    const sneak = judge("경비의 눈을 피해 재빨리 통과한다");
    assert.equal(sneak.actionType, "stealth");
    assert.equal(sneak.stat, "dex");
    assert.equal(sneak.needsCheck, true);

    const cipher = judge("고문서의 암호를 해독한다");
    assert.equal(cipher.stat, "int");
    assert.equal(cipher.needsCheck, true);

    const talk = judge("상대방을 말로 설득한다");
    assert.equal(talk.actionType, "persuade");
    assert.equal(talk.stat, "cha");
    assert.equal(talk.needsCheck, true);

    const look = judge("주변을 조용히 둘러본다");
    assert.equal(look.needsCheck, false);

    const take = judge("보이는 평범한 물건을 집는다");
    assert.equal(take.needsCheck, false);
    assert.equal(take.actionType, "free");

    const trap = judge("위험한 함정을 해제한다");
    assert.equal(trap.needsCheck, true);
    assert.equal(trap.stat, "int");

    const conditional = judge("조건이 맞으면 상대를 제지한다");
    assert.equal(conditional.needsCheck, false);
    assert.equal(conditional.check, "conditional_hold");
    assert.equal(conditional.actionType, "free");
  });

  it("keeps treatment, rest, item use, and an uncommitted smash on their owners", () => {
    for (const body of [
      "상처를 응급처치한다.",
      "중독 상태를 치료하려 한다.",
      "출혈을 지혈하려 한다.",
      "마비 상태를 치료한다.",
      "현재 상태이상을 치료하려 한다.",
    ]) {
      const treated = judge(body);
      assert.equal(treated.actionType, "support", body);
      assert.equal(treated.needsCheck, true, body);
    }

    const rest = judge("안전한 곳에서 잠시 휴식하며 상처를 추스른다.");
    assert.equal(rest.needsCheck, false);
    assert.equal(rest.check, "safe_rest");

    const potion = judge("회복약을 사용한다");
    assert.equal(potion.actionType, "use_item");
    assert.equal(potion.needsCheck, false);

    const held = judge("만약 문이 잠겨 있다면 힘으로 부순다");
    assert.equal(held.actionType, "free");
    assert.equal(held.needsCheck, false);
    assert.equal(held.check, "conditional_hold");
    assert.match(
      formatTrpgActionCheckWire({
        needsCheck: false,
        checkReason: "conditional_hold",
        d20: null,
        finalScore: null,
        dc: null,
        tier: null,
        statKey: "str",
      }),
      /not a completed act/
    );
  });

  it("keeps reading, refusal, quotation, and a condition off the committed act", () => {
    const read = judge("회복약 사용법을 읽는다");
    assert.equal(read.actionType, "free");
    assert.equal(read.needsCheck, false);
    assert.notEqual(read.check, "ordinary_item_use");
    assert.equal(isTreatmentItemIntent("회복약 사용법을 읽는다", ["회복약"]), false);
    assert.equal(healOwnerKind({ body: "회복약 사용법을 읽는다", sourceInventory: ["회복약"] }), "none");

    const used = judge("회복약을 사용한다");
    assert.equal(used.actionType, "use_item");
    assert.equal(used.check, "ordinary_item_use");
    assert.equal(isTreatmentItemIntent("회복약을 사용한다", ["회복약"]), true);
    assert.equal(healOwnerKind({ body: "회복약을 사용한다", sourceInventory: ["회복약"] }), "item");

    const usedThenNod = judge("회복약을 사용한다. 고개를 끄덕인다.");
    assert.equal(usedThenNod.actionType, "use_item");
    assert.equal(usedThenNod.check, "ordinary_item_use");
    assert.equal(isCommittedItemConsumption("회복약을 사용한다. 고개를 끄덕인다."), true);
    assert.equal(isTreatmentItemIntent("회복약을 사용한다. 고개를 끄덕인다.", ["회복약"]), true);

    const refusedPotion = judge("회복약을 사용하지 않는다. 고개를 끄덕인다.");
    assert.equal(isCommittedItemConsumption("회복약을 사용하지 않는다. 고개를 끄덕인다."), false);
    assert.equal(isTreatmentItemIntent("회복약을 사용하지 않는다. 고개를 끄덕인다.", ["회복약"]), false);
    assert.notEqual(refusedPotion.check, "ordinary_item_use");

    const compoundUseAttack = judge("회복약을 사용한다. 경비를 공격한다.");
    assert.equal(compoundUseAttack.actionType, "use_item");
    assert.equal(isCommittedItemConsumption("회복약을 사용한다. 경비를 공격한다."), true);
    const bothOrders = ["회복약", "붕대"] as const;
    const lookThenBandage = "회복약을 살펴본다. 붕대를 사용한다.";
    assert.equal(findCommittedTreatmentItem(lookThenBandage, bothOrders), "붕대");
    assert.equal(findCommittedTreatmentItem(lookThenBandage, [...bothOrders].reverse()), "붕대");
    assert.equal(findCommittedTreatmentItem("회복약을 사용한다. 붕대를 살펴본다.", bothOrders), "회복약");
    assert.equal(findCommittedTreatmentItem("붕대를 사용하지 않는다. 회복약을 사용한다.", bothOrders), "회복약");
    assert.equal(findCommittedTreatmentItem("회복약 사용법을 읽는다. 붕대를 사용한다.", [...bothOrders].reverse()), "붕대");
    const whileLooking = "회복약을 바라보면서 붕대를 사용한다.";
    const whileJudged = judge(whileLooking);
    assert.equal(whileJudged.actionType, "use_item");
    assert.equal(whileJudged.check, "ordinary_item_use");
    assert.equal(findCommittedTreatmentItem(whileLooking, bothOrders), "붕대");
    assert.equal(findCommittedTreatmentItem(whileLooking, [...bothOrders].reverse()), "붕대");
    assert.equal(findCommittedTreatmentItem("「회복약을 사용한다」", bothOrders), null);
    assert.equal(findCommittedTreatmentItem("중독 상태를 치료한다", ["해독제"]), null);
    const compoundWire = buildTrpgGmUserBlock({
      worldBrief: "폐허",
      memoryBlock: "",
      opening: false,
      actions: [
        {
          participantId: 1,
          name: "렌",
          body: "회복약을 사용한다. 경비를 공격한다.",
          needsCheck: false,
          checkReason: "ordinary_item_use",
          statKey: "none",
          d20: null,
          finalScore: null,
          dc: null,
          tier: null,
        },
      ],
    });
    assert.match(compoundWire, /AUTHORITATIVE HUMAN PC ACTION/);
    assert.match(compoundWire, /회복약을 사용한다\. 경비를 공격한다\./);
    assert.match(compoundWire, /ordinary_item_use/);
    assert.match(compoundWire, /unadjudicated=경비를 공격한다/);
    assert.match(compoundWire, /do not narrate these as success or failure/);
    const nodWire = buildTrpgGmUserBlock({
      worldBrief: "폐허",
      memoryBlock: "",
      opening: false,
      actions: [
        {
          participantId: 1,
          name: "렌",
          body: "회복약을 사용한다. 고개를 끄덕인다.",
          needsCheck: false,
          checkReason: "ordinary_item_use",
          statKey: "none",
          d20: null,
          finalScore: null,
          dc: null,
          tier: null,
        },
      ],
    });
    assert.doesNotMatch(nodWire, /unadjudicated=/);
    const doorWire = buildTrpgGmUserBlock({
      worldBrief: "폐허",
      memoryBlock: "",
      opening: false,
      regenerate: true,
      actions: [
        {
          participantId: 1,
          name: "렌",
          body: "회복약을 사용한다. 잠긴 철문을 힘껏 부순다.",
          needsCheck: false,
          checkReason: "ordinary_item_use",
          statKey: "none",
          d20: null,
          finalScore: null,
          dc: null,
          tier: null,
        },
      ],
    });
    assert.match(doorWire, /ordinary_item_use|d20=none/);
    assert.match(doorWire, /unadjudicated=잠긴 철문을 힘껏 부순다/);
    assert.match(doorWire, /do not narrate these as success or failure/);

    const declined = judge("상대방을 설득하지 않는다");
    assert.notEqual(declined.actionType, "persuade");
    assert.equal(declined.needsCheck, false);
    assert.equal(declined.check, "declined_act");
    assert.notEqual(declined.stat, "cha");

    const quoted = judge("「지금 공격하고 설득한다」");
    assert.notEqual(quoted.actionType, "attack");
    assert.notEqual(quoted.actionType, "persuade");
    assert.equal(quoted.check, "talk");
    assert.equal(quoted.needsCheck, false);

    const instead = judge("설득하지 않고 경비를 공격한다");
    assert.equal(instead.actionType, "attack");
    assert.equal(instead.needsCheck, true);
    assert.equal(instead.stat, "str");

    const mixed = judge("만약 적이 도망치면 쫓는다. 지금은 경비를 공격한다.");
    assert.equal(mixed.actionType, "attack");
    assert.equal(mixed.needsCheck, true);
    assert.equal(mixed.stat, "str");
    assert.match(uncommittedActionWire("만약 적이 도망치면 쫓는다. 지금은 경비를 공격한다.") ?? "", /쫓는다/);

    const only = judge("만약 적이 도망치면 쫓는다");
    assert.equal(only.actionType, "free");
    assert.equal(only.needsCheck, false);
    assert.equal(only.check, "conditional_hold");

    const unknown = judge("문이 잠겨 있으면 힘으로 부순다.");
    assert.equal(unknown.needsCheck, false);
    assert.equal(unknown.check, "conditional_hold");
    assert.equal(unknown.actionType, "free");

    const smash = judge("잠긴 문을 힘으로 부순다");
    assert.equal(smash.needsCheck, true);
    assert.notEqual(smash.check, "conditional_hold");
    assert.equal(smash.stat, "str");

    const scene = judge("장면을 살핀다");
    assert.notEqual(scene.check, "conditional_hold");
    const contrast = judge("반면 문을 민다");
    assert.notEqual(contrast.check, "conditional_hold");

    const defend = judge("방패로 공격을 가로막는다");
    assert.equal(defend.actionType, "defend");
    assert.equal(defend.needsCheck, true);
    assert.equal(defend.stat, "con");
  });

  it("tells the GM which clause was not performed", () => {
    const mixed = "만약 적이 도망치면 쫓는다. 지금은 경비를 공격한다.";
    const judged = judge(mixed);
    const block = (regenerate: boolean) =>
      buildTrpgGmUserBlock({
        worldBrief: "폐허",
        memoryBlock: "",
        opening: false,
        regenerate,
        actions: [
          {
            participantId: 1,
            name: "렌",
            body: mixed,
            needsCheck: judged.needsCheck,
            checkReason: judged.check,
            statKey: judged.stat,
            d20: 14,
            finalScore: 16,
            dc: 12,
            tier: "SUCCESS",
          },
        ],
      });
    for (const text of [block(false), block(true)]) {
      assert.match(text, /\[UNCOMMITTED uncommitted=만약 적이 도망치면 쫓는다/);
      assert.match(text, /지금은 경비를 공격한다/);
      assert.doesNotMatch(text, /conditional_hold/);
    }
    assert.match(block(false), /check_required/);

    const refused = "상대방을 설득하지 않는다";
    const refusedJudge = judge(refused);
    const refusedWire = buildTrpgGmUserBlock({
      worldBrief: "폐허",
      memoryBlock: "",
      opening: false,
      actions: [
        {
          participantId: 1,
          name: "렌",
          body: refused,
          needsCheck: refusedJudge.needsCheck,
          checkReason: refusedJudge.check,
          statKey: refusedJudge.stat,
          d20: null,
          finalScore: null,
          dc: null,
          tier: null,
        },
      ],
    });
    assert.match(refusedWire, /reason=declined_act/);
    assert.match(refusedWire, /\[UNCOMMITTED uncommitted=상대방을 설득하지 않는다/);
    assert.doesNotMatch(refusedWire, /check_required/);
  });

  it("a client-shaped attack type is not required for an obvious blow", () => {
    assert.equal(resolveServerHumanActionType("검으로 벤다."), "attack");
    const forced = pickStatForActionDetailed({
      actionType: "attack",
      selectedStat: "cha",
      body: "검으로 벤다.",
      defs,
    });
    assert.equal(forced.statKey, "cha", "a stored override still wins for an already locked row");
  });
});
