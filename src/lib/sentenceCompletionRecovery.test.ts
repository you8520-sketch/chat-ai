import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  isEligibleForSentenceCompletionRecovery,
  isRecoverablePredicateTruncation,
  recoverSentenceCompletion,
  recoverSentenceCompletionInFullResponse,
} from "@/lib/sentenceCompletionRecovery";

describe("recoverSentenceCompletion", () => {
  it("completes truncated past-tense predicate with 다.", () => {
    for (const input of ["백하율이 손끝으로 렌의 목덜미를 훑었", "그는 잠시 멈췄", "그녀를 바라보았"]) {
      const { text, recovered, actions } = recoverSentenceCompletion(input);
      assert.equal(recovered, true);
      assert.match(text, /다\.$/);
      assert.ok(actions.includes("predicate:다."));
    }
  });

  it("does not add new narrative beyond sentence ending", () => {
    const input = "백하율이 고개를 훑었";
    const { text } = recoverSentenceCompletion(input);
    assert.equal(text, "백하율이 고개를 훑었다.");
    assert.equal(text.includes("그리고"), false);
  });

  it("leaves complete sentences unchanged", () => {
    const input = "백하율이 고개를 훑었다.";
    const { text, recovered } = recoverSentenceCompletion(input);
    assert.equal(recovered, false);
    assert.equal(text, input);
  });

  it("closes unclosed double quote without inventing words", () => {
    const input = '"아니면 제가';
    const { text, recovered } = recoverSentenceCompletion(input);
    assert.equal(recovered, true);
    assert.equal(text, '"아니면 제가"');
  });

  it("skips unsafe particle truncation", () => {
    const input = "번화가 어디";
    const { recovered } = recoverSentenceCompletion(input);
    assert.equal(recovered, false);
  });

  it("skips mid-word verb stem without past ending", () => {
    const input = "그의 시선이 렌을 바라보";
    const { recovered } = recoverSentenceCompletion(input);
    assert.equal(recovered, false);
  });

  it("preserves trailing whitespace", () => {
    const input = "그는 멈췄  \n";
    const { text, recovered } = recoverSentenceCompletion(input);
    assert.equal(recovered, true);
    assert.equal(text, "그는 멈췄다.  \n");
  });

  it("strips broken HTML tail instead of sentence recovery", () => {
    const prose = `RP 본문이 이어진다. ${"창밖 바람이 불었다.".repeat(8)}`;
    const input = `${prose}\n\n\`\`\`html\n\`\`\`html\n<div style`;
    const { text, recovered, actions } = recoverSentenceCompletion(input);
    assert.equal(recovered, true);
    assert.ok(actions.includes("strip:broken-html-fragment"));
    assert.equal(text, prose);
    assert.doesNotMatch(text, /```html/i);
  });

  it("does not empty html-only garbage on full-response recovery", () => {
    const input = "```html\n<div style=color:red";
    const { text, recovered } = recoverSentenceCompletionInFullResponse(input);
    assert.equal(recovered, false);
    assert.equal(text, input);
  });
});

describe("isRecoverablePredicateTruncation", () => {
  it("detects clear predicate tails", () => {
    assert.equal(isRecoverablePredicateTruncation("손끝을 훑었"), true);
    assert.equal(isRecoverablePredicateTruncation("잠시 멈췄"), true);
  });

  it("rejects complete or unsafe tails", () => {
    assert.equal(isRecoverablePredicateTruncation("훑었다."), false);
    assert.equal(isRecoverablePredicateTruncation("렌을"), false);
  });
});

describe("isEligibleForSentenceCompletionRecovery", () => {
  it("allows predicate and open-quote cases", () => {
    assert.equal(isEligibleForSentenceCompletionRecovery("목덜미를 훑었"), true);
    assert.equal(isEligibleForSentenceCompletionRecovery('"안녕'), true);
  });

  it("rejects complete prose", () => {
    assert.equal(isEligibleForSentenceCompletionRecovery("훑었다."), false);
  });
});
