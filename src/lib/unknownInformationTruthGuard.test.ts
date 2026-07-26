import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { estimateTokens } from "@/lib/tokenEstimate";
import {
  UNKNOWN_INFORMATION_TRUTH_GUARD_BLOCK,
  UNKNOWN_INFORMATION_TRUTH_GUARD_SECTION_ID,
} from "@/lib/unknownInformationTruthGuard";

describe("UNKNOWN_INFORMATION_TRUTH_GUARD_BLOCK", () => {
  it("includes required truth-priority meanings", () => {
    const block = UNKNOWN_INFORMATION_TRUTH_GUARD_BLOCK;
    assert.match(block, /미확인 정보/);
    assert.match(block, /사실성이 분량과 장면 확장보다 우선/);
    assert.match(
      block,
      /관련 범주나 사물이 존재한다는 사실만으로 구체값을 추론하지 않는다/
    );
    assert.match(block, /장면에 이미 존재하거나 확립된 확인 수단/);
    assert.match(block, /확인 결과도 만들지 않는다/);
    assert.match(block, /근거가 실제로 존재하는 정보는 그대로 답한다/);
    assert.match(block, /무조건 모른다고 하지 않는다/);
  });

  it("excludes canary fixtures and internal implementation terms", () => {
    const block = UNKNOWN_INFORMATION_TRUTH_GUARD_BLOCK;
    assert.doesNotMatch(block, /14:30/);
    assert.doesNotMatch(block, /2실/);
    assert.doesNotMatch(block, /서강우/);
    assert.doesNotMatch(block, /플러드/);
    assert.doesNotMatch(block, /LENGTH owner/i);
    assert.doesNotMatch(block, /Terminal/);
    assert.doesNotMatch(block, /source-bound/i);
    assert.doesNotMatch(block, /continuation/i);
    assert.doesNotMatch(block, /2차 호출/);
    assert.doesNotMatch(block, /system prompt/i);
    assert.doesNotMatch(block, /가이딩 서포트/);
  });

  it("stays within ~400–700 Korean chars and ~100–400 estimated tokens", () => {
    const chars = UNKNOWN_INFORMATION_TRUTH_GUARD_BLOCK.length;
    const tokens = estimateTokens(UNKNOWN_INFORMATION_TRUTH_GUARD_BLOCK);
    assert.ok(chars >= 400, `expected >=400 chars, got ${chars}`);
    assert.ok(chars <= 750, `expected <=750 chars, got ${chars}`);
    assert.ok(tokens >= 100, `expected >=100 tokens, got ${tokens}`);
    assert.ok(tokens <= 400, `expected <=400 tokens, got ${tokens}`);
  });

  it("exports stable absolute-tail section id", () => {
    assert.equal(
      UNKNOWN_INFORMATION_TRUTH_GUARD_SECTION_ID,
      "rule-unknown-information-truth-absolute-tail"
    );
  });
});
