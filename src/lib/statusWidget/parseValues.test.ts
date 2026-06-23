import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  splitProseAndStatusWidgetValues,
  stripIncompleteStatusWidgetTail,
  inferWidgetValuesFromProse,
  captureStatusWidgetValuesFromModelText,
  sanitizeParsedStatusWidgetValues,
  statusWidgetValuesAreCorrupt,
  STATUS_VALUES_BLOCK,
  STATUS_VALUES_END,
  STATUS_VALUES_CHAR_BLOCK,
} from "@/lib/statusWidget/parseValues";
import { statusWidgetValuesHasContent } from "@/lib/statusWidget/displayPolicy";
import { stripAllStatusWindowOutputArtifacts } from "@/lib/statusMeta/stripArtifacts";
import { renderStatusWidgetHtml } from "@/lib/statusWidget/render";
import { DEFAULT_STATUS_WIDGET } from "@/lib/statusWidget/defaultTemplate";

describe("stripIncompleteStatusWidgetTail", () => {
  it("removes incomplete STATUS_VALUES block during stream", () => {
    const partial = `RP 본문입니다.

${STATUS_VALUES_BLOCK}
{"시간":"14:30","장소":"카페"`;
    assert.equal(stripIncompleteStatusWidgetTail(partial), "RP 본문입니다.");
  });

  it("removes partial marker fragment at stream tail", () => {
    assert.equal(stripIncompleteStatusWidgetTail("RP 본문.\n<<<STATUS"), "RP 본문.");
    assert.equal(stripIncompleteStatusWidgetTail("RP 본문.\n<<<STATUS_VALUES>>>"), "RP 본문.");
  });

  it("keeps prose when STATUS_VALUES block is complete", () => {
    const complete = `RP 본문.

${STATUS_VALUES_BLOCK}
{"시간":"14:30"}
${STATUS_VALUES_END}`;
    assert.equal(stripIncompleteStatusWidgetTail(complete), complete);
  });

  it("stripAllStatusWindowOutputArtifacts hides incomplete widget tail", () => {
    const partial = `RP 본문.

${STATUS_VALUES_CHAR_BLOCK}
{"시간":"15:00"`;
    const stripped = stripAllStatusWindowOutputArtifacts(partial);
    assert.equal(stripped, "RP 본문.");
    assert.doesNotMatch(stripped, /STATUS_VALUES/);
  });
});

describe("splitProseAndStatusWidgetValues", () => {
  it("splits prose and single widget values", () => {
    const text = `본문 RP입니다.

${STATUS_VALUES_BLOCK}
{"시간":"14:30","장소":"카페","속마음":"…","현재상황":"…"}
${STATUS_VALUES_END}`;
    const { prose, values } = splitProseAndStatusWidgetValues(text);
    assert.equal(prose, "본문 RP입니다.");
    assert.equal(values.character?.["시간"], "14:30");
  });

  it("falls back to trailing ```json fence when STATUS_VALUES markers missing", () => {
    const text = `본문 RP입니다.

\`\`\`json
{"시간":"21:00","장소":"거실","속마음":"긴장","현재상황":"대화 중"}
\`\`\``;
    const { prose, values } = splitProseAndStatusWidgetValues(text);
    assert.equal(prose, "본문 RP입니다.");
    assert.equal(values.character?.["장소"], "거실");
  });
});

describe("captureStatusWidgetValuesFromModelText", () => {
  it("captures from raw model output before save-path status strip", () => {
    const raw = `RP 본문입니다.

${STATUS_VALUES_CHAR_BLOCK}
{"시간":"15:00","장소":"거리"}
${STATUS_VALUES_END}`;
    const captured = captureStatusWidgetValuesFromModelText(raw);
    assert.equal(captured?.character?.["시간"], "15:00");
    const stripped = stripAllStatusWindowOutputArtifacts(raw);
    assert.doesNotMatch(stripped, /STATUS_VALUES/);
    assert.equal(captureStatusWidgetValuesFromModelText(stripped), null);
  });
});

describe("inferWidgetValuesFromProse", () => {
  it("extracts plain status lines from model prose tail", () => {
    const text = `RP 본문...

NPC의 속마음 한 줄 : 렌 님 손이 내 손안에 있다.
현재 상황을 짧게 요약 : 번화가에서 손을 잡고 있다.`;
    const values = inferWidgetValuesFromProse(text, DEFAULT_STATUS_WIDGET);
    assert.match(values?.["속마음"] ?? "", /손안/);
    assert.match(values?.["현재상황"] ?? "", /번화가/);
  });
});

describe("renderStatusWidgetHtml", () => {
  it("fills template placeholders", () => {
    const html = renderStatusWidgetHtml(DEFAULT_STATUS_WIDGET, {
      시간: "09:00",
      장소: "집",
      속마음: "졸리다",
      현재상황: "아침",
    });
    assert.match(html, /09:00/);
    assert.match(html, /졸리다/);
    assert.doesNotMatch(html, /\{\{/);
  });

  it("ignores model-copied ellipsis placeholders", () => {
    const html = renderStatusWidgetHtml(DEFAULT_STATUS_WIDGET, {
      시간: "09:00",
      장소: "집",
      속마음: "…",
      현재상황: "...",
    });
    assert.match(html, /09:00/);
    assert.doesNotMatch(html, /…/);
  });
});

describe("corrupt status widget values", () => {
  it("detects JSON fragment pollution in field values", () => {
    const corrupt = {
      character: {
        시간: '"오후 2시","장소":"대기실","속마음":"질투","현재상황":"키스"}"',
        장소: '"대기실","속마음":"질투"}"',
      },
    };
    assert.equal(statusWidgetValuesAreCorrupt(corrupt), true);
    assert.equal(statusWidgetValuesHasContent(corrupt), false);
    assert.deepEqual(sanitizeParsedStatusWidgetValues(corrupt), {});
  });
});
