import { describe, expect, it } from "vitest";
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
    expect(budget.lorebook).toBe(MEMORY_CAPACITY_FIXED);
    expect(budget.recent).toBe(MEMORY_CAPACITY_FIXED);
    expect(budget.archive).toBe(ARCHIVE_CAPACITY_FIXED);
    expect(budget.total).toBe(MEMORY_CAPACITY_FIXED + ARCHIVE_CAPACITY_FIXED);
  });
});

describe("archive prompt injection", () => {
  it("includes archive when non-empty (all providers)", () => {
    expect(shouldIncludeArchiveAlways("claude-opus-4", "openrouter")).toBe(true);
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
    expect(injection.archiveIncluded).toBe(true);
    expect(injection.archiveText).toContain("과거 아카이브");
    expect(injection.text).not.toContain("과거 아카이브");
    expect(injection.text).toContain("[1~5턴]");
  });

  it("DeepSeek uses past-event summary header with dedupe line", () => {
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
    expect(injection.text).toContain("[과거 사건 요약본]");
    expect(injection.text).toContain("동일한 하나의 사건으로 인지");
    expect(injection.text).not.toContain("[현재기억]");
  });
});
