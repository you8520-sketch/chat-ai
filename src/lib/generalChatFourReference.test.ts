import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  CHAT_IMAGE_CAST_HIGH_FIDELITY_CAP,
  CHAT_IMAGE_CAST_IDENTITY_REFERENCE_CAP,
  CHAT_IMAGE_CAST_MAX_SELECTED,
  CHAT_IMAGE_CAST_MAX_SELECTED_ERROR,
  parseCastIntentManifest,
  type ChatImageCastIntentManifest,
} from "@/lib/chatImageCast";
import {
  bindApprovedCastManifest,
  groundCastIntent,
  renderCastFidelityTiers,
  type GroundCastContext,
} from "@/lib/chatImageCastManifest";
import {
  describeReferenceOrder,
  type ChatImageVisualSubject,
} from "@/lib/chatImageVisualIdentity";
import {
  buildChatComicGenerationPlan,
  CHAT_COMIC_TEMPLATE_PREVIEW_URL,
} from "@/lib/chatComicGeneration";
import { buildComicProviderReferences } from "@/lib/chatComicReferenceIsolation";
import { buildStrictComicFallbackPrompt } from "@/lib/chatImageStrictSafetyFallbackPrompt";
import {
  buildDeterministicScenePlan,
  buildSceneSourceMessages,
} from "@/lib/chatImageScenePlan";
import {
  CHAT_IMAGE_REFERENCE_SURCHARGE_POINTS,
  CHAT_ROOM_IMAGE_GENERATION_POINTS,
  resolveImageGenerationRequiredPoints,
  resolveImageIdentityReferenceSurcharge,
} from "@/lib/chatImagePricing";
import { createVisualSubjectKey } from "@/lib/visualSubjects";

const PERSONA_URL = "/synthetic/user-persona-primary.webp";
const MAIN_URL = "/synthetic/character-a-primary.webp";

function supportUrl(index: number): string {
  return `/synthetic/support-${index}.webp`;
}

function castContext(count: number): GroundCastContext {
  const selectableAssets: GroundCastContext["selectableAssets"] = [];
  const visualSubjects: NonNullable<GroundCastContext["visualSubjects"]> = [];
  const characterAssets: GroundCastContext["characterAssets"] = [
    { url: MAIN_URL, tag: "CharacterA" },
    { url: PERSONA_URL, tag: "UserPersona" },
  ];
  for (let index = 1; index <= count + 2; index += 1) {
    const url = supportUrl(index);
    const key = createVisualSubjectKey();
    characterAssets.push({ url, tag: `Support${index}`, visualSubjectKey: key });
    selectableAssets.push({ url, tag: `Support${index}`, visualSubjectKey: key });
    visualSubjects.push({
      subjectKey: key,
      name: `Support${index}`,
      savedAppearance: `appearance ${index}`,
      representativeAssetUrl: url,
      sourceCharacterId: null,
    });
  }
  return {
    persona: {
      name: "UserPersona",
      gender: "female",
      referenceImageUrl: PERSONA_URL,
      savedAppearance: "",
      appearanceMode: "image_only",
    },
    mainCharacter: {
      name: "CharacterA",
      gender: "male",
      referenceImageUrl: MAIN_URL,
      savedAppearance: "",
      appearanceMode: "image_only",
    },
    selectableAssets,
    visualSubjects,
    characterAssets,
  };
}

function coreIntent(): ChatImageCastIntentManifest {
  return {
    compositionGoal: "auto",
    subjects: [
      {
        key: "persona",
        role: "persona",
        name: "UserPersona",
        included: true,
        importance: "primary",
        visibility: "required_visible",
      },
      {
        key: "main_character",
        role: "main_character",
        name: "CharacterA",
        included: true,
        importance: "primary",
        visibility: "required_visible",
      },
    ],
  };
}

function addSupport(count: number): ChatImageCastIntentManifest["subjects"] {
  const base = coreIntent();
  const extra = Array.from({ length: count }, (_, offset) => {
    const index = offset + 1;
    return {
      key: `supporting:Support${index}`,
      role: "supporting_character" as const,
      name: `Support${index}`,
      included: true,
      importance: "primary" as const,
      visibility: "required_visible" as const,
      requestedReferenceAssetUrl: supportUrl(index),
    };
  });
  return [...base.subjects, ...extra];
}

function groundedFor(count: number) {
  const grounded = groundCastIntent(
    { ...coreIntent(), subjects: addSupport(count) },
    castContext(count)
  );
  assert.equal(grounded.ok, true, grounded.ok ? "" : grounded.reason);
  if (!grounded.ok) throw new Error(grounded.reason);
  return grounded.manifest;
}

function comicPlanFor(count: number) {
  const plan = buildDeterministicScenePlan(
    buildSceneSourceMessages([
      {
        id: 1,
        role: "assistant",
        content: [
          "캐릭터들이 한자리에 모였다.",
          'UserPersona: "다 같이 가자."',
          'CharacterA: "좋아."',
        ].join("\n"),
      },
    ]),
    4,
    { personaName: "UserPersona", characterName: "CharacterA" }
  );
  return buildChatComicGenerationPlan({
    characterName: "CharacterA",
    characterGender: "male",
    personaName: "UserPersona",
    personaGender: "female",
    characterImageUrl: MAIN_URL,
    characterSavedAppearance: "",
    characterAppearanceMode: "image_only",
    personaImageUrl: PERSONA_URL,
    personaSavedAppearance: "",
    personaAppearanceMode: "image_only",
    mood: "comic",
    plan,
    castManifest: groundedFor(count),
    contentKind: "character",
    compositionMode: "full_provider_rendered",
  });
}

describe("general chat physical 4-identity-reference support (PR-A)", () => {
  it("BUDGET config: physical reference budget is 4; fidelity guarantee stays a separate 3", () => {
    assert.equal(CHAT_IMAGE_CAST_IDENTITY_REFERENCE_CAP, 4);
    assert.equal(CHAT_IMAGE_CAST_MAX_SELECTED, 4);
    assert.equal(CHAT_IMAGE_CAST_HIGH_FIDELITY_CAP, 3);
    // The fidelity guarantee is intentionally not the physical attachment budget.
    assert.ok(CHAT_IMAGE_CAST_HIGH_FIDELITY_CAP < CHAT_IMAGE_CAST_IDENTITY_REFERENCE_CAP);
  });

  it("ILLUSTRATION 2 refs -> 2 attachments (persona + main)", () => {
    const bound = bindApprovedCastManifest(groundedFor(0));
    assert.deepEqual(bound.referenceUrls, [PERSONA_URL, MAIN_URL]);
    assert.deepEqual(
      bound.subjects.map((subject) => subject.referenceIndex),
      [1, 2]
    );
  });

  it("ILLUSTRATION 3 refs -> 3 attachments (persona + main + support1)", () => {
    const bound = bindApprovedCastManifest(groundedFor(1));
    assert.deepEqual(bound.referenceUrls, [PERSONA_URL, MAIN_URL, supportUrl(1)]);
    assert.deepEqual(
      bound.subjects.map((subject) => subject.referenceIndex),
      [1, 2, 3]
    );
  });

  it("ILLUSTRATION 4 refs -> 4 provider attachments in canonical identity order", () => {
    const bound = bindApprovedCastManifest(groundedFor(2));
    assert.deepEqual(bound.referenceUrls, [
      PERSONA_URL,
      MAIN_URL,
      supportUrl(1),
      supportUrl(2),
    ]);
    assert.deepEqual(
      bound.subjects.map((subject) => subject.referenceIndex),
      [1, 2, 3, 4]
    );
    // no reference bleed: each subject maps only to its own URL
    const byIndex = new Map(
      bound.subjects.map((subject) => [subject.referenceIndex, subject.referenceImageUrl])
    );
    assert.equal(byIndex.get(1), PERSONA_URL);
    assert.equal(byIndex.get(2), MAIN_URL);
    assert.equal(byIndex.get(3), supportUrl(1));
    assert.equal(byIndex.get(4), supportUrl(2));
  });

  it("COMIC 2 refs -> template + 2 identity attachments", () => {
    const plan = comicPlanFor(0);
    const refs = buildComicProviderReferences({
      referenceUrls: plan.referenceUrls,
      subjects: plan.subjects,
    });
    assert.equal(refs.length, 3);
    assert.equal(refs[0]?.role, "template");
    assert.equal(refs.filter((ref) => ref.role !== "template").length, 2);
    assert.deepEqual(plan.referenceUrls, [CHAT_COMIC_TEMPLATE_PREVIEW_URL, PERSONA_URL, MAIN_URL]);
  });

  it("COMIC 3 refs -> template + 3 identity attachments", () => {
    const plan = comicPlanFor(1);
    const refs = buildComicProviderReferences({
      referenceUrls: plan.referenceUrls,
      subjects: plan.subjects,
    });
    assert.equal(refs.length, 4);
    assert.equal(refs.filter((ref) => ref.role !== "template").length, 3);
    assert.deepEqual(plan.referenceUrls, [
      CHAT_COMIC_TEMPLATE_PREVIEW_URL,
      PERSONA_URL,
      MAIN_URL,
      supportUrl(1),
    ]);
  });

  it("COMIC 4 refs -> template + 4 identity attachments with exact ownership", () => {
    const plan = comicPlanFor(2);
    const refs = buildComicProviderReferences({
      referenceUrls: plan.referenceUrls,
      subjects: plan.subjects,
    });
    assert.equal(refs.length, 5, "template + 4 identity attachments");
    assert.equal(refs.filter((ref) => ref.role !== "template").length, 4);
    assert.deepEqual(plan.referenceUrls, [
      CHAT_COMIC_TEMPLATE_PREVIEW_URL,
      PERSONA_URL,
      MAIN_URL,
      supportUrl(1),
      supportUrl(2),
    ]);
    const owners = describeReferenceOrder({
      referenceUrls: plan.referenceUrls,
      subjects: plan.subjects,
      templateUrl: CHAT_COMIC_TEMPLATE_PREVIEW_URL,
    });
    assert.equal(owners[0]?.owner, "template / composition only");
    assert.match(owners[1]?.owner ?? "", /user persona: UserPersona/);
    assert.match(owners[2]?.owner ?? "", /chat character: CharacterA/);
    assert.match(owners[3]?.owner ?? "", /supporting character: Support1/);
    assert.match(owners[4]?.owner ?? "", /supporting character: Support2/);
  });

  it("TIER2 4 refs: strict fallback prompt keeps the same 4 grounded identities", () => {
    const manifest = groundedFor(2);
    const plan = comicPlanFor(2);
    const strict = buildStrictComicFallbackPrompt({
      panelCount: 4,
      mood: "comic",
      characterName: "CharacterA",
      characterGender: "male",
      personaName: "UserPersona",
      personaGender: "female",
      subjects: plan.subjects as readonly ChatImageVisualSubject[],
      castManifest: manifest,
      castSelected: manifest.subjects.filter((subject) => subject.included),
      contentKind: "character",
      compositionMode: "full_provider_rendered",
    });
    for (const name of ["UserPersona", "CharacterA", "Support1", "Support2"]) {
      assert.match(strict, new RegExp(name), `Tier2 keeps identity ${name}`);
    }
    // Comic template occupies slot 1, so identity slots are 2..5 and each slot
    // stays owned by exactly one identity in the strict fallback prompt.
    assert.match(strict, /Image 2 belongs ONLY to UserPersona/);
    assert.match(strict, /Image 5 belongs ONLY to Support2/);
    // Fidelity promise budget is shared with Tier1 (same canonical owner):
    // exactly 3 HIGH FIDELITY subjects, the 4th physical identity is SECONDARY,
    // and the 4th identity is NOT removed from the strict provider pack.
    assert.match(strict, /at most 3 subjects with bound identity evidence/);
    const strictHigh = strict
      .split("\n")
      .filter((line) => /HIGH FIDELITY/.test(line));
    assert.equal(strictHigh.length, CHAT_IMAGE_CAST_HIGH_FIDELITY_CAP);
    assert.match(strict, /Support2: SECONDARY fidelity/);
    assert.doesNotMatch(strict, /Support2: HIGH FIDELITY/);
    assert.match(strict, /Image 5 belongs ONLY to Support2/);
  });

  it("NORMAL-4-FIDELITY-BUDGET: 4 physical refs, exactly 3 HIGH FIDELITY, 4th SECONDARY", () => {
    const bound = bindApprovedCastManifest(groundedFor(2));
    assert.equal(bound.referenceUrls.length, 4);
    assert.deepEqual(bound.referenceUrls, [
      PERSONA_URL,
      MAIN_URL,
      supportUrl(1),
      supportUrl(2),
    ]);
    const fidelity = renderCastFidelityTiers(bound.selected, bound.subjects);
    assert.match(fidelity, /at most 3 subjects with bound identity evidence/);
    const high = fidelity.split("\n").filter((line) => /HIGH FIDELITY/.test(line));
    assert.equal(high.length, CHAT_IMAGE_CAST_HIGH_FIDELITY_CAP);
    assert.equal(high.length, 3);
    assert.match(fidelity, /UserPersona: HIGH FIDELITY primary/);
    assert.match(fidelity, /CharacterA: HIGH FIDELITY primary/);
    assert.match(fidelity, /Support1: HIGH FIDELITY primary/);
    assert.match(fidelity, /Support2: SECONDARY fidelity/);
    assert.doesNotMatch(fidelity, /Support2: HIGH FIDELITY/);
  });

  it("THREE-PERSON: 3-person fidelity behavior is unchanged", () => {
    const bound = bindApprovedCastManifest(groundedFor(1));
    assert.deepEqual(bound.referenceUrls, [PERSONA_URL, MAIN_URL, supportUrl(1)]);
    const fidelity = renderCastFidelityTiers(bound.selected, bound.subjects);
    assert.match(
      fidelity,
      /Subjects with bound identity evidence must stay visually distinct\./
    );
    assert.doesNotMatch(fidelity, /at most 3 subjects/);
    const high = fidelity.split("\n").filter((line) => /HIGH FIDELITY/.test(line));
    assert.equal(high.length, 3);
    assert.ok(
      high.every((line) => /: HIGH FIDELITY\./.test(line)),
      "3-person keeps plain HIGH FIDELITY with no primary/secondary split"
    );
  });

  it("5th cast member is server-rejected", () => {
    const parsed = parseCastIntentManifest({
      compositionGoal: "auto",
      subjects: addSupport(3),
    });
    assert.ok(parsed);
    const grounded = groundCastIntent(parsed, castContext(3));
    assert.equal(grounded.ok, false);
    assert.equal(grounded.ok ? "" : grounded.reason, CHAT_IMAGE_CAST_MAX_SELECTED_ERROR);
  });

  it("non-selectable supporting asset is rejected (no unvalidated URL reaches provider)", () => {
    const intent: ChatImageCastIntentManifest = {
      ...coreIntent(),
      subjects: [
        ...coreIntent().subjects,
        {
          key: "supporting:Support1",
          role: "supporting_character",
          name: "Support1",
          included: true,
          importance: "primary",
          visibility: "required_visible",
          requestedReferenceAssetUrl: "/uploads/not-selectable.webp",
        },
      ],
    };
    const grounded = groundCastIntent(intent, castContext(1));
    assert.equal(grounded.ok, false);
  });

  it("PRICING 4 actual grounded refs -> base + 40P (220P) via the canonical owner", () => {
    assert.equal(CHAT_ROOM_IMAGE_GENERATION_POINTS, 180);
    assert.equal(resolveImageIdentityReferenceSurcharge(4), 40);
    assert.equal(resolveImageGenerationRequiredPoints(4), 220);
    assert.equal(
      resolveImageGenerationRequiredPoints(4),
      CHAT_ROOM_IMAGE_GENERATION_POINTS + 2 * CHAT_IMAGE_REFERENCE_SURCHARGE_POINTS
    );
    // The illustration + comic packs yield the identical grounded count.
    assert.equal(bindApprovedCastManifest(groundedFor(2)).referenceUrls.length, 4);
    const comicRefs = buildComicProviderReferences({
      referenceUrls: comicPlanFor(2).referenceUrls,
      subjects: comicPlanFor(2).subjects,
    });
    assert.equal(comicRefs.filter((ref) => ref.role !== "template").length, 4);
  });
});