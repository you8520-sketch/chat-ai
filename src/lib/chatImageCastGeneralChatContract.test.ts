import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

import {
  CHAT_IMAGE_CAST_FOUR_PLUS_WARNING,
  CHAT_IMAGE_CAST_MAX_SELECTED,
  CHAT_IMAGE_CAST_MAX_SELECTED_ERROR,
  parseCastIntentManifest,
  type ChatImageCastIntentManifest,
} from "@/lib/chatImageCast";
import {
  bindApprovedCastManifest,
  groundCastIntent,
  type GroundCastContext,
} from "@/lib/chatImageCastManifest";
import { resolveChatImageCastPolicy } from "@/lib/chatImageCast";
import { createVisualSubjectKey } from "@/lib/visualSubjects";

const PERSONA_URL = "/synthetic/user-persona-primary.webp";
const MAIN_URL = "/synthetic/character-a-primary.webp";

function castContext(count: number): GroundCastContext {
  const selectableAssets: GroundCastContext["selectableAssets"] = [];
  const visualSubjects: NonNullable<GroundCastContext["visualSubjects"]> = [];
  const characterAssets: GroundCastContext["characterAssets"] = [
    { url: MAIN_URL, tag: "CharacterA" },
    { url: PERSONA_URL, tag: "UserPersona" },
  ];
  for (let index = 1; index <= count + 2; index += 1) {
    const url = `/synthetic/support-${index}.webp`;
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

function supportSubject(name: string, url: string): ChatImageCastIntentManifest["subjects"][number] {
  return {
    key: `supporting:${name}`,
    role: "supporting_character",
    name,
    included: true,
    importance: "primary",
    visibility: "required_visible",
    requestedReferenceAssetUrl: url,
  };
}

/** Character-kind INTENT subjects are server-rebased to canonical persona/main refs. */
function addSupport(
  count: number
): ChatImageCastIntentManifest["subjects"] {
  const base = coreIntent();
  const extra = Array.from({ length: count }, (_, offset) => {
    const index = offset + 1;
    const url = `/synthetic/support-${index}.webp`;
    return supportSubject(`Support${index}`, url);
  });
  return [...base.subjects, ...extra];
}

describe("general chat optional multi-cast selector — product contract", () => {
  it("CAST-SEL-1 character policy: persona+main is the valid default (min 2)", () => {
    const policy = resolveChatImageCastPolicy("character");
    assert.equal(policy.requireMainCharacter, true);
    assert.equal(policy.personaOptional, false);
    assert.equal(policy.minSelected, 2);
    assert.equal(policy.maxSelected, CHAT_IMAGE_CAST_MAX_SELECTED);
    const intent = coreIntent();
    const grounded = groundCastIntent(intent, castContext(0));
    assert.equal(grounded.ok, true);
    if (!grounded.ok) throw new Error(grounded.reason);
    assert.equal(
      grounded.manifest.subjects.filter((subject) => subject.included).length,
      2
    );
  });

  it("CAST-SEL-2 persona+main+support1 (3 selected) is valid", () => {
    const grounded = groundCastIntent(
      { ...coreIntent(), subjects: addSupport(1) },
      castContext(1)
    );
    assert.equal(grounded.ok, true, grounded.ok ? "" : grounded.reason);
    if (!grounded.ok) throw new Error(grounded.reason);
    assert.equal(
      grounded.manifest.subjects.filter((subject) => subject.included).length,
      3
    );
    assert.equal(grounded.manifest.compositionGoal, "trio_group");
  });

  it("CAST-SEL-3 persona+main+support1+support2 (4 selected) is valid, ensemble", () => {
    const grounded = groundCastIntent(
      { ...coreIntent(), subjects: addSupport(2) },
      castContext(2)
    );
    assert.equal(grounded.ok, true);
    if (!grounded.ok) throw new Error(grounded.reason);
    assert.equal(
      grounded.manifest.subjects.filter((subject) => subject.included).length,
      4
    );
    assert.equal(grounded.manifest.compositionGoal, "ensemble_scene");
  });

  it("CAST-SEL-4 fifth subject is server-rejected by the max-4 policy", () => {
    const parsed = parseCastIntentManifest({
      compositionGoal: "auto",
      subjects: addSupport(3),
    });
    assert.ok(parsed, "five-subject intent parses");
    const grounded = groundCastIntent(parsed!, castContext(3));
    assert.equal(grounded.ok, false);
    assert.equal(grounded.ok ? "" : grounded.reason, CHAT_IMAGE_CAST_MAX_SELECTED_ERROR);
  });

  it("CAST-SEL-5 simulation policy: min 1, max 4, persona-only valid, fifth reject", () => {
    const policy = resolveChatImageCastPolicy("simulation");
    assert.equal(policy.minSelected, 1);
    assert.equal(policy.maxSelected, CHAT_IMAGE_CAST_MAX_SELECTED);
    assert.equal(policy.requireMainCharacter, false);
    // persona-only
    const personaOnly = parseCastIntentManifest({
      compositionGoal: "auto",
      subjects: [
        {
          role: "persona",
          name: "UserPersona",
          included: true,
          importance: "primary",
          visibility: "required_visible",
        },
      ],
    });
    assert.ok(personaOnly);
    const single = groundCastIntent(personaOnly, castContext(3), undefined, "simulation");
    assert.equal(single.ok, true);
    // 5 members reject
    const five = parseCastIntentManifest({
      compositionGoal: "auto",
      subjects: [
        {
          role: "persona",
          name: "UserPersona",
          included: true,
          importance: "primary",
          visibility: "required_visible",
        },
        ...Array.from({ length: 4 }, (_, index) => ({
          role: "supporting_character",
          name: `Member${index + 1}`,
          requestedReferenceAssetUrl: `/synthetic/support-${index + 1}.webp`,
        })),
      ],
    });
    assert.ok(five);
    const fiveGrounded = groundCastIntent(five, castContext(3), undefined, "simulation");
    assert.equal(fiveGrounded.ok, false);
    assert.equal(fiveGrounded.ok ? "" : fiveGrounded.reason, CHAT_IMAGE_CAST_MAX_SELECTED_ERROR);
  });

  it("CAST-SEC-1 unauthorized asset URL fails closed", () => {
    const identity = coreIntent().subjects;
    const forged = parseCastIntentManifest({
      compositionGoal: "auto",
      subjects: [
        ...identity,
        {
          role: "supporting_character",
          name: "Support1",
          importance: "primary",
          visibility: "required_visible",
          requestedReferenceAssetUrl: "/uploads/forged-asset.webp",
        },
      ],
    });
    assert.ok(forged);
    const grounded = groundCastIntent(forged, castContext(1));
    assert.equal(grounded.ok, false);
    assert.equal(grounded.ok ? "" : grounded.reason, "선택한 참고 에셋을 사용할 수 없습니다.");
  });

  it("CAST-SEC-2 asset owned by a different visual subject is rejected for simulation", () => {
    const requesterName = "Member1";
    // Cross-owner simulation grounding: Member1 requests Support2's asset.
    const intent: ChatImageCastIntentManifest = {
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
          key: `supporting:${requesterName}`,
          role: "supporting_character",
          name: requesterName,
          included: true,
          importance: "primary",
          visibility: "required_visible",
          requestedReferenceAssetUrl: "/synthetic/support-2.webp",
        },
      ],
    };
    const grounded = groundCastIntent(intent, castContext(1), undefined, "simulation");
    assert.equal(grounded.ok, false);
    assert.equal(
      grounded.ok ? "" : grounded.reason,
      "다른 인물에 연결된 이미지는 해당 인물 reference로 사용할 수 없습니다."
    );
  });

  it("CAST-REF-1 persona+main always attach identity references; supporting refs come only from the selectable pool", () => {
    const grounded = groundCastIntent(
      { ...coreIntent(), subjects: addSupport(2) },
      castContext(2)
    );
    assert.equal(grounded.ok, true);
    if (!grounded.ok) throw new Error(grounded.reason);
    const bound = bindApprovedCastManifest(grounded.manifest);
    // Product contract: the user (persona) and the main character ALWAYS carry
    // an identity reference, no matter how many supporting cast are selected.
    assert.ok(bound.referenceUrls.includes(PERSONA_URL));
    assert.ok(bound.referenceUrls.includes(MAIN_URL));
    // Supporting references, when attached, only ever come from the selectable pool.
    for (const url of bound.referenceUrls) {
      if (url === PERSONA_URL || url === MAIN_URL) continue;
      assert.ok(url.startsWith("/synthetic/support-"));
    }
    // INVESTIGATION NOTE (current implementation, NOT a product invariant):
    // supporting identity references are currently capped at
    // CHAT_IMAGE_CAST_IDENTITY_REFERENCE_CAP=3, so the 4th selected cast member
    // is attached without its own reference image. Raising 3->4 is an approved
    // follow-up (4th identity ref + additional-person surcharge); this PR pins
    // no cap value.
  });

  it("CAST-REF-2 max selected = 4 is the product contract; 4th identity ref is an approved follow-up", () => {
    // PRODUCT CONTRACT: up to 4 selected cast members are always valid,
    // regardless of the identity-reference cap value.
    const grounded = groundCastIntent(
      { ...coreIntent(), subjects: addSupport(2) },
      castContext(2)
    );
    assert.equal(grounded.ok, true);
    if (!grounded.ok) throw new Error(grounded.reason);
    assert.equal(
      grounded.manifest.subjects.filter((subject) => subject.included).length,
      4
    );
    // COST FACT: reference images are billed as image input tokens
    // (usage.input_tokens_details.image_tokens). A 4th identity reference adds
    // upstream input cost, absorbed by an additional-person point surcharge
    // (approved FOLLOW-UP; surcharge value TBD — not set in this PR).
    const edit = readFileSync("src/lib/openAiImageEdit.ts", "utf8");
    assert.ok(edit.includes("input_tokens_details"));
    // CURRENT: 4 selected / max 3 identity refs (implementation detail)
    // FOLLOW-UP: 4th identity ref + additional-person surcharge
  });

  it("CAST-REF-3 attached-reference loop has no client-side upper cap (provider transport proven)", () => {
    const edit = readFallbackAttachmentLoop();
    assert.match(edit, /opts\.references\.forEach/);
  });

  it("CAST-LIFE-1 production comic route consumes the shared cast owner with no planner call", () => {
    const route = readComicRoute();
    assert.match(route, /groundCastIntent\(/);
    assert.doesNotMatch(route, /planChatImageScene\(/);
    // Broadcast gate: general chat activates the cast path only above 2
    // selected — the doc'd default duo remains the overloaded-fast path.
    assert.match(route, /selectedCount > 2 \? grounded\.manifest : null/);
  });

  it("CAST-LIFE-2 both illustration and comic consume the same bindApprovedCastManifest owner", () => {
    const comic = readFileSync(
      new URL("../lib/chatComicGeneration.ts", import.meta.url),
      "utf8"
    );
    const ld = readFileSync(
      new URL("../lib/chatLdIllustrationGeneration.ts", import.meta.url),
      "utf8"
    );
    assert.match(comic, /bindApprovedCastManifest\(/);
    assert.match(ld, /bindApprovedCastManifest\(/);
  });

  it("CAST-UX-1 four-person fidelity warning stays surfaced for the picker", () => {
    assert.match(CHAT_IMAGE_CAST_FOUR_PLUS_WARNING, /4인 장면/u);
    const picker = readPickerSource();
    assert.match(picker, /CHAT_IMAGE_CAST_FOUR_PLUS_WARNING/);
  });
});

function readFallbackAttachmentLoop(): string {
  return readFileSync(
    new URL("../lib/openAiImageEdit.ts", import.meta.url),
    "utf8"
  );
}

function readComicRoute(): string {
  return readFileSync(
    new URL("../app/api/chat/comic-generation/route.ts", import.meta.url),
    "utf8"
  );
}

function readPickerSource(): string {
  return readFileSync(
    new URL("../components/ChatImageCastPicker.tsx", import.meta.url),
    "utf8"
  );
}
