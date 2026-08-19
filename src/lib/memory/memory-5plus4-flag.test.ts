import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, it } from "node:test";
import {
  isMemory5Plus4Enabled,
  isSummaryBarrierActive,
  resolveNewBatchEndForStart,
  resolveNewBatchSpanLength,
  resolveProviderRawExchangeCount,
  PHASE1_DEPLOY_PROCEDURE,
  PHASE2_ENABLE_PROCEDURE,
} from "./memory-5plus4-flag";
import { LEGACY_NULL_TURN_END_OFFSET } from "./memory-summary-range";
import { highestContiguousCompletedTurn } from "./memory-summary-integrity";
import { resolveNextBatchRange } from "./memory-summary-range";

const ENV_KEY = "MEMORY_5PLUS4_ENABLED";
const MEMORY_ENV_KEY = "MEMORY_FEATURE_ENABLED";

function saveEnv(): Record<string, string | undefined> {
  return {
    [ENV_KEY]: process.env[ENV_KEY],
    [MEMORY_ENV_KEY]: process.env[MEMORY_ENV_KEY],
  };
}

function restoreEnv(saved: Record<string, string | undefined>): void {
  for (const [key, value] of Object.entries(saved)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
}

describe("MEMORY_5PLUS4_ENABLED two-phase cutover C1-C4", () => {
  let saved: Record<string, string | undefined>;

  beforeEach(() => {
    saved = saveEnv();
  });

  afterEach(() => {
    restoreEnv(saved);
  });

  it("C1 flag OFF — legacy 6-turn writer, provider RAW=5, barrier inactive", () => {
    delete process.env[ENV_KEY];
    process.env[MEMORY_ENV_KEY] = "1";

    assert.equal(isMemory5Plus4Enabled(), false);
    assert.equal(resolveNewBatchEndForStart(1), 1 + LEGACY_NULL_TURN_END_OFFSET);
    assert.equal(resolveNewBatchSpanLength(), LEGACY_NULL_TURN_END_OFFSET + 1);
    assert.equal(resolveProviderRawExchangeCount(), 5);
    assert.equal(isSummaryBarrierActive(), false);
    assert.equal(resolveNewBatchEndForStart(7), 12);
  });

  it("C2 flag ON after legacy frontier 12 — next seal is 13-17", () => {
    process.env[ENV_KEY] = "true";
    process.env[MEMORY_ENV_KEY] = "1";

    assert.equal(isMemory5Plus4Enabled(), true);
    assert.equal(resolveNewBatchEndForStart(13), 17);
    assert.deepEqual(resolveNextBatchRange(12, 17), { turnStart: 13, turnEnd: 17 });
    assert.equal(resolveProviderRawExchangeCount(), 4);
    assert.equal(isSummaryBarrierActive(), true);
  });

  it("C3 existing 5-turn rows remain readable after restart (mixed spans)", () => {
    delete process.env[ENV_KEY];
    const records = [
      { turnStart: 1, turnEnd: 6 },
      { turnStart: 7, turnEnd: 12 },
      { turnStart: 13, turnEnd: 17 },
      { turnStart: 18, turnEnd: 22 },
    ];
    assert.equal(highestContiguousCompletedTurn(records, 25), 22);
  });

  it("C4 flag transition does not imply row rewrite — frontier advances only on new seals", () => {
    delete process.env[ENV_KEY];
    assert.equal(resolveNextBatchRange(12, 16), null);
    process.env[ENV_KEY] = "1";
    assert.deepEqual(resolveNextBatchRange(12, 17), { turnStart: 13, turnEnd: 17 });
  });

  it("exposes operational deployment procedures", () => {
    assert.match(PHASE1_DEPLOY_PROCEDURE, /MEMORY_5PLUS4_ENABLED/);
    assert.match(PHASE2_ENABLE_PROCEDURE, /MEMORY_5PLUS4_ENABLED=true/);
  });
});
