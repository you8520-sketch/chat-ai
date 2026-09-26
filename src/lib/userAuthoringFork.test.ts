import assert from "node:assert/strict";
import Database from "better-sqlite3";
import { describe, it } from "node:test";
import { insertForkChatRow } from "@/lib/chatForkCreate";
import {
  CURRENT_USER_COAUTHOR_SEMANTICS_VERSION,
  ensureUserCoauthorSchema,
  markUserMessageCoauthorSemanticsVersion,
  readUserAuthoringLevel,
  readUserCoauthorMode,
  recomputeAndPersistUserCoauthorMode,
} from "@/lib/userCoauthorState";

function openDb(): Database.Database {
  const db = new Database(":memory:");
  db.exec(`
    CREATE TABLE chats (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      character_id INTEGER NOT NULL,
      mode TEXT NOT NULL DEFAULT 'safe',
      memory_pending TEXT NOT NULL DEFAULT '[]',
      memory_meta TEXT NOT NULL DEFAULT '{}',
      memory_archived_turns INTEGER NOT NULL DEFAULT 0,
      gemini_model TEXT NOT NULL DEFAULT '',
      user_note TEXT NOT NULL DEFAULT '',
      selected_persona_id INTEGER,
      user_impersonation INTEGER NOT NULL DEFAULT 0,
      target_response_chars INTEGER NOT NULL DEFAULT 2500,
      title TEXT NOT NULL DEFAULT '',
      writing_style_override TEXT NOT NULL DEFAULT '',
      memory_capacity INTEGER NOT NULL DEFAULT 0,
      narrative_pov TEXT NOT NULL DEFAULT 'third_person',
      pov_character_name TEXT,
      user_authoring_level TEXT NOT NULL DEFAULT 'LIMITED'
    );
    CREATE TABLE messages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      chat_id INTEGER NOT NULL,
      role TEXT NOT NULL,
      content TEXT NOT NULL DEFAULT ''
    );
  `);
  ensureUserCoauthorSchema(db);
  return db;
}

describe("user authoring fork ownership", () => {
  it("copies ALLOW base level and reconstructs copied current-epoch OOC override", () => {
    const db = openDb();
    const childId = insertForkChatRow(db, {
      userId: 1,
      characterId: 7,
      mode: "safe",
      memoryPending: "[]",
      memoryMeta: "{}",
      memoryArchivedTurns: 0,
      geminiModel: "",
      userNote: "",
      selectedPersonaId: null,
      userImpersonation: 0,
      targetResponseChars: 2500,
      title: "branch",
      writingStyleOverride: "",
      memoryCapacity: 0,
      narrativePov: "third_person",
      povCharacterName: "",
      userAuthoringLevel: "ALLOW",
    });

    const grant = db
      .prepare("INSERT INTO messages (chat_id, role, content) VALUES (?, 'user', ?)")
      .run(childId, "OOC: 내 캐릭터 전권.");
    markUserMessageCoauthorSemanticsVersion(
      db,
      Number(grant.lastInsertRowid),
      CURRENT_USER_COAUTHOR_SEMANTICS_VERSION
    );

    assert.equal(readUserAuthoringLevel(db, childId), "ALLOW");
    assert.equal(recomputeAndPersistUserCoauthorMode(db, childId), "ABSOLUTE");
    assert.equal(readUserCoauthorMode(db, childId), "ABSOLUTE");
  });

  it("copied ALLOW base without an eligible OOC override inherits only ALLOW", () => {
    const db = openDb();
    const childId = insertForkChatRow(db, {
      userId: 1,
      characterId: 7,
      mode: "safe",
      memoryPending: "[]",
      memoryMeta: "{}",
      memoryArchivedTurns: 0,
      geminiModel: "",
      userNote: "",
      selectedPersonaId: null,
      userImpersonation: 0,
      targetResponseChars: 2500,
      title: "branch",
      writingStyleOverride: "",
      memoryCapacity: 0,
      narrativePov: "third_person",
      povCharacterName: "",
      userAuthoringLevel: "ALLOW",
    });

    assert.equal(readUserAuthoringLevel(db, childId), "ALLOW");
    assert.equal(recomputeAndPersistUserCoauthorMode(db, childId), "OFF");
    assert.equal(readUserCoauthorMode(db, childId), "OFF");
  });
});
