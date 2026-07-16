/**
 * 10_000-char lorebook compact path ??fixture/unit only, no live model calls.
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
import { describe, it, before, after, beforeEach } from "node:test";
import { getDb } from "@/lib/db";
import { MEMORY_CAPACITY_FIXED } from "./memory-capacity-shared";
import { ensureLorebookWithinBudget } from "./memory-lorebook-fit";
import { resolveLorebookFromRecords } from "./memory-lorebook-resolve";
import { OOC_ONLY_SUMMARY_MARKER } from "./memory-summary-integrity";
import { getOrCreateChatMemory, updateChatMemory } from "./memory-db";
import {
  __setCompactCurrentMemoryTestOverride,
  syncChatLongTermMemory,
} from "./memory-rolling-summary";
import {
  listMemoryRecordsForChat,
  rebuildLorebookFromRecords,
} from "./memory-turn-summary";

const CHAT_ID = 990100;
const USER_ID = 990101;
const CHAR_ID = 990102;

const NARRATIVE_CHUNK =
  "?�온?� ?�회?�에???�을 만나 ?�원???�내?�다 ???�의 �?��???�들리며 감정???�러?�다 ??" +
  "커프링크?��? 받으�??�만???�속???�눴?????�별 ???�장??맡긴?�고 고백?�다. ";

type Stub = {
  calls: number;
  lastInput: string;
  mode: "ok" | "throw";
  resultText: string;
};

const stub: Stub = {
  calls: 0,
  lastInput: "",
  mode: "ok",
  resultText: "",
};

function installStub() {
  __setCompactCurrentMemoryTestOverride(async (existing) => {
    stub.calls += 1;
    stub.lastInput = existing;
    if (stub.mode === "throw") throw new Error("STUB_COMPACT_FAIL");
    return stub.resultText;
  });
}

function cleanup() {
  const db = getDb();
  db.prepare("DELETE FROM chat_turn_summaries WHERE chat_id=?").run(CHAT_ID);
  db.prepare("DELETE FROM chat_memories WHERE chat_id=?").run(CHAT_ID);
  db.prepare("DELETE FROM chats WHERE id=?").run(CHAT_ID);
  db.prepare("DELETE FROM users WHERE id=?").run(USER_ID);
  db.prepare("DELETE FROM characters WHERE id=?").run(CHAR_ID);
}

function seedChat() {
  const db = getDb();
  cleanup();
  db.prepare(`INSERT INTO users (id, email, nickname, pw_hash) VALUES (?,?,?,?)`).run(
    USER_ID,
    `compact-${USER_ID}@test.local`,
    "compact-test",
    "x"
  );
  db.prepare(`INSERT INTO characters (id, name) VALUES (?,?)`).run(CHAR_ID, "CompactChar");
  db.prepare(`INSERT INTO chats (id, user_id, character_id, mode) VALUES (?,?,?,'safe')`).run(
    CHAT_ID,
    USER_ID,
    CHAR_ID
  );
}

function seedOverBudgetSummaries(opts?: { withOoc?: boolean }) {
  const db = getDb();
  const body = NARRATIVE_CHUNK.repeat(8);
  let turn = 1;
  for (let i = 0; i < 20; i++) {
    const summary = `${body} 배치${i} 추�??�술�?길이�??�보?�다.`;
    db.prepare(
      `INSERT INTO chat_turn_summaries (chat_id, turn_number, summary, summary_kind)
       VALUES (?,?,?,?)`
    ).run(CHAT_ID, turn, summary, "main_canon");
    turn += 6;
  }
  if (opts?.withOoc) {
    db.prepare(
      `INSERT INTO chat_turn_summaries (chat_id, turn_number, summary, summary_kind)
       VALUES (?,?,?,?)`
    ).run(CHAT_ID, turn, OOC_ONLY_SUMMARY_MARKER, "empty_ooc");
  }
  const rebuilt = rebuildLorebookFromRecords(CHAT_ID);
  assert.ok(
    rebuilt.length > MEMORY_CAPACITY_FIXED,
    `expected rebuilt lorebook > ${MEMORY_CAPACITY_FIXED}, got ${rebuilt.length}`
  );
  return rebuilt;
}

async function persistCompactIfNeeded(): Promise<{ compressed: boolean; text: string }> {
  const budget = MEMORY_CAPACITY_FIXED;
  const rebuilt = rebuildLorebookFromRecords(CHAT_ID);
  const result = await ensureLorebookWithinBudget(rebuilt, budget);
  if (result.compressed) {
    updateChatMemory(CHAT_ID, USER_ID, CHAR_ID, {
      recent_summary: result.text,
      membership_tier: "free",
      last_compressed_at: new Date().toISOString(),
    });
    syncChatLongTermMemory(CHAT_ID, result.text);
  }
  return result;
}

describe("10k lorebook compact path (mocked, no live API)", () => {
  before(() => {
    installStub();
    seedChat();
  });
  after(() => {
    __setCompactCurrentMemoryTestOverride(null);
    cleanup();
  });
  beforeEach(() => {
    stub.calls = 0;
    stub.lastInput = "";
    stub.mode = "ok";
    stub.resultText = `${"?�축???�건 ?�름 ?�약. ".repeat(40)}??`;
    assert.ok(stub.resultText.length < MEMORY_CAPACITY_FIXED);
    cleanup();
    seedChat();
    getOrCreateChatMemory(CHAT_ID, USER_ID, CHAR_ID, "free");
    installStub();
  });

  it("below threshold does not run compact", async () => {
    const short = "짧�? ?�재기억 본문";
    const r = await ensureLorebookWithinBudget(short, MEMORY_CAPACITY_FIXED);
    assert.equal(r.compressed, false);
    assert.equal(r.text, short);
    assert.equal(stub.calls, 0);
  });

  it("above threshold runs compact exactly once and persists to recent + chats.current_summary", async () => {
    const rebuilt = seedOverBudgetSummaries();
    updateChatMemory(CHAT_ID, USER_ID, CHAR_ID, {
      recent_summary: rebuilt,
      summarized_turn_count: 120,
      message_count: 125,
      membership_tier: "free",
    });
    const db = getDb();
    db.prepare("UPDATE chats SET current_summary=? WHERE id=?").run(rebuilt, CHAT_ID);

    const beforeCount = (
      db
        .prepare("SELECT summarized_turn_count FROM chat_memories WHERE chat_id=?")
        .get(CHAT_ID) as { summarized_turn_count: number }
    ).summarized_turn_count;
    const beforeRows = listMemoryRecordsForChat(CHAT_ID).length;

    const r = await persistCompactIfNeeded();
    assert.equal(r.compressed, true);
    assert.equal(stub.calls, 1);
    assert.equal(r.text, stub.resultText.trim());

    const mem = db
      .prepare("SELECT recent_summary, summarized_turn_count FROM chat_memories WHERE chat_id=?")
      .get(CHAT_ID) as { recent_summary: string; summarized_turn_count: number };
    const chat = db
      .prepare("SELECT current_summary FROM chats WHERE id=?")
      .get(CHAT_ID) as { current_summary: string };

    assert.equal(mem.recent_summary, stub.resultText.trim());
    assert.equal(chat.current_summary, stub.resultText.trim());
    assert.equal(mem.summarized_turn_count, beforeCount);
    assert.equal(listMemoryRecordsForChat(CHAT_ID).length, beforeRows);
  });

  it("OOC-only placeholder is excluded from compact input", async () => {
    seedOverBudgetSummaries({ withOoc: true });
    const rebuilt = rebuildLorebookFromRecords(CHAT_ID);
    assert.equal(rebuilt.includes(OOC_ONLY_SUMMARY_MARKER), false);

    await ensureLorebookWithinBudget(rebuilt, MEMORY_CAPACITY_FIXED);
    assert.equal(stub.calls, 1);
    assert.equal(stub.lastInput.includes(OOC_ONLY_SUMMARY_MARKER), false);
  });

  it("compact failure does not overwrite existing current_summary", async () => {
    const rebuilt = seedOverBudgetSummaries();
    const prior = `[prior] ${rebuilt.slice(0, 200)}`;
    updateChatMemory(CHAT_ID, USER_ID, CHAR_ID, {
      recent_summary: prior,
      summarized_turn_count: 60,
      membership_tier: "free",
    });
    const db = getDb();
    db.prepare("UPDATE chats SET current_summary=? WHERE id=?").run(prior, CHAT_ID);

    stub.mode = "throw";
    const r = await persistCompactIfNeeded();
    assert.equal(r.compressed, false);
    assert.equal(stub.calls, 1);

    const mem = db
      .prepare("SELECT recent_summary, summarized_turn_count FROM chat_memories WHERE chat_id=?")
      .get(CHAT_ID) as { recent_summary: string; summarized_turn_count: number };
    const chat = db
      .prepare("SELECT current_summary FROM chats WHERE id=?")
      .get(CHAT_ID) as { current_summary: string };
    assert.equal(mem.recent_summary, prior);
    assert.equal(chat.current_summary, prior);
    assert.equal(mem.summarized_turn_count, 60);
  });

  it("second run after successful compact does not call model again", async () => {
    seedOverBudgetSummaries();
    const first = await persistCompactIfNeeded();
    assert.equal(first.compressed, true);
    assert.equal(stub.calls, 1);

    const db = getDb();
    const stored = (
      db
        .prepare("SELECT recent_summary FROM chat_memories WHERE chat_id=?")
        .get(CHAT_ID) as { recent_summary: string }
    ).recent_summary;
    assert.ok(stored.length <= MEMORY_CAPACITY_FIXED);

    const second = await ensureLorebookWithinBudget(stored, MEMORY_CAPACITY_FIXED);
    assert.equal(second.compressed, false);
    assert.equal(stub.calls, 1);

    const resolvedUnder = await resolveLorebookFromRecords(
      CHAT_ID,
      MEMORY_CAPACITY_FIXED + 1_000_000
    );
    assert.equal(resolvedUnder.compressed, false);
    assert.equal(stub.calls, 1);
  });

  it("chat_turn_summaries rows survive compact", async () => {
    seedOverBudgetSummaries({ withOoc: true });
    const before = listMemoryRecordsForChat(CHAT_ID).map((r) => ({
      turnStart: r.turnStart,
      kind: r.summaryKind,
      len: r.charCount,
    }));
    await persistCompactIfNeeded();
    const after = listMemoryRecordsForChat(CHAT_ID).map((r) => ({
      turnStart: r.turnStart,
      kind: r.summaryKind,
      len: r.charCount,
    }));
    assert.deepEqual(after, before);
  });
});
