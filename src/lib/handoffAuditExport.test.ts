import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { after, describe, it } from "node:test";

import { getDb } from "@/lib/db";
import {
  exportProductionHandoffAuditSnapshot,
  resolveHandoffAuditAdminPersonaCandidates,
  resolveHandoffAuditCharacterCandidates,
} from "@/lib/handoffAuditExport";

const SOURCE = fs.readFileSync(path.join(process.cwd(), "src/lib/handoffAuditExport.ts"), "utf8");

const userId = 881_000_001;
const characterId = 881_000_101;
const personaId = 881_000_201;
const fixtureName = "handoff-audit-export-fixture-char";

function cleanup(): void {
  const db = getDb();
  db.prepare("DELETE FROM user_personas WHERE id=?").run(personaId);
  db.prepare("DELETE FROM characters WHERE id=?").run(characterId);
  db.prepare("DELETE FROM users WHERE id=?").run(userId);
}

after(cleanup);

describe("handoffAuditExport read-only loaders", () => {
  it("reuses production read-only chunk and persona loaders", () => {
    assert.match(SOURCE, /loadCharacterChunksForPromptReadOnly/);
    assert.match(SOURCE, /getPersonaById/);
    assert.match(SOURCE, /resolveExampleDialogForPrompt/);
    assert.match(SOURCE, /parseStoredSpeechProfile/);
    assert.match(SOURCE, /formatPublicPersonaForPrompt/);
    assert.doesNotMatch(SOURCE, /loadCharacterChunksForPrompt\(/);
    assert.doesNotMatch(SOURCE, /saveCharacterChunks/);
    assert.doesNotMatch(SOURCE, /scheduleEnglishBackfill/);
    assert.match(SOURCE, /\/data\/handoff-audit-exports/);
    assert.doesNotMatch(SOURCE, /"data\/handoff-audit-exports"/);
  });
});

describe("handoffAuditExport local fixture", () => {
  it("exports exact fixture fields and stays unproven on a non-production DB", () => {
    cleanup();
    const db = getDb();
    db.prepare(
      "INSERT INTO users (id, email, nickname, pw_hash, is_admin) VALUES (?, ?, ?, ?, 1)"
    ).run(userId, "handoff-audit-export-fixture@example.test", "감사픽스처", "x");
    db.prepare(
      `INSERT INTO characters (
        id, name, description, greeting, system_prompt, world, example_dialog,
        speech_profile, nsfw, official, creator_id
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, 0, ?)`
    ).run(
      characterId,
      fixtureName,
      "성격 원문",
      "인사 원문",
      "시스템 원문",
      "세계 원문",
      "예시 원문",
      '{"tone":"fixture"}',
      userId
    );
    db.prepare(
      `INSERT INTO user_personas (id, user_id, name, description, secret_description, speech_examples, gender)
       VALUES (?, ?, ?, ?, ?, ?, 'other')`
    ).run(personaId, userId, "관리자페르소나", "페르소나 본문", "비밀 본문", "말투 예시");

    const candidates = resolveHandoffAuditCharacterCandidates(fixtureName);
    assert.equal(candidates.length, 1);
    assert.equal(candidates[0]?.id, characterId);
    assert.equal("system_prompt" in candidates[0]!, false);

    const personas = resolveHandoffAuditAdminPersonaCandidates();
    assert.ok(personas.some((row) => row.personaId === personaId));
    assert.equal(
      personas.some((row) => JSON.stringify(row).includes("페르소나 본문")),
      false
    );

    const snapshot = exportProductionHandoffAuditSnapshot({
      characterId,
      personaId,
    });
    assert.equal(snapshot.PRODUCTION_RECORD_PROVEN, false);
    assert.equal(snapshot.database_source, "local_non_production");
    assert.equal(snapshot.character.fields.system_prompt, "시스템 원문");
    assert.equal(snapshot.world_canon.fields.world, "세계 원문");
    assert.equal(snapshot.persona.fields.description, "페르소나 본문");
    assert.equal(snapshot.speech_lock.fields.speech_profile, '{"tone":"fixture"}');
    assert.equal(snapshot.character.hashes.system_prompt.chars, "시스템 원문".length);
    assert.match(snapshot.character.hashes.system_prompt.sha256, /^[a-f0-9]{64}$/);
  });
});
