import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { resolveSuggestedRepliesExtractMaxAttempts } from "./job";
import { suggestedRepliesHaveContent } from "./parse";

describe("suggested replies shared initial attempt budget", () => {
  it("shared initial consumed leaves 2 repair attempts (3 total budget)", () => {
    assert.equal(resolveSuggestedRepliesExtractMaxAttempts(true), 2);
    assert.equal(resolveSuggestedRepliesExtractMaxAttempts(false), 3);
    assert.equal(resolveSuggestedRepliesExtractMaxAttempts(undefined), 3);
  });

  it("prefetched valid replies are accepted without a provider call", () => {
    const prefetched = [
      { kind: "escalate" as const, text: "*손을 뻗으며* \"잠깐, 그 말부터 다시 들어보자.\" *눈을 맞추며*" },
      { kind: "soften" as const, text: "*미소 지으며* \"괜찮아, 천천히 말해도 돼.\" *어깨를 풀며*" },
      { kind: "pivot" as const, text: "*시계를 보며* \"일단 밥부터 먹고 얘기할까?\" *문 쪽을 가리키며*" },
    ];
    assert.equal(suggestedRepliesHaveContent(prefetched), true);
    assert.equal(resolveSuggestedRepliesExtractMaxAttempts(true), 2);
  });
});
