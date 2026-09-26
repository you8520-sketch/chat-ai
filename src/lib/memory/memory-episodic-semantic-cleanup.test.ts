import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { getDb } from "@/lib/db";
import { deleteChatOwnedDerivedRows } from "@/lib/chatOwnedDataCleanup";
import { deleteUserCharacter } from "@/lib/deleteCharacter";
import {
  installIsolatedTestDatabase,
  uninstallIsolatedTestDatabase,
} from "@/lib/test/isolatedTestDatabase";
import {
  EPISODIC_FACT_EMBEDDINGS_TABLE,
  episodicFactContentHash,
  episodicFactSemanticText,
  upsertEpisodicFactEmbedding,
} from "@/lib/memory/memory-episodic-semantic-index";
import { EPISODIC_SEMANTIC_MODEL_CANDIDATES } from "@/lib/memory/memory-episodic-semantic-config";

/**
 * Real deletion owners against an isolated full-schema DB. Proves cleanup is
 * cleanup-only: with the semantic feature never enabled, deleting a chat or a
 * character must not create the derived sidecar table.
 */

function sidecarExists(): boolean {
  return Boolean(
    getDb().prepare("SELECT 1 AS ok FROM sqlite_master WHERE type='table' AND name=?").get(EPISODIC_FACT_EMBEDDINGS_TABLE)
  );
}

let seq = 0;
function seedChat(): { userId: number; characterId: number; chatId: number } {
  seq += 1;
  const db = getDb();
  const userId = Number(
    db.prepare("INSERT INTO users (email, nickname, pw_hash) VALUES (?,?,?)").run(`sem-clean-${seq}@t.local`, `u${seq}`, "x").lastInsertRowid
  );
  const characterId = Number(
    db.prepare("INSERT INTO characters (name, creator_id, official) VALUES (?, ?, 0)").run(`SemClean${seq}`, userId).lastInsertRowid
  );
  const chatId = Number(
    db.prepare("INSERT INTO chats (user_id, character_id, mode) VALUES (?, ?, 'safe')").run(userId, characterId).lastInsertRowid
  );
  db.prepare(
    `INSERT INTO episodic_memory_facts (chat_id, character_id, user_id, source_turn, category, subject, attribute, value, importance, fact_text, metadata)
     VALUES (?, ?, ?, 10, 'setting', 'storm', 'note', 'cave', 'normal', '폭풍우 밤에 둘은 동굴로 피신했다.', '{"memory_evidence_type":"explicit_scene_event","content_route":"safe"}')`
  ).run(chatId, characterId, userId);
  return { userId, characterId, chatId };
}

function writeVector(chatId: number): void {
  const db = getDb();
  const fact = db.prepare("SELECT id, fact_text FROM episodic_memory_facts WHERE chat_id=?").get(chatId) as { id: number; fact_text: string };
  const model = EPISODIC_SEMANTIC_MODEL_CANDIDATES.bge_m3;
  const vector = new Float32Array(model.dimensions);
  vector[0] = 1;
  assert.equal(
    upsertEpisodicFactEmbedding(db, { chatId, factId: fact.id, model, contentHash: episodicFactContentHash(episodicFactSemanticText(fact)!), vector }),
    "written"
  );
}

function vectorsFor(chatId: number): number {
  return (getDb().prepare(`SELECT COUNT(*) AS n FROM ${EPISODIC_FACT_EMBEDDINGS_TABLE} WHERE chat_id=?`).get(chatId) as { n: number }).n;
}

before(() => installIsolatedTestDatabase());
after(() => uninstallIsolatedTestDatabase());

describe("semantic sidecar cleanup is cleanup-only", () => {
  it("disabled feature: chat delete does not create the sidecar table", () => {
    const { userId, chatId } = seedChat();
    assert.equal(sidecarExists(), false, "before delete: no sidecar");
    getDb().transaction(() => deleteChatOwnedDerivedRows(getDb(), chatId, userId))();
    assert.equal(sidecarExists(), false, "after delete: still no sidecar");
    assert.equal((getDb().prepare("SELECT COUNT(*) AS n FROM chats WHERE id=?").get(chatId) as { n: number }).n, 0);
  });

  it("disabled feature: character delete does not create the sidecar table", () => {
    const { userId, characterId } = seedChat();
    assert.equal(sidecarExists(), false, "before delete: no sidecar");
    assert.deepEqual(deleteUserCharacter(characterId, userId), { ok: true });
    assert.equal(sidecarExists(), false, "after delete: still no sidecar");
  });

  it("enabled (sidecar exists): chat delete wipes that chat's vectors only", () => {
    const a = seedChat();
    const b = seedChat();
    writeVector(a.chatId);
    writeVector(b.chatId);
    getDb().transaction(() => deleteChatOwnedDerivedRows(getDb(), a.chatId, a.userId))();
    assert.equal(vectorsFor(a.chatId), 0);
    assert.equal(vectorsFor(b.chatId), 1);
  });

  it("enabled (sidecar exists): character delete wipes vectors of its chats", () => {
    const c = seedChat();
    writeVector(c.chatId);
    assert.deepEqual(deleteUserCharacter(c.characterId, c.userId), { ok: true });
    assert.equal(vectorsFor(c.chatId), 0);
  });
});
