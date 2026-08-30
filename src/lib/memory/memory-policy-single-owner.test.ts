import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { execSync } from "node:child_process";
import {
  RAW_HISTORY_COMPLETE_EXCHANGES,
  ROLLING_SUMMARY_INTERVAL,
  ROLLING_SUMMARY_MAX_CHARS,
  ROLLING_SUMMARY_MIN_CHARS,
  ROLLING_SUMMARY_TARGET_CHARS,
  resolveSummaryLogLabel,
  targetSummarizedThrough,
} from "./memory-constants";
import { isSummaryBarrierActive } from "./memory-feature";
import {
  newBatchEndForStart,
  resolveNextBatchRange,
  resolveRecordSpan,
  resolveStoredTurnEnd,
} from "./memory-summary-range";
import {
  pickNextSummaryBatch,
  shouldTriggerRollingSummary,
  summarySealAtTurn,
} from "./memory-rolling-summary";
import { highestContiguousCompletedTurn } from "./memory-summary-integrity";
import type { DialogueTurn } from "@/lib/hybridMemory";

const REPO_ROOT = process.cwd();

function makePlayable(count: number): DialogueTurn[] {
  return Array.from({ length: count }, (_, i) => ({
    user: `u${i + 1}`,
    assistant: `a${i + 1}`,
  }));
}

function repoRgCount(pattern: string): number {
  const out = execSync(
    `rg -l ${JSON.stringify(pattern)} --glob '!**/node_modules/**' --glob '!**/.git/**' --glob '!**/.next*/**' --glob '!*.test.ts' --glob '!**/memory-summary-migration.ts' --glob '!*.md' src scripts || true`,
    { cwd: REPO_ROOT, encoding: "utf8" }
  );
  return out
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean).length;
}

describe("single memory policy owner", () => {
  it("canonical constants are 5+4", () => {
    assert.equal(ROLLING_SUMMARY_INTERVAL, 5);
    assert.equal(RAW_HISTORY_COMPLETE_EXCHANGES, 4);
    assert.equal(ROLLING_SUMMARY_TARGET_CHARS, 450);
    assert.equal(ROLLING_SUMMARY_MAX_CHARS, 600);
    assert.equal(ROLLING_SUMMARY_MIN_CHARS, 80);
    assert.equal(resolveSummaryLogLabel(), "5턴 기억 기록");
  });

  it("MEMORY_5PLUS4_ENABLED production references are 0", () => {
    const hits = execSync(
      `rg -n "MEMORY_5PLUS4_ENABLED|isMemory5Plus4Enabled|resolveActiveSummaryInterval|resolveProviderRawExchangeCount|PHASE1_DEPLOY_PROCEDURE|PHASE2_ENABLE_PROCEDURE" src scripts --glob '!*.test.ts' --glob '!*.md' || true`,
      { cwd: REPO_ROOT, encoding: "utf8" }
    ).trim();
    assert.equal(hits, "", hits);
  });

  it("no new 6-turn automatic writer path", () => {
    assert.equal(newBatchEndForStart(1), 5);
    assert.equal(newBatchEndForStart(6), 10);
    assert.equal(newBatchEndForStart(11), 15);
    assert.deepEqual(resolveNextBatchRange(0, 5), { turnStart: 1, turnEnd: 5 });
    assert.deepEqual(resolveNextBatchRange(5, 10), { turnStart: 6, turnEnd: 10 });
    assert.deepEqual(resolveNextBatchRange(10, 15), { turnStart: 11, turnEnd: 15 });
    assert.equal(pickNextSummaryBatch(makePlayable(6), 0).length, 5);
    assert.equal(shouldTriggerRollingSummary(5, 0), true);
    assert.equal(shouldTriggerRollingSummary(6, 0), true);
    assert.equal(summarySealAtTurn(0), 5);
  });

  it("new summary ranges are 1-5 / 6-10 / 11-15", () => {
    assert.equal(targetSummarizedThrough(3), 0);
    assert.equal(targetSummarizedThrough(5), 5);
    assert.equal(targetSummarizedThrough(9), 5);
    assert.equal(targetSummarizedThrough(10), 10);
    assert.equal(targetSummarizedThrough(18), 15);
    assert.equal(targetSummarizedThrough(37), 35);
  });

  it("explicit user-edited 1~6 rows remain readable", () => {
    const span = resolveRecordSpan({ turn_number: 1, turn_end: 6 });
    assert.ok(span);
    assert.equal(span.turnEnd, 6);
    assert.equal(span.turnCount, 6);
    assert.equal(resolveStoredTurnEnd(1, 6), 6);
    assert.equal(resolveStoredTurnEnd(1, null), null);
    assert.equal(
      highestContiguousCompletedTurn([{ turnStart: 1, turnEnd: 6 }], 12),
      6
    );
  });

  it("after explicit user-edited 1~6, next new batch is 7-11", () => {
    assert.deepEqual(resolveNextBatchRange(6, 11), { turnStart: 7, turnEnd: 11 });
    assert.equal(resolveNextBatchRange(6, 10), null);
  });

  it("mixed explicit 1~6 user span + new 5-turn batches keeps a contiguous frontier", () => {
    const records = [
      { turnStart: 1, turnEnd: 6 },
      { turnStart: 7, turnEnd: 11 },
      { turnStart: 12, turnEnd: 16 },
    ];
    assert.equal(highestContiguousCompletedTurn(records, 20), 16);
  });

  it("no runtime legacy six-turn automatic symbols outside migration", () => {
    assert.equal(repoRgCount("isLegacySixTurnBatch"), 0);
    assert.equal(repoRgCount("LEGACY_SIX_TURN_SPAN"), 0);
    assert.equal(repoRgCount("LEGACY_NULL_TURN_END_OFFSET"), 0);
  });

  it("summary barrier is active whenever memory is on", () => {
    const prev = process.env.MEMORY_FEATURE_ENABLED;
    try {
      delete process.env.MEMORY_FEATURE_ENABLED;
      assert.equal(isSummaryBarrierActive(), true);
      process.env.MEMORY_FEATURE_ENABLED = "0";
      assert.equal(isSummaryBarrierActive(), false);
      process.env.MEMORY_FEATURE_ENABLED = "1";
      assert.equal(isSummaryBarrierActive(), true);
    } finally {
      if (prev === undefined) delete process.env.MEMORY_FEATURE_ENABLED;
      else process.env.MEMORY_FEATURE_ENABLED = prev;
    }
  });

  it("legacy 20-message memory compressor subgraph has zero runtime references", () => {
    assert.equal(repoRgCount("memory-compressor"), 0);
    assert.equal(repoRgCount("compressMemoryBuffer"), 0);
    assert.equal(repoRgCount("scheduleMemoryCompression"), 0);
    assert.equal(repoRgCount("callGeminiCompression"), 0);
    assert.equal(repoRgCount("COMPRESSION_TRIGGER"), 0);
    assert.equal(repoRgCount("appendToBuffer"), 0);
    assert.equal(repoRgCount("getBufferMessages"), 0);
    try {
      readFileSync("/workspace/src/lib/memory/memory-compressor.ts");
      assert.fail("memory-compressor.ts still exists");
    } catch {
      // expected
    }
  });
});
