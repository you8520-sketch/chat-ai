import assert from "node:assert/strict";
import { execSync } from "node:child_process";
import { describe, it } from "node:test";
import {
  RAW_HISTORY_COMPLETE_EXCHANGES,
  ROLLING_SUMMARY_INTERVAL,
} from "./memory-constants";
import { rawRecentTurnsToHistory } from "@/lib/hybridMemory";
import { highestContiguousCompletedTurn } from "./memory-summary-integrity";
import { persistValidatedSummaryBatch } from "./memory-summary-persist";
import { isPhaseCLegacyCleanupAllowed } from "./memory-summary-migration";
import {
  newBatchEndForStart,
  resolveRecordSpan,
  resolveStoredTurnEnd,
} from "./memory-summary-range";

function repoRgCount(pattern: string, extraGlob?: string): number {
  const glob = extraGlob ?? "--glob '!*.test.ts' --glob '!**/memory-summary-migration.ts'";
  const out = execSync(
    `rg -l ${JSON.stringify(pattern)} --glob '!**/node_modules/**' --glob '!**/.git/**' --glob '!**/.next*/**' ${glob} src scripts || true`,
    { cwd: "/workspace", encoding: "utf8" }
  );
  return out
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean).length;
}

describe("Phase C — six-turn compatibility cleanup", () => {
  it("precondition helper accepts zero legacy inventory", () => {
    assert.equal(
      isPhaseCLegacyCleanupAllowed({
        ACTIVE_AUTOMATIC_LEGACY_6TURN_ROWS: 0,
        INACTIVE_AUTOMATIC_LEGACY_6TURN_ROWS: 0,
        USER_EDITED_NULL_SPAN_ROWS: 0,
        TOTAL_AUTOMATIC_LEGACY_6TURN_ROWS: 0,
      }),
      true
    );
  });

  it("new automatic writer spans are exactly 5 turns", () => {
    assert.equal(newBatchEndForStart(1), 5);
    assert.equal(newBatchEndForStart(6), 10);
    assert.equal(newBatchEndForStart(11) - 11 + 1, ROLLING_SUMMARY_INTERVAL);
  });

  it("NULL turn_end is not silently treated as automatic 5 or 6 at runtime", () => {
    assert.equal(resolveStoredTurnEnd(1, null), null);
    assert.equal(resolveRecordSpan({ turn_number: 1, turn_end: null }), null);
  });

  it("explicit user-edited 1~6 records remain readable as 1~6", () => {
    const span = resolveRecordSpan({ turn_number: 1, turn_end: 6 });
    assert.ok(span);
    assert.equal(span.turnStart, 1);
    assert.equal(span.turnEnd, 6);
    assert.equal(span.turnCount, 6);
    assert.equal(
      highestContiguousCompletedTurn([{ turnStart: 1, turnEnd: 6 }], 12),
      6
    );
  });

  it("user-edited explicit arbitrary spans are not forced to 5 turns", () => {
    const span = resolveRecordSpan({ turn_number: 1, turn_end: 8 });
    assert.ok(span);
    assert.equal(span.turnEnd, 8);
    assert.notEqual(span.turnCount, ROLLING_SUMMARY_INTERVAL);
  });

  it("chat 5 manual 1~6 user_edited shape is preserved by runtime reader", () => {
    const span = resolveRecordSpan({
      turn_number: 1,
      turn_end: 6,
    });
    assert.ok(span);
    assert.equal(span.turnEnd, 6);
    assert.notEqual(span.turnCount, ROLLING_SUMMARY_INTERVAL);
  });

  it("automatic persist rejects 6-turn spans without userEdited", () => {
    const result = persistValidatedSummaryBatch({
      chatId: 99_002,
      userId: 99_002,
      characterId: 1,
      tier: "free",
      turnStart: 1,
      turnEnd: 6,
      assistantMessageId: null,
      summary:
        "자동 6턴 배치는 더 이상 허용되지 않습니다. 충분한 길이의 요약 본문입니다.",
      playableTurnCount: 6,
    });
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.reason, "SUMMARY_INVALID");
  });

  it("explicit 1~6 span is not treated as automatic legacy without user_edited flag", () => {
    const span = resolveRecordSpan({ turn_number: 1, turn_end: 6 });
    assert.ok(span);
    assert.equal(span.turnCount, 6);
    assert.notEqual(span.turnCount, ROLLING_SUMMARY_INTERVAL);
  });

  it("provider RAW history remains exactly 4 complete exchanges", () => {
    const turns = Array.from({ length: 5 }, (_, i) => ({
      user: `u${i + 1}`,
      assistant: `a${i + 1}`,
    }));
    const history = rawRecentTurnsToHistory(turns);
    assert.equal(history.length, RAW_HISTORY_COMPLETE_EXCHANGES * 2);
  });

  it("no runtime six-turn automatic fallback symbols remain outside migration", () => {
    assert.equal(repoRgCount("isLegacySixTurnBatch"), 0);
    assert.equal(repoRgCount("LEGACY_SIX_TURN_SPAN"), 0);
    assert.equal(repoRgCount("LEGACY_NULL_TURN_END_OFFSET"), 0);
    assert.equal(repoRgCount("turn_number \\+ 5"), 0);
  });

  it("db boot no longer backfills NULL turn_end to six-turn spans", () => {
    const src = execSync(
      'rg -n backfillChatTurnSummaryTurnEnd src --glob "!*.test.ts" || true',
      { cwd: "/workspace", encoding: "utf8" }
    ).trim();
    assert.equal(src, "");
  });
});
