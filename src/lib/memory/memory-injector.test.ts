import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { buildMemoryContext } from "./memory-injector";
import { MEMORY_CAPACITY_FIXED } from "./memory-capacity-shared";

describe("buildMemoryContext default header", () => {
  it("uses tier-separated [현재기억] hint", () => {
    const injection = buildMemoryContext({
      memory: {
        pinned_facts: "",
        recent_summary: "[1~6턴]\n밥을 먹었다",
        archive_summary: "",
        membership_tier: "free",
      },
      userMessage: "안녕",
      memoryCapacity: MEMORY_CAPACITY_FIXED,
    });
    assert.match(injection.text, /\[현재기억\]/);
    assert.match(injection.text, /이전 구간의 요약/);
    assert.doesNotMatch(injection.text, /\[과거 사건 요약본\]/);
  });
});

describe("buildMemoryContext pastEventSummaryDedupe", () => {
  it("uses [과거 사건 요약본] header for DeepSeek", () => {
    const injection = buildMemoryContext({
      memory: {
        pinned_facts: "",
        recent_summary: "[1~6턴]\n밥을 먹었다",
        archive_summary: "",
        membership_tier: "free",
      },
      userMessage: "안녕",
      memoryCapacity: MEMORY_CAPACITY_FIXED,
      pastEventSummaryDedupe: true,
    });
    assert.match(injection.text, /\[과거 사건 요약본\]/);
    assert.match(injection.text, /동일한 하나의 사건으로 인지/);
    assert.doesNotMatch(injection.text, /\[현재기억\]/);
  });
});
