/**
 * PR #980 correction pass — zero provider calls.
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
import { after, before, beforeEach, describe, it } from "node:test";
import { getDb } from "@/lib/db";
import {
  installIsolatedTestDatabase,
  uninstallIsolatedTestDatabase,
} from "@/lib/test/isolatedTestDatabase";
import {
  buildLorebookActivationText,
  loadKeywordLorebookPromptBlockFromActivation,
} from "@/lib/keywordLorebooks";
import {
  FREE_CAPABILITY,
  SUBSCRIBED_CAPABILITY,
} from "@/lib/subscriptionMemoryCapability";
import {
  createUserNotePreset,
  listUserNotePresets,
  updateUserNotePreset,
} from "@/lib/userNotePresets";
import {
  getOrCreateUserLorebookForChat,
  loadUserLorebookPromptBlockFromActivation,
  normalizeUserLorebookEntries,
  saveUserLorebookEntries,
  type UserLorebookStoredEntry,
} from "@/lib/userLorebook";

const USER = 992001;
const CHAT = 992002;
const CHAR = 992003;
const CREATOR_LOREBOOK = 992004;
const USER_CHAT_LOREBOOK = 992005;

function seed(): void {
  const db = getDb();
  db.prepare(`DELETE FROM _schema_flags WHERE key='user_note_reference_zone_cleanup_v1'`).run();
  db.prepare("DELETE FROM lorebook_active_entries WHERE chat_id=?").run(CHAT);
  db.prepare("DELETE FROM keyword_lorebooks WHERE creator_id=? OR chat_id=? OR id=?").run(
    USER,
    CHAT,
    USER_CHAT_LOREBOOK
  );
  db.prepare("DELETE FROM user_note_presets WHERE user_id=?").run(USER);
  db.prepare("DELETE FROM chats WHERE id=?").run(CHAT);
  db.prepare("DELETE FROM users WHERE id=?").run(USER);
  db.prepare("DELETE FROM characters WHERE id=?").run(CHAR);

  db.prepare(
    `INSERT INTO users (id, email, nickname, pw_hash, sub_until, sub_plan) VALUES (?,?,?,?,?,?)`
  ).run(USER, `ulc-${USER}@test.local`, "ulc-user", "x", null, null);
  db.prepare(`INSERT INTO characters (id, name, lorebook_id) VALUES (?,?,?)`).run(
    CHAR,
    "Char",
    CREATOR_LOREBOOK
  );
  db.prepare(`INSERT INTO chats (id, user_id, character_id, mode, user_note) VALUES (?,?,?,'safe','')`).run(
    CHAT,
    USER,
    CHAR
  );
  db.prepare(
    `INSERT INTO keyword_lorebooks (id, creator_id, name, summary, entries_json, scope)
     VALUES (?, ?, 'creator', '', ?, 'creator')`
  ).run(CREATOR_LOREBOOK, USER, JSON.stringify([{ keywords: ["C"], content: "CREATOR" }]));
  db.prepare(
    `INSERT INTO keyword_lorebooks (id, creator_id, name, summary, entries_json, scope, chat_id)
     VALUES (?, ?, 'user book', '', ?, 'user_chat', ?)`
  ).run(
    USER_CHAT_LOREBOOK,
    USER,
    JSON.stringify([{ keywords: ["U"], content: "USER_PRIVATE" }]),
    CHAT
  );
  db.prepare(`UPDATE chats SET user_lorebook_id=? WHERE id=?`).run(USER_CHAT_LOREBOOK, CHAT);
}

before(() => installIsolatedTestDatabase());
after(() => uninstallIsolatedTestDatabase());
beforeEach(seed);

describe("Creator/User lorebook API scope isolation", () => {
  it("creator-scope row lookup rejects user_chat id", () => {
    const db = getDb();
    const row = db
      .prepare(
        `SELECT id FROM keyword_lorebooks
         WHERE id = ? AND creator_id = ? AND COALESCE(scope, 'creator') = 'creator'`
      )
      .get(USER_CHAT_LOREBOOK, USER);
    assert.equal(row, undefined);
  });

  it("creator DELETE does not remove user_chat row", () => {
    const db = getDb();
    const info = db
      .prepare(
        `DELETE FROM keyword_lorebooks
         WHERE id = ? AND creator_id = ? AND COALESCE(scope, 'creator') = 'creator'`
      )
      .run(USER_CHAT_LOREBOOK, USER);
    assert.equal(info.changes, 0);
    const still = db.prepare(`SELECT id FROM keyword_lorebooks WHERE id=?`).get(USER_CHAT_LOREBOOK);
    assert.ok(still);
  });
});

describe("User Lorebook normalization enabled index", () => {
  it("preserves enabled flags when blank rows are skipped", () => {
    const normalized = normalizeUserLorebookEntries([
      { keywords: "A", content: "first", enabled: true },
      { keywords: "", content: "", enabled: false },
      { keywords: "B", content: "third", enabled: true },
    ]);
    assert.equal(normalized.ok, true);
    if (!normalized.ok) return;
    assert.equal(normalized.entries.length, 2);
    assert.equal(normalized.entries[0]?.enabled, true);
    assert.equal(normalized.entries[1]?.enabled, true);
  });
});

describe("User Lorebook carryover eligibility", () => {
  it("drops paid #20 carryover after downgrade to Free effective set", () => {
    const db = getDb();
    const userBook = getOrCreateUserLorebookForChat(db, CHAT, USER);
    const entries: UserLorebookStoredEntry[] = Array.from({ length: 20 }, (_, i) => ({
      keywords: [`K${i}`],
      content: `BODY_${i}`,
      enabled: true,
    }));
    saveUserLorebookEntries(db, CHAT, USER, entries);
    const activation = buildLorebookActivationText({ currentUserMessage: "K19" });
    loadUserLorebookPromptBlockFromActivation(db, {
      chatId: CHAT,
      userId: USER,
      capability: SUBSCRIBED_CAPABILITY,
      activation,
      currentTurn: 5,
    });
    const afterDowngrade = loadUserLorebookPromptBlockFromActivation(db, {
      chatId: CHAT,
      userId: USER,
      capability: FREE_CAPABILITY,
      activation,
      currentTurn: 6,
    });
    assert.doesNotMatch(afterDowngrade, /BODY_19/);
    void userBook;
  });
});

describe("User Lorebook save clears stale carryover", () => {
  it("edit content removes old TTL injection on next turn", () => {
    const db = getDb();
    saveUserLorebookEntries(db, CHAT, USER, [
      { keywords: ["HIT"], content: "OLD_BODY", enabled: true },
    ]);
    const activation = buildLorebookActivationText({ currentUserMessage: "HIT" });
    loadUserLorebookPromptBlockFromActivation(db, {
      chatId: CHAT,
      userId: USER,
      capability: FREE_CAPABILITY,
      activation,
      currentTurn: 2,
    });
    saveUserLorebookEntries(db, CHAT, USER, [
      { keywords: ["HIT"], content: "NEW_BODY", enabled: true },
    ]);
    const next = loadUserLorebookPromptBlockFromActivation(db, {
      chatId: CHAT,
      userId: USER,
      capability: FREE_CAPABILITY,
      activation,
      currentTurn: 3,
    });
    assert.doesNotMatch(next, /OLD_BODY/);
    assert.match(next, /NEW_BODY/);
  });
});

describe("multiline creator-wins dedupe", () => {
  it("uses match.content not rendered block splitting", () => {
    const db = getDb();
    const multiline = "paragraph A\n\nparagraph B";
    db.prepare(`UPDATE keyword_lorebooks SET entries_json=? WHERE id=?`).run(
      JSON.stringify([{ keywords: ["ML"], content: multiline }]),
      CREATOR_LOREBOOK
    );
    saveUserLorebookEntries(db, CHAT, USER, [
      { keywords: ["ML"], content: multiline, enabled: true },
    ]);
    const activation = buildLorebookActivationText({ currentUserMessage: "hello ML" });
    const creatorExclude = new Set<string>();
    loadKeywordLorebookPromptBlockFromActivation(db, CREATOR_LOREBOOK, activation, {
      chatId: CHAT,
      currentTurn: 1,
      onMatch: (match) => creatorExclude.add(match.content.trim()),
    });
    const userBlock = loadUserLorebookPromptBlockFromActivation(db, {
      chatId: CHAT,
      userId: USER,
      capability: FREE_CAPABILITY,
      activation,
      currentTurn: 1,
      excludeContents: creatorExclude,
    });
    assert.equal(userBlock, "");
    assert.equal(creatorExclude.size, 1);
    assert.ok(creatorExclude.has(multiline));
  });
});

describe("paid Focus preset 2K", () => {
  it("stores and lists 1700 chars without 1K truncation", () => {
    const content = "P".repeat(1700);
    const created = createUserNotePreset(USER, "paid preset", content, 2000);
    assert.ok(created);
    assert.equal(created!.content.length, 1700);
    const listed = listUserNotePresets(USER);
    assert.equal(listed[0]?.content.length, 1700);
    const updated = updateUserNotePreset(USER, created!.id, { content: "Q".repeat(2001) }, 2000);
    assert.equal(updated, null);
    const still = listUserNotePresets(USER)[0];
    assert.equal(still?.content.length, 1700);
  });

  it("rejects save over Free cap without truncating stored preset", () => {
    const content = "R".repeat(1700);
    const created = createUserNotePreset(USER, "downgrade preset", content, 2000);
    assert.ok(created);
    const rejected = updateUserNotePreset(USER, created!.id, { content }, 1000);
    assert.equal(rejected, null);
    assert.equal(listUserNotePresets(USER)[0]?.content.length, 1700);
  });
});

describe("one user lorebook per chat", () => {
  it("getOrCreate reuses existing user_chat row by chat_id", () => {
    const db = getDb();
    db.prepare(`UPDATE chats SET user_lorebook_id=NULL WHERE id=?`).run(CHAT);
    const row = getOrCreateUserLorebookForChat(db, CHAT, USER);
    assert.equal(row.id, USER_CHAT_LOREBOOK);
    const count = db
      .prepare(`SELECT COUNT(*) AS c FROM keyword_lorebooks WHERE scope='user_chat' AND chat_id=?`)
      .get(CHAT) as { c: number };
    assert.equal(count.c, 1);
  });
});
