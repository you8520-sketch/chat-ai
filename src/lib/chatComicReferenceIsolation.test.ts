import assert from "node:assert/strict";
import test from "node:test";

import { formatOpenAiImageProviderAttemptsForAdmin } from "@/lib/openAiImageSafetyFallback";
import {
  buildComicProviderReferences,
  classifyComicModerationAssociation,
  formatComicReferenceSetForAdmin,
  prepareComicProviderReferenceInput,
} from "@/lib/chatComicReferenceIsolation";
import { CHAT_COMIC_TEMPLATE_PREVIEW_URL } from "@/lib/chatComicGenerationConstants";
import { buildChatComicGenerationPlan } from "@/lib/chatComicGeneration";
import { buildStrictComicFallbackPrompt } from "@/lib/chatImageStrictSafetyFallbackPrompt";
import { projectComicSafeStructureForTier2 } from "@/lib/chatComicSafeStructure";
import type { ScenePlan } from "@/lib/chatImageScenePlan";
import type { ChatImageVisualSubject } from "@/lib/chatImageVisualIdentity";

const subjects: ChatImageVisualSubject[] = [
  {
    key: "character-18", role: "chat character", name: "라이크", gender: "male",
    referenceIndex: 2, referenceImageUrl: "/character.webp", appearanceMode: "image_only",
    sourceKind: "main_character",
  },
  {
    key: "persona-7", role: "user persona", name: "렌", gender: "male",
    referenceIndex: 3, referenceImageUrl: "/persona.webp", appearanceMode: "image_only",
    sourceKind: "persona",
  },
];

const references = buildComicProviderReferences({
  referenceUrls: [CHAT_COMIC_TEMPLATE_PREVIEW_URL, "/character.webp", "/persona.webp"],
  subjects,
});

test("REF-BIND-1: provider references preserve template/identity slots and stay real", () => {
  assert.deepEqual(references.map((item) => item.role), ["template", "chat_character", "user_persona"]);
  assert.deepEqual(references.map((item) => item.index), [1, 2, 3]);
  assert.equal(references.length, 3);
  assert.ok(references.every((item) => item.content === "real"));
});

test("REF-BIND-2: reference set signature contains no source bytes", () => {
  const diagnostic = formatComicReferenceSetForAdmin(references);
  assert.deepEqual(diagnostic, {
    referenceRoles: ["template", "chat_character", "user_persona"],
    referenceCount: 3,
    referenceSetSignature: "template:real|chat_character:real|user_persona:real",
    references: [
      { index: 1, role: "template", content: "real" },
      { index: 2, role: "chat_character", content: "real" },
      { index: 3, role: "user_persona", content: "real" },
    ],
  });
  const json = JSON.stringify(diagnostic);
  assert.doesNotMatch(json, /character\.webp|persona\.webp|base64|https?:\/\//);
});

test("REF-BIND-3: normalization preserves slots and never leaks bytes", async () => {
  const input = await prepareComicProviderReferenceInput({
    primaryPrompt: "prompt",
    strictFallbackPrompt: "fallback",
    references,
    normalizeReference: async (sourceUrl) => `data:${sourceUrl}`,
  });
  assert.equal(input.primaryPrompt, "prompt");
  assert.equal(input.strictFallbackPrompt, "fallback");
  assert.deepEqual(input.references.map((item) => item.index), [1, 2, 3]);
});

const scenePlan: ScenePlan = {
  sceneBackground: "ordinary indoor room",
  atmosphere: "calm everyday mood",
  events: [{ id: "E1", order: 1, sourceMessageId: 1, sourceRole: "assistant", kind: "action", actor: "character", text: "walks in", segmentKind: "action" }],
  heroEventIds: ["E1"],
  heroScene: "walks in",
  recommendedPanelCount: 2,
  panels: [1, 2].map((index) => ({
    index, sourceEventIds: ["E1"], situation: "walks in", dialogue: [],
  })),
};

test("PROMPT-BIND-1..2: primary and Tier-2 retain template and identity slot binding", () => {
  const pack = buildChatComicGenerationPlan({
    characterName: "라이크", characterGender: "male", characterImageUrl: "/character.webp",
    characterSavedAppearance: "", characterAppearanceMode: "image_only",
    personaName: "렌", personaGender: "male", personaImageUrl: "/persona.webp",
    personaSavedAppearance: "", personaAppearanceMode: "image_only", plan: scenePlan,
  });
  const tier2 = buildStrictComicFallbackPrompt({
    panelCount: 2, characterName: "라이크", characterGender: "male",
    personaName: "렌", personaGender: "male", subjects: pack.subjects,
    safeStructure: projectComicSafeStructureForTier2(scenePlan, { personaVisible: true }),
  });
  assert.match(pack.prompt, /Reference image 1 is LAYOUT AND FINISH ONLY/);
  assert.match(tier2, /Reference image 1 is LAYOUT AND FINISH ONLY/);
  assert.match(pack.prompt, /Image 2/);
  assert.match(pack.prompt, /Image 3/);
  assert.match(tier2, /Image 2/);
  assert.match(tier2, /Image 3/);
});

test("DIAG-1..7: attempts are explicit, preserve unknown safety data, and mark fallback invoked", () => {
  const diagnostic = formatOpenAiImageProviderAttemptsForAdmin({
    providerAttempts: [
      { attempt: 1, kind: "primary", outcome: "safety_rejected", promptHash: "hash-1", diagnostic: { providerRequestId: "req-1", errorCode: "moderation_blocked", safetyCategories: ["sexual"] } },
      { attempt: 2, kind: "strict_safety_fallback", outcome: "safety_rejected", promptHash: "hash-2", diagnostic: { providerRequestId: "req-2", errorCode: "moderation_blocked" } },
    ],
    knownProviderCostUsd: null,
    hasUnknownAttemptCost: true,
    safetyFallbackUsed: false,
    referenceSet: formatComicReferenceSetForAdmin(references),
  });
  assert.equal(diagnostic.safetyFallbackInvoked, true);
  assert.equal(diagnostic.safetyFallbackUsed, false);
  const json = JSON.stringify(diagnostic);
  assert.match(json, /"attempt":1/);
  assert.match(json, /"attempt":2/);
  assert.match(json, /req-1/);
  assert.match(json, /req-2/);
  assert.match(json, /hash-1/);
  assert.match(json, /"safetyCategories":"UNKNOWN"/);
  assert.equal((json.match(/template:real\|chat_character:real\|user_persona:real/g) ?? []).length, 2);
  assert.doesNotMatch(json, /\[Object\]|rawPrompt|sourceUrl|base64|https?:\/\//);
});

test("human QA outcomes classify moderation association without declaring an image unsafe", () => {
  assert.equal(classifyComicModerationAssociation({
    normal: "moderation_blocked", neutral_template: "pass",
  }), "REAL_TEMPLATE_CONTENT_PRIMARY_SUSPECT");
  assert.equal(classifyComicModerationAssociation({
    normal: "moderation_blocked", neutral_identity_refs: "pass",
  }), "IDENTITY_REFERENCE_OR_MULTI_PERSON_INTERACTION");
  assert.equal(classifyComicModerationAssociation({
    normal: "moderation_blocked", neutral_visual_context: "pass",
  }), "REFERENCE_BYTES_ALONE_NOT_SUFFICIENT_CAUSE");
});
