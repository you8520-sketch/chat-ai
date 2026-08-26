import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  ARCHIVE_CAPACITY_FIXED,
  MEMORY_CAPACITY_FIXED,
  resolveMemoryBudgetFromCapacity,
} from "./memory-capacity-shared";
import { shouldIncludeArchiveAlways } from "@/lib/contextTrack";
import { buildMemoryContext } from "./memory-injector";

describe("resolveMemoryBudgetFromCapacity", () => {
  it("keeps 10000-char lorebook and enables archive budget", () => {
    const budget = resolveMemoryBudgetFromCapacity();
    assert.equal(budget.lorebook, MEMORY_CAPACITY_FIXED);
    assert.equal(budget.recent, MEMORY_CAPACITY_FIXED);
    assert.equal(budget.archive, ARCHIVE_CAPACITY_FIXED);
    assert.equal(budget.total, MEMORY_CAPACITY_FIXED + ARCHIVE_CAPACITY_FIXED);
  });
});

describe("archive prompt injection", () => {
  it("includes archive when non-empty (all providers)", () => {
    assert.equal(shouldIncludeArchiveAlways("claude-opus-4", "openrouter"), true);
    const injection = buildMemoryContext({
      memory: {
        pinned_facts: "",
        recent_summary: "[1~5턴]\n최근 사건",
        archive_summary: "과거 아카이브 요약",
        membership_tier: "free",
      },
      userMessage: "안녕",
      memoryCapacity: MEMORY_CAPACITY_FIXED,
      includeArchiveAlways: true,
    });
    assert.equal(injection.archiveIncluded, true);
    assert.match(injection.archiveText ?? "", /과거 아카이브/);
    assert.doesNotMatch(injection.text, /과거 아카이브/);
    assert.match(injection.text, /\[1~5턴\]/);
  });

  it("DeepSeek uses past-event summary header with dedupe line", () => {
    const injection = buildMemoryContext({
      memory: {
        pinned_facts: "",
        recent_summary: "[1~5턴]\n밥을 먹었다",
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
