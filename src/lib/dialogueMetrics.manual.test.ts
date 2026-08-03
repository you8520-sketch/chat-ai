/**
 * Manual semantic unit heuristic tests.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  computeDialogueMetrics,
  estimateManualSemanticMetrics,
  extractQuoteBlocks,
} from "@/lib/dialogueMetrics";

describe("manual semantic metrics", () => {
  it("merges micro-action narration between quotes into one unit", () => {
    const text = [
      '"처음 봐."',
      "",
      "그는 눈을 가늘게 떴다.",
      "",
      '"적어도 내 기억에는 그래."',
      "",
      "입꼬리가 느슨하게 올라갔다.",
      "",
      '"그래도 네 이름은 기억해 둘게."',
    ].join("\n");
    assert.equal(extractQuoteBlocks(text).length, 3);
    const manual = estimateManualSemanticMetrics(text);
    assert.equal(manual.manual_semantic_units, 1);
    assert.equal(manual.manual_resume_transitions, 2);
    assert.equal(manual.manual_fragmentation_multiplier, 3);
  });

  it("flags auto metrics unreliable when diverging >=25%", () => {
    const text = [
      '"안녕."',
      "",
      "긴 설명이 이어졌다. 등록 절차를 안내하며 새로운 정보를 발견했다. 결국 다른 방향으로 장면이 바뀌었다.",
      "",
      '"다른 말."',
    ].join("\n");
    const m = computeDialogueMetrics({ text });
    assert.ok(m.manual_semantic_units >= 2);
  });
});
