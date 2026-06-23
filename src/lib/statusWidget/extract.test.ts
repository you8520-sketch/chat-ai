import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { DEFAULT_STATUS_WIDGET } from "./defaultTemplate";
import {
  buildStatusWidgetExtractSystemForTest,
  normalizeStatusWidgetExtractionForTest,
} from "./extract";
import { collectWidgetJsonKeys } from "./prompt";

describe("statusWidget extract", () => {
  it("collectWidgetJsonKeys includes field keys and template placeholders", () => {
    const keys = collectWidgetJsonKeys(DEFAULT_STATUS_WIDGET);
    assert.ok(keys.includes("시간"));
    assert.ok(keys.includes("장소"));
    assert.ok(keys.includes("속마음"));
    assert.ok(keys.includes("현재상황"));
  });

  it("normalizeWidgetExtraction maps id/label keys and rejects placeholders", () => {
    const normalized = normalizeStatusWidgetExtractionForTest(
      {
        시간: "14:30",
        장소: "<scene value>",
        속마음: "…",
        현재상황: "대화 중",
      },
      DEFAULT_STATUS_WIDGET
    );
    assert.equal(normalized["시간"], "14:30");
    assert.equal(normalized["현재상황"], "대화 중");
    assert.equal(normalized["장소"], undefined);
    assert.equal(normalized["속마음"], undefined);
  });

  it("normalizeWidgetExtraction falls back to previous turn values", () => {
    const normalized = normalizeStatusWidgetExtractionForTest(
      { 시간: "15:00" },
      DEFAULT_STATUS_WIDGET,
      { 장소: "카페", 속마음: "긴장", 현재상황: "이전 상황" }
    );
    assert.equal(normalized["시간"], "15:00");
    assert.equal(normalized["장소"], "카페");
    assert.equal(normalized["속마음"], "긴장");
    assert.equal(normalized["현재상황"], "이전 상황");
  });

  it("buildWidgetExtractSystem lists required JSON keys", () => {
    const system = buildStatusWidgetExtractSystemForTest(DEFAULT_STATUS_WIDGET);
    assert.match(system, /"시간"/);
    assert.match(system, /Never copy placeholders/);
  });
});
