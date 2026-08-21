import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import Database from "better-sqlite3";
import { describe, it } from "node:test";
import { bootstrapStreamingTurn } from "@/lib/streamingPersistence";
import {
  CURRENT_USER_COAUTHOR_SEMANTICS_VERSION,
  DEFAULT_USER_COAUTHOR_MODE,
  LEGACY_USER_COAUTHOR_SEMANTICS_VERSION,
  ensureUserCoauthorSchema,
  listEligibleUserCoauthorMessageContents,
  markUserMessageCoauthorSemanticsVersion,
  persistUserCoauthorAfterSuccessfulUserInsert,
  persistUserCoauthorMode,
  readUserCoauthorMode,
  readUserCoauthorSemanticsVersion,
  recomputeAndPersistUserCoauthorMode,
  recomputeUserCoauthorModeFromEligibleMessages,
  resolveEffectiveUserAuthoringFromChatColumn,
  resolveEffectiveUserAuthoringForRegeneration,
} from "@/lib/userCoauthorState";

const PUBLIC_FULL_GRANT = "OOC: 내 대사랑 행동도 알아서 써줘.";
const PUBLIC_REVOKE = "OOC: 이제 내 대사나 행동은 쓰지 마.";
const AUDITED_CHAT_735_MESSAGE_SHA256 =
  "9c68cbdf1f51906f06d6bbdfe71d4131861df223e93caf1acc44bdb4f558450c";

function sha(text: string): string {
  return createHash("sha256").update(text, "utf8").digest("hex");
}

function openAuthorityDb(): Database.Database {
  const db = new Database(":memory:");
  db.exec(`
    CREATE TABLE chats (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL DEFAULT 1,
      character_id INTEGER NOT NULL DEFAULT 1
    );
    CREATE TABLE messages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      chat_id INTEGER NOT NULL,
      role TEXT NOT NULL,
      content TEXT NOT NULL DEFAULT '',
      model TEXT NOT NULL DEFAULT '',
      request_id TEXT,
      generation_status TEXT NOT NULL DEFAULT 'completed',
      user_message_id INTEGER,
      alternates TEXT NOT NULL DEFAULT '[]',
      active_variant INTEGER NOT NULL DEFAULT 0,
      deduction_slices TEXT
    );
  `);
  ensureUserCoauthorSchema(db);
  db.prepare("INSERT INTO chats (id) VALUES (1)").run();
  return db;
}

function insertUser(
  db: Database.Database,
  content: string,
  version = CURRENT_USER_COAUTHOR_SEMANTICS_VERSION,
  chatId = 1
): number {
  const info = db
    .prepare("INSERT INTO messages (chat_id, role, content) VALUES (?,?,?)")
    .run(chatId, "user", content);
  const id = Number(info.lastInsertRowid);
  if (version >= CURRENT_USER_COAUTHOR_SEMANTICS_VERSION) {
    markUserMessageCoauthorSemanticsVersion(db, id, version);
  }
  return id;
}

describe("user coauthor authority + semantics epoch", () => {
  it("A — migration defaults chats OFF and existing messages version 0", () => {
    const db = new Database(":memory:");
    db.exec(`
      CREATE TABLE chats (id INTEGER PRIMARY KEY);
      CREATE TABLE messages (id INTEGER PRIMARY KEY, chat_id INTEGER, role TEXT, content TEXT);
      INSERT INTO chats (id) VALUES (735);
      INSERT INTO messages (id, chat_id, role, content) VALUES (3773, 735, 'user', '${PUBLIC_FULL_GRANT}');
    `);
    ensureUserCoauthorSchema(db);
    assert.equal(readUserCoauthorMode(db, 735), "OFF");
    assert.equal(readUserCoauthorSemanticsVersion(db, 3773), LEGACY_USER_COAUTHOR_SEMANTICS_VERSION);
    assert.equal(recomputeAndPersistUserCoauthorMode(db, 735), "OFF");
  });

  it("B — new persistent grant marks version 1 and chat FULL", () => {
    const db = openAuthorityDb();
    const applied = resolveEffectiveUserAuthoringFromChatColumn(db, 1, PUBLIC_FULL_GRANT);
    assert.equal(applied.persistentAfter, "FULL");
    const userId = insertUser(db, PUBLIC_FULL_GRANT, CURRENT_USER_COAUTHOR_SEMANTICS_VERSION);
    persistUserCoauthorMode(db, 1, applied.persistentAfter);
    assert.equal(readUserCoauthorSemanticsVersion(db, userId), 1);
    assert.equal(readUserCoauthorMode(db, 1), "FULL");
  });

  it("C — ordinary next turn reads chat FULL and remains FULL", () => {
    const db = openAuthorityDb();
    persistUserCoauthorMode(db, 1, "FULL");
    insertUser(db, PUBLIC_FULL_GRANT);
    const next = resolveEffectiveUserAuthoringFromChatColumn(db, 1, "고개를 끄덕인다.");
    assert.equal(next.persistentBefore, "FULL");
    assert.equal(next.currentMode, "FULL");
    assert.equal(next.persistentAfter, "FULL");
    persistUserCoauthorMode(db, 1, next.persistentAfter);
    assert.equal(readUserCoauthorMode(db, 1), "FULL");
  });

  it("D — partial revoke updates the column", () => {
    const db = openAuthorityDb();
    persistUserCoauthorMode(db, 1, "FULL");
    const applied = resolveEffectiveUserAuthoringFromChatColumn(db, 1, "OOC: 내 대사는 내가 쓸게.");
    assert.equal(applied.currentMode, "ACTIONS");
    persistUserCoauthorMode(db, 1, applied.persistentAfter);
    assert.equal(readUserCoauthorMode(db, 1), "ACTIONS");
  });

  it("E — full revoke sets OFF", () => {
    const db = openAuthorityDb();
    persistUserCoauthorMode(db, 1, "FULL");
    const applied = resolveEffectiveUserAuthoringFromChatColumn(db, 1, PUBLIC_REVOKE);
    assert.equal(applied.persistentAfter, "OFF");
    persistUserCoauthorMode(db, 1, applied.persistentAfter);
    assert.equal(readUserCoauthorMode(db, 1), "OFF");
  });

  it("F + required legacy regression — version 0 grant is ignored", () => {
    const db = openAuthorityDb();
    insertUser(db, PUBLIC_FULL_GRANT, LEGACY_USER_COAUTHOR_SEMANTICS_VERSION);
    assert.equal(recomputeUserCoauthorModeFromEligibleMessages(db, 1), "OFF");
    const next = resolveEffectiveUserAuthoringFromChatColumn(db, 1, "안녕.");
    assert.equal(next.persistentBefore, "OFF");
    assert.equal(next.currentMode, "OFF");
    assert.equal(next.persistentAfter, "OFF");
  });

  it("required sequence — legacy ignored, then new grant FULL, ordinary stays, revoke OFF", () => {
    const db = openAuthorityDb();
    insertUser(db, PUBLIC_FULL_GRANT, LEGACY_USER_COAUTHOR_SEMANTICS_VERSION);
    assert.equal(readUserCoauthorMode(db, 1), "OFF");

    const grant = resolveEffectiveUserAuthoringFromChatColumn(db, 1, PUBLIC_FULL_GRANT);
    const grantId = insertUser(db, PUBLIC_FULL_GRANT);
    persistUserCoauthorMode(db, 1, grant.persistentAfter);
    assert.equal(readUserCoauthorSemanticsVersion(db, grantId), 1);
    assert.equal(readUserCoauthorMode(db, 1), "FULL");

    const ordinary = resolveEffectiveUserAuthoringFromChatColumn(db, 1, "문을 연다.");
    persistUserCoauthorMode(db, 1, ordinary.persistentAfter);
    assert.equal(ordinary.currentMode, "FULL");
    assert.equal(readUserCoauthorMode(db, 1), "FULL");

    const revoke = resolveEffectiveUserAuthoringFromChatColumn(db, 1, PUBLIC_REVOKE);
    persistUserCoauthorMode(db, 1, revoke.persistentAfter);
    assert.equal(readUserCoauthorMode(db, 1), "OFF");
  });

  it("G — editing a legacy message into an explicit grant marks 1 and FULL", () => {
    const db = openAuthorityDb();
    const id = insertUser(db, "안녕.", LEGACY_USER_COAUTHOR_SEMANTICS_VERSION);
    assert.equal(readUserCoauthorSemanticsVersion(db, id), 0);
    db.prepare("UPDATE messages SET content=? WHERE id=?").run(PUBLIC_FULL_GRANT, id);
    markUserMessageCoauthorSemanticsVersion(db, id);
    assert.equal(recomputeAndPersistUserCoauthorMode(db, 1), "FULL");
    assert.equal(readUserCoauthorSemanticsVersion(db, id), 1);
  });

  it("H — delete new grant recomputes OFF", () => {
    const db = openAuthorityDb();
    const grantId = insertUser(db, PUBLIC_FULL_GRANT);
    persistUserCoauthorMode(db, 1, "FULL");
    insertUser(db, "계속해.");
    db.prepare("DELETE FROM messages WHERE id=?").run(grantId);
    assert.equal(recomputeAndPersistUserCoauthorMode(db, 1), "OFF");
  });

  it("I / F1 — fork of legacy grant history stays OFF", () => {
    const db = openAuthorityDb();
    insertUser(db, PUBLIC_FULL_GRANT, LEGACY_USER_COAUTHOR_SEMANTICS_VERSION);
    db.prepare("INSERT INTO chats (id) VALUES (2)").run();
    db.prepare(
      `INSERT INTO messages (chat_id, role, content, user_coauthor_semantics_version)
       SELECT 2, role, content, user_coauthor_semantics_version FROM messages WHERE chat_id=1`
    ).run();
    assert.equal(recomputeAndPersistUserCoauthorMode(db, 2), "OFF");
  });

  it("J / F2 — fork after new persistent FULL grant is FULL", () => {
    const db = openAuthorityDb();
    insertUser(db, PUBLIC_FULL_GRANT);
    persistUserCoauthorMode(db, 1, "FULL");
    db.prepare("INSERT INTO chats (id) VALUES (2)").run();
    db.prepare(
      `INSERT INTO messages (chat_id, role, content, user_coauthor_semantics_version)
       SELECT 2, role, content, user_coauthor_semantics_version FROM messages WHERE chat_id=1`
    ).run();
    assert.equal(recomputeAndPersistUserCoauthorMode(db, 2), "FULL");
  });

  it("F3 — fork before new persistent grant is OFF", () => {
    const db = openAuthorityDb();
    const ordinaryId = insertUser(db, "안녕.");
    const grantId = insertUser(db, PUBLIC_FULL_GRANT);
    persistUserCoauthorMode(db, 1, "FULL");
    db.prepare("INSERT INTO chats (id) VALUES (2)").run();
    db.prepare(
      `INSERT INTO messages (chat_id, role, content, user_coauthor_semantics_version)
       SELECT 2, role, content, user_coauthor_semantics_version FROM messages WHERE chat_id=1 AND id<=?`
    ).run(ordinaryId);
    assert.notEqual(grantId, ordinaryId);
    assert.equal(recomputeAndPersistUserCoauthorMode(db, 2), "OFF");
  });

  it("F4 — fork after new FULL then revoke is OFF", () => {
    const db = openAuthorityDb();
    insertUser(db, PUBLIC_FULL_GRANT);
    insertUser(db, PUBLIC_REVOKE);
    assert.equal(recomputeAndPersistUserCoauthorMode(db, 1), "OFF");
    db.prepare("INSERT INTO chats (id) VALUES (2)").run();
    db.prepare(
      `INSERT INTO messages (chat_id, role, content, user_coauthor_semantics_version)
       SELECT 2, role, content, user_coauthor_semantics_version FROM messages WHERE chat_id=1`
    ).run();
    assert.equal(recomputeAndPersistUserCoauthorMode(db, 2), "OFF");
  });

  it("K — regeneration does not resurrect a legacy grant", () => {
    const db = openAuthorityDb();
    const legacyId = insertUser(db, PUBLIC_FULL_GRANT, LEGACY_USER_COAUTHOR_SEMANTICS_VERSION);
    persistUserCoauthorMode(db, 1, "OFF");
    const regen = resolveEffectiveUserAuthoringForRegeneration(db, 1, legacyId);
    assert.equal(regen.persistentBefore, "OFF");
    assert.equal(regen.currentMode, "OFF");
    assert.equal(regen.persistentAfter, "OFF");
  });

  it("K — regeneration uses version=1 history up to the parent, not a later column", () => {
    const db = openAuthorityDb();
    const grantId = insertUser(db, PUBLIC_FULL_GRANT);
    const ordinaryId = insertUser(db, "문을 연다.");
    insertUser(db, PUBLIC_REVOKE);
    persistUserCoauthorMode(db, 1, "OFF");
    const regenOrdinary = resolveEffectiveUserAuthoringForRegeneration(db, 1, ordinaryId);
    assert.equal(regenOrdinary.currentMode, "FULL");
    assert.equal(regenOrdinary.persistentAfter, "FULL");
    const regenGrant = resolveEffectiveUserAuthoringForRegeneration(db, 1, grantId);
    assert.equal(regenGrant.currentMode, "FULL");
    const laterRevoke = resolveEffectiveUserAuthoringForRegeneration(
      db,
      1,
      Number(
        (db.prepare("SELECT MAX(id) AS id FROM messages").get() as { id: number }).id
      )
    );
    assert.equal(laterRevoke.currentMode, "OFF");
  });

  it("L — normal POST reads the column and does not replay all history", () => {
    const db = openAuthorityDb();
    insertUser(db, PUBLIC_FULL_GRANT, LEGACY_USER_COAUTHOR_SEMANTICS_VERSION);
    persistUserCoauthorMode(db, 1, "OFF");
    const eligible = listEligibleUserCoauthorMessageContents(db, 1);
    assert.deepEqual(eligible, []);
    const applied = resolveEffectiveUserAuthoringFromChatColumn(db, 1, "안녕.");
    assert.equal(applied.persistentBefore, "OFF");
    assert.equal(applied.currentMode, "OFF");
  });

  it("audited production chat 735 hash stays OFF as version 0", () => {
    assert.equal(AUDITED_CHAT_735_MESSAGE_SHA256.length, 64);
    assert.notEqual(sha(PUBLIC_FULL_GRANT), AUDITED_CHAT_735_MESSAGE_SHA256);
    const db = openAuthorityDb();
    db.prepare("INSERT INTO chats (id) VALUES (735)").run();
    db.prepare(
      "INSERT INTO messages (id, chat_id, role, content) VALUES (3773, 735, 'user', ?)"
    ).run(PUBLIC_FULL_GRANT);
    assert.equal(readUserCoauthorSemanticsVersion(db, 3773), 0);
    assert.equal(recomputeAndPersistUserCoauthorMode(db, 735), "OFF");
    assert.equal(
      resolveEffectiveUserAuthoringFromChatColumn(db, 735, "다음 턴.").persistentAfter,
      "OFF"
    );
  });

  it("USER INSERT FAILS → user_coauthor_mode does not change", () => {
    const db = openAuthorityDb();
    assert.equal(readUserCoauthorMode(db, 1), DEFAULT_USER_COAUTHOR_MODE);
    db.exec(`
      CREATE TRIGGER fail_user_insert BEFORE INSERT ON messages
      WHEN NEW.role = 'user'
      BEGIN
        SELECT RAISE(ABORT, 'USER INSERT FAILS');
      END;
    `);
    const applied = resolveEffectiveUserAuthoringFromChatColumn(db, 1, PUBLIC_FULL_GRANT);
    assert.equal(applied.persistentAfter, "FULL");
    assert.throws(() => {
      bootstrapStreamingTurn(db, {
        chatId: 1,
        requestId: "cr_coauthor_insert_fail",
        userContent: PUBLIC_FULL_GRANT,
        skipUserInsert: false,
        onUserInserted: (userMessageId) => {
          persistUserCoauthorAfterSuccessfulUserInsert(db, {
            chatId: 1,
            userMessageId,
            persistentAfter: applied.persistentAfter,
          });
        },
      });
    });
    assert.equal(readUserCoauthorMode(db, 1), "OFF");
    assert.equal(
      (db.prepare("SELECT COUNT(*) AS n FROM messages WHERE role='user'").get() as { n: number }).n,
      0
    );
  });

  it("USER INSERT SUCCEEDS → state persists without a provider call", () => {
    const db = openAuthorityDb();
    const applied = resolveEffectiveUserAuthoringFromChatColumn(db, 1, PUBLIC_FULL_GRANT);
    const boot = bootstrapStreamingTurn(db, {
      chatId: 1,
      requestId: "cr_coauthor_insert_ok",
      userContent: PUBLIC_FULL_GRANT,
      skipUserInsert: false,
      onUserInserted: (userMessageId) => {
        persistUserCoauthorAfterSuccessfulUserInsert(db, {
          chatId: 1,
          userMessageId,
          persistentAfter: applied.persistentAfter,
        });
      },
    });
    assert.equal(boot.userMessageSaved, true);
    assert.ok(boot.userMessageId != null);
    assert.equal(readUserCoauthorSemanticsVersion(db, boot.userMessageId!), 1);
    assert.equal(readUserCoauthorMode(db, 1), "FULL");
  });

  it("bootstrap marks every new USER message version 1, including unrelated OOC", () => {
    const db = openAuthorityDb();
    const boot = bootstrapStreamingTurn(db, {
      chatId: 1,
      requestId: "cr_coauthor_unrelated",
      userContent: "OOC: 지금 장면은 밤이야.",
      skipUserInsert: false,
    });
    assert.equal(readUserCoauthorSemanticsVersion(db, boot.userMessageId!), 1);
    assert.equal(readUserCoauthorMode(db, 1), "OFF");
  });
});
