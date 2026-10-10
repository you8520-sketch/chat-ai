import Module from "module";

const originalLoad = Module._load;
Module._load = function (request, parent, isMain) {
  if (request === "server-only") return {};
  return originalLoad.call(this, request, parent, isMain);
} as typeof Module._load;

import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import Database from "better-sqlite3";

import { ensureStatusWidgetTriggerTables } from "@/lib/statusWidgetTriggers";
import type { parseCharacterFormBody as ParseCharacterFormBodyFn } from "@/lib/characterFormSave";
import type { updateCharacterPublicProfileFromForm as UpdateCharacterPublicProfileFromFormFn } from "@/lib/characterFormSave";
import { readPublicDossier } from "@/lib/characterPublicDossier";

let parseCharacterFormBody: typeof ParseCharacterFormBodyFn;
let updateCharacterPublicProfileFromForm: typeof UpdateCharacterPublicProfileFromFormFn;

const adultUser = { id: 1, nickname: "creator", is_adult: 1 as const };

function setupTestDb(): Database.Database {
  const db = new Database(":memory:");
  db.exec(`
    CREATE TABLE characters (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      creator_id INTEGER,
      official INTEGER NOT NULL DEFAULT 0,
      share_slug TEXT,
      visibility TEXT NOT NULL DEFAULT 'private',
      moderation_status TEXT NOT NULL DEFAULT 'approved',
      moderation_note TEXT,
      images TEXT,
      nsfw INTEGER NOT NULL DEFAULT 0,
      name TEXT NOT NULL DEFAULT '테스트',
      greeting TEXT NOT NULL DEFAULT '안녕',
      creator_comment TEXT,
      tags TEXT,
      participant_min_age INTEGER,
      adult_status TEXT NOT NULL DEFAULT 'unknown',
      tagline TEXT NOT NULL DEFAULT '한 줄 소개',
      description TEXT NOT NULL DEFAULT '공개 소개',
      genre TEXT NOT NULL DEFAULT '로맨스',
      genres TEXT NOT NULL DEFAULT '["로맨스"]',
      emoji TEXT NOT NULL DEFAULT '✨',
      hue INTEGER NOT NULL DEFAULT 260,
      audience TEXT NOT NULL DEFAULT 'all',
      assets TEXT NOT NULL DEFAULT '[]',
      comments_enabled INTEGER NOT NULL DEFAULT 1,
      creator_name TEXT NOT NULL DEFAULT '',
      status_widget_json TEXT NOT NULL DEFAULT '',
      simulation_reuse_allowed INTEGER NOT NULL DEFAULT 0,
      simulation_nsfw_allowed INTEGER NOT NULL DEFAULT 0,
      trpg_reuse_allowed INTEGER NOT NULL DEFAULT 0,
      content_kind TEXT NOT NULL DEFAULT 'character',
      simulation_cast TEXT NOT NULL DEFAULT '',
      simulation_visual_subjects_json TEXT NOT NULL DEFAULT '',
      gender TEXT NOT NULL DEFAULT 'male',
      world TEXT NOT NULL DEFAULT '비공개 세계관 원문',
      gender_public INTEGER NOT NULL DEFAULT 0,
      height_cm INTEGER,
      weight_kg INTEGER,
      world_public_name TEXT NOT NULL DEFAULT '',
      world_public INTEGER NOT NULL DEFAULT 0
    );
  `);
  ensureStatusWidgetTriggerTables(db);
  return db;
}

function insertCharacter(db: Database.Database): number {
  return Number(
    db
      .prepare(
        `INSERT INTO characters (creator_id, images, assets, gender, world)
         VALUES (1, ?, ?, 'male', '빌린 세계관 스냅샷')`,
      )
      .run(
        JSON.stringify(["/uploads/test.png"]),
        JSON.stringify([{ url: "/uploads/test.png", tag: "neutral" }]),
      ).lastInsertRowid,
  );
}

function publicProfileBody(overrides: Record<string, unknown> = {}) {
  return {
    tagline: "한 줄 소개",
    description: "공개 소개",
    genres: ["로맨스"],
    assets: [{ url: "/uploads/test.png", tag: "neutral", representativeRank: 1 }],
    visibility: "private",
    ...overrides,
  };
}

function readDossierRow(db: Database.Database, id: number) {
  return db
    .prepare(
      `SELECT gender, world, gender_public, height_cm, weight_kg, world_public_name, world_public
       FROM characters WHERE id=?`,
    )
    .get(id) as {
    gender: string;
    world: string;
    gender_public: number;
    height_cm: number | null;
    weight_kg: number | null;
    world_public_name: string;
    world_public: number;
  };
}

let testDb: Database.Database;

before(async () => {
  testDb = setupTestDb();
  global.__db = testDb;
  ({ parseCharacterFormBody, updateCharacterPublicProfileFromForm } = await import("@/lib/characterFormSave"));
});

after(() => {
  testDb.close();
  global.__db = undefined;
});

describe("public dossier save contract", () => {
  it("parses public metadata without treating world/gender as prompt-only extras", () => {
    const parsed = parseCharacterFormBody(
      {
        content_kind: "character",
        name: "테스트",
        tagline: "한 줄 소개",
        description: "공개 소개",
        greeting: "안녕",
        system_prompt: "y".repeat(600),
        world: "y".repeat(600),
        speech_personality: "x".repeat(500),
        speech_traits: "x".repeat(500),
        speech_examples: "x".repeat(500),
        speech_forbidden: "",
        genres: ["로맨스"],
        gender: "male",
        gender_public: true,
        height_cm: "183",
        weight_kg: "71",
        world_public_name: "에테르노스 제국",
        world_public: true,
        nsfw: false,
        participant_min_age: 28,
        assets: [{ url: "/uploads/test.png", tag: "neutral", representativeRank: 1 }],
      },
      adultUser,
    );
    assert.equal(parsed.ok, true);
    if (!parsed.ok) return;
    assert.equal(parsed.data.gender, "male");
    assert.equal(parsed.data.genderPublic, true);
    assert.equal(parsed.data.heightCm, 183);
    assert.equal(parsed.data.weightKg, 71);
    assert.equal(parsed.data.worldPublicName, "에테르노스 제국");
    assert.equal(parsed.data.worldPublic, true);
    assert.equal(parsed.data.world.startsWith("y"), true);
  });

  it("PATCH public_profile stores consented fields and never rewrites private gender/world", async () => {
    const id = insertCharacter(testDb);
    const result = await updateCharacterPublicProfileFromForm(
      adultUser,
      id,
      publicProfileBody({
        gender: "female",
        world: "가짜로 덮어쓸 세계관",
        gender_public: true,
        height_cm: 183,
        weight_kg: 71,
        world_public_name: "에테르노스 제국",
        world_public: true,
      }),
    );
    assert.equal(result.ok, true);
    const row = readDossierRow(testDb, id);
    assert.equal(row.gender, "male");
    assert.equal(row.world, "빌린 세계관 스냅샷");
    assert.equal(row.gender_public, 1);
    assert.equal(row.height_cm, 183);
    assert.equal(row.weight_kg, 71);
    assert.equal(row.world_public_name, "에테르노스 제국");
    assert.equal(row.world_public, 1);
    assert.deepEqual(readPublicDossier(row), {
      world: "에테르노스 제국",
      gender: "남성",
      heightCm: 183,
      weightKg: 71,
    });
  });

  it("PATCH public_profile can turn every field off and clear numbers", async () => {
    const id = insertCharacter(testDb);
    await updateCharacterPublicProfileFromForm(
      adultUser,
      id,
      publicProfileBody({
        gender_public: true,
        height_cm: 183,
        weight_kg: 71,
        world_public_name: "에테르노스 제국",
        world_public: true,
      }),
    );
    const off = await updateCharacterPublicProfileFromForm(
      adultUser,
      id,
      publicProfileBody({
        gender_public: false,
        height_cm: "",
        weight_kg: "",
        world_public_name: "",
        world_public: false,
      }),
    );
    assert.equal(off.ok, true);
    const row = readDossierRow(testDb, id);
    assert.equal(row.gender, "male");
    assert.equal(row.world, "빌린 세계관 스냅샷");
    assert.equal(row.gender_public, 0);
    assert.equal(row.height_cm, null);
    assert.equal(row.weight_kg, null);
    assert.equal(row.world_public_name, "");
    assert.equal(row.world_public, 0);
    assert.equal(readPublicDossier(row).gender, null);
    assert.equal(readPublicDossier(row).world, null);
  });

  it("rejects invalid height on public_profile PATCH and leaves the row unchanged", async () => {
    const id = insertCharacter(testDb);
    const result = await updateCharacterPublicProfileFromForm(
      adultUser,
      id,
      publicProfileBody({ height_cm: "183cm" }),
    );
    assert.equal(result.ok, false);
    if (!result.ok) assert.match(result.error, /숫자만/);
    const row = readDossierRow(testDb, id);
    assert.equal(row.height_cm, null);
    assert.equal(row.gender, "male");
    assert.equal(row.world, "빌린 세계관 스냅샷");
  });
});
