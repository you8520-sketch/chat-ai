import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { DEFAULT_STATUS_WIDGET } from "./defaultTemplate";
import { collectWidgetJsonKeys } from "./prompt";
import { normalizeWidgetExtraction } from "./extractNormalize";
import {
  buildCombinedDualWidgetExtractSystem,
  buildCombinedDualWidgetExtractUserBlock,
  buildWidgetExtractRepairUserBlock,
  buildWidgetExtractSystem,
  buildWidgetExtractUserBlock,
  formatPreviousTurnWidgetValues,
  looksLikeInnerStateField,
  measureStatusWidgetPreviousEcho,
} from "./extractNormalize";
import type { StatusWidget } from "./types";

const PERSISTENT_WIDGET: StatusWidget = {
  ...DEFAULT_STATUS_WIDGET,
  fields: [
    { id: "place", label: "장소", instruction: "현재 장소" },
    { id: "time", label: "시각", instruction: "현재 시각" },
    { id: "hp", label: "체력", instruction: "체력 수치" },
    { id: "mood", label: "속마음", instruction: "NPC의 속마음" },
  ],
};

describe("V3 previous-echo guard (prompt + measure)", () => {
  it("A. persistent unchanged — keep-when-unchanged allowed; no force-every-turn rule", () => {
    const system = buildWidgetExtractSystem(
      PERSISTENT_WIDGET,
      collectWidgetJsonKeys(PERSISTENT_WIDGET)
    );
    assert.match(system, /continuity references, not answer text to copy/i);
    assert.match(system, /Persistent state[\s\S]*may keep prior values when unchanged/i);
    assert.doesNotMatch(system, /must change every turn/i);
    assert.doesNotMatch(system, /무조건 매턴/);
    assert.doesNotMatch(system, /force.*new value.*every turn/i);

    const previous = formatPreviousTurnWidgetValues(
      { 장소: "본부 식당", 시각: "12:30", 체력: "90" },
      "character",
      PERSISTENT_WIDGET
    );
    assert.match(previous, /continuity reference/);
    assert.match(previous, /본부 식당/);
    assert.match(previous, /12:30/);
    assert.match(previous, /90/);
  });

  it("B. inner-state current-turn update — do not copy previous wording as answer", () => {
    const system = buildWidgetExtractSystem(
      PERSISTENT_WIDGET,
      collectWidgetJsonKeys(PERSISTENT_WIDGET)
    );
    assert.match(system, /Freshly evaluate inner-state at the END of the current turn/i);
    assert.match(system, /do not mechanically repeat the previous wording/i);
    assert.match(
      system,
      /new actions, dialogue, information, or emotional context/i
    );

    const user = buildWidgetExtractUserBlock({
      charName: "라이크",
      personaName: "렌",
      userMessage: "사실 나는 가이드가 아니야. 위장 신분이야.",
      assistantProse:
        "라이크는 숨을 멈췄다. 신입의 정체가 뒤집히자 경계가 선명해졌다. 그는 말을 고르며 한 발 물러섰다.",
      widget: PERSISTENT_WIDGET,
      source: "character",
      previousValues: { 속마음: "이 신입은 조금 수상하네." },
    });
    assert.match(user, /PREVIOUS TURN CHARACTER WIDGET VALUES/);
    assert.match(user, /이 신입은 조금 수상하네/);
    assert.match(user, /continuity reference/);
    assert.match(user, /답안 복사용이 아니다|기계적으로 복사하지 말고/);
    assert.match(user, /ASSISTANT REPLY — current turn prose only/);
    assert.match(user, /위장 신분/);
    // Current RP + reminder after previous values (not previous as final exemplar).
    const prevIdx = user.indexOf("[PREVIOUS TURN CHARACTER WIDGET VALUES]");
    const rpIdx = user.indexOf("[ASSISTANT REPLY — current turn prose only]");
    const remIdx = user.indexOf("[REMINDER]");
    assert.ok(prevIdx >= 0 && rpIdx > prevIdx && remIdx > rpIdx);
  });

  it("C. same underlying emotion — false change not forced", () => {
    const system = buildWidgetExtractSystem(
      PERSISTENT_WIDGET,
      collectWidgetJsonKeys(PERSISTENT_WIDGET)
    );
    assert.match(
      system,
      /If the underlying state genuinely remains unchanged, preserve the meaning/i
    );
    assert.match(system, /exact wording need not be copied/i);
    assert.doesNotMatch(system, /must paraphrase every turn/i);
    assert.doesNotMatch(system, /always invent a new emotion/i);
  });

  it("D. whole snapshot echo — previous JSON is not an allowed copy-answer template", () => {
    const previousSnapshot = {
      장소: "에이지스 본관 복도",
      시각: "14:30",
      속마음: "이상한 사람이라고 생각하지만 나쁜 의미는 아니다.",
      속마음표정: "( •́ _ •̀)",
    };
    const user = buildWidgetExtractUserBlock({
      charName: "플러드",
      personaName: "고로",
      userMessage: "난 그냥 행정직원이야 우리 플러드는 어디가는길?",
      assistantProse:
        "행정직원. 서강우는 그 말을 들으면서도 상대의 얼굴에서 눈을 떼지 않았다. 그는 복도 한가운데서 기다렸다.",
      widget: PERSISTENT_WIDGET,
      source: "character",
      previousValues: previousSnapshot,
    });
    assert.match(user, /not answer text to copy/i);
    assert.doesNotMatch(user, /copy previous snapshot/i);
    assert.doesNotMatch(user, /paste the previous JSON/i);
    assert.match(user, /continuity reference/);

    const dualSys = buildCombinedDualWidgetExtractSystem(
      PERSISTENT_WIDGET,
      PERSISTENT_WIDGET
    );
    assert.match(dualSys, /continuity references, not answer text to copy/i);
    assert.match(dualSys, /do not mechanically repeat previous wording/i);

    const dualUser = buildCombinedDualWidgetExtractUserBlock({
      charName: "플러드",
      personaName: "고로",
      userMessage: "어디 가는 길?",
      assistantProse: "그는 컵을 든 채 대답을 기다렸다.",
      characterWidget: PERSISTENT_WIDGET,
      userWidget: PERSISTENT_WIDGET,
      previousCharacterValues: previousSnapshot,
    });
    assert.match(dualUser, /continuity reference/);
    assert.match(dualUser, /not answer text to copy/i);
  });

  it("E. normalizeWidgetExtraction still does not backfill from previous", () => {
    const normalized = normalizeWidgetExtraction({ 시간: "15:00" }, DEFAULT_STATUS_WIDGET);
    assert.equal(normalized["시간"], "15:00");
    assert.equal(normalized["장소"], undefined);
    assert.equal(normalized["속마음"], undefined);
    assert.equal(normalized["현재상황"], undefined);
  });

  it("repair assembly puts previous before current RP (not last exemplar)", () => {
    const block = buildWidgetExtractRepairUserBlock({
      keys: collectWidgetJsonKeys(PERSISTENT_WIDGET),
      widget: PERSISTENT_WIDGET,
      source: "character",
      charName: "레온",
      personaName: "렌",
      userMessage: "잠시 기다린다",
      assistantProse: "그는 신입의 말에 숨을 고르며 표정을 바꿨다.",
      previousValues: { 속마음: "이 신입은 조금 수상하네." },
    });
    const prevIdx = block.indexOf("[PREVIOUS CANONICAL WIDGET VALUES]");
    const rpIdx = block.indexOf("[ASSISTANT RP — FINAL SCENE PRIORITY]");
    assert.ok(prevIdx >= 0 && rpIdx > prevIdx);
    assert.match(block, /continuity reference/);
    assert.ok(block.trimEnd().endsWith("그는 신입의 말에 숨을 고르며 표정을 바꿨다."));
  });

  it("measureStatusWidgetPreviousEcho counts exact inner-state / whole-character matches", () => {
    const widget: StatusWidget = {
      ...DEFAULT_STATUS_WIDGET,
      fields: [
        { id: "place", label: "장소", instruction: "장소" },
        { id: "inner", label: "속마음", instruction: "NPC의 속마음" },
        { id: "face", label: "속마음표정", instruction: "표정" },
      ],
    };
    assert.equal(looksLikeInnerStateField(widget.fields[1]!), true);
    assert.equal(looksLikeInnerStateField(widget.fields[2]!), true);

    const previous = {
      장소: "복도",
      속마음: "수상하네",
      속마음표정: "(・_・;)",
    };
    const partial = {
      장소: "식당",
      속마음: "수상하네",
      속마음표정: "(・_・;)",
    };
    const partialStats = measureStatusWidgetPreviousEcho({
      widget,
      previous,
      current: partial,
    });
    assert.equal(partialStats.compared, 2);
    assert.equal(partialStats.exact, 2);
    assert.equal(partialStats.allExact, true);
    assert.equal(partialStats.wholeCharacterExact, false);
    assert.deepEqual(partialStats.exactKeys.sort(), ["속마음", "속마음표정"].sort());

    const whole = measureStatusWidgetPreviousEcho({
      widget,
      previous,
      current: { ...previous },
    });
    assert.equal(whole.wholeCharacterExact, true);
    assert.equal(whole.allExact, true);

    const fresh = measureStatusWidgetPreviousEcho({
      widget,
      previous,
      current: {
        장소: "식당",
        속마음: "정체가 들통났으니 경계를 높여야 한다.",
        속마음표정: "(￣ヘ￣)",
      },
    });
    assert.equal(fresh.exact, 0);
    assert.equal(fresh.allExact, false);
    assert.equal(fresh.wholeCharacterExact, false);
  });
});
