import { describe, expect, it } from "vitest";

import {
  countCompletedTurnsUpToMessageId,
  forkSummarizedTurnCount,
} from "./memory-fork-turn-count";

describe("memory-fork-snapshot", () => {
  it("counts completed turns up to message id", () => {
    const messages = [
      { id: 1, role: "user", model: "" },
      { id: 2, role: "assistant", model: "greeting" },
      { id: 3, role: "user", model: "" },
      { id: 4, role: "assistant", model: "deepseek" },
      { id: 5, role: "user", model: "" },
      { id: 6, role: "assistant", model: "deepseek" },
      { id: 7, role: "user", model: "" },
    ];

    expect(countCompletedTurnsUpToMessageId(messages, 4)).toBe(1);
    expect(countCompletedTurnsUpToMessageId(messages, 6)).toBe(2);
    expect(countCompletedTurnsUpToMessageId(messages, 7)).toBe(2);
  });

  it("forkSummarizedTurnCount floors to completed 6-turn batches", () => {
    expect(forkSummarizedTurnCount(0)).toBe(0);
    expect(forkSummarizedTurnCount(5)).toBe(0);
    expect(forkSummarizedTurnCount(6)).toBe(6);
    expect(forkSummarizedTurnCount(13)).toBe(12);
  });
});
