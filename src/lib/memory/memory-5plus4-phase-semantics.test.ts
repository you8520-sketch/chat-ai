import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  buildRollingSummarySystemPrompt,
  pickNextSummaryBatch,
  shouldTriggerRollingSummary,
  summarySealAtTurn,
} from "./memory-rolling-summary";
import { clampMemoryRecordSummary } from "./memory-summary-clamp";
import {
  MEMORY_RECORD_MAX_CHARS,
  ROLLING_SUMMARY_MAX_CHARS,
  ROLLING_SUMMARY_TARGET_CHARS,
  resolveSummaryLogLabel,
} from "./memory-constants";
import { newBatchEndForStart } from "./memory-summary-range";
import { resolveMemoryCoverageGap } from "@/lib/hybridMemory";
import type { DialogueTurn } from "@/lib/hybridMemory";

function makePlayable(count: number): DialogueTurn[] {
  return Array.from({ length: count }, (_, i) => ({
    user: `u${i + 1}`,
    assistant: `a${i + 1}`,
  }));
}

describe("single-policy summary semantics", () => {
  it("completed4 => not due; completed5 => seal 1-5", () => {
    assert.equal(shouldTriggerRollingSummary(4, 0), false);
    assert.equal(shouldTriggerRollingSummary(5, 0), true);
    assert.equal(summarySealAtTurn(0), 5);
    assert.equal(newBatchEndForStart(1), 5);
    assert.equal(pickNextSummaryBatch(makePlayable(5), 0).length, 5);
  });

  it("automatic clamp is 600 / target 450; user-edited cap stays 800", () => {
    assert.equal(ROLLING_SUMMARY_MAX_CHARS, 600);
    assert.equal(ROLLING_SUMMARY_TARGET_CHARS, 450);
    const prompt = buildRollingSummarySystemPrompt(5);
    assert.match(prompt, /최대 600자/);
    const clamped = clampMemoryRecordSummary("가".repeat(900), ROLLING_SUMMARY_MAX_CHARS);
    assert.ok(clamped.length <= 600);
    const userEdited = clampMemoryRecordSummary("가".repeat(900));
    assert.ok(userEdited.length <= MEMORY_RECORD_MAX_CHARS);
    assert.equal(MEMORY_RECORD_MAX_CHARS, 800);
  });

  it("logs use 5턴 기억 기록", () => {
    assert.equal(resolveSummaryLogLabel(), "5턴 기억 기록");
  });

  it("summary1-5 + RAW 6-9 => coverage gap 0", () => {
    const summarized = 5;
    const completed = 9;
    const firstRaw = completed - 4 + 1;
    assert.equal(firstRaw, 6);
    assert.equal(
      resolveMemoryCoverageGap({ firstRawPlayableTurn: firstRaw, summarizedTurnCount: summarized }),
      0
    );
  });
});
