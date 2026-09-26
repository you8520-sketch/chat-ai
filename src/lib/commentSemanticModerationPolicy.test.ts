import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  COMMENT_SEMANTIC_JEV_CRITERIA,
  COMMENT_SEMANTIC_JEV_QUESTION_ID,
  COMMENT_SEMANTIC_MODERATION_SYSTEM,
  buildCommentSemanticJevQuestions,
  buildCommentSemanticJevState,
  buildCommentSemanticModerationUserPrompt,
  parseCommentSemanticModerationVerdict,
} from "@/lib/commentSemanticModerationPolicy";
import { COMMENT_MODERATION_BENCHMARK_CORPUS } from "@/lib/commentModerationBenchmarkCorpus";
import { readFileSync } from "node:fs";
import { join } from "node:path";

describe("comment semantic moderation policy owner", () => {
  it("parses ALLOW/BLOCK with optional Korean reason (Gemini parser preserved)", () => {
    assert.deepEqual(parseCommentSemanticModerationVerdict("ALLOW\n문제 없음"), {
      verdict: "ALLOW",
      reason: "문제 없음",
    });
    assert.deepEqual(parseCommentSemanticModerationVerdict("BLOCK 공격적"), {
      verdict: "BLOCK",
      reason: "",
    });
    assert.equal(parseCommentSemanticModerationVerdict("MAYBE"), null);
  });

  it("user prompt includes only trigger, matched terms, normalized, and comment", () => {
    const prompt = buildCommentSemanticModerationUserPrompt({
      content: "테스트 댓글",
      normalized: "테스트댓글",
      matchedWords: ["파쿠리"],
      trigger: "banned_word",
    });
    assert.match(prompt, /\[TRIGGER: banned_word\]/);
    assert.match(prompt, /파쿠리/);
    assert.match(prompt, /테스트 댓글/);
    assert.doesNotMatch(prompt, /userId|authorId|points|session|OPENROUTER/i);
  });

  it("JEV questions expose exactly ALLOW/BLOCK criteria from the same policy", () => {
    const questions = buildCommentSemanticJevQuestions();
    const q = questions[COMMENT_SEMANTIC_JEV_QUESTION_ID];
    assert.equal(q?.type, "choice");
    assert.deepEqual(Object.keys(q!.criteria).sort(), ["ALLOW", "BLOCK"]);
    assert.equal(q!.criteria.ALLOW, COMMENT_SEMANTIC_JEV_CRITERIA.ALLOW);
    assert.equal(q!.criteria.BLOCK, COMMENT_SEMANTIC_JEV_CRITERIA.BLOCK);
  });

  it("JEV state contains only approved bounded fields", () => {
    const state = buildCommentSemanticJevState({
      content: "hello",
      normalized: "hello",
      matchedWords: ["x"],
      trigger: "banned_word",
    });
    assert.deepEqual(Object.keys(state).sort(), ["content", "matchedWords", "normalized", "trigger"]);
  });

  it("production commentModeration.ts consumes the shared system prompt (no forked copy)", () => {
    const src = readFileSync(join(process.cwd(), "src/lib/commentModeration.ts"), "utf8");
    assert.match(src, /COMMENT_SEMANTIC_MODERATION_SYSTEM/);
    assert.doesNotMatch(src, /You are a Korean community comment moderator/);
    assert.ok(COMMENT_SEMANTIC_MODERATION_SYSTEM.includes("ALLOW or BLOCK"));
  });

  it("corpus fixtures declare expected labels without id heuristics", () => {
    assert.ok(COMMENT_MODERATION_BENCHMARK_CORPUS.length >= 14);
    for (const fixture of COMMENT_MODERATION_BENCHMARK_CORPUS) {
      assert.ok(fixture.expected === "ALLOW" || fixture.expected === "BLOCK");
      assert.ok(fixture.rationale.length > 0);
      assert.ok(fixture.category.length > 0);
      // Id must not encode the label as the sole source of truth — expected is explicit.
      assert.notEqual(fixture.id.toLowerCase(), fixture.expected.toLowerCase());
    }
    const allows = COMMENT_MODERATION_BENCHMARK_CORPUS.filter((f) => f.expected === "ALLOW");
    const blocks = COMMENT_MODERATION_BENCHMARK_CORPUS.filter((f) => f.expected === "BLOCK");
    assert.ok(allows.length >= 5);
    assert.ok(blocks.length >= 5);
  });
});
