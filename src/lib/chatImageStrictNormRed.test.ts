import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  buildStrictComicFallbackPrompt,
  buildStrictLdDuoFallbackPrompt,
} from "@/lib/chatImageStrictSafetyFallbackPrompt";
import {
  normalizeSavedAppearanceForProvider,
  parseEyeTraitsFromClause,
} from "@/lib/chatImageEyeTraits";
import {
  clipSavedAppearanceForStrictFallback,
  prepareSubjectsForStrictFallback,
  renderChatImageSubjectManifest,
  renderCrossSubjectTraitIsolation,
  type ChatImageVisualSubject,
} from "@/lib/chatImageVisualIdentity";
import { SYNTHETIC_CHARACTER_A_APPEARANCE } from "@/lib/chatImageVisualIdentity.fixtures";

const EDAN_RAW = SYNTHETIC_CHARACTER_A_APPEARANCE;
const LIFT_RAW = "black irises, red pupils";

const STRICT_NORM_SUBJECTS: ChatImageVisualSubject[] = [
  {
    key: "character",
    name: "에단",
    gender: "male",
    role: "chat character",
    referenceImageUrl: "/c.webp",
    referenceIndex: 2,
    savedAppearance: EDAN_RAW,
    appearanceMode: "image_plus_saved",
    sourceKind: "main_character",
  },
  {
    key: "persona",
    name: "리프트",
    gender: "female",
    role: "user persona",
    referenceImageUrl: "/p.webp",
    referenceIndex: 3,
    savedAppearance: LIFT_RAW,
    appearanceMode: "image_plus_saved",
    sourceKind: "persona",
  },
];

function subjectBlock(prompt: string, letter: "A" | "B"): string {
  const match = prompt.match(
    new RegExp(`\\[SUBJECT ${letter}[\\s\\S]*?(?=\\[SUBJECT [A-Z]|\\nSTYLE FIDELITY|$)`)
  );
  return match?.[0] ?? "";
}

function assertEyeSemantics(
  block: string,
  subjectName: string,
  expected: { iris: string; pupil: string }
) {
  assert.match(
    block,
    new RegExp(`${subjectName} ONLY — Iris color: ${expected.iris}`, "i")
  );
  assert.match(
    block,
    new RegExp(`${subjectName} ONLY — Pupil color: ${expected.pupil}`, "i")
  );
  const wrongIris = expected.iris === "red" ? "black" : "red";
  const wrongPupil = expected.pupil === "red" ? "black" : "red";
  assert.doesNotMatch(
    block,
    new RegExp(`${subjectName} ONLY — Iris color: ${wrongIris}`, "i")
  );
  assert.doesNotMatch(
    block,
    new RegExp(`${subjectName} ONLY — Pupil color: ${wrongPupil}`, "i")
  );
}

describe("chatImageStrictNorm — normalization owner", () => {
  it("STRICT-NORM-RED rendered prompt text must not be re-parsed as semantic source", () => {
    const rendered = normalizeSavedAppearanceForProvider(EDAN_RAW, {
      subjectName: "에단",
    });
    const reparsedTraits = parseEyeTraitsFromClause(rendered);
    assert.equal(
      reparsedTraits.pupilColor,
      "red",
      "guard prose in rendered text is not valid semantic input"
    );
    const secondPass = normalizeSavedAppearanceForProvider(rendered, {
      subjectName: "에단",
    });
    assert.equal(rendered, secondPass);
    assert.match(secondPass, /에단 ONLY — Pupil color: black/);
    assert.doesNotMatch(secondPass, /에단 ONLY — Pupil color: red/);
  });

  it("STRICT-NORM-1 strict comic exact trait parity with stage trace", () => {
    const clipA = clipSavedAppearanceForStrictFallback(STRICT_NORM_SUBJECTS[0]!);
    const prepared = prepareSubjectsForStrictFallback(STRICT_NORM_SUBJECTS);
    const manifestA = renderChatImageSubjectManifest(prepared[0]!, 0);
    const manifestB = renderChatImageSubjectManifest(prepared[1]!, 1);
    const isolation = renderCrossSubjectTraitIsolation(prepared);

    assert.doesNotMatch(clipA, /Immutable eye traits for/);
    assert.doesNotMatch(prepared[0]!.savedAppearance, /ONLY —/);
    const clipTraits = parseEyeTraitsFromClause(clipA);
    assert.equal(clipTraits.irisColor, "red");
    assert.equal(clipTraits.pupilColor, "black");

    assertEyeSemantics(manifestA, "에단", { iris: "red", pupil: "black" });
    assertEyeSemantics(manifestB, "리프트", { iris: "black", pupil: "red" });

    const strict = buildStrictComicFallbackPrompt({
      panelCount: 4,
      characterName: "에단",
      characterGender: "male",
      personaName: "리프트",
      personaGender: "female",
      subjects: STRICT_NORM_SUBJECTS,
      compositionMode: "full_provider_rendered",
    });
    assertEyeSemantics(subjectBlock(strict, "A"), "에단", {
      iris: "red",
      pupil: "black",
    });
    assertEyeSemantics(subjectBlock(strict, "B"), "리프트", {
      iris: "black",
      pupil: "red",
    });

    assert.match(isolation, /에단 \(SUBJECT A\):.*iris red.*pupil black/i);
    assert.match(isolation, /리프트 \(SUBJECT B\):.*iris black.*pupil red/i);
    assert.doesNotMatch(isolation, /에단.*pupil red/i);
    assert.doesNotMatch(isolation, /리프트.*iris red/i);
  });

  it("STRICT-NORM-2 strict LD exact trait parity", () => {
    const strict = buildStrictLdDuoFallbackPrompt({
      characterName: "에단",
      characterGender: "male",
      personaName: "리프트",
      personaGender: "female",
      subjects: STRICT_NORM_SUBJECTS,
      sceneSourceText: "카페에서 대화한다.",
      adultGrounded: false,
    });
    assertEyeSemantics(strict, "에단", { iris: "red", pupil: "black" });
    assertEyeSemantics(strict, "리프트", { iris: "black", pupil: "red" });
    assert.match(strict, /CROSS-SUBJECT IMMUTABLE TRAIT ISOLATION/);
  });

  it("STRICT-ISOLATION-1 isolation parses sanitized raw not rendered guards", () => {
    const prepared = prepareSubjectsForStrictFallback(STRICT_NORM_SUBJECTS);
    const isolation = renderCrossSubjectTraitIsolation(prepared);
    assert.match(isolation, /에단 \(SUBJECT A\):.*iris red.*pupil black/i);
    assert.match(isolation, /리프트 \(SUBJECT B\):.*iris black.*pupil red/i);
  });
});

describe("chatImageStrictMode — image_only safety boundary", () => {
  it("STRICT-MODE-1 image_only trusted main never consumes saved prose", () => {
    const subject: ChatImageVisualSubject = {
      key: "character",
      name: "태현",
      gender: "male",
      role: "character",
      referenceImageUrl: "/c.webp",
      referenceIndex: 2,
      savedAppearance: "explicit prose should not leak",
      appearanceMode: "image_only",
      sourceKind: "main_character",
    };
    assert.equal(clipSavedAppearanceForStrictFallback(subject), "");
    const prepared = prepareSubjectsForStrictFallback([subject])[0]!;
    assert.equal(prepared.savedAppearance, "");
    assert.equal(prepared.appearanceMode, "image_only");
    const manifest = renderChatImageSubjectManifest(prepared, 0);
    assert.doesNotMatch(manifest, /explicit prose should not leak/);
    const strict = buildStrictComicFallbackPrompt({
      panelCount: 2,
      characterName: "태현",
      characterGender: "male",
      personaName: "유저",
      personaGender: "female",
      subjects: [subject],
    });
    assert.doesNotMatch(strict, /explicit prose should not leak/);
  });

  it("STRICT-MODE-2 image_plus_saved trusted main preserves visual eye traits", () => {
    const subject: ChatImageVisualSubject = {
      key: "character",
      name: "에단",
      gender: "male",
      role: "character",
      referenceImageUrl: "/c.webp",
      referenceIndex: 2,
      savedAppearance: "black pupils, red irises",
      appearanceMode: "image_plus_saved",
      sourceKind: "main_character",
    };
    const clipped = clipSavedAppearanceForStrictFallback(subject);
    assert.match(clipped, /black pupils/i);
    assert.match(clipped, /red irises/i);
    const prepared = prepareSubjectsForStrictFallback([subject])[0]!;
    assert.equal(prepared.appearanceMode, "image_plus_saved");
    const manifest = renderChatImageSubjectManifest(prepared, 0);
    assertEyeSemantics(manifest, "에단", { iris: "red", pupil: "black" });
  });

  it("STRICT-MODE-3 trusted persona with non-visual lore strips prose and downgrades mode", () => {
    const subject: ChatImageVisualSubject = {
      key: "persona",
      name: "리프트",
      gender: "female",
      role: "persona",
      referenceImageUrl: "/p.webp",
      referenceIndex: 3,
      savedAppearance: "this is relationship lore and not visual appearance",
      appearanceMode: "image_plus_saved",
      sourceKind: "persona",
    };
    assert.equal(clipSavedAppearanceForStrictFallback(subject), "");
    const prepared = prepareSubjectsForStrictFallback([subject])[0]!;
    assert.equal(prepared.savedAppearance, "");
    assert.equal(prepared.appearanceMode, "image_only");
    const strict = buildStrictComicFallbackPrompt({
      panelCount: 2,
      characterName: "A",
      characterGender: "male",
      personaName: "리프트",
      personaGender: "female",
      subjects: [subject],
    });
    assert.doesNotMatch(strict, /relationship lore/i);
  });

  it("STRICT-MODE-4 untrusted supporting cast strips text and uses image_only", () => {
    const subject: ChatImageVisualSubject = {
      key: "support-1",
      name: "조연",
      gender: "female",
      role: "supporting",
      referenceImageUrl: "/support.webp",
      referenceIndex: 3,
      savedAppearance: "arbitrary injected text",
      appearanceMode: "image_plus_saved",
      sourceKind: "cast_member",
    };
    assert.equal(clipSavedAppearanceForStrictFallback(subject), "");
    const prepared = prepareSubjectsForStrictFallback([subject])[0]!;
    assert.equal(prepared.savedAppearance, "");
    assert.equal(prepared.appearanceMode, "image_only");
  });

  it("STRICT-IMAGE-ONLY-1 image_only trusted main with saved text absent from strict prompt", () => {
    const subject: ChatImageVisualSubject = {
      key: "character",
      name: "Main",
      gender: "male",
      role: "character",
      referenceImageUrl: "/c.webp",
      referenceIndex: 2,
      savedAppearance: "explicit prose should not leak",
      appearanceMode: "image_only",
      sourceKind: "main_character",
    };
    assert.equal(clipSavedAppearanceForStrictFallback(subject), "");
    const prepared = prepareSubjectsForStrictFallback([subject])[0]!;
    assert.equal(prepared.appearanceMode, "image_only");
    const strict = buildStrictComicFallbackPrompt({
      panelCount: 2,
      characterName: "Main",
      characterGender: "male",
      personaName: "User",
      personaGender: "female",
      subjects: [subject],
    });
    assert.doesNotMatch(strict, /explicit prose should not leak/);
  });

  it("STRICT-NONVISUAL-TRUSTED-1 image_plus_saved trusted but no visual clause strips raw prose", () => {
    const subject: ChatImageVisualSubject = {
      key: "persona",
      name: "User",
      gender: "female",
      role: "persona",
      referenceImageUrl: "/p.webp",
      referenceIndex: 3,
      savedAppearance: "this is relationship lore and not visual appearance",
      appearanceMode: "image_plus_saved",
      sourceKind: "persona",
    };
    assert.equal(clipSavedAppearanceForStrictFallback(subject), "");
    const prepared = prepareSubjectsForStrictFallback([subject])[0]!;
    assert.equal(prepared.savedAppearance, "");
    assert.equal(prepared.appearanceMode, "image_only");
  });

  it("STRICT-IMAGE-PLUS-VISUAL-1 image_plus_saved trusted visual traits preserved end-to-end", () => {
    const subject: ChatImageVisualSubject = {
      key: "character",
      name: "에단",
      gender: "male",
      role: "character",
      referenceImageUrl: "/c.webp",
      referenceIndex: 2,
      savedAppearance: "black pupils, red irises",
      appearanceMode: "image_plus_saved",
      sourceKind: "main_character",
    };
    const prepared = prepareSubjectsForStrictFallback([subject])[0]!;
    assert.equal(prepared.appearanceMode, "image_plus_saved");
    const strict = buildStrictComicFallbackPrompt({
      panelCount: 2,
      characterName: "에단",
      characterGender: "male",
      personaName: "User",
      personaGender: "female",
      subjects: [subject],
    });
    assertEyeSemantics(strict, "에단", { iris: "red", pupil: "black" });
  });

  it("STRICT-UNTRUSTED-1 untrusted cast strips saved text even with image_plus_saved mode", () => {
    const subject: ChatImageVisualSubject = {
      key: "support-1",
      name: "조연",
      gender: "female",
      role: "supporting",
      referenceImageUrl: "/support.webp",
      referenceIndex: 3,
      savedAppearance: "red irises, black pupils",
      appearanceMode: "image_plus_saved",
      sourceKind: "cast_member",
    };
    assert.equal(clipSavedAppearanceForStrictFallback(subject), "");
    const prepared = prepareSubjectsForStrictFallback([subject])[0]!;
    assert.equal(prepared.savedAppearance, "");
    assert.equal(prepared.appearanceMode, "image_only");
  });
});
