/**
 * Live Comic Execution Parity Audit — deterministic production-path tracing.
 * Counts-only / structure-only; never emits raw prompts, chat, or reference bytes.
 */

import crypto from "crypto";

import {
  CHAT_COMIC_TEMPLATE_PREVIEW_URL,
  buildChatComicGenerationPlan,
  buildChatComicImagePrompt,
  parseChatComicOutputDimensions,
} from "@/lib/chatComicGeneration";
import {
  compileComicPanelOverlayLayouts,
  compileComicTextOverlaySvg,
  filterDialogueForTextOverlay,
  validateComicOverlayPreflight,
  type TextOverlaySafetyContext,
} from "@/lib/chatComicTextOverlay";
import {
  buildChatComicPanelSpecVisualSection,
  compileChatComicPanelSpec,
} from "@/lib/chatComicPanelSpec";
import {
  containsBedroomBedStructure,
  projectComicSafeStructureForTier2,
  renderComicSafeStructureForTier2Prompt,
} from "@/lib/chatComicSafeStructure";
import type { ChatComicPanelCount } from "@/lib/chatComicGeneration";
import type { ChatImageCastGroundedManifest } from "@/lib/chatImageCastManifest";
import type { ContentKind } from "@/lib/simulationMode";
import type { ImagePromptGender } from "@/lib/chatImageGeneration";
import type { ChatImageAppearanceMode, ChatImageVisualSubject } from "@/lib/chatImageVisualIdentity";
import {
  buildDeterministicScenePlan,
  buildSceneSourceMessages,
  resolveScenePresentationVisibility,
  validateScenePlan,
  type ScenePlan,
  type ScenePresentationVisibility,
  type SceneSourceMessage,
} from "@/lib/chatImageScenePlan";

/** Merge commit for PR #847 (unified overlay-first architecture). */
export const COMIC_MERGE_847_COMMIT = "e6ac5abf72755fa1759bc661bac3f5c0f1d4bbaf";
/** PR #847 head before merge. */
export const COMIC_847_HEAD_COMMIT = "affd47f522c767d1d5172f80490ebb7de6b814f2";

export const COMIC_CLIENT_GENERATION_ENDPOINT = "/api/chat/comic-generation";
export const COMIC_CLIENT_GENERATION_MODE = "comic";

export type ComicDeploymentParityAudit = {
  expectedMerge847Commit: string;
  expected847HeadCommit: string;
  deployedSha: string | null;
  deployedShaMatches847Merge: boolean;
  deployedShaContains847Head: boolean;
  auditNote: string;
};

export type ComicEndpointOwnershipAudit = {
  clientEndpoint: string;
  clientMode: string;
  serverRoutePath: string;
  clientSendsScenePlan: true;
  clientSendsPanelCount: true;
  clientResultUrlField: "imageUrl";
  serverPersistsFinalComicBuffer: true;
};

export type ComicScenePlanParityAudit = {
  validationOk: boolean;
  validationReason?: string;
  clientPanelCount: number;
  approvedPanelCount: number;
  clientDialogueLineCount: number;
  approvedDialogueLineCount: number;
  dialogueEventCount: number;
  linkedSourceDialogueCount: number;
  emptyPanelDialogueCount: number;
  panelsWithDialogueEventsButZeroLines: number;
  sceneBackgroundLength: number;
  heroSceneLength: number;
};

export type ComicOverlayExecutionAudit = {
  preflightOk: boolean;
  preflightReason?: string;
  approvedDialogueLineCount: number;
  filteredDialogueLineCount: number;
  bubbleCount: number;
  narrationCount: number;
  sfxCount: number;
  svgSpeechBubbleCount: number;
  svgNarrationCount: number;
  svgSfxCount: number;
  svgHasVisibleOverlay: boolean;
  perPanel: Array<{
    panelIndex: number;
    rawDialogueLines: number;
    approvedDialogueLines: number;
    filteredDialogueLines: number;
    bubbleCount: number;
    narrationCount: number;
    sfxCount: number;
    situationLength: number;
  }>;
};

export type ComicBufferParityAudit = {
  providerBufferBytes: number;
  finalBufferBytes: number;
  providerSha256: string;
  finalSha256: string;
  buffersIdentical: boolean;
  overlayMutatedBytes: boolean;
};

export type ComicVisualStructureAudit = {
  tier: 1 | 2;
  sharedBackground: string;
  panelBackgrounds: string[];
  panelSituations: string[];
  hasBedroomBedKeywords: boolean;
  hasLyingRecliningKeywords: boolean;
  genericInteriorRisk: boolean;
  templateReferenceUrl: string;
  templateReferenceIndex: number;
  layoutTemplateContaminationRisk: true;
  tierPromptLineCount: number;
  tierPromptHasVisualOnlyGuard: boolean;
};

export type ComicExecutionFailureClassification = {
  textLayerFailure: boolean;
  textLayerFailureReasons: string[];
  visualLayerFailure: boolean;
  visualLayerFailureReasons: string[];
  tracksIndependent: true;
};

export type ComicGenerationExecutionDiagnostic = {
  deployedSha: string | null;
  merge847Expected: string;
  endpoint: string;
  mode: string;
  panelCount: number;
  validationOk: boolean;
  preflightOk: boolean;
  approvedDialogueLineCount: number;
  filteredDialogueLineCount: number;
  overlayBubbleCount: number;
  overlayNarrationCount: number;
  overlaySfxCount: number;
  overlaySvgVisible: boolean;
  emptyPanelDialogueCount: number;
  dialogueEventCount: number;
  linkedSourceDialogueCount: number;
  panelsWithDialogueEventsButZeroLines: number;
  safetyFallbackUsed: boolean;
  tierUsed: 1 | 2;
  tier1HasBedroomBedKeywords: boolean;
  tier1GenericInteriorRisk: boolean;
  tier2HasBedroomBedKeywords: boolean;
  templateReferenceIndex: number;
  providerBufferBytes: number;
  finalBufferBytes: number;
  buffersIdentical: boolean;
  resultUrlField: "imageUrl";
  textLayerFailure: boolean;
  visualLayerFailure: boolean;
};

const GENERIC_INTERIOR_PATTERN =
  /(?:sofa| couch| living room| houseplant| potted plant| indoor plant| 거실| 소파| 화분| 실내)/iu;
const BEDROOM_BED_PATTERN = /(?:bedroom| bed| lying| reclining| 침실| 침대| 누(?:워|운|어)| 눕)/iu;
const LYING_PATTERN = /(?:lying| reclining| 누(?:워|운|어)| 눕| 누워)/iu;

export function resolveDeployedGitSha(): string | null {
  const raw =
    process.env.RAILWAY_GIT_COMMIT_SHA ??
    process.env.VERCEL_GIT_COMMIT_SHA ??
    process.env.GIT_COMMIT_SHA ??
    null;
  return raw?.trim() || null;
}

export function auditComicDeploymentParity(opts: {
  deployedSha?: string | null;
} = {}): ComicDeploymentParityAudit {
  const deployedSha = opts.deployedSha ?? resolveDeployedGitSha();
  const normalized = deployedSha?.toLowerCase() ?? null;
  return {
    expectedMerge847Commit: COMIC_MERGE_847_COMMIT,
    expected847HeadCommit: COMIC_847_HEAD_COMMIT,
    deployedSha,
    deployedShaMatches847Merge: normalized === COMIC_MERGE_847_COMMIT.toLowerCase(),
    deployedShaContains847Head: Boolean(
      normalized?.startsWith(COMIC_847_HEAD_COMMIT.slice(0, 7).toLowerCase())
    ),
    auditNote:
      "Runtime SHA must be checked via /api/health gitCommit or admin comic diagnostic deployedSha. Code-level merge ancestry is proven in PARITY-DEPLOY tests.",
  };
}

export function auditComicEndpointOwnership(): ComicEndpointOwnershipAudit {
  return {
    clientEndpoint: COMIC_CLIENT_GENERATION_ENDPOINT,
    clientMode: COMIC_CLIENT_GENERATION_MODE,
    serverRoutePath: "src/app/api/chat/comic-generation/route.ts",
    clientSendsScenePlan: true,
    clientSendsPanelCount: true,
    clientResultUrlField: "imageUrl",
    serverPersistsFinalComicBuffer: true,
  };
}

function countDialogueLines(plan: ScenePlan): number {
  return plan.panels.reduce((sum, panel) => sum + panel.dialogue.length, 0);
}

function countLinkedSourceDialogue(plan: ScenePlan): number {
  return plan.panels.reduce(
    (sum, panel) =>
      sum +
      panel.dialogue.filter(
        (line) => line.provenance === "source" && line.sourceEventId && line.text.trim()
      ).length,
    0
  );
}

function countEmptyPanelDialogue(plan: ScenePlan): number {
  return plan.panels.filter((panel) => panel.dialogue.length === 0).length;
}

function countPanelsWithDialogueEventsButZeroLines(
  plan: ScenePlan
): number {
  const eventsById = new Map(plan.events.map((event) => [event.id, event]));
  let count = 0;
  for (const panel of plan.panels) {
    if (panel.dialogue.length > 0) continue;
    const hasDialogueEvent = panel.sourceEventIds.some((id) => {
      const event = eventsById.get(id);
      return event?.kind === "dialogue";
    });
    if (hasDialogueEvent) count += 1;
  }
  return count;
}

export function auditComicScenePlanParity(opts: {
  clientPlan: unknown;
  approvedPlan: ScenePlan;
  messages: readonly SceneSourceMessage[];
  personaName?: string;
  characterName?: string;
  knownSpeakerNames?: readonly string[];
  contentKind?: ContentKind;
}): ComicScenePlanParityAudit {
  const validated = validateScenePlan(opts.clientPlan, opts.messages, {
    allowUserEdits: true,
    personaName: opts.personaName,
    characterName: opts.characterName,
    knownSpeakerNames: opts.knownSpeakerNames,
    contentKind: opts.contentKind,
  });
  const clientPlan =
    validated.ok && opts.clientPlan && typeof opts.clientPlan === "object"
      ? (opts.clientPlan as ScenePlan)
      : null;
  const dialogueEventCount = opts.approvedPlan.events.filter(
    (event) => event.kind === "dialogue"
  ).length;

  return {
    validationOk: validated.ok,
    validationReason: validated.ok ? undefined : validated.reason,
    clientPanelCount: clientPlan?.panels.length ?? 0,
    approvedPanelCount: opts.approvedPlan.panels.length,
    clientDialogueLineCount: clientPlan ? countDialogueLines(clientPlan) : 0,
    approvedDialogueLineCount: countDialogueLines(opts.approvedPlan),
    dialogueEventCount,
    linkedSourceDialogueCount: countLinkedSourceDialogue(opts.approvedPlan),
    emptyPanelDialogueCount: countEmptyPanelDialogue(opts.approvedPlan),
    panelsWithDialogueEventsButZeroLines: countPanelsWithDialogueEventsButZeroLines(
      opts.approvedPlan
    ),
    sceneBackgroundLength: opts.approvedPlan.sceneBackground.trim().length,
    heroSceneLength: opts.approvedPlan.heroScene.trim().length,
  };
}

export function countComicOverlaySvgElements(svg: string): {
  speechBubbleCount: number;
  narrationCount: number;
  sfxCount: number;
} {
  const speechBubbleCount = (svg.match(/class="speech-bubble"/g) ?? []).length;
  const narrationCount = (svg.match(/class="narration-box"/g) ?? []).length;
  const sfxCount = (svg.match(/class="sfx"/g) ?? []).length;
  return { speechBubbleCount, narrationCount, sfxCount };
}

export function auditComicOverlayExecution(opts: {
  width: number;
  height: number;
  panelCount: number;
  plan: ScenePlan;
  visibility?: ScenePresentationVisibility;
  safetyContext?: TextOverlaySafetyContext;
  subjects?: readonly ChatImageVisualSubject[];
}): ComicOverlayExecutionAudit {
  const visibility = opts.visibility ?? { personaVisible: true };
  const safetyContext: TextOverlaySafetyContext = {
    ...opts.safetyContext,
    personaVisible: visibility.personaVisible,
  };

  const preflight = validateComicOverlayPreflight({
    width: opts.width,
    height: opts.height,
    panelCount: opts.panelCount,
    plan: opts.plan,
    visibility,
    safetyContext,
    subjects: opts.subjects,
  });

  const layouts = compileComicPanelOverlayLayouts({
    width: opts.width,
    height: opts.height,
    panelCount: opts.panelCount,
    plan: opts.plan,
    visibility,
    safetyContext,
    subjects: opts.subjects,
  });

  const svg = compileComicTextOverlaySvg({
    width: opts.width,
    height: opts.height,
    panelCount: opts.panelCount,
    plan: opts.plan,
    visibility,
    safetyContext,
    subjects: opts.subjects,
  });
  const svgCounts = countComicOverlaySvgElements(svg);

  let approvedDialogueLineCount = 0;
  let filteredDialogueLineCount = 0;
  let bubbleCount = 0;
  let narrationCount = 0;
  let sfxCount = 0;

  const perPanel = opts.plan.panels.slice(0, opts.panelCount).map((panel, index) => {
    const rawDialogueLines = panel.dialogue.length;
    const approved = filterDialogueForTextOverlay(panel.dialogue, safetyContext);
    const filteredDialogueLines = Math.max(0, rawDialogueLines - approved.length);
    const layout = layouts[index];
    approvedDialogueLineCount += approved.length;
    filteredDialogueLineCount += filteredDialogueLines;
    bubbleCount += layout?.bubbles.length ?? 0;
    narrationCount += layout?.narration ? 1 : 0;
    sfxCount += layout?.sfx ? 1 : 0;
    return {
      panelIndex: panel.index,
      rawDialogueLines,
      approvedDialogueLines: approved.length,
      filteredDialogueLines,
      bubbleCount: layout?.bubbles.length ?? 0,
      narrationCount: layout?.narration ? 1 : 0,
      sfxCount: layout?.sfx ? 1 : 0,
      situationLength: String(panel.situation ?? "").trim().length,
    };
  });

  const svgHasVisibleOverlay =
    svgCounts.speechBubbleCount + svgCounts.narrationCount + svgCounts.sfxCount > 0;

  return {
    preflightOk: preflight.ok,
    preflightReason: preflight.ok ? undefined : preflight.reason,
    approvedDialogueLineCount,
    filteredDialogueLineCount,
    bubbleCount,
    narrationCount,
    sfxCount,
    svgSpeechBubbleCount: svgCounts.speechBubbleCount,
    svgNarrationCount: svgCounts.narrationCount,
    svgSfxCount: svgCounts.sfxCount,
    svgHasVisibleOverlay,
    perPanel,
  };
}

export function auditComicBufferParity(opts: {
  providerBuffer: Buffer;
  finalBuffer: Buffer;
}): ComicBufferParityAudit {
  const providerSha256 = crypto.createHash("sha256").update(opts.providerBuffer).digest("hex");
  const finalSha256 = crypto.createHash("sha256").update(opts.finalBuffer).digest("hex");
  const buffersIdentical = providerSha256 === finalSha256;
  return {
    providerBufferBytes: opts.providerBuffer.length,
    finalBufferBytes: opts.finalBuffer.length,
    providerSha256,
    finalSha256,
    buffersIdentical,
    overlayMutatedBytes: !buffersIdentical,
  };
}

function collectVisualTokens(plan: ScenePlan, visibility: ScenePresentationVisibility): {
  sharedBackground: string;
  panelBackgrounds: string[];
  panelSituations: string[];
} {
  const spec = compileChatComicPanelSpec({
    plan,
    personaName: "persona",
    characterName: "character",
    visibility,
    subjects: [],
  });
  return {
    sharedBackground: spec.sharedBackground,
    panelBackgrounds: spec.panels.map((panel) => panel.background),
    panelSituations: spec.panels.map((panel) => panel.situation),
  };
}

function assessGenericInteriorRisk(tokens: readonly string[]): boolean {
  const haystack = tokens.join(" ");
  return GENERIC_INTERIOR_PATTERN.test(haystack) && !BEDROOM_BED_PATTERN.test(haystack);
}

function assessBedroomBedKeywords(tokens: readonly string[]): boolean {
  return BEDROOM_BED_PATTERN.test(tokens.join(" "));
}

function assessLyingKeywords(tokens: readonly string[]): boolean {
  return LYING_PATTERN.test(tokens.join(" "));
}

export function auditComicTier1VisualStructure(opts: {
  plan: ScenePlan;
  personaName: string;
  characterName: string;
  visibility?: ScenePresentationVisibility;
  subjects?: readonly ChatImageVisualSubject[];
}): ComicVisualStructureAudit {
  const visibility = opts.visibility ?? { personaVisible: true };
  const visualSection = buildChatComicPanelSpecVisualSection({
    plan: opts.plan,
    personaName: opts.personaName,
    characterName: opts.characterName,
    visibility,
    subjects: opts.subjects ?? [],
  });
  const tokens = collectVisualTokens(opts.plan, visibility);
  const allTokens = [tokens.sharedBackground, ...tokens.panelBackgrounds, ...tokens.panelSituations];

  return {
    tier: 1,
    sharedBackground: tokens.sharedBackground,
    panelBackgrounds: tokens.panelBackgrounds,
    panelSituations: tokens.panelSituations,
    hasBedroomBedKeywords: assessBedroomBedKeywords(allTokens),
    hasLyingRecliningKeywords: assessLyingKeywords(allTokens),
    genericInteriorRisk: assessGenericInteriorRisk(allTokens),
    templateReferenceUrl: CHAT_COMIC_TEMPLATE_PREVIEW_URL,
    templateReferenceIndex: 0,
    layoutTemplateContaminationRisk: true,
    tierPromptLineCount: visualSection.split("\n").filter(Boolean).length,
    tierPromptHasVisualOnlyGuard: /VISUAL LAYER ONLY|zero readable text/i.test(visualSection),
  };
}

export function auditComicTier2VisualStructure(opts: {
  plan: ScenePlan;
  visibility?: ScenePresentationVisibility;
}): ComicVisualStructureAudit {
  const visibility = opts.visibility ?? { personaVisible: true };
  const safeStructure = projectComicSafeStructureForTier2(opts.plan, visibility);
  const tierLines = renderComicSafeStructureForTier2Prompt(safeStructure);
  const allTokens = [
    safeStructure.sharedBackground,
    ...safeStructure.panels.flatMap((panel) => [panel.background, panel.situation, panel.poseHint]),
  ];

  return {
    tier: 2,
    sharedBackground: safeStructure.sharedBackground,
    panelBackgrounds: safeStructure.panels.map((panel) => panel.background),
    panelSituations: safeStructure.panels.map((panel) => panel.situation),
    hasBedroomBedKeywords: containsBedroomBedStructure(safeStructure),
    hasLyingRecliningKeywords: assessLyingKeywords(allTokens),
    genericInteriorRisk: assessGenericInteriorRisk(allTokens),
    templateReferenceUrl: CHAT_COMIC_TEMPLATE_PREVIEW_URL,
    templateReferenceIndex: 0,
    layoutTemplateContaminationRisk: true,
    tierPromptLineCount: tierLines.length,
    tierPromptHasVisualOnlyGuard: tierLines.some((line) => /no readable letters/i.test(line)),
  };
}

export function classifyComicExecutionFailures(opts: {
  overlay: ComicOverlayExecutionAudit;
  tier1: ComicVisualStructureAudit;
  tier2: ComicVisualStructureAudit;
  scenePlan: ComicScenePlanParityAudit;
  expectedBedroomScene?: boolean;
}): ComicExecutionFailureClassification {
  const textLayerFailureReasons: string[] = [];
  const visualLayerFailureReasons: string[] = [];

  if (opts.scenePlan.dialogueEventCount > 0 && opts.overlay.approvedDialogueLineCount === 0) {
    textLayerFailureReasons.push("dialogue_events_present_but_zero_approved_overlay_lines");
  }
  if (opts.scenePlan.panelsWithDialogueEventsButZeroLines > 0) {
    textLayerFailureReasons.push("panels_cover_dialogue_events_with_empty_dialogue_arrays");
  }
  if (opts.overlay.approvedDialogueLineCount > 0 && opts.overlay.svgSpeechBubbleCount === 0) {
    textLayerFailureReasons.push("approved_dialogue_but_zero_svg_bubbles");
  }
  if (!opts.overlay.svgHasVisibleOverlay && opts.overlay.approvedDialogueLineCount === 0) {
    textLayerFailureReasons.push("zero_visible_overlay_elements");
  }
  if (opts.overlay.filteredDialogueLineCount > 0 && opts.overlay.approvedDialogueLineCount === 0) {
    textLayerFailureReasons.push("all_panel_dialogue_filtered_before_overlay");
  }

  if (opts.expectedBedroomScene) {
    if (!opts.tier1.hasBedroomBedKeywords) {
      visualLayerFailureReasons.push("tier1_missing_bedroom_bed_keywords");
    }
    if (!opts.tier1.hasLyingRecliningKeywords) {
      visualLayerFailureReasons.push("tier1_missing_lying_reclining_keywords");
    }
    if (opts.tier1.genericInteriorRisk) {
      visualLayerFailureReasons.push("tier1_generic_interior_risk_without_bedroom");
    }
    if (opts.tier1.layoutTemplateContaminationRisk) {
      visualLayerFailureReasons.push("layout_template_reference_index_0_contamination_risk");
    }
  }

  return {
    textLayerFailure: textLayerFailureReasons.length > 0,
    textLayerFailureReasons,
    visualLayerFailure: visualLayerFailureReasons.length > 0,
    visualLayerFailureReasons,
    tracksIndependent: true,
  };
}

export function buildComicGenerationExecutionDiagnostic(opts: {
  scenePlan: ScenePlan;
  panelCount: ChatComicPanelCount;
  messages: readonly SceneSourceMessage[];
  clientPlan?: unknown;
  personaName: string;
  characterName: string;
  knownSpeakerNames?: readonly string[];
  contentKind?: ContentKind;
  castManifest?: ChatImageCastGroundedManifest | null;
  characterGender?: ImagePromptGender;
  personaGender?: ImagePromptGender;
  characterImageUrl?: string;
  personaImageUrl?: string;
  characterSavedAppearance?: string;
  personaSavedAppearance?: string;
  characterAppearanceMode?: ChatImageAppearanceMode;
  personaAppearanceMode?: ChatImageAppearanceMode;
  safetyFallbackUsed?: boolean;
  providerBuffer?: Buffer;
  finalBuffer?: Buffer;
  expectedBedroomScene?: boolean;
}): ComicGenerationExecutionDiagnostic {
  const visibility = resolveScenePresentationVisibility({
    contentKind: opts.contentKind ?? "character",
    castManifest: opts.castManifest ?? null,
  });
  const dims = parseChatComicOutputDimensions(opts.panelCount);
  const scenePlanAudit = auditComicScenePlanParity({
    clientPlan: opts.clientPlan ?? opts.scenePlan,
    approvedPlan: opts.scenePlan,
    messages: opts.messages,
    personaName: opts.personaName,
    characterName: opts.characterName,
    knownSpeakerNames: opts.knownSpeakerNames,
    contentKind: opts.contentKind,
  });

  const identityPack = buildChatComicGenerationPlan({
    characterName: opts.characterName,
    characterGender: opts.characterGender ?? "female",
    personaName: opts.personaName,
    personaGender: opts.personaGender ?? "female",
    characterImageUrl: opts.characterImageUrl ?? "/character-ref",
    characterSavedAppearance: opts.characterSavedAppearance ?? "",
    characterAppearanceMode: opts.characterAppearanceMode ?? "image_only",
    personaImageUrl: opts.personaImageUrl ?? "/persona-ref",
    personaSavedAppearance: opts.personaSavedAppearance ?? "",
    personaAppearanceMode: opts.personaAppearanceMode ?? "image_only",
    mood: "comic",
    plan: opts.scenePlan,
    castManifest: opts.castManifest,
    contentKind: opts.contentKind,
  });

  const overlay = auditComicOverlayExecution({
    width: dims.width,
    height: dims.height,
    panelCount: opts.panelCount,
    plan: opts.scenePlan,
    visibility,
    safetyContext: { isSafetyFallback: opts.safetyFallbackUsed === true },
    subjects: identityPack.subjects,
  });

  const tier1 = auditComicTier1VisualStructure({
    plan: opts.scenePlan,
    personaName: opts.personaName,
    characterName: opts.characterName,
    visibility,
    subjects: identityPack.subjects,
  });
  const tier2 = auditComicTier2VisualStructure({ plan: opts.scenePlan, visibility });
  const classification = classifyComicExecutionFailures({
    overlay,
    tier1,
    tier2,
    scenePlan: scenePlanAudit,
    expectedBedroomScene: opts.expectedBedroomScene,
  });

  const providerBuffer = opts.providerBuffer ?? Buffer.alloc(0);
  const finalBuffer = opts.finalBuffer ?? Buffer.alloc(0);
  const bufferAudit =
    opts.providerBuffer && opts.finalBuffer
      ? auditComicBufferParity({ providerBuffer, finalBuffer })
      : {
          providerBufferBytes: providerBuffer.length,
          finalBufferBytes: finalBuffer.length,
          buffersIdentical: false,
        };

  // Ensure Tier-1 prompt compiles (parity ownership check — no raw prompt returned).
  void buildChatComicImagePrompt({
    characterName: opts.characterName,
    characterGender: opts.characterGender ?? "female",
    personaName: opts.personaName,
    personaGender: opts.personaGender ?? "female",
    mood: "comic",
    plan: opts.scenePlan,
    subjects: identityPack.subjects,
    castManifest: opts.castManifest,
    castSelected: opts.castManifest?.subjects.filter((subject) => subject.included),
    contentKind: opts.contentKind,
  });

  return {
    deployedSha: resolveDeployedGitSha(),
    merge847Expected: COMIC_MERGE_847_COMMIT,
    endpoint: COMIC_CLIENT_GENERATION_ENDPOINT,
    mode: COMIC_CLIENT_GENERATION_MODE,
    panelCount: opts.panelCount,
    validationOk: scenePlanAudit.validationOk,
    preflightOk: overlay.preflightOk,
    approvedDialogueLineCount: overlay.approvedDialogueLineCount,
    filteredDialogueLineCount: overlay.filteredDialogueLineCount,
    overlayBubbleCount: overlay.bubbleCount,
    overlayNarrationCount: overlay.narrationCount,
    overlaySfxCount: overlay.sfxCount,
    overlaySvgVisible: overlay.svgHasVisibleOverlay,
    emptyPanelDialogueCount: scenePlanAudit.emptyPanelDialogueCount,
    dialogueEventCount: scenePlanAudit.dialogueEventCount,
    linkedSourceDialogueCount: scenePlanAudit.linkedSourceDialogueCount,
    panelsWithDialogueEventsButZeroLines: scenePlanAudit.panelsWithDialogueEventsButZeroLines,
    safetyFallbackUsed: opts.safetyFallbackUsed === true,
    tierUsed: opts.safetyFallbackUsed ? 2 : 1,
    tier1HasBedroomBedKeywords: tier1.hasBedroomBedKeywords,
    tier1GenericInteriorRisk: tier1.genericInteriorRisk,
    tier2HasBedroomBedKeywords: tier2.hasBedroomBedKeywords,
    templateReferenceIndex: tier1.templateReferenceIndex,
    providerBufferBytes: bufferAudit.providerBufferBytes,
    finalBufferBytes: bufferAudit.finalBufferBytes,
    buffersIdentical: bufferAudit.buffersIdentical,
    resultUrlField: "imageUrl",
    textLayerFailure: classification.textLayerFailure,
    visualLayerFailure: classification.visualLayerFailure,
  };
}

/** Build a bedroom-lying fixture for deterministic parity regression (no provider call). */
export function buildBedroomLyingParityFixture(
  panelCount: ChatComicPanelCount = 4
): {
  messages: ReturnType<typeof buildSceneSourceMessages>;
  plan: ScenePlan;
} {
  const messages = buildSceneSourceMessages([
    {
      id: 1,
      role: "user",
      content:
        '*침대에 누워 천장을 바라본다*\n"오늘은 좀 쉬고 싶어."',
    },
    {
      id: 2,
      role: "assistant",
      content:
        '그는 침실 옆에 앉아 이불을 여며 조용히 미소 지었다. "그래, 좀 쉬어."',
    },
    {
      id: 3,
      role: "user",
      content: '"옆에 앉아줄래?"',
    },
    {
      id: 4,
      role: "assistant",
      content: "그는 고개를 끄덕이며 침대 가장자리에 앉았다.",
    },
  ]);
  const plan = buildDeterministicScenePlan(messages, panelCount, {
    personaName: "유저",
    characterName: "캐릭터",
  });
  return { messages, plan };
}
