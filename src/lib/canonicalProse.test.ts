import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  firstDifferingIndex,
  getCanonicalProseBody,
  logRegeneratedEditFormattingMismatchDev,
  normalizeEditedProseForSave,
  normalizeProseLineEndings,
  resolveAssistantCanonicalProseSource,
  resolveAssistantEditInitialValue,
} from "./canonicalProse";
import { resolveActiveVariantContent } from "./messageAlternates";

const REGENERATED_SAMPLE_PROSE =
  "문장 하나가 이어진다. 같은 문단의 다음 문장이다.\n\n" +
  "새 문단이 시작된다. 아직 같은 문단이다.\n\n" +
  "\"대사 한 줄.\"\n\n" +
  "그 뒤의 지문이 이어진다.";

const REGENERATED_FRAGMENTED_DISPLAY =
  "문장 하나가 이어진다.\n\n" +
  "같은 문단의 다음 문장이다.\n\n" +
  "새 문단이 시작된다.\n\n" +
  "아직 같은 문단이다.\n\n" +
  "\"대사 한 줄.\"\n\n" +
  "그 뒤의 지문이 이어진다.";

const SAMPLE_CANONICAL_PROSE =
  "문장 하나가 이어진다. 같은 문단의 다음 문장이다.\n\n" +
  "새 문단이 시작된다. 아직 같은 문단이다.\n\n" +
  "\"대사를 말했다.\"\n\n" +
  "그 뒤의 지문이 이어진다.";

describe("canonical prose body", () => {
  it("preserves exact prose paragraph newlines", () => {
    assert.equal(getCanonicalProseBody(SAMPLE_CANONICAL_PROSE), SAMPLE_CANONICAL_PROSE);
  });

  it("does not convert every sentence into its own paragraph", () => {
    const out = getCanonicalProseBody(
      "문장 하나. 이어지는 문장 둘. 같은 행동을 설명하는 문장 셋."
    );

    assert.equal(out, "문장 하나. 이어지는 문장 둘. 같은 행동을 설명하는 문장 셋.");
    assert.equal(out.includes("문장 하나.\n\n이어지는 문장 둘."), false);
  });

  it("removes status widget value blocks without reflowing prose", () => {
    const input =
      "첫 문단이다. 이어지는 문장이다.\n\n" +
      "둘째 문단이다.\n\n" +
      "<<<STATUS_VALUES>>>\n" +
      "{\"time\":\"밤\",\"place\":\"복도\"}\n" +
      "<<<END_STATUS>>>";

    assert.equal(
      getCanonicalProseBody(input),
      "첫 문단이다. 이어지는 문장이다.\n\n둘째 문단이다."
    );
  });

  it("preserves dialogue line breaks", () => {
    assert.equal(getCanonicalProseBody(SAMPLE_CANONICAL_PROSE), SAMPLE_CANONICAL_PROSE);
  });

  it("save normalization changes CRLF only", () => {
    assert.equal(
      normalizeEditedProseForSave("  앞 공백\r\n\r\n뒤 공백  "),
      "  앞 공백\n\n뒤 공백  "
    );
  });

  it("line ending normalization keeps LF text unchanged", () => {
    assert.equal(normalizeProseLineEndings(SAMPLE_CANONICAL_PROSE), SAMPLE_CANONICAL_PROSE);
  });

  it("uses regenerated active variant as the edit textarea source, not streamed display content", () => {
    const message = {
      content: REGENERATED_FRAGMENTED_DISPLAY,
      variants: [
        { content: "이전 응답.", model: "m1", usage: null, created_at: "" },
        { content: REGENERATED_SAMPLE_PROSE, model: "m2", usage: null, created_at: "" },
      ],
      activeVariant: 1,
    };

    const completedDisplaySource = resolveActiveVariantContent(message);
    const editInitialValue = resolveAssistantEditInitialValue(message);
    const savedAgain = normalizeEditedProseForSave(editInitialValue);

    assert.equal(resolveAssistantCanonicalProseSource(message), REGENERATED_SAMPLE_PROSE);
    assert.equal(completedDisplaySource, REGENERATED_SAMPLE_PROSE);
    assert.equal(editInitialValue, REGENERATED_SAMPLE_PROSE);
    assert.equal(savedAgain, REGENERATED_SAMPLE_PROSE);
    assert.equal(editInitialValue.includes("문장 하나가 이어진다.\n\n같은 문단"), false);
  });

  it("removes regenerated status widget blocks without changing prose paragraph breaks", () => {
    const withWidget =
      REGENERATED_SAMPLE_PROSE +
      "\n\n<<<STATUS_VALUES>>>\n" +
      "{\"values\":{\"위치\":\"복도\"},\"extracted_facts\":[]}\n" +
      "<<<END_STATUS>>>";
    const message = {
      content: REGENERATED_FRAGMENTED_DISPLAY,
      variants: [
        { content: "이전 응답.", model: "m1", usage: null, created_at: "" },
        { content: withWidget, model: "m2", usage: null, created_at: "" },
      ],
      activeVariant: 1,
    };

    assert.equal(resolveAssistantEditInitialValue(message), REGENERATED_SAMPLE_PROSE);
  });

  it("reports the first differing index without logging private regenerated content", () => {
    assert.equal(firstDifferingIndex("abc", "abX"), 2);

    const originalWarn = console.warn;
    const calls: unknown[][] = [];
    console.warn = (...args: unknown[]) => {
      calls.push(args);
    };
    try {
      logRegeneratedEditFormattingMismatchDev({
        messageId: 858,
        storedCanonicalProse: REGENERATED_SAMPLE_PROSE,
        editModalValue: REGENERATED_FRAGMENTED_DISPLAY,
        transform: "test",
        fallbackSource: "content",
      });
    } finally {
      console.warn = originalWarn;
    }

    assert.equal(calls.length, 1);
    assert.equal(calls[0]?.[0], "[RegeneratedEditFormattingMismatch]");
    assert.equal(
      JSON.stringify(calls[0]?.[1]).includes(REGENERATED_SAMPLE_PROSE),
      false
    );
  });
});
