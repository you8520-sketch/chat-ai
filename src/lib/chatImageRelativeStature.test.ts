import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { buildChatComicGenerationPlan } from "@/lib/chatComicGeneration";
import { buildChatLdIllustrationPrompt } from "@/lib/chatLdIllustrationGeneration";
import {
  buildStrictComicFallbackPrompt,
  buildStrictLdDuoFallbackPrompt,
} from "@/lib/chatImageStrictSafetyFallbackPrompt";
import {
  bindChatImageReferencePack,
  buildChatDuoVisualSubjects,
  parseNumericHeightCm,
  prepareSubjectsForStrictFallback,
  renderChatImageVisualIdentity,
  renderCrossSubjectRelativeStature,
  resolveCharacterSavedAppearance,
  resolvePersonaSavedAppearance,
  type ChatImageVisualSubject,
} from "@/lib/chatImageVisualIdentity";
import {
  buildDeterministicScenePlan,
  buildSceneSourceMessages,
} from "@/lib/chatImageScenePlan";

function duoSubjects(opts: {
  aName?: string;
  bName?: string;
  aHeight?: string;
  bHeight?: string;
  bMode?: ChatImageVisualSubject["appearanceMode"];
  bSaved?: string;
}): ChatImageVisualSubject[] {
  return bindChatImageReferencePack({
    subjectsInImageOrder: buildChatDuoVisualSubjects({
      characterName: opts.aName ?? "에단",
      characterGender: "male",
      characterImageUrl: "/c.webp",
      characterSavedAppearance: opts.aHeight ?? "키 180cm",
      characterAppearanceMode: "image_plus_saved",
      personaName: opts.bName ?? "리프트",
      personaGender: "female",
      personaImageUrl: "/p.webp",
      personaSavedAppearance: opts.bSaved ?? opts.bHeight ?? "키 188cm",
      personaAppearanceMode: opts.bMode ?? "image_plus_saved",
    }),
  }).subjects;
}

function statureBlock(text: string): string {
  const match = text.match(
    /CROSS-SUBJECT RELATIVE STATURE[\s\S]*?(?=\n\n|$)/
  );
  return match?.[0] ?? "";
}

describe("chatImageRelativeStature — cross-subject numeric height owner", () => {
  it("RELATIVE-HEIGHT-1 A 180 B 188 — B taller than A", () => {
    const subjects = duoSubjects({ aHeight: "키 180cm", bHeight: "키 188cm" });
    const block = renderCrossSubjectRelativeStature(subjects);
    assert.match(block, /리프트 \(SUBJECT B, 188 cm\) is taller than 에단 \(SUBJECT A, 180 cm\)/);
    assert.doesNotMatch(block, /에단.*is taller than 리프트/i);
  });

  it("RELATIVE-HEIGHT-2 A 188 B 180 — A taller than B", () => {
    const subjects = duoSubjects({ aHeight: "키 188cm", bHeight: "키 180cm" });
    const block = renderCrossSubjectRelativeStature(subjects);
    assert.match(block, /에단 \(SUBJECT A, 188 cm\) is taller than 리프트 \(SUBJECT B, 180 cm\)/);
  });

  it("RELATIVE-HEIGHT-3 equal height — no taller/shorter contract", () => {
    const subjects = duoSubjects({ aHeight: "키 185cm", bHeight: "185 cm" });
    assert.equal(renderCrossSubjectRelativeStature(subjects), "");
  });

  it("RELATIVE-HEIGHT-4 A only has height — no relative comparison", () => {
    const subjects = duoSubjects({
      aHeight: "키 180cm",
      bHeight: "black irises, red pupils",
    });
    assert.equal(renderCrossSubjectRelativeStature(subjects), "");
  });

  it("RELATIVE-HEIGHT-5 sitting scene — stature contract without screen-position rule", () => {
    const subjects = duoSubjects({ aHeight: "키 180cm", bHeight: "키 188cm" });
    const prompt = buildChatLdIllustrationPrompt({
      characterName: "에단",
      characterGender: "male",
      personaName: "리프트",
      personaGender: "female",
      currentTurn: "리프트가 의자에 앉아 있고 에단은 옆에 기대어 있다.",
      subjects,
    });
    const block = statureBlock(prompt);
    assert.match(block, /리프트.*is taller than 에단/i);
    assert.doesNotMatch(prompt, /must (?:always )?appear higher on the canvas/i);
    assert.doesNotMatch(prompt, /head must always be above/i);
    assert.match(
      prompt,
      /Let on-screen vertical placement follow pose, sitting, leaning, bending, perspective, and camera distance while preserving believable relative body stature/i
    );
  });

  it("RELATIVE-HEIGHT-6 route parity LD / comic / TR use same owner", () => {
    const subjects = duoSubjects({ aHeight: "키 180cm", bHeight: "키 188cm" });
    const expected = /리프트 \(SUBJECT B, 188 cm\) is taller than 에단 \(SUBJECT A, 180 cm\)/;

    const ld = buildChatLdIllustrationPrompt({
      characterName: "에단",
      characterGender: "male",
      personaName: "리프트",
      personaGender: "female",
      currentTurn: "카페에서 대화한다.",
      subjects,
    });
    assert.match(statureBlock(ld), expected);

    const comic = buildChatComicGenerationPlan({
      characterName: "에단",
      characterGender: "male",
      personaName: "리프트",
      personaGender: "female",
      characterImageUrl: "/c.webp",
      characterSavedAppearance: "키 180cm",
      characterAppearanceMode: "image_plus_saved",
      personaImageUrl: "/p.webp",
      personaSavedAppearance: "키 188cm",
      personaAppearanceMode: "image_plus_saved",
      plan: buildDeterministicScenePlan(
        buildSceneSourceMessages([
          { id: 1, role: "user", content: "안녕" },
          { id: 2, role: "assistant", content: "그래." },
        ]),
        2
      ),
    }).prompt;
    assert.match(statureBlock(comic), expected);

    const tr = buildChatLdIllustrationPrompt({
      characterName: "에단",
      characterGender: "male",
      personaName: "리프트",
      personaGender: "female",
      currentTurn: "GM SCENE: The party stands in a hall.",
      fullSource: "LOCATION: hall\nGM SCENE: The party stands in a hall.",
      cast: [
        {
          name: "에단",
          gender: "male",
          role: "companion",
          referenceIndex: 1,
          appearanceNote: "키 180cm",
          appearanceMode: "image_plus_saved",
          imageUrl: "/c.webp",
        },
        {
          name: "리프트",
          gender: "female",
          role: "player",
          referenceIndex: 2,
          appearanceNote: "키 188cm",
          appearanceMode: "image_plus_saved",
          imageUrl: "/p.webp",
        },
      ],
      subjects,
    });
    assert.match(statureBlock(tr), expected);
  });

  it("RELATIVE-HEIGHT-7 strict trusted image_plus_saved preserves height relation", () => {
    const subjects = duoSubjects({ aHeight: "키 180cm", bHeight: "키 188cm" });
    const strict = buildStrictLdDuoFallbackPrompt({
      characterName: "에단",
      characterGender: "male",
      personaName: "리프트",
      personaGender: "female",
      subjects,
      sceneSourceText: "카페에서 대화한다.",
      adultGrounded: false,
    });
    assert.match(statureBlock(strict), /리프트.*is taller than 에단/i);

    const comicStrict = buildStrictComicFallbackPrompt({
      panelCount: 2,
      characterName: "에단",
      characterGender: "male",
      personaName: "리프트",
      personaGender: "female",
      subjects,
    });
    assert.match(statureBlock(comicStrict), /리프트.*is taller than 에단/i);
  });

  it("RELATIVE-HEIGHT-8 image_only persona does not activate hidden saved height", () => {
    const subjects = duoSubjects({
      aHeight: "키 180cm",
      bSaved: "키 188cm",
      bMode: "image_only",
    });
    assert.equal(renderCrossSubjectRelativeStature(subjects), "");
    const prepared = prepareSubjectsForStrictFallback(subjects);
    assert.equal(prepared[1]!.appearanceMode, "image_only");
    assert.equal(prepared[1]!.savedAppearance, "");
    const strict = buildStrictLdDuoFallbackPrompt({
      characterName: "에단",
      characterGender: "male",
      personaName: "리프트",
      personaGender: "female",
      subjects,
      sceneSourceText: "explicit prose should not leak",
      adultGrounded: false,
    });
    assert.doesNotMatch(strict, /188 cm/);
    assert.doesNotMatch(statureBlock(strict), /is taller than/i);
  });

  it("parseNumericHeightCm supports canonical height formats", () => {
    assert.equal(parseNumericHeightCm("180cm"), 180);
    assert.equal(parseNumericHeightCm("180 cm"), 180);
    assert.equal(parseNumericHeightCm("키 180cm"), 180);
    assert.equal(parseNumericHeightCm("신장 180cm"), 180);
    assert.equal(parseNumericHeightCm("height 180 cm"), 180);
    assert.equal(parseNumericHeightCm("height: 180cm"), 180);
    assert.equal(parseNumericHeightCm("커 보인다"), null);
    assert.equal(parseNumericHeightCm("허리 188cm"), null);
    assert.equal(parseNumericHeightCm("검 길이 180cm"), null);
    assert.equal(parseNumericHeightCm("검 길이 180cm, 신장 188cm"), 188);
  });

  it("structural probe — renderChatImageVisualIdentity includes stature block", () => {
    const subjects = duoSubjects({ aHeight: "키 180cm", bHeight: "키 188cm" });
    const identity = renderChatImageVisualIdentity({ subjects, hasTemplate: false });
    assert.match(identity, /CROSS-SUBJECT RELATIVE STATURE/);
    assert.match(identity, /by approximately 8 cm/);
  });
});

describe("chatImageHeightPath — production resolver parity", () => {
  it("HEIGHT-PATH-1 bare 188cm survives persona resolver path", () => {
    const resolved = resolvePersonaSavedAppearance("188cm");
    assert.match(resolved, /188\s*cm/i);
    assert.equal(parseNumericHeightCm(resolved), 188);
  });

  it("HEIGHT-PATH-2 신장 188cm survives persona resolver path", () => {
    const resolved = resolvePersonaSavedAppearance("신장 188cm");
    assert.match(resolved, /188\s*cm/i);
    assert.equal(parseNumericHeightCm(resolved), 188);
  });

  it("HEIGHT-PATH-3 height: 188cm survives persona resolver path", () => {
    const resolved = resolvePersonaSavedAppearance("height: 188cm");
    assert.match(resolved, /188\s*cm/i);
    assert.equal(parseNumericHeightCm(resolved), 188);
  });

  it("HEIGHT-PATH-4 허리 188cm is NOT height evidence", () => {
    assert.equal(resolvePersonaSavedAppearance("허리 188cm"), "");
    assert.equal(parseNumericHeightCm("허리 188cm"), null);
  });

  it("HEIGHT-PATH-5 검 길이 180cm is NOT height evidence", () => {
    assert.equal(resolvePersonaSavedAppearance("검 길이 180cm"), "");
    assert.equal(parseNumericHeightCm("검 길이 180cm"), null);
  });

  it("HEIGHT-PATH-6 production-like 180/188 resolver → final stature relation", () => {
    const characterSaved = resolveCharacterSavedAppearance({
      appearanceRaw: "검은 머리, 키 180cm",
    });
    const personaSaved = resolvePersonaSavedAppearance(
      "검은 머리, 붉은 동공, 188cm"
    );
    assert.match(characterSaved, /180\s*cm/i);
    assert.match(personaSaved, /188\s*cm/i);

    const subjects = bindChatImageReferencePack({
      subjectsInImageOrder: buildChatDuoVisualSubjects({
        characterName: "에단",
        characterGender: "male",
        characterImageUrl: "/c.webp",
        characterSavedAppearance: characterSaved,
        characterAppearanceMode: "image_plus_saved",
        personaName: "리프트",
        personaGender: "female",
        personaImageUrl: "/p.webp",
        personaSavedAppearance: personaSaved,
        personaAppearanceMode: "image_plus_saved",
      }),
    }).subjects;

    const identity = renderChatImageVisualIdentity({ subjects, hasTemplate: false });
    assert.match(
      identity,
      /리프트 \(SUBJECT B, 188 cm\) is taller than 에단 \(SUBJECT A, 180 cm\) by approximately 8 cm/
    );
  });

  it("HEIGHT-PATH-7 labeled height wins over unrelated cm measurement", () => {
    assert.equal(parseNumericHeightCm("체격은 마른 편. 신장 188cm."), 188);
    assert.equal(parseNumericHeightCm("검 길이 180cm, 신장 188cm"), 188);
    const resolved = resolvePersonaSavedAppearance("검 길이 180cm, 신장 188cm");
    assert.match(resolved, /신장 188cm/);
    assert.doesNotMatch(resolved, /검 길이 180cm/);
  });
});
