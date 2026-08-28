import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { CharacterAsset } from "@/lib/characterAssets";
import {
  CHARACTER_VISUAL_SUBJECT_LIMIT,
  createCharacterVisualSubjectKey,
  emptyCharacterVisualSubjectsDocument,
  parseCharacterVisualSubjectsJson,
  prepareCharacterVisualSubjectsForSave,
  serializeCharacterVisualSubjectsJson,
} from "@/lib/characterVisualSubjects";
import { isVisualSubjectKey, assetsForMainCharacterPool } from "@/lib/visualSubjects";
import { parseCharacterFormBody } from "@/lib/characterFormSave";

const adultCreator = { id: 1, nickname: "creator", is_adult: 1 as const };

function asset(url: string, tag: string, visualSubjectKey?: string): CharacterAsset {
  return { url, tag, ...(visualSubjectKey ? { visualSubjectKey } : {}) };
}

describe("characterVisualSubjects", () => {
  it("creates vis_* keys and accepts them in validation", () => {
    const key = createCharacterVisualSubjectKey();
    assert.equal(isVisualSubjectKey(key), true);
    assert.match(key, /^vis_/);
  });

  it("prepares creator-managed subjects for save", () => {
    const key = createCharacterVisualSubjectKey();
    const submitted = {
      version: 1 as const,
      subjects: [
        {
          subjectKey: key,
          name: "민준",
          savedAppearance: "검은 머리",
          representativeAssetUrl: "/uploads/support.webp",
          sourceCharacterId: null,
        },
      ],
    };
    const assets = [asset("/uploads/main.webp", "기본"), asset("/uploads/support.webp", "민준 표정", key)];

    const prepared = prepareCharacterVisualSubjectsForSave({
      submittedRaw: JSON.stringify(submitted),
      storedRaw: "",
      assets,
    });
    assert.equal(prepared.subjects[0]?.name, "민준");
    assert.equal(prepared.subjects[0]?.representativeAssetUrl, "/uploads/support.webp");
  });

  it("rejects more than the character visual subject limit", () => {
    const subjects = Array.from({ length: CHARACTER_VISUAL_SUBJECT_LIMIT + 1 }, (_, index) => ({
      subjectKey: createCharacterVisualSubjectKey(),
      name: `NPC${index}`,
      savedAppearance: "",
      representativeAssetUrl: null,
      sourceCharacterId: null,
    }));
    assert.throws(
      () =>
        prepareCharacterVisualSubjectsForSave({
          submittedRaw: JSON.stringify({ version: 1, subjects }),
          storedRaw: "",
          assets: [],
        }),
      /최대 12명/
    );
  });

  it("parseCharacterFormBody saves character visual subjects atomically with assets", () => {
    const key = createCharacterVisualSubjectKey();
    const doc = {
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
    const assets = [
      asset("/uploads/main.webp", "기본"),
      asset("/uploads/support.webp", "민준", key),
    ];
    const parsed = parseCharacterFormBody(
      {
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
        assets,
        visual_subjects: doc,
      },
      adultCreator
    );
    assert.equal(parsed.ok, true, parsed.ok ? undefined : parsed.error);
    if (!parsed.ok) throw new Error(parsed.error);
    const saved = parseCharacterVisualSubjectsJson(parsed.data.simulationVisualSubjectsJson);
    assert.equal(saved.subjects[0]?.subjectKey, key);
    assert.equal(parsed.data.assets.every((row) => row.visualSubjectKey !== key || row.url === "/uploads/support.webp"), true);
  });

  it("assetsForMainCharacterPool excludes support-owned assets for character kind", () => {
    const key = createCharacterVisualSubjectKey();
    const assets = [
      asset("/uploads/main.webp", "기본"),
      asset("/uploads/support.webp", "민준", key),
    ];
    const mainPool = assetsForMainCharacterPool(assets, "character");
    assert.deepEqual(mainPool.map((row) => row.url), ["/uploads/main.webp"]);
  });

  it("roundtrips serialized character visual subjects", () => {
    const key = createCharacterVisualSubjectKey();
    const doc = emptyCharacterVisualSubjectsDocument();
    doc.subjects.push({
      subjectKey: key,
      name: "서연",
      savedAppearance: "은발",
      representativeAssetUrl: null,
      sourceCharacterId: null,
    });
    const json = serializeCharacterVisualSubjectsJson(doc);
    const reloaded = parseCharacterVisualSubjectsJson(json);
    assert.deepEqual(reloaded, doc);
  });
});
