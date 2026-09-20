/**
 * Creator Lorebook — 20 attach + 4K turn budget. Provider generation calls = 0.
 */
import assert from "node:assert/strict";
import Database from "better-sqlite3";
import { describe, it } from "node:test";
import {
  CHARACTER_CREATOR_LOREBOOK_ATTACH_LIMIT,
  CREATOR_LOREBOOK_TURN_INJECT_MAX_CHARS,
  applyCreatorLorebookTurnInjectionBudget,
  buildCreatorLorebookPromptBlock,
  clearCreatorLorebookCarryoverForChat,
  dedupeCreatorLorebookMatchesByContent,
  ensureCreatorLorebookSchema,
  loadAttachedCreatorLorebooksPromptBlockFromActivation,
  normalizeCreatorLorebookIds,
  normalizeCreatorLorebookUnit,
  replaceCharacterCreatorLorebookAttachments,
  sortCreatorLorebookMatchesByPriority,
  validateCreatorLorebookAttachmentIds,
  type CreatorLorebookMatch,
} from "@/lib/creatorLorebook";
import {
  buildLorebookActivationText,
  ensureLorebookActiveEntriesTable,
  matchKeywordLorebookEntryDetails,
  parseStoredLorebookEntries,
  serializeLorebookEntries,
} from "@/lib/keywordLorebooks";
import { buildContext } from "@/services/contextBuilder";

const CREATOR = 881001;
const CHARACTER = 881002;
const CHAT = 881003;

function makeDb(): Database.Database {
  const db = new Database(":memory:");
  db.exec(`
    CREATE TABLE keyword_lorebooks (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      creator_id INTEGER NOT NULL,
      name TEXT NOT NULL DEFAULT '',
      summary TEXT NOT NULL DEFAULT '',
      entries_json TEXT NOT NULL DEFAULT '[]',
      scope TEXT NOT NULL DEFAULT 'creator',
      chat_id INTEGER,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE characters (
      id INTEGER PRIMARY KEY,
      name TEXT NOT NULL,
      creator_id INTEGER,
      lorebook_id INTEGER
    );
    CREATE TABLE chats (
      id INTEGER PRIMARY KEY,
      character_id INTEGER NOT NULL
    );
  `);
  ensureLorebookActiveEntriesTable(db);
  ensureCreatorLorebookSchema(db);
  db.prepare(`INSERT INTO characters (id, name) VALUES (?, 'Test Char')`).run(CHARACTER);
  db.prepare(`INSERT INTO chats (id, character_id) VALUES (?, ?)`).run(CHAT, CHARACTER);
  return db;
}

function insertCreatorLorebook(
  db: Database.Database,
  input: { content: string; keywords: string[]; name?: string }
): number {
  const info = db
    .prepare(
      `INSERT INTO keyword_lorebooks (creator_id, name, summary, entries_json, scope)
       VALUES (?, ?, '', ?, 'creator')`
    )
    .run(
      CREATOR,
      input.name ?? "book",
      serializeLorebookEntries([{ keywords: input.keywords, content: input.content }])
    );
  return Number(info.lastInsertRowid);
}

function attach(db: Database.Database, lorebookIds: number[]): void {
  replaceCharacterCreatorLorebookAttachments(db, CHARACTER, lorebookIds);
}

describe("creator lorebook unit model", () => {
  it("accepts single content + keywords", () => {
    const normalized = normalizeCreatorLorebookUnit({
      keywords: "A│B",
      content: "hello",
    });
    assert.equal(normalized.ok, true);
    if (normalized.ok) {
      assert.equal(normalized.entry.content, "hello");
      assert.deepEqual(normalized.entry.keywords, ["A", "B"]);
    }
  });

  it("rejects multi-entry container payload", () => {
    const normalized = normalizeCreatorLorebookUnit({
      entries: [{ keywords: "A", content: "x" }],
    });
    assert.equal(normalized.ok, false);
  });
});

describe("attachment limits", () => {
  it("normalizes deduped lorebook ids", () => {
    assert.deepEqual(normalizeCreatorLorebookIds([3, 3, "4", 0, -1]), [3, 4]);
  });

  it("rejects more than 20 attachments", () => {
    const db = makeDb();
    const ids = Array.from({ length: 21 }, (_, i) => i + 1);
    const result = validateCreatorLorebookAttachmentIds(db, CREATOR, ids);
    assert.equal(result.ok, false);
  });

  it("rejects foreign owner and user_chat scope", () => {
    const db = makeDb();
    const owned = insertCreatorLorebook(db, { content: "x", keywords: ["k"] });
    const foreign = db
      .prepare(
        `INSERT INTO keyword_lorebooks (creator_id, name, summary, entries_json, scope)
         VALUES (999, 'f', '', '[]', 'creator')`
      )
      .run();
    const userChat = db
      .prepare(
        `INSERT INTO keyword_lorebooks (creator_id, name, summary, entries_json, scope, chat_id)
         VALUES (?, 'u', '', '[]', 'user_chat', 1)`
      )
      .run(CREATOR);

    assert.equal(
      validateCreatorLorebookAttachmentIds(db, CREATOR, [owned]).ok,
      true
    );
    assert.equal(
      validateCreatorLorebookAttachmentIds(db, CREATOR, [Number(foreign.lastInsertRowid)]).ok,
      false
    );
    assert.equal(
      validateCreatorLorebookAttachmentIds(db, CREATOR, [Number(userChat.lastInsertRowid)]).ok,
      false
    );
  });
});

describe("turn injection budget", () => {
  it("full-unit-or-skip with exact 4000 boundary", () => {
    const matches: CreatorLorebookMatch[] = [
      { entryKey: "a", content: "a".repeat(3999), keyword: "k", source: "current_user", lorebookId: 1, attachmentPosition: 0 },
      { entryKey: "b", content: "b", keyword: "k", source: "current_user", lorebookId: 2, attachmentPosition: 1 },
    ];
    const selected = applyCreatorLorebookTurnInjectionBudget(matches, 4000);
    assert.equal(selected.length, 1);
    assert.equal(selected[0]!.content.length, 3999);
  });

  it("skips 800-char unit when only 300 remains but later 250 fits", () => {
    const matches: CreatorLorebookMatch[] = [
      { entryKey: "a", content: "a".repeat(3700), keyword: "k", source: "current_user", lorebookId: 1, attachmentPosition: 0 },
      { entryKey: "b", content: "b".repeat(800), keyword: "k", source: "current_user", lorebookId: 2, attachmentPosition: 1 },
      { entryKey: "c", content: "c".repeat(250), keyword: "k", source: "current_user", lorebookId: 3, attachmentPosition: 2 },
    ];
    const selected = applyCreatorLorebookTurnInjectionBudget(matches, 4000);
    assert.equal(selected.length, 2);
    assert.equal(selected[0]!.content.length, 3700);
    assert.equal(selected[1]!.content.length, 250);
  });

  it("dedupes identical content preserving first provenance", () => {
    const matches: CreatorLorebookMatch[] = [
      { entryKey: "a", content: "SAME", keyword: "k1", source: "current_user", lorebookId: 1, attachmentPosition: 0 },
      { entryKey: "b", content: "SAME", keyword: "k2", source: "carryover", lorebookId: 2, attachmentPosition: 1, carryoverTurnsRemaining: 2 },
    ];
    const deduped = dedupeCreatorLorebookMatchesByContent(matches);
    assert.equal(deduped.length, 1);
    assert.equal(deduped[0]!.source, "current_user");
  });
});

describe("priority ordering", () => {
  it("orders current_user before recent_raw before carryover", () => {
    const matches: CreatorLorebookMatch[] = [
      { entryKey: "c", content: "C", keyword: "k", source: "carryover", lorebookId: 3, attachmentPosition: 2 },
      { entryKey: "r", content: "R", keyword: "k", source: "recent_raw", lorebookId: 2, attachmentPosition: 1 },
      { entryKey: "u", content: "U", keyword: "k", source: "current_user", lorebookId: 1, attachmentPosition: 0 },
    ];
    const sorted = sortCreatorLorebookMatchesByPriority(matches);
    assert.deepEqual(sorted.map((m) => m.source), ["current_user", "recent_raw", "carryover"]);
  });
});

describe("20-match stress fixture", () => {
  it("matches 20 x 800 chars but injects <= 4000 with one prompt block", () => {
    const db = makeDb();
    const keyword = "STRESS_KW";
    const lorebookIds: number[] = [];
    for (let i = 0; i < 20; i++) {
      lorebookIds.push(
        insertCreatorLorebook(db, {
          name: `stress-${i}`,
          keywords: [keyword],
          content: `UNIT_${i}_` + "x".repeat(800 - `UNIT_${i}_`.length),
        })
      );
    }
    attach(db, lorebookIds);

    const activation = buildLorebookActivationText({
      currentUserMessage: `trigger ${keyword}`,
    });
    let preBudgetMatchCount = 0;
    for (const lorebookId of lorebookIds) {
      const row = db
        .prepare(`SELECT entries_json FROM keyword_lorebooks WHERE id=?`)
        .get(lorebookId) as { entries_json: string };
      const entry = parseStoredLorebookEntries(row.entries_json)[0];
      if (!entry) continue;
      preBudgetMatchCount += matchKeywordLorebookEntryDetails([entry], activation).length;
    }

    const injectedMatches: CreatorLorebookMatch[] = [];
    const block = loadAttachedCreatorLorebooksPromptBlockFromActivation(db, CHARACTER, activation, {
      chatId: CHAT,
      currentTurn: 1,
      onMatch: (match) => injectedMatches.push(match),
    });

    const matchedChars = lorebookIds.length * 800;
    const injectedChars =
      injectedMatches.reduce((sum, m) => sum + m.content.length, 0) +
      Math.max(0, injectedMatches.length - 1) * 2;

    assert.equal(lorebookIds.length, CHARACTER_CREATOR_LOREBOOK_ATTACH_LIMIT);
    assert.equal(preBudgetMatchCount, 20);
    assert.equal(matchedChars, 16_000);
    assert.ok(injectedChars <= CREATOR_LOREBOOK_TURN_INJECT_MAX_CHARS);
    for (const match of injectedMatches) {
      assert.ok(block.includes(match.content));
    }
    assert.equal(block.match(/\[KEYWORD LOREBOOK/g)?.length ?? 0, 1);

    const built = buildContext({
      charName: "Char",
      chunks: [],
      userNickname: "U",
      keywordLorebookBlock: block,
      shortTermHistory: [],
      currentUserMessage: keyword,
      nsfw: false,
      modelId: "google/gemini-2.5-flash",
      provider: "google",
    });
    assert.ok((built.meta?.trackedSections ?? []).some((s) => s.id === "keyword-lorebook"));
  });
});

describe("TTL attachment filtering", () => {
  it("drops carryover for detached lorebook", () => {
    const db = makeDb();
    const id = insertCreatorLorebook(db, { content: "OLD_BODY", keywords: ["KW"] });
    attach(db, [id]);

    db.prepare(
      `INSERT INTO lorebook_active_entries
         (chat_id, lorebook_id, entry_key, content, keyword, last_source, last_turn, expires_after_turn)
       VALUES (?, ?, 'entry_old', 'OLD_BODY', 'KW', 'recent_raw', 1, 5)`
    ).run(CHAT, id);

    attach(db, []);
    clearCreatorLorebookCarryoverForChat(db, CHAT, id);

    const activation = buildLorebookActivationText({ currentUserMessage: "" });
    const block = loadAttachedCreatorLorebooksPromptBlockFromActivation(db, CHARACTER, activation, {
      chatId: CHAT,
      currentTurn: 2,
    });
    assert.equal(block, "");
  });
});

describe("prompt block owner", () => {
  it("renders one creator block", () => {
    const block = buildCreatorLorebookPromptBlock(["A", "B"]);
    assert.match(block, /^\[KEYWORD LOREBOOK/);
    assert.match(block, /A\n\nB/);
  });
});

describe("input pressure regression", () => {
  it("blocks 16K matched creator path from exceeding 4K injected in buildContext", () => {
    const db = makeDb();
    const keyword = "PRESSURE_KW";
    const lorebookIds: number[] = [];
    for (let i = 0; i < 20; i++) {
      lorebookIds.push(
        insertCreatorLorebook(db, {
          name: `pressure-${i}`,
          keywords: [keyword],
          content: `P${i}_` + "z".repeat(800 - `P${i}_`.length),
        })
      );
    }
    attach(db, lorebookIds);
    const activation = buildLorebookActivationText({
      currentUserMessage: keyword,
    });
    const block = loadAttachedCreatorLorebooksPromptBlockFromActivation(db, CHARACTER, activation, {
      chatId: CHAT,
      currentTurn: 1,
    });
    const built = buildContext({
      charName: "Char",
      chunks: [],
      userNickname: "U",
      keywordLorebookBlock: block,
      shortTermHistory: [],
      currentUserMessage: keyword,
      nsfw: false,
      modelId: "google/gemini-2.5-flash",
      provider: "google",
    });
    const injectedBody = block.replace(/^\[[^\]]+\]\n?/, "");
    assert.ok(injectedBody.length <= CREATOR_LOREBOOK_TURN_INJECT_MAX_CHARS);
    assert.ok((built.estimatedInputTokens ?? 0) < 115_000);
  });
});
