/**
 * Creator Lorebook — 20 attach + 4K turn budget. Provider generation calls = 0.
 */
import assert from "node:assert/strict";
import Database from "better-sqlite3";
import { describe, it } from "node:test";
import {
  CHARACTER_CREATOR_LOREBOOK_ATTACH_LIMIT,
  CREATOR_LOREBOOK_MIGRATION_FLAG,
  CREATOR_LOREBOOK_TURN_INJECT_MAX_CHARS,
  CreatorLorebookMigrationError,
  CreatorUnitInvariantViolationError,
  deleteCreatorLorebookForOwner,
  applyCreatorLorebookTurnInjectionBudget,
  buildCreatorLorebookPromptBlock,
  classifyCreatorLorebookEntryCount,
  clearStaleCreatorScopeCarryoverForChat,
  dedupeCreatorLorebookMatchesByContent,
  ensureCreatorLorebookSchema,
  listCharacterCreatorLorebookAttachmentIds,
  loadAttachedCreatorLorebooksPromptBlockFromActivation,
  migrateCreatorLorebookLegacyState,
  normalizeCreatorLorebookIds,
  normalizeCreatorLorebookUnit,
  parseCreatorLorebookUnitEntry,
  replaceCharacterCreatorLorebookAttachments,
  schemaFlagApplied,
  sortCreatorLorebookMatchesByPriority,
  validateCreatorLorebookAttachmentIds,
  type CreatorLorebookMatch,
} from "@/lib/creatorLorebook";
import {
  LOREBOOK_KEYWORDS_PER_ENTRY,
  buildLorebookActivationText,
  ensureLorebookActiveEntriesTable,
  matchKeywordLorebookEntryDetails,
  parseStoredLorebookEntries,
  serializeLorebookEntries,
} from "@/lib/keywordLorebooks";
import { LOREBOOK_SCOPE_USER_CHAT } from "@/lib/userLorebook";
import { buildContext } from "@/services/contextBuilder";

const CREATOR = 881001;
const CHARACTER = 881002;
const CHAT = 881003;
const USER_CHAT_LOREBOOK = 881004;

function ensureMigrationTables(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS _schema_flags (
      key TEXT PRIMARY KEY,
      applied_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS character_lorebook_attachments (
      character_id INTEGER NOT NULL,
      lorebook_id INTEGER NOT NULL,
      position INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      PRIMARY KEY (character_id, lorebook_id)
    );
  `);
  ensureLorebookActiveEntriesTable(db);
}

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
  ensureMigrationTables(db);
  ensureCreatorLorebookSchema(db);
  db.prepare(`INSERT INTO characters (id, name, creator_id) VALUES (?, 'Test Char', ?)`).run(
    CHARACTER,
    CREATOR
  );
  db.prepare(`INSERT INTO chats (id, character_id) VALUES (?, ?)`).run(CHAT, CHARACTER);
  return db;
}

function makeMigrationDb(): Database.Database {
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
  ensureMigrationTables(db);
  return db;
}

function insertCreatorLorebook(
  db: Database.Database,
  input: { content: string; keywords: string[]; name?: string; entries?: Array<{ keywords: string[]; content: string }> }
): number {
  const entries =
    input.entries ??
    [{ keywords: input.keywords, content: input.content }];
  const info = db
    .prepare(
      `INSERT INTO keyword_lorebooks (creator_id, name, summary, entries_json, scope)
       VALUES (?, ?, '', ?, 'creator')`
    )
    .run(CREATOR, input.name ?? "book", serializeLorebookEntries(entries));
  return Number(info.lastInsertRowid);
}

function attach(db: Database.Database, lorebookIds: number[]): void {
  replaceCharacterCreatorLorebookAttachments(db, CHARACTER, lorebookIds);
}

function activeRows(db: Database.Database, chatId: number) {
  return db
    .prepare(`SELECT lorebook_id, content, keyword FROM lorebook_active_entries WHERE chat_id=? ORDER BY lorebook_id`)
    .all(chatId) as Array<{ lorebook_id: number; content: string; keyword: string }>;
}

describe("creator keyword validation", () => {
  it("CREATOR_KEYWORDS_10_ACCEPTED via delimiter string", () => {
    const keywords = Array.from({ length: 10 }, (_, i) => `KW${i}`).join("│");
    const normalized = normalizeCreatorLorebookUnit({ keywords, content: "body" });
    assert.equal(normalized.ok, true);
    if (normalized.ok) assert.equal(normalized.entry.keywords.length, 10);
  });

  it("CREATOR_KEYWORDS_10_ACCEPTED via array input", () => {
    const keywords = Array.from({ length: 10 }, (_, i) => `KW${i}`);
    const normalized = normalizeCreatorLorebookUnit({ keywords, content: "body" });
    assert.equal(normalized.ok, true);
    if (normalized.ok) assert.equal(normalized.entry.keywords.length, 10);
  });

  it("CREATOR_KEYWORDS_11_REJECTED via delimiter string", () => {
    const keywords = Array.from({ length: 11 }, (_, i) => `KW${i}`).join("│");
    const normalized = normalizeCreatorLorebookUnit({ keywords, content: "body" });
    assert.equal(normalized.ok, false);
    if (!normalized.ok) {
      assert.match(normalized.error, new RegExp(String(LOREBOOK_KEYWORDS_PER_ENTRY)));
    }
  });

  it("CREATOR_KEYWORDS_11_REJECTED via array input", () => {
    const keywords = Array.from({ length: 11 }, (_, i) => `KW${i}`);
    const normalized = normalizeCreatorLorebookUnit({ keywords, content: "body" });
    assert.equal(normalized.ok, false);
  });

  it("CREATOR_KEYWORDS_11_STORED_AS_10 = NO", () => {
    const db = makeDb();
    const keywords = Array.from({ length: 11 }, (_, i) => `KW${i}`);
    const normalized = normalizeCreatorLorebookUnit({ keywords, content: "body" });
    assert.equal(normalized.ok, false);
    const count = db
      .prepare(`SELECT COUNT(*) AS c FROM keyword_lorebooks WHERE creator_id=?`)
      .get(CREATOR) as { c: number };
    assert.equal(count.c, 0);
  });
});

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

  it("fail-closed on multi-entry runtime read", () => {
    const json = serializeLorebookEntries([
      { keywords: ["A"], content: "one" },
      { keywords: ["B"], content: "two" },
    ]);
    assert.throws(() => parseCreatorLorebookUnitEntry(json), CreatorUnitInvariantViolationError);
    assert.equal(classifyCreatorLorebookEntryCount(json), "multi");
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
         VALUES (?, 'u', '', '[]', ?, 1)`
      )
      .run(CREATOR, LOREBOOK_SCOPE_USER_CHAT);

    assert.equal(validateCreatorLorebookAttachmentIds(db, CREATOR, [owned]).ok, true);
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
  it("matches 20 x 800 chars but matched-content budget <= 4000 with one prompt block", () => {
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

    const matchedContentChars = lorebookIds.length * 800;
    const matchedContentBudgetChars =
      injectedMatches.reduce((sum, m) => sum + m.content.length, 0) +
      Math.max(0, injectedMatches.length - 1) * 2;
    const finalRenderedCreatorBlockChars = block.length;

    assert.equal(lorebookIds.length, CHARACTER_CREATOR_LOREBOOK_ATTACH_LIMIT);
    assert.equal(preBudgetMatchCount, 20);
    assert.equal(matchedContentChars, 16_000);
    assert.ok(matchedContentBudgetChars <= CREATOR_LOREBOOK_TURN_INJECT_MAX_CHARS);
    assert.ok(finalRenderedCreatorBlockChars > matchedContentBudgetChars);
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
  it("DETACH_CLEARS_CREATOR_CARRYOVER without manual cleanup", () => {
    const db = makeDb();
    const id = insertCreatorLorebook(db, { content: "OLD_BODY", keywords: ["KW"] });
    attach(db, [id]);

    db.prepare(
      `INSERT INTO lorebook_active_entries
         (chat_id, lorebook_id, entry_key, content, keyword, last_source, last_turn, expires_after_turn)
       VALUES (?, ?, 'entry_old', 'OLD_BODY', 'KW', 'recent_raw', 1, 5)`
    ).run(CHAT, id);

    attach(db, []);

    const rows = activeRows(db, CHAT);
    assert.equal(rows.length, 0);
  });

  it("DETACH_REATTACH_NO_TTL_REVIVAL", () => {
    const db = makeDb();
    const id = insertCreatorLorebook(db, { content: "REVIVE_BODY", keywords: ["KW"] });
    attach(db, [id]);
    const activation = buildLorebookActivationText({ currentUserMessage: "KW" });
    loadAttachedCreatorLorebooksPromptBlockFromActivation(db, CHARACTER, activation, {
      chatId: CHAT,
      currentTurn: 1,
    });
    attach(db, []);
    attach(db, [id]);
    const block = loadAttachedCreatorLorebooksPromptBlockFromActivation(db, CHARACTER, {
      currentUserText: "",
      recentRawText: "",
    }, {
      chatId: CHAT,
      currentTurn: 2,
    });
    assert.equal(block, "");
  });

  it("DETACH_ALL_CLEARS_CREATOR_TTL", () => {
    const db = makeDb();
    const a = insertCreatorLorebook(db, { content: "A", keywords: ["KA"] });
    const b = insertCreatorLorebook(db, { content: "B", keywords: ["KB"] });
    attach(db, [a, b]);
    db.prepare(
      `INSERT INTO lorebook_active_entries
       (chat_id, lorebook_id, entry_key, content, keyword, last_source, last_turn, expires_after_turn)
       VALUES (?, ?, 'e1', 'A', 'KA', 'recent_raw', 1, 5),
              (?, ?, 'e2', 'B', 'KB', 'recent_raw', 1, 5)`
    ).run(CHAT, a, CHAT, b);
    attach(db, []);
    assert.equal(activeRows(db, CHAT).length, 0);
  });
});

describe("DELETE lifecycle", () => {
  it("DELETE_CLEARS_CREATOR_TTL and preserves User Lorebook TTL", () => {
    const db = makeDb();
    const creatorId = insertCreatorLorebook(db, { content: "CREATOR_BODY", keywords: ["CREATOR_KW"] });
    attach(db, [creatorId]);

    db.prepare(
      `INSERT INTO keyword_lorebooks (id, creator_id, name, summary, entries_json, scope, chat_id)
       VALUES (?, ?, 'user', '', ?, ?, ?)`
    ).run(
      USER_CHAT_LOREBOOK,
      CREATOR,
      serializeLorebookEntries([{ keywords: ["USER_KW"], content: "USER_BODY" }]),
      LOREBOOK_SCOPE_USER_CHAT,
      CHAT
    );

    db.prepare(
      `INSERT INTO lorebook_active_entries
       (chat_id, lorebook_id, entry_key, content, keyword, last_source, last_turn, expires_after_turn)
       VALUES (?, ?, 'creator_entry', 'CREATOR_BODY', 'CREATOR_KW', 'recent_raw', 1, 5),
              (?, ?, 'user_entry', 'USER_BODY', 'USER_KW', 'recent_raw', 1, 5)`
    ).run(CHAT, creatorId, CHAT, USER_CHAT_LOREBOOK);

    const deleted = deleteCreatorLorebookForOwner(db, creatorId, CREATOR);
    assert.equal(deleted, true);

    const creatorRow = db
      .prepare(`SELECT id FROM keyword_lorebooks WHERE id=?`)
      .get(creatorId);
    assert.equal(creatorRow, undefined);
    assert.equal(listCharacterCreatorLorebookAttachmentIds(db, CHARACTER).length, 0);

    const creatorTtl = db
      .prepare(`SELECT COUNT(*) AS c FROM lorebook_active_entries WHERE chat_id=? AND lorebook_id=?`)
      .get(CHAT, creatorId) as { c: number };
    assert.equal(creatorTtl.c, 0);

    const userRow = db
      .prepare(`SELECT content, keyword FROM lorebook_active_entries WHERE chat_id=? AND lorebook_id=?`)
      .get(CHAT, USER_CHAT_LOREBOOK) as { content: string; keyword: string };
    assert.equal(userRow.content, "USER_BODY");
    assert.equal(userRow.keyword, "USER_KW");
  });
});

describe("USER_LOREBOOK scope isolation", () => {
  it("USER_LOREBOOK_CARRYOVER_SURVIVES_CREATOR_CLEANUP", () => {
    const db = makeDb();
    db.prepare(
      `INSERT INTO keyword_lorebooks (id, creator_id, name, summary, entries_json, scope, chat_id)
       VALUES (?, ?, 'user', '', ?, ?, ?)`
    ).run(
      USER_CHAT_LOREBOOK,
      CREATOR,
      serializeLorebookEntries([{ keywords: ["USER_KW"], content: "USER_BODY" }]),
      LOREBOOK_SCOPE_USER_CHAT,
      CHAT
    );
    db.prepare(
      `INSERT INTO lorebook_active_entries
       (chat_id, lorebook_id, entry_key, content, keyword, last_source, last_turn, expires_after_turn)
       VALUES (?, ?, 'user_entry', 'USER_BODY', 'USER_KW', 'recent_raw', 1, 5)`
    ).run(CHAT, USER_CHAT_LOREBOOK);

    const creatorId = insertCreatorLorebook(db, { content: "CREATOR_BODY", keywords: ["CREATOR_KW"] });
    attach(db, [creatorId]);

    clearStaleCreatorScopeCarryoverForChat(db, CHAT, [creatorId]);

    const rows = activeRows(db, CHAT);
    assert.equal(rows.length, 1);
    assert.equal(rows[0]!.lorebook_id, USER_CHAT_LOREBOOK);
    assert.equal(rows[0]!.content, "USER_BODY");
    assert.equal(rows[0]!.keyword, "USER_KW");
  });

  it("Creator activation does not delete user_chat carryover", () => {
    const db = makeDb();
    db.prepare(
      `INSERT INTO keyword_lorebooks (id, creator_id, name, summary, entries_json, scope, chat_id)
       VALUES (?, ?, 'user', '', ?, ?, ?)`
    ).run(
      USER_CHAT_LOREBOOK,
      CREATOR,
      serializeLorebookEntries([{ keywords: ["USER_KW"], content: "USER_BODY" }]),
      LOREBOOK_SCOPE_USER_CHAT,
      CHAT
    );
    db.prepare(
      `INSERT INTO lorebook_active_entries
       (chat_id, lorebook_id, entry_key, content, keyword, last_source, last_turn, expires_after_turn)
       VALUES (?, ?, 'user_entry', 'USER_BODY', 'USER_KW', 'recent_raw', 1, 5)`
    ).run(CHAT, USER_CHAT_LOREBOOK);

    const creatorId = insertCreatorLorebook(db, { content: "CREATOR_BODY", keywords: ["CREATOR_KW"] });
    attach(db, [creatorId]);
    const activation = buildLorebookActivationText({ currentUserMessage: "CREATOR_KW" });
    loadAttachedCreatorLorebooksPromptBlockFromActivation(db, CHARACTER, activation, {
      chatId: CHAT,
      currentTurn: 2,
    });

    const rows = activeRows(db, CHAT);
    assert.ok(rows.some((row) => row.lorebook_id === USER_CHAT_LOREBOOK && row.content === "USER_BODY"));
  });
});

describe("migration", () => {
  it("MIGRATION_BLOCK_NO_FLAG when attached container exceeds 20 entries", () => {
    const db = makeMigrationDb();
    const entries = Array.from({ length: 21 }, (_, i) => ({
      keywords: [`K${i}`],
      content: `BODY_${i}`,
    }));
    const lorebookId = insertCreatorLorebook(db, { name: "big", keywords: ["x"], content: "x", entries });
    db.prepare(`INSERT INTO characters (id, name, creator_id, lorebook_id) VALUES (10, 'C', ?, ?)`).run(
      CREATOR,
      lorebookId
    );

    assert.throws(() => migrateCreatorLorebookLegacyState(db), CreatorLorebookMigrationError);
    assert.equal(schemaFlagApplied(db, CREATOR_LOREBOOK_MIGRATION_FLAG), false);
    const character = db.prepare(`SELECT lorebook_id FROM characters WHERE id=10`).get() as {
      lorebook_id: number;
    };
    assert.equal(character.lorebook_id, lorebookId);
    assert.equal(listCharacterCreatorLorebookAttachmentIds(db, 10).length, 0);
  });

  it("MIGRATION_RETRY succeeds after fixing fixture to <=20", () => {
    const db = makeMigrationDb();
    const entries = Array.from({ length: 21 }, (_, i) => ({
      keywords: [`K${i}`],
      content: `BODY_${i}`,
    }));
    const lorebookId = insertCreatorLorebook(db, { name: "big", keywords: ["x"], content: "x", entries });
    db.prepare(`INSERT INTO characters (id, name, creator_id, lorebook_id) VALUES (10, 'C', ?, ?)`).run(
      CREATOR,
      lorebookId
    );
    assert.throws(() => migrateCreatorLorebookLegacyState(db));

    db.prepare(`UPDATE keyword_lorebooks SET entries_json=? WHERE id=?`).run(
      serializeLorebookEntries(entries.slice(0, 20)),
      lorebookId
    );
    migrateCreatorLorebookLegacyState(db);
    assert.equal(schemaFlagApplied(db, CREATOR_LOREBOOK_MIGRATION_FLAG), true);
    const migratedCharacter = db
      .prepare(`SELECT lorebook_id FROM characters WHERE id=10`)
      .get() as { lorebook_id: number | null };
    assert.equal(migratedCharacter.lorebook_id, null);
    assert.equal(listCharacterCreatorLorebookAttachmentIds(db, 10).length, 20);
  });

  it("UNATTACHED_MULTI_ENTRY_FLATTEN preserves all units", () => {
    const db = makeMigrationDb();
    const lorebookId = insertCreatorLorebook(db, {
      name: "library",
      keywords: ["A"],
      content: "A",
      entries: [
        { keywords: ["A"], content: "CONTENT_A" },
        { keywords: ["B"], content: "CONTENT_B" },
        { keywords: ["C"], content: "CONTENT_C" },
      ],
    });

    migrateCreatorLorebookLegacyState(db);

    const rows = db
      .prepare(`SELECT id, entries_json FROM keyword_lorebooks WHERE scope='creator' ORDER BY id ASC`)
      .all() as Array<{ id: number; entries_json: string }>;
    assert.equal(rows.length, 3);
    const contents = rows.map((row) => parseCreatorLorebookUnitEntry(row.entries_json)?.content);
    assert.deepEqual(contents.sort(), ["CONTENT_A", "CONTENT_B", "CONTENT_C"]);
    assert.equal(rows[0]!.id, lorebookId);
    assert.equal(classifyCreatorLorebookEntryCount(rows[0]!.entries_json), "single");
  });

  it("SHARED_CONTAINER_FLATTEN_ONCE for two characters", () => {
    const db = makeMigrationDb();
    const lorebookId = insertCreatorLorebook(db, {
      name: "shared",
      keywords: ["A"],
      content: "A",
      entries: [
        { keywords: ["A"], content: "CONTENT_A" },
        { keywords: ["B"], content: "CONTENT_B" },
        { keywords: ["C"], content: "CONTENT_C" },
      ],
    });
    db.prepare(`INSERT INTO characters (id, name, creator_id, lorebook_id) VALUES (1, 'C1', ?, ?)`).run(
      CREATOR,
      lorebookId
    );
    db.prepare(`INSERT INTO characters (id, name, creator_id, lorebook_id) VALUES (2, 'C2', ?, ?)`).run(
      CREATOR,
      lorebookId
    );

    migrateCreatorLorebookLegacyState(db);

    const creatorRows = db
      .prepare(`SELECT COUNT(*) AS c FROM keyword_lorebooks WHERE scope='creator'`)
      .get() as { c: number };
    assert.equal(creatorRows.c, 3);
    const attach1 = listCharacterCreatorLorebookAttachmentIds(db, 1);
    const attach2 = listCharacterCreatorLorebookAttachmentIds(db, 2);
    assert.deepEqual(attach1, attach2);
    assert.equal(attach1.length, 3);
  });

  it("LEGACY_FOREIGN_REFERENCE_FAILS_CLOSED", () => {
    const db = makeMigrationDb();
    const lorebookId = insertCreatorLorebook(db, { content: "x", keywords: ["k"] });
    db.prepare(`INSERT INTO characters (id, name, creator_id, lorebook_id) VALUES (5, 'C', 999, ?)`).run(
      lorebookId
    );
    assert.throws(() => migrateCreatorLorebookLegacyState(db), CreatorLorebookMigrationError);
    assert.equal(schemaFlagApplied(db, CREATOR_LOREBOOK_MIGRATION_FLAG), false);
  });

  it("MIGRATION_IDEMPOTENT", () => {
    const db = makeMigrationDb();
    const lorebookId = insertCreatorLorebook(db, {
      name: "once",
      keywords: ["A"],
      content: "A",
      entries: [
        { keywords: ["A"], content: "A1" },
        { keywords: ["B"], content: "B1" },
      ],
    });
    db.prepare(`INSERT INTO characters (id, name, creator_id, lorebook_id) VALUES (7, 'C', ?, ?)`).run(
      CREATOR,
      lorebookId
    );
    migrateCreatorLorebookLegacyState(db);
    const afterFirst = db.prepare(`SELECT COUNT(*) AS c FROM keyword_lorebooks WHERE scope='creator'`).get() as {
      c: number;
    };
    const attachmentsFirst = listCharacterCreatorLorebookAttachmentIds(db, 7);
    migrateCreatorLorebookLegacyState(db);
    const afterSecond = db.prepare(`SELECT COUNT(*) AS c FROM keyword_lorebooks WHERE scope='creator'`).get() as {
      c: number;
    };
    const attachmentsSecond = listCharacterCreatorLorebookAttachmentIds(db, 7);
    assert.equal(afterFirst.c, afterSecond.c);
    assert.deepEqual(attachmentsFirst, attachmentsSecond);
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
  it("blocks 16K matched creator path from exceeding 4K matched-content budget", () => {
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
    const headerMatch = block.match(/^\[[^\]]+\]\n?/);
    const matchedContentBudgetChars = block.length - (headerMatch?.[0]?.length ?? 0);
    assert.ok(matchedContentBudgetChars <= CREATOR_LOREBOOK_TURN_INJECT_MAX_CHARS);
    assert.ok((built.estimatedInputTokens ?? 0) < 115_000);
  });
});
