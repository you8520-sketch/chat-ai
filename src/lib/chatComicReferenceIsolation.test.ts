import assert from "node:assert/strict";
import test from "node:test";

import { hashPromptForDiagnostic } from "@/lib/openAiImageFailureDiagnostic";
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

test("REF-ISO-1..7: each mode selects only reference roles and preserves prompt hash", () => {
  const expected: Record<ComicReferenceIsolationMode, string[]> = {
    normal: ["template", "chat_character", "user_persona"],
    without_template: ["chat_character", "user_persona"],
    without_character: ["template", "user_persona"],
    without_persona: ["template", "chat_character"],
    template_only: ["template"],
    identity_refs_only: ["chat_character", "user_persona"],
  };
  const frozenTier2Prompt = "deterministic tier-2 fixture";
  const normalHash = hashPromptForDiagnostic(frozenTier2Prompt);
  for (const [mode, roles] of Object.entries(expected)) {
    const selected = isolateComicProviderReferences(
      references,
      mode as ComicReferenceIsolationMode
    );
    assert.deepEqual(selected.map((item) => item.role), roles);
    assert.deepEqual(selected.map((item) => item.index), roles.map((_, index) => index + 1));
    assert.equal(hashPromptForDiagnostic(frozenTier2Prompt), normalHash);
  }
});

test("REF-ISO-8..10: override is admin-only, invalid values reject, diagnostics contain no sources", () => {
  assert.throws(() => resolveComicDiagnosticOverrides({
    canSeeCost: false, referenceMode: "without_template",
  }), /FORBIDDEN/);
  assert.throws(() => resolveComicDiagnosticOverrides({
    canSeeCost: true, referenceMode: "bogus",
  }), /INVALID/);
  assert.throws(() => resolveComicDiagnosticOverrides({
    canSeeCost: true,
    referenceMode: "template_only",
    visualContextMode: "neutral_visual_context",
  }), /AXES_MUST_BE_ISOLATED/);
  const diagnostic = formatComicReferenceSetForAdmin(references);
  assert.deepEqual(diagnostic, {
    referenceRoles: ["template", "chat_character", "user_persona"],
    referenceCount: 3,
    referenceSetSignature: "template+chat_character+user_persona",
  });
  const json = JSON.stringify(diagnostic);
  assert.doesNotMatch(json, /character\.webp|persona\.webp|base64|https?:\/\//);
});

const scenePlan: ScenePlan = {
  sceneBackground: "bedroom SECRET_RAW_SOURCE",
  atmosphere: "intimate SECRET_RAW_SOURCE",
  events: [{ id: "E1", sourceRole: "assistant", kind: "action", actor: "character", text: "SECRET_RAW_SOURCE", segmentKind: "prose" }],
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

test("DIAG-1..7: attempts are explicit, preserve unknown safety data, and mark fallback invoked", () => {
  const diagnostic = formatOpenAiImageProviderAttemptsForAdmin({
    providerAttempts: [
      { attempt: 1, kind: "primary", outcome: "safety_rejected", promptHash: "hash-1", diagnostic: { providerRequestId: "req-1", errorCode: "moderation_blocked", safetyCategories: ["sexual"] } },
      { attempt: 2, kind: "strict_safety_fallback", outcome: "safety_rejected", promptHash: "hash-2", diagnostic: { providerRequestId: "req-2", errorCode: "moderation_blocked" } },
    ],
    knownProviderCostUsd: null,
    hasUnknownAttemptCost: true,
    safetyFallbackUsed: false,
  });
  assert.equal(diagnostic.safetyFallbackInvoked, true);
  assert.equal(diagnostic.safetyFallbackUsed, true);
  const json = JSON.stringify(diagnostic);
  assert.match(json, /"attempt":1/);
  assert.match(json, /"attempt":2/);
  assert.match(json, /req-1/);
  assert.match(json, /req-2/);
  assert.match(json, /hash-1/);
  assert.match(json, /"safetyCategories":"UNKNOWN"/);
  assert.doesNotMatch(json, /\[Object\]|rawPrompt|sourceUrl|base64|https?:\/\//);
});

test("human QA outcomes classify moderation association without declaring an image unsafe", () => {
  assert.equal(classifyComicModerationAssociation({
    normal: "moderation_blocked", without_template: "pass",
  }), "TEMPLATE_REFERENCE_PRIMARY_SUSPECT");
  assert.equal(classifyComicModerationAssociation({
    normal: "moderation_blocked", identity_refs_only: "moderation_blocked", template_only: "pass",
  }), "IDENTITY_REFERENCE_OR_MULTI_PERSON_INTERACTION");
  assert.equal(classifyComicModerationAssociation({
    normal: "moderation_blocked", neutral_visual_context: "pass",
  }), "REFERENCE_BYTES_ALONE_NOT_SUFFICIENT_CAUSE");
});
