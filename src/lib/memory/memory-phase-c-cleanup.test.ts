import Module from "module";

const originalLoad = (Module as unknown as { _load: typeof Module._load })._load;
(Module as unknown as { _load: typeof Module._load })._load = function (
  request: string,
  parent: NodeModule,
  isMain: boolean
) {
  if (request === "server-only") return {};
  return originalLoad(request, parent, isMain);
} as typeof Module._load;

import assert from "node:assert/strict";
import { execSync } from "node:child_process";
import { after, before, describe, it } from "node:test";
import { getDb } from "@/lib/db";
import {
  installIsolatedTestDatabase,
  uninstallIsolatedTestDatabase,
} from "@/lib/test/isolatedTestDatabase";
import {
  RAW_HISTORY_COMPLETE_EXCHANGES,
  ROLLING_SUMMARY_INTERVAL,
} from "./memory-constants";
import { rawRecentTurnsToHistory } from "@/lib/hybridMemory";
import { highestContiguousCompletedTurn } from "./memory-summary-integrity";
import { getOrCreateChatMemory } from "./memory-db";
import { persistValidatedSummaryBatch } from "./memory-summary-persist";
import { isPhaseCLegacyCleanupAllowed } from "./memory-summary-migration";
import {
  newBatchEndForStart,
  resolveRecordSpan,
  resolveStoredTurnEnd,
} from "./memory-summary-range";
import { validateSummarySpanWrite } from "./memory-summary-span-write";
import {
  listMemoryRecordsForChat,
  updateMemoryRecordById,
} from "./memory-turn-summary";

const REPO_ROOT = process.cwd();

const FIXTURE =
  "사용자가 수동으로 편집한 1~6턴 요약입니다. " +
  "충분한 길이의 본문을 포함하며 장면의 인과와 감정 변화를 순서대로 기록합니다. " +
  "레온은 연회장 테라스에서 렌을 만나 정원을 안내했고 서로의 마음을 확인했다.";

const CHAT_ID = 99_100;
const USER_ID = 99_101;
const CHAR_ID = 99_102;

function repoRgCount(pattern: string, extraGlob?: string): number {
  const glob = extraGlob ?? "--glob '!*.test.ts' --glob '!**/memory-summary-migration.ts'";
  const out = execSync(
    `rg -l ${JSON.stringify(pattern)} --glob '!**/node_modules/**' --glob '!**/.git/**' --glob '!**/.next*/**' ${glob} src scripts || true`,
    { cwd: REPO_ROOT, encoding: "utf8" }
  );
  return out
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean).length;
}

function runtimeInsertWriterPaths(): string[] {
  const out = execSync(
    `rg -l "INSERT INTO chat_turn_summaries" src/lib/memory --glob '!*.test.ts' || true`,
    { cwd: REPO_ROOT, encoding: "utf8" }
  );
  return out
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .sort();
}

function seedChat() {
  const db = getDb();
  db.prepare("DELETE FROM chat_turn_summaries WHERE chat_id=?").run(CHAT_ID);
  db.prepare("DELETE FROM chat_memories WHERE chat_id=?").run(CHAT_ID);
  db.prepare("DELETE FROM chats WHERE id=?").run(CHAT_ID);
  db.prepare("DELETE FROM users WHERE id=?").run(USER_ID);
  db.prepare("DELETE FROM characters WHERE id=?").run(CHAR_ID);
  db.prepare(`INSERT INTO users (id, email, nickname, pw_hash) VALUES (?,?,?,?)`).run(
    USER_ID,
    `phasec-${USER_ID}@test.local`,
    "phasec",
    "x"
  );
  db.prepare(`INSERT INTO characters (id, name) VALUES (?,?)`).run(CHAR_ID, "PhaseC");
  db.prepare(`INSERT INTO chats (id, user_id, character_id, mode) VALUES (?,?,?,'safe')`).run(
    CHAT_ID,
    USER_ID,
    CHAR_ID
  );
  getOrCreateChatMemory(CHAT_ID, USER_ID, CHAR_ID, "free");
}


before(() => installIsolatedTestDatabase());
after(() => uninstallIsolatedTestDatabase());

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
      { cwd: REPO_ROOT, encoding: "utf8" }
    ).trim();
    assert.equal(src, "");
  });
});

describe("Phase C — summary span write invariant (single owner)", () => {
  it("shared owner: automatic implicit 1~5 accepted", () => {
    assert.deepEqual(validateSummarySpanWrite({ turnStart: 1 }), {
      ok: true,
      turnStart: 1,
      turnEnd: 5,
      turnSpan: 5,
    });
  });

  it("shared owner: automatic explicit 1~6 rejected", () => {
    assert.deepEqual(
      validateSummarySpanWrite({ turnStart: 1, turnEnd: 6, userEdited: false }),
      { ok: false, reason: "SUMMARY_INVALID" }
    );
  });

  it("shared owner: userEdited explicit 1~6 accepted", () => {
    assert.deepEqual(
      validateSummarySpanWrite({ turnStart: 1, turnEnd: 6, userEdited: true }),
      { ok: true, turnStart: 1, turnEnd: 6, turnSpan: 6 }
    );
  });

  it("shared owner: userEdited arbitrary explicit span accepted", () => {
    assert.deepEqual(
      validateSummarySpanWrite({ turnStart: 3, turnEnd: 11, userEdited: true }),
      { ok: true, turnStart: 3, turnEnd: 11, turnSpan: 9 }
    );
  });

  it("persistValidatedSummaryBatch rejects automatic explicit 1~6", () => {
    const result = persistValidatedSummaryBatch({
      chatId: CHAT_ID,
      userId: USER_ID,
      characterId: CHAR_ID,
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

  it("persistValidatedSummaryBatch accepts userEdited explicit 1~6", () => {
    seedChat();
    const result = persistValidatedSummaryBatch({
      chatId: CHAT_ID,
      userId: USER_ID,
      characterId: CHAR_ID,
      tier: "free",
      turnStart: 1,
      turnEnd: 6,
      assistantMessageId: null,
      summary: FIXTURE,
      userEdited: true,
      playableTurnCount: 6,
    });
    assert.equal(result.ok, true);
    const records = listMemoryRecordsForChat(CHAT_ID);
    assert.equal(records.length, 1);
    assert.equal(records[0]!.turnEnd, 6);
    assert.equal(records[0]!.userEdited, true);
  });

  it("updateMemoryRecordById preserves explicit 1~6 span (chat 5 shape)", () => {
    seedChat();
    getDb()
      .prepare(
        `INSERT INTO chat_turn_summaries
          (chat_id, turn_number, turn_end, summary, summary_kind, user_edited, inactive)
         VALUES (?, 1, 6, ?, 'narrative', 1, 0)`
      )
      .run(CHAT_ID, FIXTURE);
    const before = listMemoryRecordsForChat(CHAT_ID)[0]!;
    assert.equal(before.turnEnd, 6);

    const edited =
      FIXTURE + " 사용자가 문장을 한 줄 더 보강했습니다. 여전히 충분한 길이입니다.";
    const updated = updateMemoryRecordById(CHAT_ID, before.id, edited);
    assert.ok(updated);
    assert.equal(updated.turnEnd, 6);
    assert.equal(updated.turnStart, 1);
    assert.equal(updated.userEdited, true);

    const row = getDb()
      .prepare(
        "SELECT turn_end FROM chat_turn_summaries WHERE chat_id=? AND turn_number=1"
      )
      .get(CHAT_ID) as { turn_end: number };
    assert.equal(row.turn_end, 6);
  });

  it("upsertMemoryRecord exported bypass writer is removed", () => {
    assert.equal(repoRgCount("export async function upsertMemoryRecord"), 0);
    assert.equal(repoRgCount("upsertMemoryRecord\\("), 0);
  });

  it("runtime chat_turn_summaries INSERT owners are persist, fork-copy, migration-only", () => {
    assert.deepEqual(runtimeInsertWriterPaths(), [
      "src/lib/memory/memory-fork-snapshot.ts",
      "src/lib/memory/memory-summary-migration.ts",
      "src/lib/memory/memory-summary-persist.ts",
      "src/lib/memory/memory-test-batch.ts",
    ]);
  });

  it("validateSummarySpanWrite is the sole span policy export", () => {
    assert.equal(repoRgCount("validateSummarySpanWrite"), 3);
  });
});

describe("Phase C — fork memory span ownership", () => {
  it("no fork-owned interval constants or summarized frontier math remain", () => {
    assert.equal(repoRgCount("FORK_MEMORY_TURN_INTERVAL"), 0);
    assert.equal(repoRgCount("FORK_MEMORY_BATCH_TURNS"), 0);
    assert.equal(repoRgCount("forkSummarizedTurnCount"), 0);
  });

  it("fork copy path uses explicit turn_end and shared span validator", () => {
    const forkSnapshot = execSync("cat src/lib/memory/memory-fork-snapshot.ts", {
      cwd: REPO_ROOT,
      encoding: "utf8",
    });
    assert.match(forkSnapshot, /SELECT turn_number, turn_end/);
    assert.match(forkSnapshot, /validateSummarySpanWrite/);
    assert.doesNotMatch(forkSnapshot, /turn_number \+ FORK_MEMORY/);
    assert.doesNotMatch(forkSnapshot, /Math\.floor\(forkTurnCount/);
  });

  it("fork API eligibility uses explicit turn_end not inferred interval", () => {
    const forkRoute = execSync("cat src/app/api/chat/fork/route.ts", {
      cwd: REPO_ROOT,
      encoding: "utf8",
    });
    assert.match(forkRoute, /turn_end IS NOT NULL AND turn_end <= \?/);
    assert.doesNotMatch(forkRoute, /FORK_MEMORY_TURN_INTERVAL/);
  });
});

after(() => {
  seedChat();
  getDb().prepare("DELETE FROM chat_turn_summaries WHERE chat_id=?").run(CHAT_ID);
});
