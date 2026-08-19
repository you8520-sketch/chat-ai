import Module from "module";
import Database from "better-sqlite3";

const originalLoad = Module._load;
Module._load = function (request, parent, isMain) {
  if (request === "server-only") return {};
  return originalLoad.call(this, request, parent, isMain);
} as typeof Module._load;

import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";

import { ensureStatusWidgetTriggerTables } from "@/lib/statusWidgetTriggers";
import type { updateCharacterPublicProfileFromForm as UpdateCharacterPublicProfileFromFormFn } from "@/lib/characterFormSave";

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
      trpg_reuse_allowed INTEGER NOT NULL DEFAULT 0
    );
  `);
  ensureStatusWidgetTriggerTables(db);
  return db;
}

function insertCharacter(
  db: Database.Database,
  input: {
    participant_min_age?: number | null;
    adult_status?: string;
    nsfw?: number;
    description?: string;
  } = {}
): number {
  const info = db
    .prepare(
      `INSERT INTO characters
        (creator_id, participant_min_age, adult_status, nsfw, description, images, assets)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      1,
      input.participant_min_age ?? null,
      input.adult_status ?? "unknown",
      input.nsfw ?? 0,
      input.description ?? "공개 소개",
      JSON.stringify(["/uploads/test.png"]),
      JSON.stringify([{ url: "/uploads/test.png", tag: "neutral" }])
    );
  return Number(info.lastInsertRowid);
}

function readAgeRow(db: Database.Database, id: number) {
  return db
    .prepare("SELECT participant_min_age, adult_status, nsfw FROM characters WHERE id=?")
    .get(id) as {
    participant_min_age: number | null;
    adult_status: string;
    nsfw: number;
  };
}

function assertAgeRowUnchanged(
  before: ReturnType<typeof readAgeRow>,
  after: ReturnType<typeof readAgeRow>
) {
  assert.equal(after.participant_min_age, before.participant_min_age);
  assert.equal(after.adult_status, before.adult_status);
  assert.equal(after.nsfw, before.nsfw);
}

function publicProfileBody(overrides: Record<string, unknown> = {}) {
  return {
    tagline: "한 줄 소개",
    description: "공개 소개",
    genres: ["로맨스"],
    assets: [{ url: "/uploads/test.png", tag: "neutral" }],
    visibility: "private",
    ...overrides,
  };
}

let testDb: Database.Database;

before(async () => {
  testDb = setupTestDb();
  global.__db = testDb;
  ({ updateCharacterPublicProfileFromForm } = await import("@/lib/characterFormSave"));
});

after(() => {
  testDb.close();
  global.__db = undefined;
});

describe("updateCharacterPublicProfileFromForm participant age persistence", () => {
  it("P1 legacy age=NULL/status=unknown/nsfw=false + age=28/nsfw=true => age=28, confirmed, nsfw=1", async () => {
    const id = insertCharacter(testDb, {
      participant_min_age: null,
      adult_status: "unknown",
      nsfw: 0,
    });
    const result = await updateCharacterPublicProfileFromForm(
      adultUser,
      id,
      publicProfileBody({ participant_min_age: 28, nsfw: true })
    );
    assert.equal(result.ok, true);
    const row = readAgeRow(testDb, id);
    assert.equal(row.participant_min_age, 28);
    assert.equal(row.adult_status, "confirmed");
    assert.equal(row.nsfw, 1);
  });

  it("P2 existing age=28/confirmed + nsfw toggle only => preserve age/status", async () => {
    const id = insertCharacter(testDb, {
      participant_min_age: 28,
      adult_status: "confirmed",
      nsfw: 0,
    });
    const result = await updateCharacterPublicProfileFromForm(
      adultUser,
      id,
      publicProfileBody({ nsfw: true })
    );
    assert.equal(result.ok, true);
    const row = readAgeRow(testDb, id);
    assert.equal(row.participant_min_age, 28);
    assert.equal(row.adult_status, "confirmed");
    assert.equal(row.nsfw, 1);
  });

  it("P3 existing age=17/minor + nsfw=true age omitted => reject", async () => {
    const id = insertCharacter(testDb, {
      participant_min_age: 17,
      adult_status: "minor",
      nsfw: 0,
    });
    const before = readAgeRow(testDb, id);
    const result = await updateCharacterPublicProfileFromForm(
      adultUser,
      id,
      publicProfileBody({ nsfw: true })
    );
    assert.equal(result.ok, false);
    assertAgeRowUnchanged(before, readAgeRow(testDb, id));
  });

  it("P4 existing age=NULL/unknown + nsfw=true age omitted => reject", async () => {
    const id = insertCharacter(testDb, {
      participant_min_age: null,
      adult_status: "unknown",
      nsfw: 0,
    });
    const before = readAgeRow(testDb, id);
    const result = await updateCharacterPublicProfileFromForm(
      adultUser,
      id,
      publicProfileBody({ nsfw: true })
    );
    assert.equal(result.ok, false);
    assertAgeRowUnchanged(before, readAgeRow(testDb, id));
  });

  it("P5 existing age=28/confirmed + explicit age=17/nsfw=false => age=17, minor, nsfw=0", async () => {
    const id = insertCharacter(testDb, {
      participant_min_age: 28,
      adult_status: "confirmed",
      nsfw: 1,
    });
    const result = await updateCharacterPublicProfileFromForm(
      adultUser,
      id,
      publicProfileBody({ participant_min_age: 17, nsfw: false })
    );
    assert.equal(result.ok, true);
    const row = readAgeRow(testDb, id);
    assert.equal(row.participant_min_age, 17);
    assert.equal(row.adult_status, "minor");
    assert.equal(row.nsfw, 0);
  });

  it("P6 existing age=28/confirmed + explicit age=17/nsfw=true => reject, DB unchanged", async () => {
    const id = insertCharacter(testDb, {
      participant_min_age: 28,
      adult_status: "confirmed",
      nsfw: 1,
    });
    const before = readAgeRow(testDb, id);
    const result = await updateCharacterPublicProfileFromForm(
      adultUser,
      id,
      publicProfileBody({ participant_min_age: 17, nsfw: true })
    );
    assert.equal(result.ok, false);
    assertAgeRowUnchanged(before, readAgeRow(testDb, id));
  });

  it("P7 adult parent age=32/nsfw=true + 7살 딸 lore => allowed, age/status preserved", async () => {
    const id = insertCharacter(testDb, {
      participant_min_age: 32,
      adult_status: "confirmed",
      nsfw: 1,
      description: "32세 아버지",
    });
    const result = await updateCharacterPublicProfileFromForm(
      adultUser,
      id,
      publicProfileBody({
        nsfw: true,
        description: "32세 아버지. 7살 딸이 있다.",
      })
    );
    assert.equal(result.ok, true);
    const row = readAgeRow(testDb, id);
    assert.equal(row.participant_min_age, 32);
    assert.equal(row.adult_status, "confirmed");
    assert.equal(row.nsfw, 1);
  });
});
