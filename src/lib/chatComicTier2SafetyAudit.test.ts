import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  buildStrictComicFallbackPrompt,
  STRICT_SAFE_DEPICTION,
} from "@/lib/chatImageStrictSafetyFallbackPrompt";
import {
  containsBedroomBedStructure,
  projectComicSafeStructureForTier2,
} from "@/lib/chatComicSafeStructure";
import { CHAT_COMIC_TEMPLATE_PREVIEW_URL } from "@/lib/chatComicGenerationConstants";
import { bindChatImageReferencePack, buildChatDuoVisualSubjects } from "@/lib/chatImageVisualIdentity";
import { COMIC_TIER2_POSITIVE_SAFE_DEPICTION } from "@/lib/chatComicTier2SafeProjection";
import {
  OpenAiImageGenerationError,
  callOpenAiImageEditWithSafetyFallback,
} from "@/lib/openAiImageSafetyFallback";
import type { ScenePlan } from "@/lib/chatImageScenePlan";
import {
  auditProviderAttemptSequence,
  auditTier2ComicPrompt,
  buildAndAuditStrictComicFallbackPrompt,
  buildComicReferenceRoleInventory,
  classifyReferenceRiskFromFixtureMetadata,
  classifyTemplateModerationRisk,
  countNegativeSexualSafetyVocabulary,
  FINAL_TIER1_PROMPT_SECTION_INVENTORY,
  FINAL_TIER2_PROMPT_SECTION_INVENTORY,
} from "@/lib/chatComicTier2SafetyAudit";

const REF = `data:image/webp;base64,${Buffer.from("ref").toString("base64")}`;

const duoSubjects = [
  {
    key: "character",
    name: "태현",
    gender: "male" as const,
    role: "character",
    referenceIndex: 2,
    referenceImageUrl: "/c.webp",
    savedAppearance: "explicit prose should not leak",
    appearanceMode: "image_only" as const,
    sourceKind: "main_character" as const,
  },
  {
    key: "persona",
    name: "유저",
    gender: "female" as const,
    role: "persona",
    referenceIndex: 3,
    referenceImageUrl: "/p.webp",
    savedAppearance: "",
    appearanceMode: "image_only" as const,
    sourceKind: "persona" as const,
  },
];

function explicitBedroomPlan(): ScenePlan {
  return {
    sceneBackground: "침실",
    atmosphere: "은은한 조명",
    events: [
      {
        id: "e1",
        order: 1,
        sourceMessageId: 1,
        sourceRole: "assistant",
        kind: "action",
        actor: "character",
        text: "둘이 침대에서 겹치며 성관계를 한다",
        segmentKind: "narration",
      },
    ],
    castMentions: [],
    heroEventIds: ["e1"],
    panels: [
      {
        index: 1,
        sourceEventIds: ["e1"],
        situation: "침실 침대",
        characterAction: "그녀 위에서 허리를 흔든다",
        dialogue: [],
      },
      {
        index: 2,
        sourceEventIds: ["e1"],
        situation: "침대에 누운 자세",
        personaAction: "이불을 끌어올린다",
        dialogue: [{ speaker: "character", text: "…조용히.", provenance: "source" }],
      },
    ],
    dialogues: [],
  };
}

function safeBedroomPlan(): ScenePlan {
  return {
    sceneBackground: "침실",
    atmosphere: "은은한 조명",
    events: [
      {
        id: "e1",
        order: 1,
        sourceMessageId: 1,
        sourceRole: "assistant",
        kind: "action",
        actor: "character",
        text: "캐릭터가 침대에 누워 이불을 끌어올린다",
        segmentKind: "narration",
      },
    ],
    castMentions: [],
    panels: [
      {
        index: 1,
        sourceEventIds: ["e1"],
        situation: "침실 침대",
        dialogue: [],
      },
      {
        index: 2,
        sourceEventIds: ["e1"],
        situation: "침대에 누운 자세",
        dialogue: [],
      },
    ],
    dialogues: [],
  };
}

function romanticPlan(): ScenePlan {
  return {
    sceneBackground: "거실",
    events: [],
    castMentions: [],
    panels: [
      {
        index: 1,
        sourceEventIds: [],
        situation: "소파에서 서로를 껴안는다",
        personaAction: "따뜻하게 안아준다",
        dialogue: [],
      },
      {
        index: 2,
        sourceEventIds: [],
        situation: "뺨에 키스",
        dialogue: [],
      },
    ],
    dialogues: [],
  };
}

function explicitDialogueSafeVisualPlan(): ScenePlan {
  return {
    sceneBackground: "침실",
    events: [],
    castMentions: [],
    panels: [
      {
        index: 1,
        sourceEventIds: [],
        situation: "침대에 누워 휴식",
        dialogue: [{ speaker: "character", text: "성관계 후 조용한 숨", provenance: "source" }],
      },
      {
        index: 2,
        sourceEventIds: [],
        situation: "이불 속",
        dialogue: [],
      },
    ],
    dialogues: [],
  };
}

function mixedUnsafeActionPlan(): ScenePlan {
  return {
    sceneBackground: "침실",
    events: [],
    castMentions: [],
    panels: [
      {
        index: 1,
        sourceEventIds: [],
        situation: "침실",
        characterAction: "성관계를 요구한다",
        dialogue: [],
      },
      {
        index: 2,
        sourceEventIds: [],
        situation: "침대",
        dialogue: [],
      },
    ],
    dialogues: [],
  };
}

function cleanPlan(): ScenePlan {
  return {
    sceneBackground: "카페",
    events: [],
    castMentions: [],
    panels: [
      {
        index: 1,
        sourceEventIds: [],
        situation: "창가 자리에서 대화",
        dialogue: [],
      },
      {
        index: 2,
        sourceEventIds: [],
        situation: "커피잔을 든다",
        dialogue: [],
      },
    ],
    dialogues: [],
  };
}

function buildTier2(plan: ScenePlan) {
  const structure = projectComicSafeStructureForTier2(plan);
  return buildAndAuditStrictComicFallbackPrompt({
    panelCount: 2,
    characterName: "태현",
    characterGender: "male",
    personaName: "유저",
    personaGender: "female",
    subjects: duoSubjects,
    safeStructure: structure,
  });
}

function safetyRejectResponse() {
  return new Response(
    JSON.stringify({
      error: {
        message: "Your request was rejected by the safety system.",
        type: "image_generation_user_error",
        code: "moderation_blocked",
      },
    }),
    {
      status: 400,
      headers: { "Content-Type": "application/json", "x-request-id": "req-live-equiv" },
    }
  );
}

describe("chatComicTier2SafetyAudit fixtures S1-S7", () => {
  it("SAFE-1 S1 explicit bedroom source — no raw explicit leak", () => {
    const { audit } = buildTier2(explicitBedroomPlan());
    assert.equal(audit.rawExplicitSourceLeakCount, 0);
    assert.equal(audit.strongGenitalTermCount, 0);
    assert.equal(audit.hasStrongExplicitSourceLeak, false);
  });

  it("SAFE-2 S1 explicit bedroom — bedroom retained", () => {
    const { audit } = buildTier2(explicitBedroomPlan());
    assert.equal(audit.hasBedroom, true);
  });

  it("SAFE-3 S1 explicit bedroom — bed retained", () => {
    const { audit } = buildTier2(explicitBedroomPlan());
    assert.equal(audit.hasBed, true);
  });

  it("SAFE-4 S1 explicit bedroom — safe lying/rest retained", () => {
    const { audit } = buildTier2(explicitBedroomPlan());
    assert.equal(audit.hasSafeLyingOrRest, true);
  });

  it("SAFE-5 S4 explicit dialogue absent from Tier-2 provider prompt", () => {
    const { prompt, audit } = buildTier2(explicitDialogueSafeVisualPlan());
    assert.equal(audit.untrustedDialogueCount, 0);
    assert.doesNotMatch(prompt, /성관계/u);
    assert.match(prompt, /침실|침대|bed|bedroom/iu);
  });

  it("SAFE-6 S5 unsafe action — whole-action safe projection", () => {
    const structure = projectComicSafeStructureForTier2(mixedUnsafeActionPlan());
    assert.match(structure.panels[0]?.poseHint ?? "", /modest|resting|bedroom|same cast/iu);
    assert.doesNotMatch(structure.panels[0]?.poseHint ?? "", /성관계/u);
    const { audit } = buildTier2(mixedUnsafeActionPlan());
    assert.equal(audit.rawExplicitSourceLeakCount, 0);
    assert.equal(audit.hasBedroom, true);
  });

  it("SAFE-7 S6 clean scene — no unnecessary genericization", () => {
    const { prompt, audit } = buildTier2(cleanPlan());
    assert.match(prompt, /카페|대화|calm|slice-of-life|conversation/iu);
    assert.doesNotMatch(prompt, /business meeting|generic office/iu);
    assert.equal(audit.rawExplicitSourceLeakCount, 0);
  });

  it("SAFE-8 savedAppearance freeform omitted in Tier-2", () => {
    const { prompt, audit } = buildTier2(safeBedroomPlan());
    assert.equal(audit.savedAppearanceFreeformCount, 0);
    assert.doesNotMatch(prompt, /explicit prose should not leak/);
  });

  it("SAFE-9 Tier-2 inventory has no uncontrolled FREEFORM_USER_DERIVED sections", () => {
    const uncontrolled = FINAL_TIER2_PROMPT_SECTION_INVENTORY.filter(
      (item) =>
        item.kind === "FREEFORM_USER_DERIVED" || item.kind === "FREEFORM_CHARACTER_DERIVED"
    );
    assert.equal(uncontrolled.length, 0);
  });

  it("S2 safe bedroom scene preserves structure", () => {
    const structure = projectComicSafeStructureForTier2(safeBedroomPlan());
    assert.equal(containsBedroomBedStructure(structure), true);
    const { audit } = buildTier2(safeBedroomPlan());
    assert.equal(audit.hasBedroom, true);
    assert.equal(audit.hasBed, true);
    assert.equal(audit.hasSafeLyingOrRest, true);
  });

  it("S3 romantic non-explicit preserves warmth", () => {
    const { prompt, audit } = buildTier2(romanticPlan());
    assert.equal(audit.hasCloseInteraction, true);
    assert.doesNotMatch(prompt, /office|cafe substitution|business meeting/iu);
  });

  it("S7 reference-only risk classification", () => {
    const { audit } = buildTier2(cleanPlan());
    const classification = classifyReferenceRiskFromFixtureMetadata({
      promptAudit: audit,
      referenceFlags: [{ index: 2, unsafeReference: true }],
    });
    assert.equal(classification, "REFERENCE_RISK");
  });
});

describe("Tier-2 self-contamination reduction SAFE-10", () => {
  it("comic Tier-2 uses positive depiction instead of BASE_IMAGE_SAFE_DEPICTION", () => {
    const { prompt } = buildTier2(explicitBedroomPlan());
    assert.match(prompt, /GENERAL-AUDIENCE VISUAL CONTRACT/);
    assert.doesNotMatch(prompt, /Do not depict explicit sexual acts/);
    assert.notEqual(
      countNegativeSexualSafetyVocabulary(prompt),
      countNegativeSexualSafetyVocabulary(STRICT_SAFE_DEPICTION)
    );
    assert.ok(countNegativeSexualSafetyVocabulary(prompt) < countNegativeSexualSafetyVocabulary(STRICT_SAFE_DEPICTION));
  });

  it("COMIC_TIER2_POSITIVE_SAFE_DEPICTION has minimal negative sexual vocabulary", () => {
    assert.equal(countNegativeSexualSafetyVocabulary(COMIC_TIER2_POSITIVE_SAFE_DEPICTION), 0);
  });
});

describe("reference inventory REF-1 REF-2 REF-3", () => {
  it("REF-1 reference roles deterministic for duo comic", () => {
    const pack = bindChatImageReferencePack({
      template: { url: CHAT_COMIC_TEMPLATE_PREVIEW_URL, role: "layout template" },
      subjectsInImageOrder: buildChatDuoVisualSubjects({
        characterName: "태현",
        characterGender: "male",
        characterImageUrl: "/c.webp",
        characterSavedAppearance: "",
        characterAppearanceMode: "image_only",
        personaName: "유저",
        personaGender: "female",
        personaImageUrl: "/p.webp",
        personaSavedAppearance: "",
        personaAppearanceMode: "image_only",
      }),
    });
    const inventory = buildComicReferenceRoleInventory({
      referenceUrls: pack.referenceUrls,
      subjects: pack.subjects,
    });
    assert.equal(inventory.referenceCount, 3);
    assert.equal(inventory.roles[0]?.role, "template / composition only");
    assert.match(inventory.roles[1]?.role ?? "", /character|태현/);
    assert.match(inventory.roles[2]?.role ?? "", /persona|유저/);
  });

  it("REF-2 template role deterministic at index 1", () => {
    const pack = bindChatImageReferencePack({
      template: { url: CHAT_COMIC_TEMPLATE_PREVIEW_URL, role: "layout template" },
      subjectsInImageOrder: buildChatDuoVisualSubjects({
        characterName: "A",
        characterGender: "female",
        characterImageUrl: "/c.webp",
        characterSavedAppearance: "",
        characterAppearanceMode: "image_only",
        personaName: "B",
        personaGender: "male",
        personaImageUrl: "/p.webp",
        personaSavedAppearance: "",
        personaAppearanceMode: "image_only",
      }),
    });
    assert.equal(pack.referenceUrls[0], CHAT_COMIC_TEMPLATE_PREVIEW_URL);
    const inventory = buildComicReferenceRoleInventory({
      referenceUrls: pack.referenceUrls,
      subjects: pack.subjects,
    });
    assert.equal(inventory.roles[0]?.index, 1);
    assert.equal(inventory.roles[0]?.role, "template / composition only");
  });

  it("REF-3 reference risk classification exposes roles not URLs", () => {
    const inventory = buildComicReferenceRoleInventory({
      referenceUrls: [CHAT_COMIC_TEMPLATE_PREVIEW_URL, "/c.webp", "/p.webp"],
      subjects: duoSubjects,
    });
    for (const role of inventory.roles) {
      assert.doesNotMatch(JSON.stringify(role), /https?:\/\//);
      assert.doesNotMatch(role.role, /base64/i);
    }
  });

  it("TEMPLATE_MODERATION_RISK classified", () => {
    assert.equal(classifyTemplateModerationRisk(), "LOW");
  });
});

describe("live-equivalent attempt sequence ATTEMPT-1 ATTEMPT-2 ATTEMPT-3", () => {
  it("ATTEMPT-1 primary safety rejection triggers exactly one Tier-2 attempt", async () => {
    let calls = 0;
    const originalFetch = globalThis.fetch;
    const originalKey = process.env.OPENAI_API_KEY;
    process.env.OPENAI_API_KEY = "test-key";
    globalThis.fetch = async () => {
      calls += 1;
      return calls === 1 ? safetyRejectResponse() : safetyRejectResponse();
    };
    try {
      await assert.rejects(
        () =>
          callOpenAiImageEditWithSafetyFallback({
            model: "gpt-image-2",
            primaryPrompt: "tier-1 risky",
            strictFallbackPrompt: "tier-2 strict safe",
            references: [REF],
            size: "864x1824",
            quality: "medium",
            outputCompression: 84,
            mode: "comic",
          }),
        (error: unknown) => error instanceof OpenAiImageGenerationError
      );
      assert.equal(calls, 2);
    } finally {
      globalThis.fetch = originalFetch;
      if (originalKey == null) delete process.env.OPENAI_API_KEY;
      else process.env.OPENAI_API_KEY = originalKey;
    }
  });

  it("ATTEMPT-2 double safety rejection — total attempts exactly 2", async () => {
    let calls = 0;
    const originalFetch = globalThis.fetch;
    const originalKey = process.env.OPENAI_API_KEY;
    process.env.OPENAI_API_KEY = "test-key";
    globalThis.fetch = async () => {
      calls += 1;
      return safetyRejectResponse();
    };
    try {
      await assert.rejects(
        () =>
          callOpenAiImageEditWithSafetyFallback({
            model: "gpt-image-2",
            primaryPrompt: "tier-1",
            strictFallbackPrompt: "tier-2",
            references: [REF, REF, REF],
            size: "864x1824",
            quality: "medium",
            outputCompression: 84,
          }),
        (error: unknown) => {
          if (!(error instanceof OpenAiImageGenerationError)) return false;
          const seq = auditProviderAttemptSequence(error.providerAttempts);
          assert.equal(seq.attemptCount, 2);
          assert.equal(seq.attempt1Kind, "primary");
          assert.equal(seq.attempt1Outcome, "safety_rejected");
          assert.equal(seq.attempt2Present, true);
          assert.equal(seq.attempt2Kind, "strict_safety_fallback");
          assert.equal(seq.attempt2Outcome, "safety_rejected");
          assert.equal(seq.safetyFallbackTriggered, true);
          return true;
        }
      );
      assert.equal(calls, 2);
    } finally {
      globalThis.fetch = originalFetch;
      if (originalKey == null) delete process.env.OPENAI_API_KEY;
      else process.env.OPENAI_API_KEY = originalKey;
    }
  });

  it("ATTEMPT-3 no third attempt on double rejection", async () => {
    let calls = 0;
    const originalFetch = globalThis.fetch;
    const originalKey = process.env.OPENAI_API_KEY;
    process.env.OPENAI_API_KEY = "test-key";
    globalThis.fetch = async () => {
      calls += 1;
      return safetyRejectResponse();
    };
    try {
      await assert.rejects(() =>
        callOpenAiImageEditWithSafetyFallback({
          model: "gpt-image-2",
          primaryPrompt: "tier-1",
          strictFallbackPrompt: "tier-2",
          references: [REF],
          size: "800x1200",
          quality: "medium",
          outputCompression: 86,
        })
      );
      assert.equal(calls, 2);
    } finally {
      globalThis.fetch = originalFetch;
      if (originalKey == null) delete process.env.OPENAI_API_KEY;
      else process.env.OPENAI_API_KEY = originalKey;
    }
  });
});

describe("prompt section inventories", () => {
  it("FINAL_TIER1 and FINAL_TIER2 inventories are defined", () => {
    assert.ok(FINAL_TIER1_PROMPT_SECTION_INVENTORY.length >= 8);
    assert.ok(FINAL_TIER2_PROMPT_SECTION_INVENTORY.length >= 8);
  });

  it("Tier-2 audit on explicit bedroom before/after negative vocab reduction", () => {
    const { prompt, audit } = buildTier2(explicitBedroomPlan());
    const beforeEstimate = countNegativeSexualSafetyVocabulary(
      [STRICT_SAFE_DEPICTION, "non-explicit", "no suggestive pose", "explicit or graphic"].join(" ")
    );
    assert.ok(audit.negativeSexualSafetyVocabCount < beforeEstimate);
    assert.ok(audit.negativeSexualSafetyVocabCount <= 1);
    void prompt;
  });
});

describe("auditTier2ComicPrompt invariants", () => {
  it("explicit bedroom fixture passes required invariants", () => {
    const { audit } = buildTier2(explicitBedroomPlan());
    assert.equal(audit.rawExplicitSourceLeakCount, 0);
    assert.equal(audit.untrustedDialogueCount, 0);
    assert.equal(audit.savedAppearanceFreeformCount, 0);
    assert.equal(audit.userRawProseCount, 0);
  });

  it("buildStrictComicFallbackPrompt still compiles without safeStructure", () => {
    const prompt = buildStrictComicFallbackPrompt({
      panelCount: 2,
      characterName: "A",
      characterGender: "female",
      personaName: "B",
      personaGender: "male",
      subjects: duoSubjects,
    });
    const audit = auditTier2ComicPrompt({ prompt, subjects: duoSubjects });
    assert.equal(audit.rawExplicitSourceLeakCount, 0);
    assert.match(prompt, /GENERAL-AUDIENCE VISUAL CONTRACT/);
  });
});
