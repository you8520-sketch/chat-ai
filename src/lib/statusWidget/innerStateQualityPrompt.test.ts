/**
 * Inner-state quality prompt policy (soft style) — no hard-guard / rewrite changes.
 * Full policy lives only in INNER_STATE_QUALITY_EN (system); reminder KO is a short nudge.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { DEFAULT_STATUS_WIDGET } from "./defaultTemplate";
import { collectWidgetJsonKeys } from "./prompt";
import {
  INNER_STATE_QUALITY_EN,
  INNER_STATE_QUALITY_KO,
  buildCombinedDualWidgetExtractSystem,
  buildCombinedDualWidgetExtractUserBlock,
  buildWidgetExtractRepairSystem,
  buildWidgetExtractSystem,
  buildWidgetExtractUserBlock,
} from "./extractNormalize";

const KEYS = collectWidgetJsonKeys(DEFAULT_STATUS_WIDGET);

function countOccurrences(haystack: string, needle: string): number {
  if (!needle) return 0;
  let n = 0;
  let from = 0;
  while (true) {
    const i = haystack.indexOf(needle, from);
    if (i < 0) return n;
    n += 1;
    from = i + needle.length;
  }
}

describe("inner-state quality prompt policy", () => {
  it("A. prefers current-turn judgment/question/intent delta over same-axis restatement", () => {
    const system = buildWidgetExtractSystem(DEFAULT_STATUS_WIDGET, KEYS, "character");
    assert.match(
      system,
      /current-turn change in judgment, emotion, question, conflict, decision, or intent/
    );
    assert.match(system, /avoid repeatedly restating the same conclusion/);
    assert.equal(system.includes(INNER_STATE_QUALITY_EN), true);
  });

  it("B. same emotion allowed — does not force a new emotion every turn", () => {
    const system = buildWidgetExtractSystem(DEFAULT_STATUS_WIDGET, KEYS, "character");
    const dual = buildCombinedDualWidgetExtractSystem(
      DEFAULT_STATUS_WIDGET,
      DEFAULT_STATUS_WIDGET
    );
    const repair = buildWidgetExtractRepairSystem(KEYS, "character");
    for (const block of [system, dual, repair]) {
      assert.match(block, /do not invent a false change/);
      assert.doesNotMatch(block, /must change (the )?emotion/i);
      assert.doesNotMatch(block, /매 턴 새로운 감정/);
      assert.doesNotMatch(block, /반드시 감정을 바꿔/);
      assert.doesNotMatch(block, /force a (new|different) emotion/i);
    }
  });

  it("C. subject-label opener soft anti-pattern — prefer direct thought, no blacklist", () => {
    const system = buildWidgetExtractSystem(DEFAULT_STATUS_WIDGET, KEYS, "character");
    const reminder = buildWidgetExtractUserBlock({
      charName: "라이크",
      personaName: "렌",
      userMessage: "…",
      assistantProse: "…",
      widget: DEFAULT_STATUS_WIDGET,
      source: "character",
    });
    assert.match(
      system,
      /When the referent is already obvious, prefer a direct thought over repeatedly beginning with the person's name\/role\/label/
    );
    assert.match(system, /이 사람\/이 신입\/저 녀석/);
    assert.match(system, /names\/labels remain fine when natural/);
    // Reminder must not restate subject-start / same-axis full policy (EN-only).
    assert.doesNotMatch(reminder, /이 사람\/이 신입\/저 녀석/);
    assert.doesNotMatch(reminder, /습관적으로 반복하지/);
    assert.doesNotMatch(reminder, /같은 결론을 표현만 바꿔/);
    assert.doesNotMatch(reminder, /slightly different wording across turns/);
    assert.doesNotMatch(system, /never (use|say|write) ['"]이 신입/);
    assert.doesNotMatch(system, /never start with a subject/i);
    assert.doesNotMatch(system, /must use a different sentence structure/i);
    assert.doesNotMatch(system, /forbidden.*(이 신입|이 사람|저 녀석)/i);
    assert.doesNotMatch(reminder, /금지.*(이 신입|이 사람|저 녀석)/);
  });

  it("D. concrete delta and intent over generic person-evaluation", () => {
    const system = buildWidgetExtractSystem(DEFAULT_STATUS_WIDGET, KEYS, "character");
    assert.match(
      system,
      /prefer a specific question\/judgment\/intent about that delta over a generic character evaluation/
    );
    assert.match(
      system,
      /prefer expressing that intent over re-evaluating the same person again/
    );
  });

  it("E. body echo: system has full policy; reminder only short current-turn/복창 nudge", () => {
    const system = buildWidgetExtractSystem(DEFAULT_STATUS_WIDGET, KEYS, "character");
    const reminder = buildWidgetExtractUserBlock({
      charName: "라이크",
      personaName: "렌",
      userMessage: "…",
      assistantProse: "이 사람, 정말 신입 맞는 걸까.",
      widget: DEFAULT_STATUS_WIDGET,
      source: "character",
    });
    assert.match(system, /do not merely echo that sentence/);
    assert.match(system, /resulting judgment or intent/);
    assert.match(system, /without inventing unsupported facts/);
    assert.equal(reminder.includes(INNER_STATE_QUALITY_KO), true);
    assert.match(reminder, /현재 턴에서 새로 생긴 판단·의문·의도/);
    assert.match(reminder, /내면문장을 그대로 복창하지 마라/);
    assert.doesNotMatch(reminder, /설명·분석·요약문/);
    assert.doesNotMatch(reminder, /1인칭 내면으로 쓴다/);
    // KO stays short — no EN semantic re-expansion
    assert.doesNotMatch(reminder, /referent is already obvious/);
    assert.doesNotMatch(reminder, /generic character evaluation/);
  });

  it("full quality EN appears once in assembled single / dual / repair system owners", () => {
    const singleSystem = buildWidgetExtractSystem(DEFAULT_STATUS_WIDGET, KEYS, "character");
    const singleUser = buildWidgetExtractUserBlock({
      charName: "라이크",
      personaName: "렌",
      userMessage: "…",
      assistantProse: "…",
      widget: DEFAULT_STATUS_WIDGET,
      source: "character",
    });
    const singleAssembled = `${singleSystem}\n\n${singleUser}`;
    assert.equal(countOccurrences(singleAssembled, INNER_STATE_QUALITY_EN), 1);
    assert.equal(countOccurrences(singleUser, INNER_STATE_QUALITY_EN), 0);
    assert.equal(countOccurrences(singleUser, INNER_STATE_QUALITY_KO), 1);

    const dualSystem = buildCombinedDualWidgetExtractSystem(
      DEFAULT_STATUS_WIDGET,
      DEFAULT_STATUS_WIDGET
    );
    const dualUser = buildCombinedDualWidgetExtractUserBlock({
      charName: "라이크",
      personaName: "렌",
      userMessage: "…",
      assistantProse: "…",
      characterWidget: DEFAULT_STATUS_WIDGET,
      userWidget: DEFAULT_STATUS_WIDGET,
    });
    const dualAssembled = `${dualSystem}\n\n${dualUser}`;
    assert.equal(countOccurrences(dualAssembled, INNER_STATE_QUALITY_EN), 1);
    assert.equal(countOccurrences(dualUser, INNER_STATE_QUALITY_EN), 0);
    assert.equal(countOccurrences(dualUser, INNER_STATE_QUALITY_KO), 1);

    const repair = buildWidgetExtractRepairSystem(KEYS, "character");
    assert.equal(countOccurrences(repair, INNER_STATE_QUALITY_EN), 1);
  });

  it("single / dual / repair share the same EN quality owner (no conflicting wording)", () => {
    const single = buildWidgetExtractSystem(DEFAULT_STATUS_WIDGET, KEYS, "character");
    const dual = buildCombinedDualWidgetExtractSystem(
      DEFAULT_STATUS_WIDGET,
      DEFAULT_STATUS_WIDGET
    );
    const repair = buildWidgetExtractRepairSystem(KEYS, "character");
    assert.equal(single.includes(INNER_STATE_QUALITY_EN), true);
    assert.equal(dual.includes(INNER_STATE_QUALITY_EN), true);
    assert.equal(repair.includes(INNER_STATE_QUALITY_EN), true);
  });
});
