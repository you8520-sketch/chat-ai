import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  RAW_HISTORY_COMPLETE_EXCHANGES,
  messagesToTurns,
  rawRecentTurnsToHistory,
  resolveHistoryMinTurnFloor,
  trimHistoryToBudget,
} from "@/lib/hybridMemory";
import { HISTORY_TOKEN_BUDGET, resolveHistoryTokenBudget } from "@/lib/contextTrack";
import {
  highestContiguousCompletedTurn,
  missingContiguousBatchStarts,
  resolveBatchStartForTurnNumber,
  expectedSealedTurnCount,
  validateSummaryNarrative,
  isLikelySummaryInstructionEcho,
} from "./memory-summary-integrity";
import {
  LEGACY_NULL_TURN_END_OFFSET,
  newBatchEndForStart,
  resolveNextBatchRange,
  resolveStoredTurnEnd,
  unsummarizedCompletedTurns,
} from "./memory-summary-range";
import { buildRollingSummarySystemPrompt } from "./memory-rolling-summary";

function makeTurns(n: number, charLen = 100): ReturnType<typeof messagesToTurns> {
  const rows: { role: "user" | "assistant"; content: string }[] = [
    { role: "assistant", content: "greeting".padEnd(50, "x"), model: "greeting" } as never,
  ];
  for (let i = 1; i <= n; i++) {
    rows.push({ role: "user", content: `u${i}`.padEnd(charLen, "a") });
    rows.push({ role: "assistant", content: `a${i}`.padEnd(charLen, "b") });
  }
  return messagesToTurns(rows);
}

describe("memory 5+4 cutover — legacy spans", () => {
  it("L1 legacy records 1-6 and 7-12 stay exact", () => {
    const records = [
      { turnStart: 1, turnEnd: 6 },
      { turnStart: 7, turnEnd: 12 },
    ];
    assert.equal(highestContiguousCompletedTurn(records, 16), 12);
  });

  it("L2 completed 16 — next batch not due until 17", () => {
    const records = [
      { turnStart: 1, turnEnd: 6 },
      { turnStart: 7, turnEnd: 12 },
    ];
    assert.equal(resolveNextBatchRange(12, 16), null);
    assert.deepEqual(missingContiguousBatchStarts(records, 16), []);
  });

  it("L3 completed 17 seals 13-17 frontier when MEMORY_5PLUS4_ENABLED", () => {
    const prev = process.env.MEMORY_5PLUS4_ENABLED;
    try {
      process.env.MEMORY_5PLUS4_ENABLED = "1";
      assert.deepEqual(resolveNextBatchRange(12, 17), { turnStart: 13, turnEnd: 17 });
    } finally {
      if (prev === undefined) delete process.env.MEMORY_5PLUS4_ENABLED;
      else process.env.MEMORY_5PLUS4_ENABLED = prev;
    }
  });

  it("L5 NULL turn_end resolves as six-turn legacy", () => {
    assert.equal(resolveStoredTurnEnd(1, null), 1 + LEGACY_NULL_TURN_END_OFFSET);
  });

  it("L7 mixed ranges highest contiguous = 22", () => {
    const records = [
      { turnStart: 1, turnEnd: 6 },
      { turnStart: 7, turnEnd: 12 },
      { turnStart: 13, turnEnd: 17 },
      { turnStart: 18, turnEnd: 22 },
    ];
    assert.equal(highestContiguousCompletedTurn(records, 25), 22);
  });

  it("regen legacy turn 4 stays in batch 1-6", () => {
    const records = [{ turnStart: 1, turnEnd: 6 }];
    assert.equal(resolveBatchStartForTurnNumber(4, records), 1);
  });

  it("regen new turn 15 stays in batch 13-17", () => {
    const records = [
      { turnStart: 1, turnEnd: 6 },
      { turnStart: 7, turnEnd: 12 },
      { turnStart: 13, turnEnd: 17 },
    ];
    assert.equal(resolveBatchStartForTurnNumber(15, records), 13);
  });
});

describe("memory 5+4 — RAW four exchanges", () => {
  it("H3 five completed => latest 4", () => {
    const turns = makeTurns(5);
    const history = rawRecentTurnsToHistory(turns);
    assert.equal(history.length, 8);
    assert.match(history[0]!.content, /^u2/);
  });

  it("H5 latest 4 over 10K soft budget preserved", () => {
    const turns = makeTurns(4, 15_000);
    const full = rawRecentTurnsToHistory(turns);
    const trimmed = trimHistoryToBudget(full, HISTORY_TOKEN_BUDGET, 4);
    assert.equal(trimmed.length, 8);
  });

  it("H8 memory lag does not increase RAW floor", () => {
    assert.equal(
      resolveHistoryMinTurnFloor({
        memoryFeatureEnabled: true,
        completedTurns: 12,
        summarizedTurnCount: 0,
      }),
      RAW_HISTORY_COMPLETE_EXCHANGES
    );
  });

  it("resolveHistoryTokenBudget restored to 10K", () => {
    assert.equal(resolveHistoryTokenBudget("gemini-3-flash", "gemini"), 10_000);
  });
});

describe("LTM + RAW gap test", () => {
  it("turn-1 fact survives via LTM when RAW is 2-5", () => {
    const uniqueFact = "UNIQUE_EVENT_X_ALPHA";
    const records = [
      {
        id: 1,
        turnStart: 1,
        turnEnd: 5,
        summary: `[1~5턴] ${uniqueFact} and later scene.`,
        summaryKind: "main_canon" as const,
        scopes: { main_canon: `${uniqueFact} and later scene.` },
        turnRangeLabel: "1~5턴",
        scopeLabel: "",
        branchId: null,
        branchStatus: null,
        promotedBy: null,
        promotedAt: null,
        inactive: false,
        userEdited: false,
        charCount: 40,
        assistantMessageId: null,
      },
    ];
    // Simulate rebuildLorebook exclude: first RAW turn = 2 → keep summary 1-5
    const cutoff = 2;
    const kept = records.filter((r) => r.turnStart < cutoff);
    assert.equal(kept.length, 1);
    assert.match(kept[0]!.summary, /UNIQUE_EVENT_X_ALPHA/);

    const turns = makeTurns(5);
    turns[1]!.user = `${uniqueFact} user turn`;
    const raw = rawRecentTurnsToHistory(turns);
    assert.doesNotMatch(raw[0]!.content, /UNIQUE_EVENT_X_ALPHA/);
    assert.equal(raw.length, 8);
  });
});

describe("summary quality contracts", () => {
  it("Q1 5-turn prompt mentions max 600 not mandatory 450", () => {
    const prompt = buildRollingSummarySystemPrompt(5);
    assert.match(prompt, /최대 600자/);
    assert.doesNotMatch(prompt, /450자/);
  });

  it("Q9 rejects 5-turn and 6-turn instruction echo", () => {
    assert.equal(
      isLikelySummaryInstructionEcho("6턴 배치의 사건을 발생 순서대로 요약"),
      true
    );
    assert.equal(
      isLikelySummaryInstructionEcho("5턴 배치의 사건을 발생 순서대로 요약"),
      true
    );
  });

  it("Q2 sparse summary accepted", () => {
    const v = validateSummaryNarrative(
      "짧지만 중요한 사건 하나만 기록함. 이후 전개에 영향을 주는 약속과 관계 변화만 남김. " +
        "추가 장식 없이 사실만 압축. 반복 묘사는 생략. 핵심만 유지.",
      "main_canon"
    );
    assert.equal(v.ok, true);
  });
});

describe("chat707 reconstructed totals fixture", () => {
  const CHAT707_FIXTURE_TYPE = "reconstructed_totals";
  const BASE = 1939;
  const A7 = 2066;
  const A11 = 1833;

  it("reduces 11 exchanges to exact latest four (42679 -> 15406 chars)", () => {
    const rows: { role: "user" | "assistant"; content: string; model?: string }[] = [
      { role: "assistant", content: "g".padEnd(50, "g"), model: "greeting" },
    ];
    for (let i = 1; i <= 11; i++) {
      rows.push({ role: "user", content: `u${i}`.padEnd(BASE, "a") });
      const aLen = i === 7 ? A7 : i === 11 ? A11 : BASE;
      rows.push({ role: "assistant", content: `a${i}`.padEnd(aLen, "b"), model: "test" });
    }
    const turns = messagesToTurns(rows);
    const before = rawRecentTurnsToHistory(turns, 11);
    const after = rawRecentTurnsToHistory(turns, 4, {
      summarizedTurnCount: 5,
      memoryFeatureEnabled: true,
    });
    const beforeChars = before.reduce((n, m) => n + m.content.length, 0);
    const afterChars = after.reduce((n, m) => n + m.content.length, 0);
    assert.equal(before.length, 22);
    assert.equal(after.length, 8);
    assert.equal(beforeChars, 42679);
    assert.equal(afterChars, 15406);
    assert.equal(CHAT707_FIXTURE_TYPE, "reconstructed_totals");
  });
});

describe("greenfield 5-turn cadence (MEMORY_5PLUS4_ENABLED)", () => {
  const ENV_KEY = "MEMORY_5PLUS4_ENABLED";

  it("expectedSealedTurnCount for greenfield", () => {
    assert.equal(expectedSealedTurnCount(4), 0);
    assert.equal(expectedSealedTurnCount(5), 5);
    assert.equal(expectedSealedTurnCount(10), 10);
  });

  it("newBatchEndForStart follows flag — OFF=6-turn legacy, ON=5-turn", () => {
    const prev = process.env[ENV_KEY];
    try {
      delete process.env[ENV_KEY];
      assert.equal(newBatchEndForStart(1), 6);
      assert.equal(newBatchEndForStart(13), 18);
      process.env[ENV_KEY] = "1";
      assert.equal(newBatchEndForStart(1), 5);
      assert.equal(newBatchEndForStart(13), 17);
    } finally {
      if (prev === undefined) delete process.env[ENV_KEY];
      else process.env[ENV_KEY] = prev;
    }
  });
});


describe("summary barrier cadence", () => {
  it("B1 seal due at turn 5 after zero summarized", async () => {
    const { shouldTriggerRollingSummary, summarySealAtTurn } = await import(
      "./memory-rolling-summary"
    );
    assert.equal(summarySealAtTurn(0), 5);
    assert.equal(shouldTriggerRollingSummary(4, 0), false);
    assert.equal(shouldTriggerRollingSummary(5, 0), true);
  });

  it("B4 healthy unsummarized <=4 after first batch", () => {
    assert.equal(unsummarizedCompletedTurns(6, 5), 1);
    assert.equal(unsummarizedCompletedTurns(9, 5), 4);
    assert.equal(unsummarizedCompletedTurns(10, 5), 5);
  });
});
