import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  getCanonicalProseBody,
  normalizeEditedProseForSave,
  normalizeProseLineEndings,
} from "./canonicalProse";

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
});
