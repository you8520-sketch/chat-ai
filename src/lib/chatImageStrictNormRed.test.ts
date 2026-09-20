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
