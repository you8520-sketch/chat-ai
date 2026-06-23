import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  STATUS_VALUES_CHAR_BLOCK,
  STATUS_VALUES_END,
} from "./parseValues";
import {
  captureDeepSeekStatusWidgetValuesFromModelText,
  extractBalancedJsonObject,
  extractStatusWidgetJsonAfterMarker,
  splitProseAndStatusWidgetValuesDeepSeek,
} from "./deepseekCapture";

describe("deepseekCapture", () => {
  it("extractBalancedJsonObject handles nested strings", () => {
    const hit = extractBalancedJsonObject('prefix {"a":"{\\"x\\":1}"} suffix');
    assert.ok(hit);
    assert.equal(JSON.parse(hit!.json).a, '{"x":1}');
  });

  it("parses multiline marker + JSON without END_STATUS", () => {
    const raw = `RP 본문.

${STATUS_VALUES_CHAR_BLOCK}
{"시간":"오후 11시","장소":"침실","속마음":"불안","현재상황":"대화 중"}`;
    const captured = captureDeepSeekStatusWidgetValuesFromModelText(raw);
    assert.equal(captured?.character?.["시간"], "오후 11시");
    assert.equal(captured?.character?.["장소"], "침실");
  });

  it("parses inline marker + JSON on same line", () => {
    const raw =
      '본문 끝. <<<STATUS_VALUES char>>> {"시간":"14:00","장소":"거리","속마음":"설렘","현재상황":"산책"}';
    const hit = extractStatusWidgetJsonAfterMarker(raw, STATUS_VALUES_CHAR_BLOCK);
    assert.equal(hit?.parsed?.["시간"], "14:00");
    const split = splitProseAndStatusWidgetValuesDeepSeek(raw);
    assert.equal(split.prose, "본문 끝.");
    assert.equal(split.values.character?.["장소"], "거리");
  });

  it("still accepts standard END-wrapped blocks", () => {
    const raw = `RP.

${STATUS_VALUES_CHAR_BLOCK}
{"시간":"09:00","장소":"집","속마음":"졸림","현재상황":"아침"}
${STATUS_VALUES_END}`;
    const captured = captureDeepSeekStatusWidgetValuesFromModelText(raw);
    assert.equal(captured?.character?.["시간"], "09:00");
  });

  it("parses loose STATUS_VALUES marker with character name (Gemini-style)", () => {
    const raw = `RP 본문.

<<<STATUS_VALUES 백하율>>>
{"시간":"오후 2시 45분","장소":"대기실","속마음":"질투","현재상황":"키스 강요"}`;
    const split = splitProseAndStatusWidgetValuesDeepSeek(raw);
    assert.equal(split.prose, "RP 본문.");
    assert.equal(split.values.character?.["시간"], "오후 2시 45분");
    assert.equal(split.values.character?.["장소"], "대기실");
  });
});
