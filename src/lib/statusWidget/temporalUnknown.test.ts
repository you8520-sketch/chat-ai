import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  classifyStatusWidgetTemporalField,
  counterAllowsUnsetPlaceholder,
  counterRequiresConcreteValue,
  isUnknownLikeStatusValue,
  rejectsUnknownLikeTemporalValue,
  sanitizeAndRepairTemporalValues,
  stripUnknownLikeFromValues,
  stripUnknownLikeTemporalFromParsed,
} from "./temporalUnknown";
import {
  formatPreviousTurnWidgetValues,
  normalizeWidgetExtraction,
} from "./extractNormalize";
import type { StatusWidget } from "./types";

const widget: StatusWidget = {
  version: 1,
  name: "t",
  placement: "bottom",
  htmlTemplate: "{{장소}}{{현재시각}}{{날짜}}{{속마음}}{{계절}}",
  fields: [
    { id: "장소", label: "장소", instruction: "현재 장소" },
    { id: "현재시각", label: "현재시각", instruction: "HH:MM", initialValue: "09:00" },
    { id: "날짜", label: "날짜", instruction: "장면 날짜", initialValue: "3월 18일" },
    { id: "속마음", label: "속마음", instruction: "NPC의 속마음" },
    { id: "계절", label: "계절", instruction: "계절" },
  ],
};

describe("isUnknownLikeStatusValue", () => {
  it("matches Korean and English unknown placeholders after normalize", () => {
    assert.equal(isUnknownLikeStatusValue("알 수 없음"), true);
    assert.equal(isUnknownLikeStatusValue("  미상.  "), true);
    assert.equal(isUnknownLikeStatusValue("UNKNOWN"), true);
    assert.equal(isUnknownLikeStatusValue("n/a"), true);
    assert.equal(isUnknownLikeStatusValue("미정"), true);
    assert.equal(isUnknownLikeStatusValue("18:30"), false);
    assert.equal(isUnknownLikeStatusValue("사령실"), false);
  });
});

describe("classifyStatusWidgetTemporalField", () => {
  it("classifies date/clock/season and not free-text", () => {
    assert.equal(classifyStatusWidgetTemporalField(widget.fields[1]!), "clock");
    assert.equal(classifyStatusWidgetTemporalField(widget.fields[2]!), "date");
    assert.equal(classifyStatusWidgetTemporalField(widget.fields[4]!), "season");
    assert.equal(classifyStatusWidgetTemporalField(widget.fields[0]!), null);
    assert.equal(classifyStatusWidgetTemporalField(widget.fields[3]!), null);
  });
});

describe("counter unknown-like policy", () => {
  it("2. D-DAY instruction allows 미정 → keep as normal value", () => {
    const field = {
      id: "d_day",
      label: "D-DAY",
      instruction: "날짜가 정해지기 전에는 미정",
    };
    assert.equal(classifyStatusWidgetTemporalField(field), "counter");
    assert.equal(counterAllowsUnsetPlaceholder(field), true);
    assert.equal(counterRequiresConcreteValue(field), false);
    assert.equal(rejectsUnknownLikeTemporalValue(field), false);

    const { values, skippedKeys } = stripUnknownLikeFromValues(
      { "D-DAY": "미정", 장소: "사령실" },
      {
        version: 1,
        name: "c",
        placement: "bottom",
        htmlTemplate: "{{D-DAY}}{{장소}}",
        fields: [field, { id: "장소", label: "장소", instruction: "장소" }],
      }
    );
    assert.equal(values?.["D-DAY"], "미정");
    assert.equal(skippedKeys.includes("D-DAY"), false);
  });

  it("3. D-DAY concrete countdown instruction rejects 알 수 없음", () => {
    const field = {
      id: "d_day",
      label: "D-DAY",
      instruction: "D-30부터 하루마다 1 감소",
      initialValue: "D-30",
    };
    assert.equal(counterRequiresConcreteValue(field), true);
    assert.equal(rejectsUnknownLikeTemporalValue(field), true);

    const { values, skippedKeys } = stripUnknownLikeFromValues(
      { "D-DAY": "알 수 없음" },
      {
        version: 1,
        name: "c",
        placement: "bottom",
        htmlTemplate: "{{D-DAY}}",
        fields: [field],
      }
    );
    assert.equal(values?.["D-DAY"], undefined);
    assert.ok(skippedKeys.includes("D-DAY"));
  });
});

describe("stripUnknownLike temporal anchors", () => {
  it("previous 현재시각 = 알 수 없음 → excluded; place kept", () => {
    const { values, skippedKeys } = stripUnknownLikeFromValues(
      { 장소: "사령실", 현재시각: "알 수 없음", 속마음: "불안하다" },
      widget
    );
    assert.equal(values?.["장소"], "사령실");
    assert.equal(values?.["속마음"], "불안하다");
    assert.equal(values?.["현재시각"], undefined);
    assert.ok(skippedKeys.includes("현재시각"));
  });

  it("previous 날짜 = 미상 → excluded", () => {
    const { values } = stripUnknownLikeFromValues({ 날짜: "미상", 장소: "복도" }, widget);
    assert.equal(values?.["날짜"], undefined);
    assert.equal(values?.["장소"], "복도");
  });

  it("previous 현재시각 = 18:30 → kept", () => {
    const { values, skippedKeys } = stripUnknownLikeFromValues(
      { 현재시각: "18:30", 장소: "복도" },
      widget
    );
    assert.equal(values?.["현재시각"], "18:30");
    assert.equal(skippedKeys.length, 0);
  });
});

describe("normalize rejects unknown temporal raw", () => {
  it("4. 현재시각 raw 알 수 없음 + initialValue 08:30 → repair", () => {
    const w: StatusWidget = {
      ...widget,
      fields: widget.fields.map((f) =>
        f.label === "현재시각" ? { ...f, initialValue: "08:30" } : f
      ),
    };
    const normalized = normalizeWidgetExtraction(
      { 장소: "사령실", 현재시각: "알 수 없음", 속마음: "침착하다", 날짜: "3월 18일", 계절: "봄" },
      w
    );
    assert.equal(normalized["현재시각"], "08:30");
    assert.equal(normalized["장소"], "사령실");
  });

  it("5. 현재시각 raw 알 수 없음 + no initialValue → drop; other fields kept", () => {
    const w: StatusWidget = {
      ...widget,
      fields: widget.fields.map((f) =>
        f.label === "현재시각" ? { ...f, initialValue: undefined } : f
      ),
    };
    const normalized = normalizeWidgetExtraction(
      {
        장소: "사령실",
        현재시각: "알 수 없음",
        속마음: "침착하다",
        날짜: "3월 18일",
        계절: "봄",
      },
      w
    );
    assert.equal(normalized["현재시각"], undefined);
    assert.equal(normalized["장소"], "사령실");
    assert.equal(normalized["속마음"], "침착하다");
    assert.equal(normalized["날짜"], "3월 18일");
  });

  it("V3 raw 계절 = unknown → dropped when no initialValue", () => {
    const normalized = normalizeWidgetExtraction(
      { 장소: "사령실", 현재시각: "18:30", 날짜: "3월 18일", 계절: "unknown", 속마음: "침착하다" },
      widget
    );
    assert.equal(normalized["계절"], undefined);
    assert.equal(normalized["현재시각"], "18:30");
  });

  it("sanitizeAndRepairTemporalValues repairs unknown from initialValue only", () => {
    const repaired = sanitizeAndRepairTemporalValues(
      { 날짜: "알 수 없음", 현재시각: "미상" },
      widget
    );
    assert.equal(repaired.values?.["날짜"], "3월 18일");
    assert.equal(repaired.values?.["현재시각"], "09:00");
    assert.ok(repaired.codes.includes("TEMPORAL_REPAIR_USED"));
  });
});

describe("parsed strip keeps non-temporal", () => {
  it("place kept + time unknown removed", () => {
    const stripped = stripUnknownLikeTemporalFromParsed(
      {
        character: { 장소: "사령실", 현재시각: "알 수 없음", 속마음: "불안하다" },
        user: null,
      },
      { characterWidget: widget }
    );
    assert.equal(stripped.values?.character?.["장소"], "사령실");
    assert.equal(stripped.values?.character?.["현재시각"], undefined);
    assert.equal(stripped.values?.character?.["속마음"], "불안하다");
  });
});

describe("formatPreviousTurnWidgetValues scopes unknown filter to temporal fields", () => {
  const previousWidget: StatusWidget = {
    version: 1,
    name: "prev",
    placement: "bottom",
    htmlTemplate:
      "{{관계 상태}}{{범인}}{{현재시각}}{{날씨}}{{D-DAY}}{{장소}}{{자유노트}}",
    fields: [
      {
        id: "rel",
        label: "관계 상태",
        instruction: "관계가 확정되기 전에는 미정",
      },
      {
        id: "culprit",
        label: "범인",
        instruction: "현재 밝혀진 범인",
      },
      {
        id: "clock",
        label: "현재시각",
        instruction: "HH:MM",
      },
      {
        id: "weather",
        label: "날씨",
        instruction: "현재 날씨",
      },
      {
        id: "dday",
        label: "D-DAY",
        instruction: "날짜가 정해지기 전에는 미정",
      },
      {
        id: "dday_concrete",
        label: "작전 D-DAY",
        instruction: "D-30부터 매일 1 감소",
        initialValue: "D-30",
      },
      { id: "place", label: "장소", instruction: "현재 장소" },
      {
        id: "note",
        label: "자유노트",
        instruction: "자유 서술",
      },
    ],
  };

  it("1. keeps non-temporal 관계 상태=미정 in previous block", () => {
    const block = formatPreviousTurnWidgetValues(
      { "관계 상태": "미정", 장소: "사령실" },
      "character",
      previousWidget
    );
    assert.match(block, /- 관계 상태: 미정/);
    assert.match(block, /- 장소: 사령실/);
  });

  it("2. keeps non-temporal 범인=불명 in previous block", () => {
    const block = formatPreviousTurnWidgetValues(
      { 범인: "불명", 장소: "복도" },
      "character",
      previousWidget
    );
    assert.match(block, /- 범인: 불명/);
  });

  it("3. omits temporal 현재시각=알 수 없음 from previous block", () => {
    const block = formatPreviousTurnWidgetValues(
      { 현재시각: "알 수 없음", 장소: "마당" },
      "character",
      previousWidget
    );
    assert.doesNotMatch(block, /현재시각/);
    assert.match(block, /- 장소: 마당/);
  });

  it("4. omits temporal 날씨=미상 from previous block", () => {
    const block = formatPreviousTurnWidgetValues(
      { 날씨: "미상", 장소: "성벽" },
      "character",
      previousWidget
    );
    assert.doesNotMatch(block, /날씨/);
    assert.match(block, /- 장소: 성벽/);
  });

  it("5. keeps counter 미정 when instruction allows unset", () => {
    const block = formatPreviousTurnWidgetValues(
      { "D-DAY": "미정", 장소: "사령실" },
      "character",
      previousWidget
    );
    assert.match(block, /- D-DAY: 미정/);
  });

  it("6. omits counter unknown when concrete countdown is required", () => {
    const block = formatPreviousTurnWidgetValues(
      { "작전 D-DAY": "알 수 없음", 장소: "사령실" },
      "character",
      previousWidget
    );
    assert.doesNotMatch(block, /작전 D-DAY/);
    assert.match(block, /- 장소: 사령실/);
  });

  it("keeps free-text 알 수 없음 on non-temporal fields", () => {
    const block = formatPreviousTurnWidgetValues(
      { 자유노트: "알 수 없음", 장소: "복도" },
      "character",
      previousWidget
    );
    assert.match(block, /- 자유노트: 알 수 없음/);
  });
});
