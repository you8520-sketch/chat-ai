import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { DEFAULT_STATUS_WIDGET } from "./defaultTemplate";
import { collectWidgetJsonKeys } from "./prompt";
import { normalizeWidgetExtraction } from "./extractNormalize";
import {
  buildCombinedDualWidgetExtractSystem,
  buildCombinedDualWidgetExtractUserBlock,
  buildVolatileEchoRepairUserBlock,
  buildWidgetExtractRepairUserBlock,
  buildWidgetExtractSystem,
  buildWidgetExtractUserBlock,
  collectVolatileExactEchoKeys,
  formatPreviousTurnWidgetValues,
  looksLikeInnerStateField,
  looksLikeVolatileTurnDerivedField,
  measureStatusWidgetPreviousEcho,
  mergeVolatileRepairIntoValues,
} from "./extractNormalize";
import {
  extractStatusWidgetValuesForTurn,
  type StatusWidgetExtractCaller,
} from "./extract";
import type { ResolvedStatusWidgetTurn, StatusWidget } from "./types";
import type { TokenUsage } from "@/lib/ai";

const PERSISTENT_WIDGET: StatusWidget = {
  ...DEFAULT_STATUS_WIDGET,
  fields: [
    { id: "place", label: "장소", instruction: "현재 장소" },
    { id: "time", label: "시각", instruction: "현재 시각" },
    { id: "hp", label: "체력", instruction: "체력 수치" },
    { id: "mood", label: "속마음", instruction: "NPC의 속마음" },
    { id: "situation", label: "현재상황", instruction: "지금 벌어지는 상황" },
  ],
};

function characterResolved(widget: StatusWidget = PERSISTENT_WIDGET): ResolvedStatusWidgetTurn {
  return {
    active: true,
    mode: "character_only",
    displayMode: "creator",
    stackOrder: "character_first",
    characterWidget: widget,
    userWidget: null,
    needsCharacterValues: true,
    needsUserValues: false,
  };
}

const usage = (n: number): TokenUsage => ({
  inputTokens: 10 + n,
  outputTokens: 5 + n,
  estimated: true,
});

function jsonForWidget(widget: StatusWidget, overrides: Record<string, string> = {}): string {
  const keys = collectWidgetJsonKeys(widget);
  const obj: Record<string, unknown> = {};
  for (const key of keys) {
    obj[key] = overrides[key] ?? `값-${key}`;
  }
  obj.extracted_facts = [];
  return JSON.stringify(obj);
}

describe("V3 previous-echo guard (volatile shield + targeted repair)", () => {
  it("A. persistent unchanged — keep-when-unchanged allowed; no force-every-turn rule", () => {
    const system = buildWidgetExtractSystem(
      PERSISTENT_WIDGET,
      collectWidgetJsonKeys(PERSISTENT_WIDGET)
    );
    assert.match(system, /continuity references, not answer text to copy/i);
    assert.match(system, /Persistent state[\s\S]*may keep prior values when unchanged/i);
    assert.doesNotMatch(system, /must change every turn/i);

    const previous = formatPreviousTurnWidgetValues(
      { 장소: "본부 식당", 시각: "12:30", 체력: "90", 속마음: "이 신입, 흥미롭군." },
      "character",
      PERSISTENT_WIDGET
    );
    assert.match(previous, /continuity reference/);
    assert.match(previous, /본부 식당/);
    assert.match(previous, /12:30/);
    assert.match(previous, /90/);
    // Volatile previous answers must not appear as continuity anchors.
    assert.doesNotMatch(previous, /이 신입, 흥미롭군/);
    assert.doesNotMatch(previous, /속마음/);
  });

  it("B. volatile previous values are omitted from extract continuity block", () => {
    const user = buildWidgetExtractUserBlock({
      charName: "라이크",
      personaName: "렌",
      userMessage: "사실 나는 가이드가 아니야. 위장 신분이야.",
      assistantProse:
        "라이크는 숨을 멈췄다. 신입의 정체가 뒤집히자 경계가 선명해졌다. 그는 말을 고르며 한 발 물러섰다.",
      widget: PERSISTENT_WIDGET,
      source: "character",
      previousValues: {
        속마음: "이 신입은 조금 수상하네.",
        현재상황: "신입을 관찰 중",
        장소: "에이지스 복도",
      },
    });
    assert.match(user, /PREVIOUS TURN CHARACTER WIDGET VALUES/);
    assert.match(user, /에이지스 복도/);
    assert.doesNotMatch(user, /이 신입은 조금 수상하네/);
    assert.doesNotMatch(user, /신입을 관찰 중/);
    assert.match(user, /continuity reference/);
    // Persistent-only previous block: volatile answer text must not appear as anchors.
    assert.match(user, /- 장소: 에이지스 복도/);
    assert.doesNotMatch(user, /- 속마음:/);
    assert.doesNotMatch(user, /- 현재상황:/);
  });

  it("C. same underlying emotion — false change not forced in soft rules", () => {
    const system = buildWidgetExtractSystem(
      PERSISTENT_WIDGET,
      collectWidgetJsonKeys(PERSISTENT_WIDGET)
    );
    assert.match(
      system,
      /If the underlying state genuinely remains unchanged, preserve the meaning/i
    );
    assert.match(system, /exact wording need not be copied/i);
  });

  it("D. whole snapshot — volatile keys shielded; persistent remain", () => {
    const previousSnapshot = {
      장소: "에이지스 본관 복도",
      시각: "14:30",
      속마음: "이상한 사람이라고 생각하지만 나쁜 의미는 아니다.",
      현재상황: "복도에서 대화 중",
    };
    const user = buildWidgetExtractUserBlock({
      charName: "플러드",
      personaName: "고로",
      userMessage: "난 그냥 행정직원이야",
      assistantProse: "서강우는 그 말을 들으면서도 상대의 얼굴에서 눈을 떼지 않았다.",
      widget: PERSISTENT_WIDGET,
      source: "character",
      previousValues: previousSnapshot,
    });
    assert.match(user, /에이지스 본관 복도/);
    assert.match(user, /14:30/);
    assert.doesNotMatch(user, /이상한 사람이라고 생각하지만/);
    assert.doesNotMatch(user, /복도에서 대화 중/);

    const dualUser = buildCombinedDualWidgetExtractUserBlock({
      charName: "플러드",
      personaName: "고로",
      userMessage: "어디 가는 길?",
      assistantProse: "그는 컵을 든 채 대답을 기다렸다.",
      characterWidget: PERSISTENT_WIDGET,
      userWidget: PERSISTENT_WIDGET,
      previousCharacterValues: previousSnapshot,
    });
    assert.match(dualUser, /에이지스 본관 복도/);
    assert.doesNotMatch(dualUser, /이상한 사람이라고 생각하지만/);
  });

  it("E. normalizeWidgetExtraction still does not backfill from previous", () => {
    const normalized = normalizeWidgetExtraction({ 시간: "15:00" }, DEFAULT_STATUS_WIDGET);
    assert.equal(normalized["시간"], "15:00");
    assert.equal(normalized["속마음"], undefined);
    assert.equal(normalized["현재상황"], undefined);
  });

  it("F. repair continuity also omits volatile previous answers", () => {
    const block = buildWidgetExtractRepairUserBlock({
      keys: collectWidgetJsonKeys(PERSISTENT_WIDGET),
      widget: PERSISTENT_WIDGET,
      source: "character",
      charName: "레온",
      personaName: "렌",
      userMessage: "잠시 기다린다",
      assistantProse: "그는 신입의 말에 숨을 고르며 표정을 바꿨다.",
      previousValues: {
        속마음: "이 신입은 조금 수상하네.",
        장소: "옥상",
      },
    });
    assert.match(block, /PREVIOUS CANONICAL WIDGET VALUES/);
    assert.match(block, /옥상/);
    assert.doesNotMatch(block, /이 신입은 조금 수상하네/);
  });

  it("G. looksLikeVolatile includes 현재상황; persistent meters excluded", () => {
    assert.equal(looksLikeVolatileTurnDerivedField(PERSISTENT_WIDGET.fields[3]!), true); // 속마음
    assert.equal(looksLikeVolatileTurnDerivedField(PERSISTENT_WIDGET.fields[4]!), true); // 현재상황
    assert.equal(looksLikeVolatileTurnDerivedField(PERSISTENT_WIDGET.fields[0]!), false); // 장소
    assert.equal(looksLikeVolatileTurnDerivedField(PERSISTENT_WIDGET.fields[2]!), false); // 체력
    assert.equal(looksLikeInnerStateField(PERSISTENT_WIDGET.fields[3]!), true);
  });

  it("H. collectVolatileExactEchoKeys ignores persistent exact matches", () => {
    const previous = {
      장소: "복도",
      속마음: "수상하네",
      현재상황: "관찰 중",
      체력: "90",
    };
    const current = {
      장소: "복도",
      속마음: "수상하네",
      현재상황: "정체가 드러난 직후",
      체력: "90",
    };
    const keys = collectVolatileExactEchoKeys({
      widget: PERSISTENT_WIDGET,
      previous,
      current,
    });
    assert.deepEqual(keys.sort(), ["속마음"].sort());
    assert.ok(!keys.includes("장소"));
    assert.ok(!keys.includes("체력"));
  });

  it("I. measureStatusWidgetPreviousEcho counts volatile exact matches incl. 현재상황", () => {
    const previous = {
      장소: "복도",
      속마음: "수상하네",
      현재상황: "관찰 중",
    };
    const partial = {
      장소: "식당",
      속마음: "수상하네",
      현재상황: "관찰 중",
    };
    const stats = measureStatusWidgetPreviousEcho({
      widget: PERSISTENT_WIDGET,
      previous,
      current: partial,
    });
    assert.equal(stats.exact, 2);
    assert.deepEqual(stats.exactKeys.sort(), ["속마음", "현재상황"].sort());
  });

  it("J. mergeVolatileRepairIntoValues only overwrites listed volatile keys", () => {
    const base = {
      장소: "복도",
      속마음: "이 신입, 정말 S급 가이드라니... 흥미롭군.",
      현재상황: "신입과 마주침",
      체력: "90",
    };
    const repaired = {
      속마음: "위장 신분이라고? 경계가 날카로워진다.",
      장소: "SHOULD_NOT_APPLY",
      체력: "1",
    };
    const merged = mergeVolatileRepairIntoValues(base, repaired, ["속마음"], PERSISTENT_WIDGET);
    assert.equal(merged["속마음"], "위장 신분이라고? 경계가 날카로워진다.");
    assert.equal(merged["장소"], "복도");
    assert.equal(merged["체력"], "90");
    assert.equal(merged["현재상황"], "신입과 마주침");
  });

  it("K. Like fixture — exact 속마음 echo triggers targeted repair once; persistent kept", async () => {
    const STALE =
      "이 신입, 정말 S급 가이드라니... 흥미롭군.";
    const FRESH =
      "위장이라고? 흥미는 남지만 경계가 먼저다.";
    const kinds: string[] = [];
    let extractCalls = 0;
    const caller: StatusWidgetExtractCaller = async (_s, history, opts) => {
      kinds.push(opts.requestKind);
      if (opts.requestKind === "background-status-widget-extract") {
        extractCalls += 1;
        return {
          text: jsonForWidget(PERSISTENT_WIDGET, {
            장소: "에이지스 복도",
            시각: "14:30",
            체력: "88",
            속마음: STALE,
            현재상황: "신입의 정체가 드러나는 순간",
          }),
          usage: usage(1),
        };
      }
      if (opts.requestKind === "background-status-widget-extract-volatile-echo-fix") {
        const userBlock = history[0]?.content ?? "";
        assert.match(userBlock, /STALE PREVIOUS VALUE/);
        assert.match(userBlock, new RegExp(STALE.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
        assert.match(userBlock, /위장/);
        return {
          text: JSON.stringify({
            속마음: FRESH,
            extracted_facts: [],
          }),
          usage: usage(2),
        };
      }
      throw new Error(`unexpected kind ${opts.requestKind}`);
    };

    const result = await extractStatusWidgetValuesForTurn({
      charName: "라이크",
      personaName: "렌",
      userMessage: '*목소리를 낮춘다.* "사실 나는 가이드가 아니야. 위장 신분이야."',
      assistantProse:
        '라이크의 눈빛이 한순간 굳었다.\n\n"…위장."\n\n그는 한 발 물러서며 신입의 표정을 다시 읽었다. 손끝의 긴장만으로도 정보가 뒤집힌 게 분명했다.',
      resolved: characterResolved(),
      previousValues: {
        character: {
          장소: "에이지스 복도",
          시각: "14:10",
          체력: "88",
          속마음: STALE,
          현재상황: "신입을 관찰하며 경계하는 중",
        },
      },
      caller,
    });

    assert.equal(extractCalls, 1);
    assert.deepEqual(kinds, [
      "background-status-widget-extract",
      "background-status-widget-extract-volatile-echo-fix",
    ]);
    assert.equal(result.meta.actualCallCount, 2);
    assert.equal(result.meta.usedRepair, true);
    assert.equal(
      result.meta.character?.finalReasonCode,
      "V3_PREVIOUS_ECHO_REPAIR_USED"
    );
    assert.equal(result.values.character?.["속마음"], FRESH);
    assert.notEqual(result.values.character?.["속마음"], STALE);
    // Persistent anchors from initial extract kept (not overwritten by repair).
    assert.equal(result.values.character?.["장소"], "에이지스 복도");
    assert.equal(result.values.character?.["체력"], "88");
    assert.equal(result.values.character?.["시각"], "14:30");
  });

  it("L2. targeted repair itself repeats stale exact → FAILED once, no retry", async () => {
    const STALE = "이 신입, 정말 S급 가이드라니... 흥미롭군.";
    const kinds: string[] = [];
    const caller: StatusWidgetExtractCaller = async (_s, _h, opts) => {
      kinds.push(opts.requestKind);
      if (opts.requestKind === "background-status-widget-extract") {
        return {
          text: jsonForWidget(PERSISTENT_WIDGET, {
            장소: "에이지스 복도",
            시각: "14:30",
            체력: "88",
            속마음: STALE,
            현재상황: "신입의 정체가 드러나는 순간",
          }),
          usage: usage(1),
        };
      }
      if (opts.requestKind === "background-status-widget-extract-volatile-echo-fix") {
        // Repair echoes the same stale string — must not count as fresh success.
        return {
          text: JSON.stringify({
            속마음: STALE,
            extracted_facts: [],
          }),
          usage: usage(2),
        };
      }
      throw new Error(`unexpected kind ${opts.requestKind}`);
    };

    const result = await extractStatusWidgetValuesForTurn({
      charName: "라이크",
      personaName: "렌",
      userMessage: '*목소리를 낮춘다.* "사실 나는 가이드가 아니야. 위장 신분이야."',
      assistantProse:
        '라이크의 눈빛이 한순간 굳었다.\n\n"…위장."\n\n그는 한 발 물러서며 신입의 표정을 다시 읽었다.',
      resolved: characterResolved(),
      previousValues: {
        character: {
          장소: "에이지스 복도",
          시각: "14:10",
          체력: "88",
          속마음: STALE,
          현재상황: "신입을 관찰하며 경계하는 중",
        },
      },
      caller,
    });

    assert.deepEqual(kinds, [
      "background-status-widget-extract",
      "background-status-widget-extract-volatile-echo-fix",
    ]);
    assert.equal(result.meta.actualCallCount, 2);
    assert.equal(
      result.meta.character?.finalReasonCode,
      "V3_PREVIOUS_ECHO_REPAIR_FAILED"
    );
    // Keep initial values (including stale 속마음) — do not loop or invent.
    assert.equal(result.values.character?.["속마음"], STALE);
    assert.equal(result.values.character?.["장소"], "에이지스 복도");
    assert.equal(result.values.character?.["체력"], "88");
    assert.equal(result.values.character?.["시각"], "14:30");
  });

  it("L. no-snapshot-fallback — extract failure does not copy previous widget", async () => {
    const caller: StatusWidgetExtractCaller = async () => ({
      text: "not-json",
      usage: usage(1),
    });
    const previous = {
      character: {
        장소: "복도",
        속마음: "이전값",
      },
    };
    const result = await extractStatusWidgetValuesForTurn({
      charName: "라이크",
      personaName: "렌",
      userMessage: "안녕",
      assistantProse: "그는 대답하지 않았다.",
      resolved: characterResolved(),
      previousValues: previous,
      caller,
      fallbackModelId: null,
    });
    assert.equal(result.values.character, null);
    assert.notEqual(result.values.character?.["속마음"], "이전값");
  });

  it("M. volatile echo repair user block lists only target keys as stale", () => {
    const block = buildVolatileEchoRepairUserBlock({
      keys: ["속마음"],
      widget: PERSISTENT_WIDGET,
      source: "character",
      charName: "라이크",
      personaName: "렌",
      userMessage: "위장이야",
      assistantProse: "그는 경계했다.",
      previousValues: {
        속마음: "이 신입, 정말 S급 가이드라니... 흥미롭군.",
        장소: "복도",
      },
    });
    assert.match(block, /REPAIR TARGETS ONLY/);
    assert.match(block, /STALE PREVIOUS VALUE/);
    assert.match(block, /흥미롭군/);
    assert.doesNotMatch(block, /- 장소:/);
  });

  it("N. dual system still has soft continuity language", () => {
    const dualSys = buildCombinedDualWidgetExtractSystem(
      PERSISTENT_WIDGET,
      PERSISTENT_WIDGET
    );
    assert.match(dualSys, /continuity references, not answer text to copy/i);
  });
});
