import assert from "node:assert/strict";
import { describe, it } from "node:test";
import Database from "better-sqlite3";
import { readRpQualificationFixture } from "@/lib/rpQualificationFixture";

function makeDb() {
  const db = new Database(":memory:");
  db.exec(`
    CREATE TABLE characters (
      id INTEGER PRIMARY KEY,
      name TEXT NOT NULL,
      gender TEXT,
      description TEXT NOT NULL DEFAULT '',
      system_prompt TEXT NOT NULL DEFAULT '',
      world TEXT NOT NULL DEFAULT '',
      example_dialog TEXT NOT NULL DEFAULT '',
      setting_chunks TEXT NOT NULL DEFAULT '[]',
      setting_chunks_en TEXT NOT NULL DEFAULT '[]',
      prompt_translation_hash TEXT,
      speech_profile TEXT,
      creator_compiled_description_json TEXT,
      appearance_raw TEXT,
      appearance_compiled TEXT,
      narration_style_instructions TEXT,
      content_kind TEXT
    );
    CREATE TABLE user_personas (
      id INTEGER PRIMARY KEY,
      user_id INTEGER NOT NULL,
      name TEXT NOT NULL,
      gender TEXT NOT NULL DEFAULT 'other',
      description TEXT NOT NULL DEFAULT '',
      speech_examples TEXT NOT NULL DEFAULT '',
      secret_description TEXT NOT NULL DEFAULT ''
    );
  `);
  return db;
}

describe("RP qualification fixture exporter", () => {
  it("exports only production-consumed public persona fields and selected character chunks", () => {
    const db = makeDb();
    db.prepare(
      `INSERT INTO characters (
        id, name, gender, description, system_prompt, world, example_dialog,
        setting_chunks, setting_chunks_en, prompt_translation_hash,
        speech_profile, creator_compiled_description_json,
        appearance_raw, appearance_compiled,
        narration_style_instructions, content_kind
      ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`
    ).run(
      18,
      "라이크",
      "male",
      "캐릭터 성격",
      "시스템",
      "세계",
      "예시",
      JSON.stringify([
        {
          id: "identity-ko",
          category: "identity",
          content: "라이크의 정체성",
          importance: "critical",
        },
      ]),
      "[]",
      null,
      "",
      "",
      "",
      "",
      "",
      "character"
    );
    db.prepare(
      `INSERT INTO user_personas
       (id, user_id, name, gender, description, speech_examples, secret_description)
       VALUES (?,?,?,?,?,?,?)`
    ).run(7, 42, "렌", "male", "조용한 사람.", "짧게 말한다.", "절대 노출 금지");

    const result = readRpQualificationFixture(db, {
      characterId: 18,
      adminUserId: 42,
      adminNickname: "관리자",
      personaName: "렌",
    });

    assert.equal(result.ok, true);
    if (!result.ok) return;

    assert.equal(result.fixture.character.id, 18);
    assert.equal(result.fixture.persona.name, "렌");
    assert.equal(result.fixture.persona.description, "조용한 사람.");
    assert.deepEqual(result.fixture.persona.mainPromptFields, ["name", "gender", "description"]);
    assert.ok(result.fixture.character.finalSelected.chunks.length > 0);
    assert.equal(JSON.stringify(result.fixture).includes("절대 노출 금지"), false);
    assert.equal(
      Object.prototype.hasOwnProperty.call(result.fixture.persona, "secret_description"),
      false
    );
  });

  it("does not guess when the admin has multiple personas with the same name", () => {
    const db = makeDb();
    db.prepare(
      `INSERT INTO characters
       (id, name, gender, description, system_prompt, world, example_dialog, setting_chunks, setting_chunks_en, content_kind)
       VALUES (?,?,?,?,?,?,?,?,?,?)`
    ).run(18, "라이크", "male", "", "", "", "", "[]", "[]", "character");
    db.prepare(
      "INSERT INTO user_personas (id, user_id, name, gender, description) VALUES (?,?,?,?,?)"
    ).run(1, 42, "렌", "male", "첫 번째");
    db.prepare(
      "INSERT INTO user_personas (id, user_id, name, gender, description) VALUES (?,?,?,?,?)"
    ).run(2, 42, "렌", "male", "두 번째 설명");

    const result = readRpQualificationFixture(db, {
      characterId: 18,
      adminUserId: 42,
      adminNickname: "관리자",
      personaName: "렌",
    });

    assert.equal(result.ok, false);
    if (result.ok) return;
    assert.equal(result.code, "persona_ambiguous");
    if (result.code !== "persona_ambiguous") return;
    assert.deepEqual(result.candidates, [
      { id: 1, gender: "male", descriptionChars: 4 },
      { id: 2, gender: "male", descriptionChars: 7 },
    ]);
  });
});
