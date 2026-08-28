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
import {
  parseCharacterVisualSubjectsJson,
  createCharacterVisualSubjectKey,
} from "@/lib/characterVisualSubjects";
import {
  parseCharacterFormBody,
  updateCharacterPublicProfileFromForm,
} from "@/lib/characterFormSave";

const adultCreator = { id: 1, nickname: "creator", is_adult: 1 as const };

function characterBody(overrides: Record<string, unknown> = {}) {
  return {
    content_kind: "character",
    name: "하윤",
    tagline: "테스트",
    description: "설명",
    greeting: "안녕",
    system_prompt: "캐릭터 설정 ".repeat(400),
    world: "세계관 ".repeat(400),
    speech_personality: "말투",
    genres: ["로맨스"],
    gender: "female",
    participant_min_age: 20,
    assets: [{ url: "/uploads/main.webp", tag: "기본" }],
    ...overrides,
  };
}

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
      name TEXT NOT NULL DEFAULT '하윤',
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
      simulation_visual_subjects_json TEXT NOT NULL DEFAULT ''
    );
  `);
  ensureStatusWidgetTriggerTables(db);
  return db;
}

describe("characterVisualSubjects save integration", () => {
  let db: Database.Database;

  before(async () => {
    db = setupTestDb();
    global.__db = db;
  });

  after(() => {
    db.close();
    global.__db = undefined;
  });

  it("missing visual_subjects field preserves stored registry on fast save", async () => {
    const key = createCharacterVisualSubjectKey();
    const storedDoc = {
      version: 1 as const,
      subjects: [
        {
          subjectKey: key,
          name: "민준",
          savedAppearance: "단발",
          representativeAssetUrl: null,
          sourceCharacterId: null,
        },
      ],
    };
    const insert = db
      .prepare(
        `INSERT INTO characters
          (creator_id, assets, images, simulation_visual_subjects_json, content_kind)
         VALUES (?, ?, ?, ?, 'character')`
      )
      .run(
        1,
        JSON.stringify([
          { url: "/uploads/main.webp", tag: "main" },
          { url: "/uploads/support.webp", tag: "민준", visualSubjectKey: key },
        ]),
        JSON.stringify(["/uploads/main.webp", "/uploads/support.webp"]),
        JSON.stringify(storedDoc)
      );
    const characterId = Number(insert.lastInsertRowid);
    const result = await updateCharacterPublicProfileFromForm(adultCreator, characterId, {
      tagline: "업데이트",
      description: "설명",
      genres: ["로맨스"],
      assets: [
        { url: "/uploads/main.webp", tag: "main" },
        { url: "/uploads/support.webp", tag: "민준", visualSubjectKey: key },
      ],
    });
    assert.equal(result.ok, true, result.ok ? undefined : result.error);
    const row = db
      .prepare("SELECT simulation_visual_subjects_json FROM characters WHERE id=?")
      .get(characterId) as { simulation_visual_subjects_json: string };
    const saved = parseCharacterVisualSubjectsJson(row.simulation_visual_subjects_json);
    assert.equal(saved.subjects[0]?.subjectKey, key);
    assert.equal(saved.subjects[0]?.name, "민준");
  });

  it("explicit empty visual_subjects with owned assets is rejected", () => {
    const key = createCharacterVisualSubjectKey();
    const parsed = parseCharacterFormBody(
      characterBody({
        visual_subjects: { version: 1, subjects: [] },
        assets: [
          { url: "/uploads/main.webp", tag: "main" },
          { url: "/uploads/support.webp", tag: "민준", visualSubjectKey: key },
        ],
      }),
      adultCreator,
      {
        trustedStoredVisualSubjectsJson: JSON.stringify({
          version: 1,
          subjects: [
            {
              subjectKey: key,
              name: "민준",
              savedAppearance: "단발",
              representativeAssetUrl: null,
              sourceCharacterId: null,
            },
          ],
        }),
      }
    );
    assert.equal(parsed.ok, false);
  });

  it("explicit empty visual_subjects passes after explicit asset reassignment", () => {
    const key = createCharacterVisualSubjectKey();
    const parsed = parseCharacterFormBody(
      characterBody({
        visual_subjects: { version: 1, subjects: [] },
        assets: [
          { url: "/uploads/main.webp", tag: "main" },
          { url: "/uploads/support.webp", tag: "민준" },
        ],
      }),
      adultCreator,
      {
        trustedStoredVisualSubjectsJson: JSON.stringify({
          version: 1,
          subjects: [
            {
              subjectKey: key,
              name: "민준",
              savedAppearance: "단발",
              representativeAssetUrl: null,
              sourceCharacterId: null,
            },
          ],
        }),
      }
    );
    assert.equal(parsed.ok, true, parsed.ok ? undefined : parsed.error);
    if (!parsed.ok) throw new Error(parsed.error);
    const saved = parseCharacterVisualSubjectsJson(parsed.data.simulationVisualSubjectsJson);
    assert.equal(saved.subjects.length, 0);
  });

  it("rejects forged visualSubjectKey when visual_subjects field is absent on create", () => {
    const forgedKey = createCharacterVisualSubjectKey();
    const parsed0 = parseCharacterFormBody(
      characterBody({
        assets: [{ url: "/uploads/main.webp", tag: "main", visualSubjectKey: forgedKey }],
      }),
      adultCreator
    );
    assert.equal(parsed0.ok, false);

    const parsed1 = parseCharacterFormBody(
      characterBody({
        assets: [
          { url: "/uploads/main.webp", tag: "main" },
          { url: "/uploads/support.webp", tag: "support", visualSubjectKey: forgedKey },
        ],
      }),
      adultCreator
    );
    assert.equal(parsed1.ok, false);
  });

  it("rejects forged visualSubjectKey on fast save with empty stored registry", async () => {
    const forgedKey = createCharacterVisualSubjectKey();
    const insert = db
      .prepare(
        `INSERT INTO characters
          (creator_id, assets, images, simulation_visual_subjects_json, content_kind)
         VALUES (?, ?, ?, '', 'character')`
      )
      .run(
        1,
        JSON.stringify([
          { url: "/uploads/main.webp", tag: "main" },
          { url: "/uploads/support.webp", tag: "support", visualSubjectKey: forgedKey },
        ]),
        JSON.stringify(["/uploads/main.webp", "/uploads/support.webp"])
      );
    const characterId = Number(insert.lastInsertRowid);
    const result = await updateCharacterPublicProfileFromForm(adultCreator, characterId, {
      tagline: "업데이트",
      description: "설명",
      genres: ["로맨스"],
      assets: [
        { url: "/uploads/main.webp", tag: "main" },
        { url: "/uploads/support.webp", tag: "support", visualSubjectKey: forgedKey },
      ],
    });
    assert.equal(result.ok, false);
  });

  it("fast save keeps registry and assets coherent after rename and main reassignment", async () => {
    const key = createCharacterVisualSubjectKey();
    const storedDoc = {
      version: 1 as const,
      subjects: [
        {
          subjectKey: key,
          name: "민준",
          savedAppearance: "단발",
          representativeAssetUrl: null,
          sourceCharacterId: null,
        },
      ],
    };
    const insert = db
      .prepare(
        `INSERT INTO characters
          (creator_id, assets, images, simulation_visual_subjects_json, content_kind)
         VALUES (?, ?, ?, ?, 'character')`
      )
      .run(
        1,
        JSON.stringify([
          { url: "/uploads/main.webp", tag: "main" },
          { url: "/uploads/support.webp", tag: "민준", visualSubjectKey: key },
        ]),
        JSON.stringify(["/uploads/main.webp", "/uploads/support.webp"]),
        JSON.stringify(storedDoc)
      );
    const characterId = Number(insert.lastInsertRowid);
    const result = await updateCharacterPublicProfileFromForm(adultCreator, characterId, {
      tagline: "업데이트",
      description: "설명",
      genres: ["로맨스"],
      visual_subjects: {
        version: 1,
        subjects: [
          {
            subjectKey: key,
            name: "민준(개명)",
            savedAppearance: "단발",
            representativeAssetUrl: null,
            sourceCharacterId: null,
          },
        ],
      },
      assets: [
        { url: "/uploads/main.webp", tag: "main" },
        { url: "/uploads/support.webp", tag: "민준(개명)" },
      ],
    });
    assert.equal(result.ok, true, result.ok ? undefined : result.error);
    const row = db
      .prepare("SELECT simulation_visual_subjects_json, assets FROM characters WHERE id=?")
      .get(characterId) as { simulation_visual_subjects_json: string; assets: string };
    const saved = parseCharacterVisualSubjectsJson(row.simulation_visual_subjects_json);
    const savedAssets = JSON.parse(row.assets) as Array<{ visualSubjectKey?: string }>;
    assert.equal(saved.subjects[0]?.name, "민준(개명)");
    assert.equal(savedAssets[1]?.visualSubjectKey, undefined);
  });

  it("forces sourceCharacterId null for new character support subjects", () => {
    const key = createCharacterVisualSubjectKey();
    const parsed = parseCharacterFormBody(
      characterBody({
        visual_subjects: {
          version: 1,
          subjects: [
            {
              subjectKey: key,
              name: "민준",
              savedAppearance: "",
              representativeAssetUrl: null,
              sourceCharacterId: 999999,
            },
          ],
        },
        assets: [
          { url: "/uploads/main.webp", tag: "main" },
          { url: "/uploads/support.webp", tag: "민준", visualSubjectKey: key },
        ],
      }),
      adultCreator
    );
    assert.equal(parsed.ok, true, parsed.ok ? undefined : parsed.error);
    if (!parsed.ok) throw new Error(parsed.error);
    const saved = parseCharacterVisualSubjectsJson(parsed.data.simulationVisualSubjectsJson);
    assert.equal(saved.subjects[0]?.sourceCharacterId, null);
  });

  it("rejects support name equal to main character", () => {
    const key = createCharacterVisualSubjectKey();
    const parsed = parseCharacterFormBody(
      characterBody({
        name: "태현",
        visual_subjects: {
          version: 1,
          subjects: [
            {
              subjectKey: key,
              name: "태현",
              savedAppearance: "",
              representativeAssetUrl: null,
              sourceCharacterId: null,
            },
          ],
        },
      }),
      adultCreator
    );
    assert.equal(parsed.ok, false);
  });

  it("rejects primary asset assigned to support subject", () => {
    const key = createCharacterVisualSubjectKey();
    const parsed = parseCharacterFormBody(
      characterBody({
        visual_subjects: {
          version: 1,
          subjects: [
            {
              subjectKey: key,
              name: "민준",
              savedAppearance: "",
              representativeAssetUrl: null,
              sourceCharacterId: null,
            },
          ],
        },
        assets: [{ url: "/uploads/main.webp", tag: "main", visualSubjectKey: key }],
      }),
      adultCreator
    );
    assert.equal(parsed.ok, false);
  });
});
