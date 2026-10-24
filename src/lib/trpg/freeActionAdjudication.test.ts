import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { resolveTrpgActionCheckDecision } from "./actionCheck";
import { pickStatForActionDetailed, resolveServerHumanActionType } from "./actionTypes";
import { formatTrpgActionCheckWire } from "./gmPrompt";
import { DEFAULT_TRPG_STAT_DEFS } from "./stats";

const defs = DEFAULT_TRPG_STAT_DEFS;

function judge(body: string) {
  const actionType = resolveServerHumanActionType(body);
  const stat = pickStatForActionDetailed({ actionType, selectedStat: null, body, defs });
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
