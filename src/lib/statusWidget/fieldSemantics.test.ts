/**
 * Creator field semantics — factual vs interpretive, volatile merge, prompt parity.
 * Deterministic: final prompt assembly + parser/merge contract (no live Luna).
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  STATUS_WIDGET_FIELD_SEMANTICS_EN,
  buildCombinedDualWidgetExtractSystem,
  buildCombinedDualWidgetExtractUserBlock,
  buildVolatileEchoRepairSystem,
  buildWidgetExtractRepairSystem,
  buildWidgetExtractSystem,
  buildWidgetExtractUserBlock,
  formatPreviousTurnWidgetValues,
  looksLikeInnerStateField,
  looksLikeVolatileTurnDerivedField,
  looksLikeVolatileTurnDerivedKey,
  normalizeWidgetExtraction,
} from "./extractNormalize";
import { collectWidgetJsonKeys } from "./prompt";
import type { StatusWidget, StatusWidgetField } from "./types";

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

function field(label: string, instruction: string, id?: string): StatusWidgetField {
  return { id: id ?? label, label, instruction };
}

const FACTUAL_WIDGET: StatusWidget = {
  version: 1,
  name: "factual",
  htmlTemplate: "{{장소}}{{소지품}}",
  placement: "bottom",
  fields: [
    field("장소", "현재 장소"),
    field("소지품", "현재 소지품"),
    field("부상", "현재 부상 상태"),
    field("호감도", "0~100 숫자로만"),
  ],
};

const DERIVED_WIDGET: StatusWidget = {
  version: 1,
  name: "derived",
  htmlTemplate: "{{감정}}{{속마음}}",
  placement: "bottom",
  fields: [
    field("감정", "현재 감정"),
    field("감정카오모지", "감정을 카오모지 하나로만 표현", "감정카오모지"),
    field("속마음", "NPC의 속마음"),
    field("의식의흐름", "캐릭터의 의식의 흐름"),
    field("하고싶은일", "현재 하고 싶은 일 3가지", "하고싶은일"),
    field("욕구", "현재 욕구"),
  ],
};

const MIXED_WIDGET: StatusWidget = {
  version: 1,
  name: "mixed",
  htmlTemplate: "{{장소}}{{부상}}{{감정카오모지}}{{속마음}}{{하고싶은일}}",
  placement: "bottom",
  fields: [
    field("장소", "현재 장소"),
    field("부상", "현재 부상 상태"),
    field("감정카오모지", "감정을 카오모지 하나로만 표현", "감정카오모지"),
    field("속마음", "NPC의 속마음"),
    field("하고싶은일", "현재 하고 싶은 일 3가지", "하고싶은일"),
  ],
};

const USER_EMOTION_WIDGET: StatusWidget = {
  version: 1,
  name: "user-emotion",
  htmlTemplate: "{{유저감정}}",
  placement: "bottom",
  fields: [field("유저감정", "유저의 속마음", "유저감정")],
};

const SCENE = {
  charName: "레온",
  personaName: "렌",
  userMessage: "오늘 다른 사람과 점심을 먹었어.",
  assistantProse:
    "레온의 눈빛이 잠시 흔들렸다. 질투심이 스치지만, 표정은 평온을 유지했다.\n\n" +
    '"…그래. 맛있었어?"\n\n' +
    "그는 손에 든 컵을 내려놓으며, 렌과 단둘이 이야기하고 싶다는 생각을 했다.",
};

describe("status widget creator field semantics", () => {
  it("CASE A/B/C/D root — canonical semantics owner appears once per assembled system", () => {
    for (const widget of [FACTUAL_WIDGET, DERIVED_WIDGET, MIXED_WIDGET]) {
      const keys = collectWidgetJsonKeys(widget);
      const system = buildWidgetExtractSystem(widget, keys, "character");
      const user = buildWidgetExtractUserBlock({ ...SCENE, widget, source: "character" });
      const assembled = `${system}\n\n${user}`;
      assert.equal(countOccurrences(assembled, STATUS_WIDGET_FIELD_SEMANTICS_EN), 1);
      assert.match(system, /Factual\/extractive fields/);
      assert.match(system, /Character-interpretive fields/);
      assert.match(system, /Obey each field's instruction/);
      assert.match(system, /\[USER\] inner-state/);
    }

    const dualSystem = buildCombinedDualWidgetExtractSystem(DERIVED_WIDGET, USER_EMOTION_WIDGET);
    const dualUser = buildCombinedDualWidgetExtractUserBlock({
      ...SCENE,
      characterWidget: DERIVED_WIDGET,
      userWidget: USER_EMOTION_WIDGET,
    });
    assert.equal(
      countOccurrences(`${dualSystem}\n\n${dualUser}`, STATUS_WIDGET_FIELD_SEMANTICS_EN),
      1
    );

    const repair = buildWidgetExtractRepairSystem(collectWidgetJsonKeys(MIXED_WIDGET), "character");
    assert.equal(countOccurrences(repair, STATUS_WIDGET_FIELD_SEMANTICS_EN), 1);

    const echoRepair = buildVolatileEchoRepairSystem(["속마음"], "character");
    assert.match(echoRepair, /interpretive\/desire fields/);
  });

  it("CASE 1 — factual fields are not volatile; inventory/injury stay persistent-class", () => {
    assert.equal(looksLikeVolatileTurnDerivedField(FACTUAL_WIDGET.fields[0]!), false); // 장소
    assert.equal(looksLikeVolatileTurnDerivedField(FACTUAL_WIDGET.fields[1]!), false); // 소지품
    assert.equal(looksLikeVolatileTurnDerivedField(FACTUAL_WIDGET.fields[2]!), false); // 부상

    const prev = formatPreviousTurnWidgetValues(
      { 장소: "카페", 소지품: "없음", 부상: "없음", 호감도: "72" },
      "character",
      FACTUAL_WIDGET
    );
    assert.match(prev, /장소: 카페/);
    assert.match(prev, /소지품: 없음/);
    assert.match(prev, /부상: 없음/);

    const system = buildWidgetExtractSystem(
      FACTUAL_WIDGET,
      collectWidgetJsonKeys(FACTUAL_WIDGET),
      "character"
    );
    assert.match(system, /do not invent new canonical facts \(items, weapons, injuries/);
  });

  it("CASE 2 — derived emotion fields allow inference (not suppressed as unknown)", () => {
    const emotionField = DERIVED_WIDGET.fields[0]!;
    assert.equal(looksLikeInnerStateField(emotionField), true);
    assert.equal(looksLikeVolatileTurnDerivedField(emotionField), true);

    const system = buildWidgetExtractSystem(
      DERIVED_WIDGET,
      collectWidgetJsonKeys(DERIVED_WIDGET),
      "character"
    );
    assert.match(system, /allow reasonable current-state inference/);
    assert.match(system, /If \[PREVIOUS TURN WIDGET VALUES\] has a prior value/);
    assert.doesNotMatch(system, /Fill every key with a scene-accurate value from the assistant prose/);
  });

  it("CASE 3 — kaomoji creator instruction appears in WIDGET FIELDS; semantics require format obedience", () => {
    const kaomojiField = MIXED_WIDGET.fields[2]!;
    assert.equal(looksLikeInnerStateField(kaomojiField), true);

    const user = buildWidgetExtractUserBlock({
      ...SCENE,
      widget: MIXED_WIDGET,
      source: "character",
    });
    assert.match(user, /감정을 카오모지 하나로만 표현/);
    assert.match(user, /\[WIDGET FIELDS\]/);

    const system = buildWidgetExtractSystem(
      MIXED_WIDGET,
      collectWidgetJsonKeys(MIXED_WIDGET),
      "character"
    );
    assert.match(system, /kaomoji-only/);
  });

  it("CASE 4 — three-wants field is volatile/interpretive (not persisted as previous anchor)", () => {
    const wantsField = DERIVED_WIDGET.fields[4]!;
    assert.equal(looksLikeVolatileTurnDerivedField(wantsField), true);
    assert.equal(looksLikeInnerStateField(wantsField), true);

    const prev = formatPreviousTurnWidgetValues(
      {
        장소: "사무실",
        하고싶은일: "1. 잠자기\n2. 먹기\n3. 쉬기",
      },
      "character",
      MIXED_WIDGET
    );
    assert.match(prev, /장소: 사무실/);
    assert.doesNotMatch(prev, /하고싶은일/);
    assert.doesNotMatch(prev, /잠자기/);

    const system = buildWidgetExtractSystem(
      DERIVED_WIDGET,
      collectWidgetJsonKeys(DERIVED_WIDGET),
      "character"
    );
    assert.match(system, /things they want to do now/);
    assert.match(system, /current interpretation\/intent, not memory/);
  });

  it("CASE 5 — stream of consciousness field is interpretive", () => {
    const socField = DERIVED_WIDGET.fields[3]!;
    assert.equal(looksLikeInnerStateField(socField), true);
    assert.match(
      buildWidgetExtractSystem(DERIVED_WIDGET, collectWidgetJsonKeys(DERIVED_WIDGET), "character"),
      /stream of consciousness/
    );
  });

  it("CASE 6 — mixed widget: factual previous kept, derived previous omitted", () => {
    const prev = formatPreviousTurnWidgetValues(
      {
        장소: "옥상",
        부상: "없음",
        감정카오모지: "(¬_¬)",
        속마음: "예전 속마음",
        하고싶은일: "1. 도망\n2. 숨기\n3. 회피",
      },
      "character",
      MIXED_WIDGET
    );
    assert.match(prev, /장소: 옥상/);
    assert.match(prev, /부상: 없음/);
    assert.doesNotMatch(prev, /감정카오모지/);
    assert.doesNotMatch(prev, /속마음/);
    assert.doesNotMatch(prev, /하고싶은일/);
  });

  it("CASE 7 — user agency boundary in canonical semantics", () => {
    const system = buildWidgetExtractSystem(
      USER_EMOTION_WIDGET,
      collectWidgetJsonKeys(USER_EMOTION_WIDGET),
      "user"
    );
    assert.match(system, /infer only from the user's own dialogue, actions, and persona/);
    assert.match(system, /character's guess, not stated user fact/);
  });

  it("CASE 8 — subject separation preserved in interpretive block", () => {
    const system = buildWidgetExtractSystem(
      DERIVED_WIDGET,
      collectWidgetJsonKeys(DERIVED_WIDGET),
      "character"
    );
    assert.match(system, /Never substitute the other person's feelings/);
    assert.match(
      buildCombinedDualWidgetExtractSystem(DERIVED_WIDGET, USER_EMOTION_WIDGET),
      /Do not swap \[CHARACTER\] and \[USER\] subjects/
    );
  });

  it("CASE 9 — volatile update: wants/emotion not injected as previous continuity", () => {
    const echoKeys = ["속마음", "하고싶은일"];
    for (const key of echoKeys) {
      assert.equal(looksLikeVolatileTurnDerivedKey(key), true);
    }
    assert.equal(looksLikeVolatileTurnDerivedKey("장소"), false);
    assert.equal(looksLikeVolatileTurnDerivedKey("부상"), false);
  });

  it("CASE 10 — creator numeric format instruction reaches final user block", () => {
    const user = buildWidgetExtractUserBlock({
      ...SCENE,
      widget: FACTUAL_WIDGET,
      source: "character",
    });
    assert.match(user, /0~100 숫자로만/);
  });

  it("parser contract unchanged — normalize still maps keys without inventing values", () => {
    const normalized = normalizeWidgetExtraction(
      {
        장소: "카페",
        감정카오모지: "(˶ᵔ ᵕ ᵔ˶)",
        속마음: "질투가 스친다",
        extracted_facts: [{ category: "x", attribute: "y", value: "z", fact_text: "t", evidence: "e" }],
      },
      MIXED_WIDGET
    );
    assert.equal(normalized["장소"], "카페");
    assert.equal(normalized["감정카오모지"], "(˶ᵔ ᵕ ᵔ˶)");
    assert.equal(normalized["속마음"], "질투가 스친다");
    assert.equal(normalized["부상"], undefined);
  });
});
