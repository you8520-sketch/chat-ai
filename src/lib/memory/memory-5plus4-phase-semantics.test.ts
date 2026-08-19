import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, it } from "node:test";
import {
  resolveActiveSummaryInterval,
  resolveNewBatchEndForStart,
  resolveSummaryLogLabel,
  resolveSummaryMaxChars,
  resolveSummaryTargetChars,
} from "./memory-5plus4-flag";
import {
  buildRollingSummarySystemPrompt,
  pickNextSummaryBatch,
  shouldTriggerRollingSummary,
  summarySealAtTurn,
} from "./memory-rolling-summary";
import { clampMemoryRecordSummary } from "./memory-summary-clamp";
import { MEMORY_RECORD_MAX_CHARS } from "./memory-constants";
import { resolveMemoryCoverageGap } from "@/lib/hybridMemory";
import type { DialogueTurn } from "@/lib/hybridMemory";

const ENV_KEY = "MEMORY_5PLUS4_ENABLED";

function saveEnv(): string | undefined {
  return process.env[ENV_KEY];
}

function restoreEnv(value: string | undefined): void {
  if (value === undefined) delete process.env[ENV_KEY];
  else process.env[ENV_KEY] = value;
}

function makePlayable(count: number): DialogueTurn[] {
  return Array.from({ length: count }, (_, i) => ({
    user: `u${i + 1}`,
    assistant: `a${i + 1}`,
  }));
}

describe("Phase1 summary semantics P1-P5 (MEMORY_5PLUS4_ENABLED=false)", () => {
  let saved: string | undefined;

  beforeEach(() => {
    saved = saveEnv();
    delete process.env[ENV_KEY];
  });

  afterEach(() => {
    restoreEnv(saved);
  });

  it("P1 OFF completed5 => shouldTrigger=false", () => {
    assert.equal(shouldTriggerRollingSummary(5, 0), false);
    assert.equal(resolveActiveSummaryInterval(), 6);
  });

  it("P2 OFF completed6 => shouldTrigger=true, seal 1-6", () => {
    assert.equal(shouldTriggerRollingSummary(6, 0), true);
    assert.equal(resolveNewBatchEndForStart(1), 6);
    assert.equal(pickNextSummaryBatch(makePlayable(6), 0).length, 6);
  });

  it("P3 OFF new 6-turn summary max=800 target telemetry=540", () => {
    assert.equal(resolveSummaryMaxChars(), 800);
    assert.equal(resolveSummaryTargetChars(), 540);
    const prompt = buildRollingSummarySystemPrompt(6);
    assert.match(prompt, /최대 800자/);
    const clamped = clampMemoryRecordSummary("가".repeat(900), resolveSummaryMaxChars());
    assert.ok(clamped.length <= 800);
  });

  it("P4 OFF logs use 6턴 기억 기록", () => {
    assert.equal(resolveSummaryLogLabel(), "6턴 기억 기록");
    assert.doesNotMatch(resolveSummaryLogLabel(), /5턴/);
  });

  it("P5 OFF after summary1-6 RAW latest5 => coverage gap0", () => {
    const summarized = 6;
    const completed = 11;
    const firstRaw = completed - 5 + 1;
    assert.equal(
      resolveMemoryCoverageGap({ firstRawPlayableTurn: firstRaw, summarizedTurnCount: summarized }),
      0
    );
  });

  it("P5b OFF user-edited memory record default cap stays 800", () => {
    const userEdited = clampMemoryRecordSummary("가".repeat(900));
    assert.ok(userEdited.length <= MEMORY_RECORD_MAX_CHARS);
    assert.equal(MEMORY_RECORD_MAX_CHARS, 800);
  });
});

describe("Phase2 summary semantics P6-P10 (MEMORY_5PLUS4_ENABLED=true)", () => {
  let saved: string | undefined;

  beforeEach(() => {
    saved = saveEnv();
    process.env[ENV_KEY] = "1";
  });

  afterEach(() => {
    restoreEnv(saved);
  });

  it("P6 ON completed4 => not due", () => {
    assert.equal(shouldTriggerRollingSummary(4, 0), false);
    assert.equal(summarySealAtTurn(0), 5);
  });

  it("P7 ON completed5 => seal 1-5", () => {
    assert.equal(shouldTriggerRollingSummary(5, 0), true);
    assert.equal(resolveNewBatchEndForStart(1), 5);
    assert.equal(pickNextSummaryBatch(makePlayable(5), 0).length, 5);
  });

  it("P8 ON max=600 target=450", () => {
    assert.equal(resolveSummaryMaxChars(), 600);
    assert.equal(resolveSummaryTargetChars(), 450);
    const prompt = buildRollingSummarySystemPrompt(5);
    assert.match(prompt, /최대 600자/);
  });

  it("P9 ON logs use 5턴 기억 기록", () => {
    assert.equal(resolveSummaryLogLabel(), "5턴 기억 기록");
  });

  it("P10 ON summary1-5 + RAW2-5 => coverage gap0", () => {
    const summarized = 5;
    const completed = 9;
    const firstRaw = completed - 4 + 1;
    assert.equal(firstRaw, 6);
    assert.equal(
      resolveMemoryCoverageGap({ firstRawPlayableTurn: firstRaw, summarizedTurnCount: summarized }),
      0
    );
  });

  it("P10b ON automatic rolling summary clamps to 600 (not memory record cap)", () => {
    const clamped = clampMemoryRecordSummary("가".repeat(900), resolveSummaryMaxChars());
    assert.ok(clamped.length <= 600);
    const userEdited = clampMemoryRecordSummary("가".repeat(900));
    assert.ok(userEdited.length <= MEMORY_RECORD_MAX_CHARS);
    assert.equal(MEMORY_RECORD_MAX_CHARS, 800);
  });
});

describe("Mixed legacy regen spans stay on stored turn_end", () => {
  let saved: string | undefined;

  beforeEach(() => {
    saved = saveEnv();
  });

  afterEach(() => {
    restoreEnv(saved);
  });

  it("legacy 1-6 record regen stays 1-6 regardless of flag", async () => {
    const { resolveBatchStartForTurnNumber } = await import("./memory-summary-integrity");
    const records = [{ turnStart: 1, turnEnd: 6, inactive: false }];
    process.env[ENV_KEY] = "1";
    assert.equal(resolveBatchStartForTurnNumber(4, records), 1);
    delete process.env[ENV_KEY];
    assert.equal(resolveBatchStartForTurnNumber(4, records), 1);
  });

  it("new 13-17 record regen stays 13-17 regardless of flag", async () => {
    const { resolveBatchStartForTurnNumber } = await import("./memory-summary-integrity");
    const records = [
      { turnStart: 1, turnEnd: 6, inactive: false },
      { turnStart: 7, turnEnd: 12, inactive: false },
      { turnStart: 13, turnEnd: 17, inactive: false },
    ];
    process.env[ENV_KEY] = "1";
    assert.equal(resolveBatchStartForTurnNumber(15, records), 13);
    delete process.env[ENV_KEY];
    assert.equal(resolveBatchStartForTurnNumber(15, records), 13);
  });
});
