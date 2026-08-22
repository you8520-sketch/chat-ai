import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  buildCompactNoGodmoddingStandardBlock,
  buildNoGodmoddingBlock,
  COLLABORATIVE_INTERACTIVE_OWNER_BLOCK,
  STANDARD_AGENCY_AI_ACTIVE,
  STANDARD_AGENCY_ALLOWED_EXCEPTIONS,
  STANDARD_AGENCY_CANONICAL_OWNER,
  STANDARD_AGENCY_FORBIDDEN_NEW_B,
} from "@/lib/noGodmodding";
import {
  CURRENT_USER_AGENCY_REINFORCEMENT_OWNER,
  wrapCurrentUserInput,
} from "@/lib/currentUserInputLabel";
import { resolveEffectiveUserAuthoring } from "@/lib/userCoauthorState";

function standardTexts() {
  const system = buildCompactNoGodmoddingStandardBlock();
  const wrapper = wrapCurrentUserInput("문을 닫는다.", { mode: "interactive" });
  return { system, wrapper };
}

describe("H1 STANDARD / OFF agency", () => {
  it("B1 — new user dialogue is forbidden on STANDARD/OFF", () => {
    const { system, wrapper } = standardTexts();
    assert.match(system, /새로운 직접 대사/);
    assert.match(wrapper, /새로운 직접 대사/);
    assert.match(system, /대신 확정하지 않는다/);
  });

  it("B2 — new deliberate wall-pin is forbidden", () => {
    const { system, wrapper } = standardTexts();
    for (const text of [system, wrapper]) {
      assert.match(text, /새로운 의도적 행동/);
      assert.match(text, /사소한 이동·접촉·물건 수취라도 새로 시작한 의도적 행동이면 대신하지 않는다/);
      assert.doesNotMatch(text, /사소한 이동·접촉·물건 수취·일상 행동은 공동 서술할 수 있다/);
    }
  });

  it("B3 — new deliberate hand relocation is forbidden", () => {
    const { system } = standardTexts();
    assert.match(system, STANDARD_AGENCY_FORBIDDEN_NEW_B);
  });

  it("B4 — new deliberate minor movement/contact is forbidden", () => {
    const { wrapper } = standardTexts();
    assert.doesNotMatch(wrapper, /small movement\/contact\/object-handling\/daily continuity may be co-narrated/);
    assert.match(wrapper, STANDARD_AGENCY_FORBIDDEN_NEW_B);
  });

  it("B5 — already-started user action physical consequence remains allowed", () => {
    const { system, wrapper } = standardTexts();
    for (const text of [system, wrapper]) {
      assert.match(text, /이미 시작한 행동의 즉각적이고 관찰 가능한 물리 결과/);
    }
  });

  it("B6 — involuntary physiological reaction remains allowed", () => {
    const { system, wrapper } = standardTexts();
    for (const text of [system, wrapper]) {
      assert.match(text, /비자발적 생리 반응만 공동 서술할 수 있다/);
    }
  });

  it("B7 — involuntary response must not imply consent/desire/emotion", () => {
    const { system, wrapper } = standardTexts();
    for (const text of [system, wrapper]) {
      assert.match(text, /욕망·호감·두려움·동의·거절·감정 결론으로 해석하지 않는다/);
    }
  });

  it("B8 — AI character proactive action/contact remains allowed", () => {
    const system = buildCompactNoGodmoddingStandardBlock();
    assert.match(system, STANDARD_AGENCY_AI_ACTIVE);
    const wrapper = wrapCurrentUserInput("문을 닫는다.", { mode: "interactive" });
    // Wrapper is a strict subset — must not contradict [A] activity.
    assert.doesNotMatch(wrapper, /\[A\]는 수동적으로/);
    assert.equal(system.includes(STANDARD_AGENCY_AI_ACTIVE), true);
  });

  it("B9 — persistent FULL coauthor remains allowed", () => {
    const applied = resolveEffectiveUserAuthoring({
      persistentMode: "OFF",
      currentUserInput: "OOC: 내 캐릭터 대사랑 행동도 알아서 써줘.",
    });
    assert.equal(applied.currentMode, "FULL");
    assert.equal(applied.persistentAfter, "FULL");
    assert.equal(applied.delegation.allowDialogue, true);
    assert.equal(applied.delegation.allowMajorActions, true);
    const owner = buildNoGodmoddingBlock("", "", "currentTurnDelegated", {
      currentTurnDelegation: applied.delegation,
    });
    assert.match(owner, /CURRENT-TURN OOC DELEGATION/);
    assert.doesNotMatch(owner, /\[USER CONTROL — COLLABORATIVE INTERACTIVE\]/);
  });

  it("B10 — turn-only FULL remains current-turn only", () => {
    const applied = resolveEffectiveUserAuthoring({
      persistentMode: "OFF",
      currentUserInput: "OOC: 이번 턴만 내 대사랑 행동도 알아서 써줘.",
    });
    assert.equal(applied.currentMode, "FULL");
    assert.equal(applied.persistentAfter, "OFF");
    const next = resolveEffectiveUserAuthoring({
      persistentMode: "OFF",
      currentUserInput: "괜찮아?",
      previousUserInput: "OOC: 이번 턴만 내 대사랑 행동도 알아서 써줘.",
    });
    assert.equal(next.currentMode, "OFF");
    assert.equal(next.persistentAfter, "OFF");
  });

  it("B11 — explicit revoke returns to OFF", () => {
    const applied = resolveEffectiveUserAuthoring({
      persistentMode: "FULL",
      currentUserInput: "OOC: 이제 내 대사나 행동은 쓰지 마.",
    });
    assert.equal(applied.currentMode, "OFF");
    assert.equal(applied.persistentAfter, "OFF");
  });

  it("canonical owner and wrapper reuse the same constants; wrapper is a strict subset", () => {
    assert.equal(STANDARD_AGENCY_CANONICAL_OWNER, "[USER CONTROL — COLLABORATIVE INTERACTIVE]");
    assert.equal(CURRENT_USER_AGENCY_REINFORCEMENT_OWNER, "CURRENT_USER_COLLABORATIVE_WRAPPER");
    const system = COLLABORATIVE_INTERACTIVE_OWNER_BLOCK;
    const wrapper = wrapCurrentUserInput("x", { mode: "interactive" });
    assert.equal(system.includes(STANDARD_AGENCY_FORBIDDEN_NEW_B), true);
    assert.equal(system.includes(STANDARD_AGENCY_ALLOWED_EXCEPTIONS), true);
    assert.equal(wrapper.includes(STANDARD_AGENCY_FORBIDDEN_NEW_B), true);
    assert.equal(wrapper.includes(STANDARD_AGENCY_ALLOWED_EXCEPTIONS), true);
    assert.equal(system.includes(STANDARD_AGENCY_AI_ACTIVE), true);
    assert.equal(wrapper.includes(STANDARD_AGENCY_AI_ACTIVE), false);
    assert.doesNotMatch(wrapper, /일상 행동은 공동 서술할 수 있다/);
    assert.doesNotMatch(system, /일상 행동은 공동 서술할 수 있다/);
  });
});
