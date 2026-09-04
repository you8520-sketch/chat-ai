import assert from "node:assert/strict";
import { describe, it } from "node:test";
import sharp from "sharp";

import {
  COMIC_847_HEAD_COMMIT,
  COMIC_CLIENT_GENERATION_ENDPOINT,
  COMIC_CLIENT_GENERATION_MODE,
  COMIC_MERGE_847_COMMIT,
  auditComicBufferParity,
  auditComicDeploymentParity,
  auditComicEndpointOwnership,
  auditComicOverlayExecution,
  auditComicScenePlanParity,
  auditComicTier1VisualStructure,
  auditComicTier2VisualStructure,
  buildBedroomLyingParityFixture,
  buildComicGenerationExecutionDiagnostic,
  classifyComicExecutionFailures,
  countComicOverlaySvgElements,
} from "./chatComicExecutionParityAudit";
import { CHAT_COMIC_TEMPLATE_PREVIEW_URL } from "./chatComicGeneration";
import { renderComicTextOverlay, validateComicOverlayPreflight } from "./chatComicTextOverlay";
import {
  buildDeterministicScenePlan,
  buildSceneSourceMessages,
  validateScenePlan,
  type ScenePlan,
} from "./chatImageScenePlan";
import { duoVisualSubjectsForCast } from "./chatComicPanelSpec.fixtures";

async function makeDummyImageBuffer(width = 864, height = 1824): Promise<Buffer> {
  return await sharp({
    create: {
      width,
      height,
      channels: 4,
      background: { r: 245, g: 245, b: 247, alpha: 1 },
    },
  })
    .webp()
    .toBuffer();
}

function forgeEmptyDialoguePlan(
  messages: ReturnType<typeof buildSceneSourceMessages>,
  panelCount: 2 | 3 | 4
): ScenePlan {
  const canonical = buildDeterministicScenePlan(messages, panelCount, {
    personaName: "유저",
    characterName: "캐릭터",
  });
  return {
    ...canonical,
    panels: canonical.panels.map((panel) => ({
      ...panel,
      dialogue: [],
      situation: "",
    })),
  };
}

describe("chatComicExecutionParityAudit deployment", () => {
  it("PARITY-DEPLOY-1: records #847 merge + head SHAs for runtime comparison", () => {
    assert.equal(COMIC_MERGE_847_COMMIT, "e6ac5abf72755fa1759bc661bac3f5c0f1d4bbaf");
    assert.equal(COMIC_847_HEAD_COMMIT, "affd47f522c767d1d5172f80490ebb7de6b814f2");
    const audit = auditComicDeploymentParity({
      deployedSha: COMIC_MERGE_847_COMMIT,
    });
    assert.equal(audit.deployedShaMatches847Merge, true);
  });

  it("PARITY-DEPLOY-2: deployed SHA mismatch is detectable", () => {
    const audit = auditComicDeploymentParity({ deployedSha: "deadbeef00000000000000000000000000000000" });
    assert.equal(audit.deployedShaMatches847Merge, false);
    assert.equal(audit.deployedShaContains847Head, false);
  });
});

describe("chatComicExecutionParityAudit endpoint ownership", () => {
  it("PARITY-ENDPOINT-1: comic button uses /api/chat/comic-generation mode=comic", () => {
    const audit = auditComicEndpointOwnership();
    assert.equal(audit.clientEndpoint, COMIC_CLIENT_GENERATION_ENDPOINT);
    assert.equal(audit.clientMode, COMIC_CLIENT_GENERATION_MODE);
    assert.equal(audit.clientResultUrlField, "imageUrl");
    assert.equal(audit.serverPersistsFinalComicBuffer, true);
  });
});

describe("chatComicExecutionParityAudit TEXT-LAYER", () => {
  const messages = buildSceneSourceMessages([
    { id: 1, role: "user", content: '"침대에서 쉬고 싶어."' },
    { id: 2, role: "assistant", content: '"그래, 좀 쉬어."' },
    { id: 3, role: "user", content: '"옆에 앉아줄래?"' },
    { id: 4, role: "assistant", content: "그는 침대 가장자리에 앉았다." },
  ]);
  const subjects = duoVisualSubjectsForCast({ characterName: "캐릭터", personaName: "유저" });

  it("PARITY-TEXT-1: empty panel dialogue[] passes validateScenePlan + preflight but yields zero bubbles", () => {
    const forged = forgeEmptyDialoguePlan(messages, 4);
    const validated = validateScenePlan(forged, messages, {
      allowUserEdits: true,
      personaName: "유저",
      characterName: "캐릭터",
    });
    assert.equal(validated.ok, true, validated.ok ? "" : validated.reason);

    const preflight = validateComicOverlayPreflight({
      width: 864,
      height: 1824,
      panelCount: 4,
      plan: validated.plan,
      subjects,
    });
    assert.equal(preflight.ok, true);

    const overlay = auditComicOverlayExecution({
      width: 864,
      height: 1824,
      panelCount: 4,
      plan: validated.plan,
      subjects,
    });
    assert.equal(overlay.bubbleCount, 0);
    assert.equal(overlay.svgSpeechBubbleCount, 0);
    assert.ok(overlay.approvedDialogueLineCount === 0);

    const scenePlanAudit = auditComicScenePlanParity({
      clientPlan: forged,
      approvedPlan: validated.plan,
      messages,
      personaName: "유저",
      characterName: "캐릭터",
    });
    assert.ok(scenePlanAudit.dialogueEventCount > 0);
    assert.ok(scenePlanAudit.panelsWithDialogueEventsButZeroLines > 0);
  });

  it("PARITY-TEXT-2: deterministic plan with dialogue produces non-zero overlay elements", () => {
    const plan = buildDeterministicScenePlan(messages, 4, {
      personaName: "유저",
      characterName: "캐릭터",
    });
    const overlay = auditComicOverlayExecution({
      width: 864,
      height: 1824,
      panelCount: 4,
      plan,
      subjects,
    });
    assert.ok(overlay.approvedDialogueLineCount > 0);
    assert.ok(overlay.bubbleCount > 0);
    assert.ok(overlay.svgHasVisibleOverlay);
  });

  it("PARITY-TEXT-3: provider buffer differs from finalComicBuffer when overlay renders", async () => {
    const plan = buildDeterministicScenePlan(messages, 2, {
      personaName: "유저",
      characterName: "캐릭터",
    });
    const providerBuffer = await makeDummyImageBuffer(1008, 1408);
    const finalBuffer = await renderComicTextOverlay({
      imageBuffer: providerBuffer,
      panelCount: 2,
      plan,
      subjects,
    });
    const bufferAudit = auditComicBufferParity({ providerBuffer, finalBuffer });
    assert.equal(bufferAudit.overlayMutatedBytes, true);
    assert.equal(bufferAudit.buffersIdentical, false);
  });

  it("PARITY-TEXT-4: empty overlay dialogue still allows narration from derived situation", async () => {
    const forged = forgeEmptyDialoguePlan(messages, 2);
    const validated = validateScenePlan(forged, messages, {
      allowUserEdits: true,
      personaName: "유저",
      characterName: "캐릭터",
    });
    assert.equal(validated.ok, true);
    const overlay = auditComicOverlayExecution({
      width: 1008,
      height: 1408,
      panelCount: 2,
      plan: validated.plan,
      subjects,
    });
    assert.equal(overlay.bubbleCount, 0);
    assert.equal(overlay.svgSpeechBubbleCount, 0);
    const providerBuffer = await makeDummyImageBuffer(1008, 1408);
    const finalBuffer = await renderComicTextOverlay({
      imageBuffer: providerBuffer,
      panelCount: 2,
      plan: validated.plan,
      subjects,
    });
    assert.ok(finalBuffer.length > 0);
  });

  it("PARITY-TEXT-5: classifyComicExecutionFailures flags text-layer when dialogue events have zero overlay", () => {
    const forged = forgeEmptyDialoguePlan(messages, 4);
    const validated = validateScenePlan(forged, messages, {
      allowUserEdits: true,
      personaName: "유저",
      characterName: "캐릭터",
    });
    assert.equal(validated.ok, true);
    const overlay = auditComicOverlayExecution({
      width: 864,
      height: 1824,
      panelCount: 4,
      plan: validated.plan,
      subjects,
    });
    const tier1 = auditComicTier1VisualStructure({
      plan: validated.plan,
      personaName: "유저",
      characterName: "캐릭터",
      subjects,
    });
    const tier2 = auditComicTier2VisualStructure({ plan: validated.plan });
    const scenePlanAudit = auditComicScenePlanParity({
      clientPlan: forged,
      approvedPlan: validated.plan,
      messages,
      personaName: "유저",
      characterName: "캐릭터",
    });
    const classification = classifyComicExecutionFailures({
      overlay,
      tier1,
      tier2,
      scenePlan: scenePlanAudit,
    });
    assert.equal(classification.textLayerFailure, true);
    assert.ok(
      classification.textLayerFailureReasons.includes(
        "panels_cover_dialogue_events_with_empty_dialogue_arrays"
      )
    );
  });
});

describe("chatComicExecutionParityAudit VISUAL-LAYER", () => {
  const subjects = duoVisualSubjectsForCast({ characterName: "캐릭터", personaName: "유저" });

  it("PARITY-VISUAL-1: bedroom-lying fixture encodes bedroom/bed/lying in Tier-1 structure", () => {
    const { plan } = buildBedroomLyingParityFixture(4);
    const tier1 = auditComicTier1VisualStructure({
      plan,
      personaName: "유저",
      characterName: "캐릭터",
      subjects,
    });
    assert.equal(tier1.hasBedroomBedKeywords, true);
    assert.equal(tier1.hasLyingRecliningKeywords, true);
    assert.equal(tier1.genericInteriorRisk, false);
    assert.equal(tier1.templateReferenceUrl, CHAT_COMIC_TEMPLATE_PREVIEW_URL);
    assert.equal(tier1.templateReferenceIndex, 0);
    assert.equal(tier1.layoutTemplateContaminationRisk, true);
  });

  it("PARITY-VISUAL-2: generic interior-only scene flags genericInteriorRisk", () => {
    const messages = buildSceneSourceMessages([
      { id: 1, role: "user", content: "*소파에 앉는다*" },
      { id: 2, role: "assistant", content: "거실 화분 사이에서 그가 미소 지었다." },
    ]);
    const plan = buildDeterministicScenePlan(messages, 2, {
      personaName: "유저",
      characterName: "캐릭터",
    });
    const tier1 = auditComicTier1VisualStructure({
      plan,
      personaName: "유저",
      characterName: "캐릭터",
      subjects,
    });
    assert.equal(tier1.genericInteriorRisk, true);
    assert.equal(tier1.hasBedroomBedKeywords, false);
  });

  it("PARITY-VISUAL-3: Tier-2 safe structure preserves bedroom tokens when present", () => {
    const { plan } = buildBedroomLyingParityFixture(4);
    const tier2 = auditComicTier2VisualStructure({ plan });
    assert.equal(tier2.hasBedroomBedKeywords, true);
    assert.ok(tier2.tierPromptLineCount > 0);
  });

  it("PARITY-VISUAL-4: bedroom expectation failure classification is independent from text-layer", () => {
    const { plan, messages } = buildBedroomLyingParityFixture(4);
    const overlay = auditComicOverlayExecution({
      width: 864,
      height: 1824,
      panelCount: 4,
      plan,
      subjects,
    });
    assert.ok(overlay.bubbleCount > 0, "deterministic bedroom fixture should have bubbles");

    const forgedGeneric = buildDeterministicScenePlan(
      buildSceneSourceMessages([
        { id: 1, role: "user", content: "*소파에 앉는다*" },
        { id: 2, role: "assistant", content: "거실 화분 옆에서 대화했다." },
      ]),
      2,
      { personaName: "유저", characterName: "캐릭터" }
    );
    const tier1Generic = auditComicTier1VisualStructure({
      plan: forgedGeneric,
      personaName: "유저",
      characterName: "캐릭터",
      subjects,
    });
    const tier2Generic = auditComicTier2VisualStructure({ plan: forgedGeneric });
    const scenePlanAudit = auditComicScenePlanParity({
      clientPlan: forgedGeneric,
      approvedPlan: forgedGeneric,
      messages,
      personaName: "유저",
      characterName: "캐릭터",
    });
    const classification = classifyComicExecutionFailures({
      overlay,
      tier1: tier1Generic,
      tier2: tier2Generic,
      scenePlan: scenePlanAudit,
      expectedBedroomScene: true,
    });
    assert.equal(classification.textLayerFailure, false);
    assert.equal(classification.visualLayerFailure, true);
    assert.equal(classification.tracksIndependent, true);
  });
});

describe("chatComicExecutionParityAudit diagnostic payload", () => {
  it("PARITY-DIAG-1: buildComicGenerationExecutionDiagnostic returns counts-only fields", () => {
    const { plan, messages } = buildBedroomLyingParityFixture(4);
    const diagnostic = buildComicGenerationExecutionDiagnostic({
      scenePlan: plan,
      panelCount: 4,
      messages,
      personaName: "유저",
      characterName: "캐릭터",
      expectedBedroomScene: true,
    });
    assert.equal(diagnostic.endpoint, COMIC_CLIENT_GENERATION_ENDPOINT);
    assert.equal(diagnostic.mode, COMIC_CLIENT_GENERATION_MODE);
    assert.equal(diagnostic.panelCount, 4);
    assert.equal(diagnostic.resultUrlField, "imageUrl");
    assert.equal(diagnostic.validationOk, true);
    assert.equal(diagnostic.preflightOk, true);
    assert.ok(diagnostic.approvedDialogueLineCount > 0);
    assert.equal(diagnostic.overlaySvgVisible, true);
    assert.equal(diagnostic.tier1HasBedroomBedKeywords, true);
    assert.equal(diagnostic.templateReferenceIndex, 0);
    assert.equal(typeof diagnostic.textLayerFailure, "boolean");
    assert.equal(typeof diagnostic.visualLayerFailure, "boolean");
  });

  it("PARITY-DIAG-2: countComicOverlaySvgElements matches layout counts", () => {
    const { plan } = buildBedroomLyingParityFixture(2);
    const overlay = auditComicOverlayExecution({
      width: 1008,
      height: 1408,
      panelCount: 2,
      plan,
      subjects: duoVisualSubjectsForCast({ characterName: "캐릭터", personaName: "유저" }),
    });
    assert.equal(overlay.svgSpeechBubbleCount, overlay.bubbleCount);
    assert.equal(overlay.svgNarrationCount, overlay.narrationCount);
    assert.equal(overlay.svgSfxCount, overlay.sfxCount);
    assert.ok(countComicOverlaySvgElements("<g></g>").speechBubbleCount === 0);
  });
});
