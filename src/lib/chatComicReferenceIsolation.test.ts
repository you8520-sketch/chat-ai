import assert from "node:assert/strict";
import test from "node:test";

import { formatOpenAiImageProviderAttemptsForAdmin } from "@/lib/openAiImageSafetyFallback";
import {
  buildComicProviderReferences,
  buildNeutralComicProviderScenePlan,
  buildNeutralComicSafeStructure,
  classifyComicModerationAssociation,
  formatComicReferenceSetForAdmin,
  isolateComicProviderReferences,
  resolveComicDiagnosticOverrides,
  type ComicReferenceIsolationMode,
} from "@/lib/chatComicReferenceIsolation";
import { CHAT_COMIC_TEMPLATE_PREVIEW_URL } from "@/lib/chatComicGenerationConstants";
import { buildChatComicGenerationPlan } from "@/lib/chatComicGeneration";
import { buildStrictComicFallbackPrompt } from "@/lib/chatImageStrictSafetyFallbackPrompt";
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

test("REF-CONTROL-1..7: controls preserve slots and change only selected content", () => {
  const expectedNeutralSlots: Record<ComicReferenceIsolationMode, number[]> = {
    normal: [],
    neutral_template: [1],
    neutral_character: [2],
    neutral_persona: [3],
    neutral_identity_refs: [2, 3],
    all_neutral: [1, 2, 3],
  };
  for (const [mode, neutralSlots] of Object.entries(expectedNeutralSlots)) {
    const selected = isolateComicProviderReferences(
      references,
      mode as ComicReferenceIsolationMode
    );
    assert.deepEqual(selected.map((item) => item.role), ["template", "chat_character", "user_persona"]);
    assert.deepEqual(selected.map((item) => item.index), [1, 2, 3]);
    assert.equal(selected.length, 3);
    assert.deepEqual(
      selected.filter((item) => item.content === "neutral").map((item) => item.index),
      neutralSlots
    );
  }
});

test("REF-ISO-8..10: override is admin-only, invalid values reject, diagnostics contain no sources", () => {
  assert.throws(() => resolveComicDiagnosticOverrides({
    canSeeCost: false, referenceMode: "neutral_template",
  }), /FORBIDDEN/);
  assert.throws(() => resolveComicDiagnosticOverrides({
    canSeeCost: true, referenceMode: "bogus",
  }), /INVALID/);
  assert.throws(() => resolveComicDiagnosticOverrides({
    canSeeCost: true,
    referenceMode: "neutral_template",
    visualContextMode: "neutral_visual_context",
  }), /AXES_MUST_BE_ISOLATED/);
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

const scenePlan: ScenePlan = {
  sceneBackground: "bedroom SECRET_RAW_SOURCE",
  atmosphere: "intimate SECRET_RAW_SOURCE",
  events: [{ id: "E1", order: 1, sourceMessageId: 1, sourceRole: "assistant", kind: "action", actor: "character", text: "SECRET_RAW_SOURCE", segmentKind: "action" }],
  heroEventIds: ["E1"],
  heroScene: "SECRET_RAW_SOURCE",
  recommendedPanelCount: 2,
  panels: [1, 2].map((index) => ({
    index, sourceEventIds: ["E1"], situation: "SECRET_RAW_SOURCE", dialogue: [],
  })),
};

test("VC-1..4: neutral fixture has fixed safe semantics and does not mutate ScenePlan", () => {
  const before = structuredClone(scenePlan);
  const projected = buildNeutralComicProviderScenePlan(scenePlan);
  const structure = buildNeutralComicSafeStructure([1, 2]);
  assert.deepEqual(scenePlan, before);
  assert.equal(projected.panels.length, scenePlan.panels.length);
  assert.doesNotMatch(JSON.stringify(projected), /SECRET_RAW_SOURCE|bedroom|intimate/);
  assert.match(JSON.stringify(projected), /two adult characters/);
  assert.doesNotMatch(JSON.stringify(structure), /SECRET_RAW_SOURCE|bedroom|lying|dialogue/);
  assert.equal(projected.recommendedPanelCount, scenePlan.recommendedPanelCount);
  assert.equal(buildNeutralComicProviderScenePlan(scenePlan).sceneBackground, "ordinary indoor room");
});

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
    safeStructure: buildNeutralComicSafeStructure([1, 2]),
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
    referenceSet: formatComicReferenceSetForAdmin(
      isolateComicProviderReferences(references, "neutral_template")
    ),
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
  assert.equal((json.match(/template:neutral\|chat_character:real\|user_persona:real/g) ?? []).length, 2);
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

