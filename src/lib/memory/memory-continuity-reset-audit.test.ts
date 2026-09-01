/**
 * Memory continuity + reset semantics audit — deterministic production-path proofs.
 * Proves valid long-term memory survives RAW window, reload, and next-turn injection.
 * Verifies global user memory wipe is not reachable; local invalidation ≠ global wipe.
 */
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
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { after, before, beforeEach, describe, it } from "node:test";
import { getDb } from "@/lib/db";
import { deleteChatOwnedDerivedRows } from "@/lib/chatOwnedDataCleanup";
import {
  installIsolatedTestDatabase,
  uninstallIsolatedTestDatabase,
} from "@/lib/test/isolatedTestDatabase";
import {
  MEMORY_POLICY_ID,
  RAW_HISTORY_COMPLETE_EXCHANGES,
  ROLLING_SUMMARY_INTERVAL,
} from "./memory-constants";
import { getOrCreateChatMemory } from "./memory-db";
import { buildMemoryContextForChat } from "./memory-manager";
import { persistValidatedSummaryBatch } from "./memory-summary-persist";
import { reconcileMemoryAfterTurnDelete } from "./memory-reconcile";
import { rebuildLorebookFromRecords } from "./memory-turn-summary";
import {
  getMemorySourceBoundaryCore,
  isMemoryWriteGuardCurrentCore,
} from "./memory-source-boundary";
import { trimLorebookToBudgetSync } from "./memory-lorebook-fit";
import {
  messagesToTurns,
  rawRecentTurnsToHistory,
  resolveLorebookExcludeFromTrimmedHistory,
} from "@/lib/hybridMemory";

const CHAT = 940001;
const CHAT_B = 940002;
const USER = 940003;
const CHAR = 940004;
const SECRET_A = "SECRET_PROMISE_ALPHA_42";
const RELATION_B = "RELATION_SHIFT_BETA_99";

function summaryWith(tag: string, extra = ""): string {
  return (
    `장면 요약: ${tag}. ${extra} ` +
    "추가 장식 없이 사실만 압축. 반복 묘사는 생략. 핵심 관계와 약속 상태를 유지한다. " +
    "인물의 감정 변화와 다음 장면 연결점을 짧게 기록한다."
  );
}

function cleanup(chatId = CHAT) {
  const db = getDb();
  db.prepare("DELETE FROM chat_turn_summaries WHERE chat_id=?").run(chatId);
  db.prepare("DELETE FROM chat_memories WHERE chat_id=?").run(chatId);
  db.prepare("DELETE FROM messages WHERE chat_id=?").run(chatId);
  db.prepare("DELETE FROM chats WHERE id=?").run(chatId);
}

function cleanupAll() {
  cleanup(CHAT);
  cleanup(CHAT_B);
  getDb().prepare("DELETE FROM users WHERE id=?").run(USER);
  getDb().prepare("DELETE FROM characters WHERE id=?").run(CHAR);
}

function ensureUserAndCharacter(): void {
  const db = getDb();
  db.prepare(`INSERT OR IGNORE INTO users (id, email, nickname, pw_hash) VALUES (?,?,?,?)`).run(
    USER,
    `cont-${USER}@test.local`,
    "cont",
    "x"
  );
  db.prepare(`INSERT OR IGNORE INTO characters (id, name) VALUES (?,?)`).run(CHAR, "ContChar");
}

function seedBase(chatId = CHAT) {
  ensureUserAndCharacter();
  const db = getDb();
  db.prepare(`INSERT INTO chats (id, user_id, character_id, mode) VALUES (?,?,?,'safe')`).run(
    chatId,
    USER,
    CHAR
  );
  getOrCreateChatMemory(chatId, USER, CHAR, "free");
}

function insertPlayableTurns(count: number, chatId = CHAT, secretOnTurn = 1): void {
  const db = getDb();
  if (count < 1) return;
  db.prepare(`INSERT INTO messages (chat_id, role, content, model) VALUES (?,?,?,?)`).run(
    chatId,
    "assistant",
    "opening",
    "greeting"
  );
  for (let t = 1; t <= count; t++) {
    const userText = t === secretOnTurn ? `${SECRET_A} user turn ${t}` : `user turn ${t}`;
    db.prepare(`INSERT INTO messages (chat_id, role, content, model) VALUES (?,?,?,?)`).run(
      chatId,
      "user",
      userText,
      "user"
    );
    db.prepare(`INSERT INTO messages (chat_id, role, content, model) VALUES (?,?,?,?)`).run(
      chatId,
      "assistant",
      t === count ? `${RELATION_B} assistant ${t}` : `assistant ${t}`,
      "test"
    );
  }
}

function sealBatch(
  turnStart: number,
  summary: string,
  playableTurnCount: number,
  chatId = CHAT
): void {
  const result = persistValidatedSummaryBatch({
    chatId,
    userId: USER,
    characterId: CHAR,
    tier: "free",
    turnStart,
    assistantMessageId: null,
    summary,
    summaryKind: "main_canon",
    scopePayload: {
      v: 1,
      scopes: { main_canon: summary },
      branchId: null,
      branchStatus: null,
      promotedBy: null,
      promotedAt: null,
    },
    branchId: null,
    branchStatus: null,
    promotedBy: null,
    promotedAt: null,
    playableTurnCount,
  });
  assert.equal(result.ok, true, result.ok ? "" : String((result as { reason?: string }).reason));
}

function assemblyAtTurnCount(playableTurns: number, summarizedTurnCount: number) {
  const rows = getDb()
    .prepare(`SELECT role, content, model FROM messages WHERE chat_id=? ORDER BY id`)
    .all(CHAT) as { role: "user" | "assistant"; content: string; model?: string }[];
  const turns = messagesToTurns(rows);
  const raw = rawRecentTurnsToHistory(turns, RAW_HISTORY_COMPLETE_EXCHANGES, {
    summarizedTurnCount,
    memoryFeatureEnabled: true,
  });
  const cutoff = resolveLorebookExcludeFromTrimmedHistory(turns, raw) ?? playableTurns;
  return { raw, cutoff, turns };
}

before(() => installIsolatedTestDatabase());
after(() => uninstallIsolatedTestDatabase());

beforeEach(() => {
  process.env.MEMORY_5PLUS4_ENABLED = "1";
});

describe("memory continuity — policy baseline", () => {
  it("MEMORY_POLICY_ID summary5_raw4 on main", () => {
    assert.equal(MEMORY_POLICY_ID, "summary5_raw4");
    assert.equal(ROLLING_SUMMARY_INTERVAL, 5);
    assert.equal(RAW_HISTORY_COMPLETE_EXCHANGES, 4);
  });
});

describe("memory continuity — long-running active chat (A)", () => {
  beforeEach(() => {
    cleanupAll();
    seedBase();
  });

  it("canonical lorebook retains SECRET_A after RAW window (turn 6+)", () => {
    insertPlayableTurns(10);
    sealBatch(
      1,
      summaryWith(SECRET_A, "Batch1 sealed in long-term memory."),
      5
    );
    sealBatch(
      6,
      summaryWith(RELATION_B, "Batch2 relationship shift recorded."),
      10
    );

    const { raw, cutoff } = assemblyAtTurnCount(10, 10);
    const rawText = raw.map((m) => m.content).join("\n");
    assert.doesNotMatch(rawText, new RegExp(SECRET_A));
    const lore = rebuildLorebookFromRecords(CHAT, { excludeTurnStartGte: cutoff });
    assert.match(lore, new RegExp(SECRET_A));
    assert.match(lore, new RegExp(RELATION_B));
  });

  it("NEXT_TURN_INJECTION_HAS_A via buildMemoryContextForChat", async () => {
    insertPlayableTurns(9);
    sealBatch(1, summaryWith(SECRET_A, "preserved for injection."), 5);

    const { raw, cutoff } = assemblyAtTurnCount(9, 5);
    assert.doesNotMatch(raw.map((m) => m.content).join("\n"), new RegExp(SECRET_A));

    const injection = await buildMemoryContextForChat({
      chatId: CHAT,
      userId: USER,
      characterId: CHAR,
      tier: "free",
      memoryCapacity: 10_000,
      userMessage: "continue scene",
      excludeSummaryTurnStartGte: cutoff,
    });
    assert.match(injection.text, new RegExp(SECRET_A));
  });

  it("20+ turns with multiple rolling summaries preserve early secret", () => {
    insertPlayableTurns(20);
    sealBatch(1, summaryWith(SECRET_A, "early secret."), 5);
    sealBatch(6, summaryWith("middle", "middle progression."), 10);
    sealBatch(11, summaryWith("further", "further progression."), 15);
    sealBatch(16, summaryWith(RELATION_B, "late arc."), 20);

    const { cutoff } = assemblyAtTurnCount(20, 20);
    const lore = rebuildLorebookFromRecords(CHAT, { excludeTurnStartGte: cutoff });
    assert.match(lore, new RegExp(SECRET_A));
    assert.match(lore, new RegExp(RELATION_B));

    const reloaded = getDb()
      .prepare(`SELECT recent_summary FROM chat_memories WHERE chat_id=?`)
      .get(CHAT) as { recent_summary: string };
    assert.match(reloaded.recent_summary, new RegExp(SECRET_A));
  });
});

describe("memory continuity — compaction (C)", () => {
  beforeEach(() => {
    cleanupAll();
    seedBase();
  });

  it("budget trim keeps core secret phrase", () => {
    insertPlayableTurns(5);
    const longSummary = summaryWith(SECRET_A, "relationship and promise details.".repeat(8));
    sealBatch(1, longSummary, 5);
    const lore = rebuildLorebookFromRecords(CHAT);
    const trimmed = trimLorebookToBudgetSync(lore, 800);
    assert.match(trimmed, new RegExp(SECRET_A));
  });
});

describe("memory continuity — new chat isolation (E)", () => {
  beforeEach(() => {
    cleanupAll();
    seedBase(CHAT);
    seedBase(CHAT_B);
  });

  it("chat B does not inherit chat A canonical memory", () => {
    insertPlayableTurns(5, CHAT);
    sealBatch(1, summaryWith(SECRET_A, "only in chat A"), 5, CHAT);
    const memB = getOrCreateChatMemory(CHAT_B, USER, CHAR, "free");
    assert.equal(memB.recent_summary, "");
    assert.doesNotMatch(rebuildLorebookFromRecords(CHAT_B), new RegExp(SECRET_A));
  });
});

describe("memory continuity — chat delete purge (F)", () => {
  beforeEach(() => {
    cleanupAll();
    seedBase();
  });

  it("deleteChatOwnedDerivedRows removes all chat-scoped memory", () => {
    insertPlayableTurns(5);
    sealBatch(1, summaryWith(SECRET_A, "to purge"), 5);
    getDb().transaction(() => {
      deleteChatOwnedDerivedRows(getDb(), CHAT, USER);
    })();
    const db = getDb();
    assert.equal(
      (db.prepare("SELECT COUNT(*) AS n FROM chat_memories WHERE chat_id=?").get(CHAT) as { n: number }).n,
      0
    );
    assert.equal(
      (db.prepare("SELECT COUNT(*) AS n FROM chat_turn_summaries WHERE chat_id=?").get(CHAT) as { n: number }).n,
      0
    );
    assert.equal(
      (db.prepare("SELECT COUNT(*) AS n FROM chats WHERE id=?").get(CHAT) as { n: number }).n,
      0
    );
  });
});

describe("memory continuity — local invalidation not global wipe (G)", () => {
  beforeEach(() => {
    cleanupAll();
    seedBase();
  });

  it("turn delete reconcile preserves unrelated sealed memory", () => {
    insertPlayableTurns(10);
    sealBatch(1, summaryWith(SECRET_A, "from early batch"), 5);
    sealBatch(6, summaryWith(RELATION_B, "from later batch"), 10);

    const db = getDb();
    const lastAssistant = db
      .prepare(
        `SELECT id FROM messages WHERE chat_id=? AND role='assistant' AND model='test' ORDER BY id DESC LIMIT 1`
      )
      .get(CHAT) as { id: number };
    const lastUser = db
      .prepare(
        `SELECT id FROM messages WHERE chat_id=? AND role='user' ORDER BY id DESC LIMIT 1`
      )
      .get(CHAT) as { id: number };
    db.prepare(`DELETE FROM messages WHERE id IN (?,?)`).run(lastUser.id, lastAssistant.id);

    reconcileMemoryAfterTurnDelete({
      chatId: CHAT,
      userId: USER,
      characterId: CHAR,
      charName: "ContChar",
      tier: "free",
      memoryCapacity: 10_000,
      deletedUserMessageId: lastUser.id,
      deletedAssistantMessageId: lastAssistant.id,
      deletedPlayableTurn: 10,
    });

    const lore = rebuildLorebookFromRecords(CHAT);
    assert.match(lore, new RegExp(SECRET_A));
  });
});

describe("memory continuity — stale write guard (K)", () => {
  beforeEach(() => {
    cleanupAll();
    seedBase();
  });

  it("epoch advance blocks stale background write guard", () => {
    insertPlayableTurns(3);
    const db = getDb();
    const snapshot = getMemorySourceBoundaryCore(db, CHAT);
    db.prepare(`UPDATE chat_memories SET memory_epoch=memory_epoch+1 WHERE chat_id=?`).run(CHAT);
    assert.equal(
      isMemoryWriteGuardCurrentCore(db, {
        chatId: CHAT,
        snapshot,
        sourceUserMessageIds: [],
      }),
      false
    );
  });
});

describe("memory continuity — user global clear unreachable (L)", () => {
  it("memory API route does not expose action clear", () => {
    const src = readFileSync(join(process.cwd(), "src/app/api/chat/memory/route.ts"), "utf8");
    assert.ok(!src.includes('action === "clear"'));
    assert.ok(!src.includes("clearMemoryForChat"));
  });

  it("no production UI sends memory clear action", () => {
    const panel = readFileSync(
      join(process.cwd(), "src/components/ChatSettingsPanel.tsx"),
      "utf8"
    );
    assert.ok(!panel.includes('"clear"'));
    assert.ok(!panel.includes("action: 'clear'"));
  });
});
