/**
 * Provider-free #1288 body-cue comparison on the pinned production 라이크/렌 snapshot.
 * Does not call a model and does not change the live COMMON_PROSE sentence.
 */
import { createHash } from "node:crypto";

import { buildContext } from "@/services/contextBuilder";
import {
  loadCharacterChunksForPromptReadOnly,
  type CharacterSettingRow,
} from "@/lib/characterChunks";
import { resolveCharacterGender } from "@/lib/characterGender";
import { CHEAPER_INFERENCE_DEEPSEEK_V41_FLASH_MODEL } from "@/lib/chatModels";
import { resolveExampleDialogForPrompt } from "@/lib/narrationFewShotTemplates";
import { toPublicPersonaDescription } from "@/lib/personaSecretLegacyMarkers";
import { formatPublicPersonaForPrompt } from "@/lib/personaSecretPrompt";
import {
  COMMON_PROSE_EMOTION_CUE_CANDIDATE,
  liveCommonProseEmotionCueBaseline,
  liveCommonProseForwardMotion,
  replaceCommonProseEmotionCue,
} from "@/lib/mainRpFinalWireAudit";
import type { ContextBuildInput } from "@/types";
import {
  buildChatOocRpContinuingUserPrompt,
  buildChatOocSceneResetUserPrompt,
  classifyChatOocIntent,
  type ChatOocIntent,
} from "@/lib/chatOocPriority";
import { resolveChatRuntimeMode, type ChatRuntimeMode } from "@/lib/chatRuntimeMode";
import {
  currentTurnAuthoringPolicyRequiresOwner,
  type CurrentTurnAuthoringDelegation,
} from "@/lib/currentTurnUserAuthoringDelegation";
import {
  applyCacheAndPrefillForTransport,
  assemblePrimaryRpRequest,
  buildOpenRouterMessages,
  type AssembledPrimaryRpRequest,
  type OpenRouterMessageOpts,
} from "@/lib/openRouterAdult";
import {
  OPENROUTER_MAX_OUTPUT_TOKENS,
  resolveOpenRouterMaxTokens,
} from "@/lib/openRouterClient";
import { getModelPricingPolicy } from "@/lib/modelPricingPolicy";
import {
  getPublishedPricing,
  resolvePublishedReferenceRatesForPrompt,
} from "@/lib/publishedModelPricing";
import { estimateTokens } from "@/lib/tokenEstimate";
import { buildSceneDirective } from "@/lib/sceneDirective";
import { USER_COAUTHOR_OWNER_TITLE } from "@/lib/noGodmodding";
import { replaceUserPlaceholder } from "@/lib/userPlaceholder";
import { resolveEffectiveUserAuthoring } from "@/lib/userCoauthorState";
import {
  CANONICAL_RP_QUALIFICATION_SOURCE,
  COMMON_PROSE_BODY_CUE_PAIRWISE_REVIEW_SEED_IDS,
  buildCanonicalRpQualificationContextInput,
  buildCommonProseBodyCueReviewCases,
  buildGreetingBodyCueReviewCases,
  type CanonicalQualificationCase,
} from "./rpModelQualificationFixture";

export const BODY_CUE_REVIEW_MODEL = CHEAPER_INFERENCE_DEEPSEEK_V41_FLASH_MODEL;
export const BODY_CUE_REVIEW_CALLS = 4;
/** Planning figure only. Production omits max_tokens, so this is not a provider cap. */
export const BODY_CUE_OUTPUT_TOKEN_CEILING = OPENROUTER_MAX_OUTPUT_TOKENS;
/** Same FX snapshot as src/lib/points.gpt61Sol.test.ts. Not a live rate. */
export const BODY_CUE_PLANNING_FX = Object.freeze({
  usdToKrw: 1530,
  effectiveKrwPerUsd: 1560.6,
});
/** Proposed bound only. Not granted, and not enforced by the provider. */
export const BODY_CUE_PROPOSED_APPROVAL = Object.freeze({
  granted: false as const,
  providerUsd: 1,
  userChargeKrw: 1000,
});
export const BODY_CUE_EVIDENCE_SOURCE = {
  HISTORICAL_PINNED: "HISTORICAL_PINNED",
  SYNTHETIC: "SYNTHETIC",
  LIVE_VERIFIED: "LIVE_VERIFIED",
} as const;

export type BodyCueEvidenceSource =
  (typeof BODY_CUE_EVIDENCE_SOURCE)[keyof typeof BODY_CUE_EVIDENCE_SOURCE];

export type BodyCueVerificationStatus = "VERIFIED" | "UNVERIFIED" | "NOT_CLAIMED";

/** Catalog only. Identity of the live row is separate from assembled-request proof. */
export const LIVE_ROW_IDENTITY_STATUS = "VERIFIED" as const;
export const LIVE_ASSEMBLED_REQUEST_STATUS = "UNVERIFIED" as const;

/** 2026-08-25 dump sections. Not rewritten when the live row is read. */
export const HISTORICAL_RP_IDENTITY_HASHES = Object.freeze({
  characterCoreSha256: "44e1c8ec7f38c0632caea1be93ca0ebd6704833f146f5eba2cf08c6288d36293",
  personaSha256: "bfab821f5c1629bccecc8fc20bdbfaa80dbbb0289404e065e8507d9a79873285",
  openingSha256: "29e3149289586f303c3ffc120a299184163b162a78e46e4f264e87231f6d1d58",
});

/**
 * Read-only production row proof from deploy 2f5cb0b4 /data/app.db.
 * Hashes only. No email, no persona/character source text.
 */
export const LIVE_DEPLOYED_ROW_PROOF = Object.freeze({
  deployedCommit: "2f5cb0b416ce214dfeb109f50622c0a45d61f62a",
  characterId: 18,
  characterName: "라이크",
  id10IsLike: false,
  nsfwListing: 1,
  official: 0,
  uniqueCanonicalAdmin: true,
  uniqueAdminRenPersona: true,
  personaGender: "male",
  personaPublicChars: 583,
  personaPublicSha256: "9ef42c7f92091ca158a53c4321b06dab4e687d3a882210c4a576e87029703a36",
  greetingSha256: "29e3149289586f303c3ffc120a299184163b162a78e46e4f264e87231f6d1d58",
  systemPromptSha256: "44c293ce3e6aaa7ab885ad93c93342a0e4d1ed803a2c7e22119f42991ee44d6b",
  worldSha256: "6e197c4e91f3f5dbe9a3b867232c564230272fe6a29e24f26d2f41964a500fa9",
  settingChunksSha256: "8eee31d5ce8cd6a736030613ac615a3755542a718d22f082a02c4d9ba0aa90cc",
  compiledCanonSha256: "e866a6da1d25bef7ab3cb90da74e224517ea07e9b558edff6e0a06f872f5a847",
  greetingMatchesHistoricalOpening: true,
  personaMatchesHistoricalDump: false,
  characterCoreDumpMatchesLiveRow: false,
  sceneTokenHits: Object.freeze({
    본부: true,
    숙소: true,
    창가: false,
    창틀: false,
    조태형: true,
    태형: true,
    가이드: true,
    넥서스: false,
    S급: true,
    임무: true,
  }),
  histGuidePhrase: true,
  histMachinePhrase: true,
  listingNsfwDoesNotForceAdultRp: true,
  englishLayerPresent: true,
  englishLayerApplied: "UNVERIFIED" as const,
});

export type LiveDeployedFieldHashes = {
  greetingSha256: string;
  systemPromptSha256: string;
  worldSha256: string;
  settingChunksSha256: string;
  personaPublicSha256: string;
};

export type LiveDeployedCharacterRow = CharacterSettingRow & {
  description?: string | null;
  greeting?: string | null;
  narration_style_instructions?: string | null;
  content_kind?: string | null;
};

export type LiveDeployedPersonaRow = {
  name: string;
  gender: string;
  description: string;
};

export type LiveDeployedBodyCueRows = {
  character: LiveDeployedCharacterRow;
  persona: LiveDeployedPersonaRow;
  /** Login nickname. Production passes this separately from persona display name. */
  userNickname?: string;
};

/** Live deploy SHA is not the #1288 comparison / prose-owner SHA. */
export const BODY_CUE_COMPARISON_REFS = Object.freeze({
  historicalProseOwnerCommit: "11e9e96aa729922d05249695f36a1e3c699aaba0",
  candidateHead: "73908e134ef28e47be8a50e6c8ebad3bcb4c6c60",
  liveDeployedCommit: LIVE_DEPLOYED_ROW_PROOF.deployedCommit,
});

/**
 * Production fields the live-row path can carry, but this change does not
 * fill or treat as applied. Do not invent values.
 */
export const LIVE_ASSEMBLED_REQUEST_UNVERIFIED_GAPS = Object.freeze({
  liveSourceTextAssembled: false,
  englishLayerApplied: "UNVERIFIED" as const,
  fieldsNotFilled: [
    "prompt_translation_hash",
    "setting_chunks_en application",
    "appearance_compiled_source_hash",
    "appearance_compiled_version",
  ],
});

export type HistoricalPinnedEvidence = {
  source: "HISTORICAL_PINNED";
  historicalSourceCharacterId: typeof CANONICAL_RP_QUALIFICATION_SOURCE.sourceCharacterId;
  historicalHashes: typeof HISTORICAL_RP_IDENTITY_HASHES;
  liveRowIdentity: typeof LIVE_ROW_IDENTITY_STATUS;
  liveAssembledRequest: typeof LIVE_ASSEMBLED_REQUEST_STATUS;
  recordedLiveRow: {
    deployedCommit: typeof LIVE_DEPLOYED_ROW_PROOF.deployedCommit;
    characterId: typeof LIVE_DEPLOYED_ROW_PROOF.characterId;
    hashes: LiveDeployedFieldHashes;
    englishLayerPresent: true;
    englishLayerApplied: "UNVERIFIED";
  };
  assemblyGaps: typeof LIVE_ASSEMBLED_REQUEST_UNVERIFIED_GAPS;
};

export type SyntheticEvidence = {
  source: "SYNTHETIC";
  inputCharacterId: number;
  liveRowIdentity: "NOT_CLAIMED";
  liveAssembledRequest: "NOT_CLAIMED";
  /** Local synthetic run only. Not production English-layer evidence. */
  syntheticUsedEnglish: boolean;
};

export type LiveVerifiedEvidence = {
  source: "LIVE_VERIFIED";
  liveRowIdentity: typeof LIVE_ROW_IDENTITY_STATUS;
  liveAssembledRequest: typeof LIVE_ASSEMBLED_REQUEST_STATUS;
  deployedCommit: typeof LIVE_DEPLOYED_ROW_PROOF.deployedCommit;
  characterId: typeof LIVE_DEPLOYED_ROW_PROOF.characterId;
  hashes: LiveDeployedFieldHashes;
  englishLayerPresent: true;
  englishLayerApplied: "UNVERIFIED";
  assemblyGaps: typeof LIVE_ASSEMBLED_REQUEST_UNVERIFIED_GAPS;
};

export type BodyCueEvidence =
  | HistoricalPinnedEvidence
  | SyntheticEvidence
  | LiveVerifiedEvidence;

export type BodyCueRowEvidenceClaim =
  | { source: "SYNTHETIC" }
  | { source: "LIVE_VERIFIED" };

export type BodyCueProductionTurn = {
  intent: ChatOocIntent;
  policyUserMessage: string;
  promptUserMessage: string;
  delegationActive: boolean;
  delegation: CurrentTurnAuthoringDelegation;
  runtimeMode: ChatRuntimeMode;
};

export type BodyCueReviewArm = {
  systemFlatSha256: string;
  rulesSha256: string;
  characterSha256: string;
  dynamicSha256: string;
  flatChars: number;
  localEstimateTokens: number;
  cached: boolean[];
  cueBaselineCount: number;
  cueCandidateCount: number;
  forwardMotionCount: number;
  commonProseCount: number;
  safeContract: boolean;
  normalAuthoring: boolean;
};

export type BodyCueReviewScene = {
  id: CanonicalQualificationCase["id"];
  targetResponseChars: number;
  currentUserMessage: string;
  reviewFocus: string[];
  productionTurn: BodyCueProductionTurn;
  promptChars: number;
  userTurnSha256: string;
  promptUserSha256: string;
  assembledUserSha256: string;
  assembledUserCarriesScene: boolean;
  sceneControlMatchesPolicy: boolean;
  baseline: BodyCueReviewArm;
  candidate: BodyCueReviewArm;
  soleAllowedDiff: boolean;
  rulesShaEqual: boolean;
  dynamicShaEqual: boolean;
  characterShaChanged: boolean;
  flatCharDelta: number;
};

type BodyCueReviewPacketCost = {
  budgetEstimate: {
    kind: "budget_estimate";
    enforceable: false;
    calls: number;
    largerPromptChars: number;
    promptTokenCeiling: number;
    outputTokenCeiling: number;
    cacheReadTokens: 0;
    inputUsdPerMillion: number;
    outputUsdPerMillion: number;
    cacheReadUsdPerMillion: number;
    targetMargin: number;
    publishedAt: string;
    providerUsd: number;
    userChargeKrw: number;
    fx: typeof BODY_CUE_PLANNING_FX;
    maxTokensSent: boolean;
  };
  supplierRoute: {
    provider: "cheaperinference";
    modelId: typeof BODY_CUE_REVIEW_MODEL;
    expectedProviderModelId: string;
    baselineMode: string;
    liveCatalogFetched: false;
  };
  approvalBound: typeof BODY_CUE_PROPOSED_APPROVAL;
  stop: {
    kind: "operator_pre_call_check";
    productionMaxTokensOmitted: true;
    singleCallCanExceedBound: true;
  };
};

type BodyCueReviewPacketShared = {
  providerCalls: 0;
  /** #1288 comparison / prose-owner SHA. Not the live deploy SHA. */
  mainCommit: typeof BODY_CUE_COMPARISON_REFS.historicalProseOwnerCommit;
  candidateHead: typeof BODY_CUE_COMPARISON_REFS.candidateHead;
  modelId: typeof BODY_CUE_REVIEW_MODEL;
  authoringLevel: "NORMAL";
  nsfw: false;
  scenes: BodyCueReviewScene[];
  proseOwnerUnchanged: true;
  cost: BodyCueReviewPacketCost;
};

export type HistoricalBodyCueReviewPacket = BodyCueReviewPacketShared & {
  evidence: HistoricalPinnedEvidence;
};

export type SyntheticBodyCueReviewPacket = BodyCueReviewPacketShared & {
  evidence: SyntheticEvidence;
  usedEnglish: boolean;
};

export type LiveVerifiedBodyCueReviewPacket = BodyCueReviewPacketShared & {
  evidence: LiveVerifiedEvidence;
  usedEnglish: boolean;
};

export type BodyCueReviewPacket =
  | HistoricalBodyCueReviewPacket
  | SyntheticBodyCueReviewPacket
  | LiveVerifiedBodyCueReviewPacket;

/** Input character id from evidence only. No packet.source fallback. */
export function bodyCueInputCharacterId(packet: BodyCueReviewPacket): number {
  switch (packet.evidence.source) {
    case BODY_CUE_EVIDENCE_SOURCE.HISTORICAL_PINNED:
      return packet.evidence.historicalSourceCharacterId;
    case BODY_CUE_EVIDENCE_SOURCE.SYNTHETIC:
      return packet.evidence.inputCharacterId;
    case BODY_CUE_EVIDENCE_SOURCE.LIVE_VERIFIED:
      return packet.evidence.characterId;
    default: {
      const unreachable: never = packet.evidence;
      return unreachable;
    }
  }
}

function sha256(text: string): string {
  return createHash("sha256").update(text, "utf8").digest("hex");
}

/**
 * Interactive, non-regenerate branch of POST /api/chat.
 * Delegation is resolved from the stored raw message.
 * buildContext receives the classified prompt string.
 * sceneServerControls.currentUserMessage stays the placeholder-resolved raw text.
 */
export function resolveBodyCueProductionTurn(
  storedUserMessage: string,
  personaName: string = CANONICAL_RP_QUALIFICATION_SOURCE.personaName,
  userNickname = personaName
): BodyCueProductionTurn {
  const policyUserMessage = replaceUserPlaceholder(storedUserMessage, personaName, userNickname);
  const intent = classifyChatOocIntent(storedUserMessage);
  const promptUserMessage = productionPromptUserMessage(intent, policyUserMessage);
  const authoring = resolveEffectiveUserAuthoring({
    persistentMode: "OFF",
    baseLevel: "NORMAL",
    currentUserInput: storedUserMessage,
  });
  const runtimeMode = resolveChatRuntimeMode({
    isContinue: false,
    novelModeEnabled: false,
    oocUserImpersonationAllowed: false,
    currentTurnDelegationActive: currentTurnAuthoringPolicyRequiresOwner(authoring.delegation),
  });
  return {
    intent,
    policyUserMessage,
    promptUserMessage,
    delegationActive: authoring.delegation.active,
    delegation: authoring.delegation,
    runtimeMode,
  };
}

function productionPromptUserMessage(intent: ChatOocIntent, displayUserMessage: string): string {
  switch (intent) {
    case "rp_scene_reset":
      return buildChatOocSceneResetUserPrompt(displayUserMessage);
    case "rp_continuing":
      return buildChatOocRpContinuingUserPrompt(displayUserMessage);
    case "none":
    case "rp_unrelated":
    case "rp_hard_stop":
      return displayUserMessage;
    default: {
      const unreachable: never = intent;
      return unreachable;
    }
  }
}

/**
 * Do not start the next call when no cap is granted, or when the observed
 * spend plus that call's worst-case estimate would pass the granted cap.
 * This does not set max_tokens and cannot abort a call already in flight.
 */
export function bodyCueNextCallAllowed(input: {
  approvedProviderUsd: number | null;
  observedProviderUsd: number;
  nextCallWorstCaseUsd: number;
}): boolean {
  if (input.approvedProviderUsd == null) return false;
  return input.observedProviderUsd + input.nextCallWorstCaseUsd <= input.approvedProviderUsd;
}

function flattenSystem(content: string | { text: string }[]): string {
  if (typeof content === "string") return content;
  return content.map((block) => block.text).join("\n\n");
}

function armFromMessages(
  messages: Array<{ role: string; content: string | { text: string; cache_control?: { type?: string } }[] }>
): BodyCueReviewArm {
  const system = messages.find((message) => message.role === "system");
  const content = system?.content ?? "";
  const flat = flattenSystem(content);
  const blocks = Array.isArray(content) ? content : [{ text: flat, cache_control: undefined }];
  return {
    systemFlatSha256: sha256(flat),
    rulesSha256: sha256(blocks[0]?.text ?? ""),
    characterSha256: sha256(blocks[1]?.text ?? ""),
    dynamicSha256: sha256(blocks[2]?.text ?? ""),
    flatChars: flat.length,
    localEstimateTokens: estimateTokens(flat),
    cached: blocks.map((block) => block.cache_control?.type === "ephemeral"),
    cueBaselineCount: flat.split(liveCommonProseEmotionCueBaseline()).length - 1,
    cueCandidateCount: flat.split(COMMON_PROSE_EMOTION_CUE_CANDIDATE).length - 1,
    forwardMotionCount: flat.split(liveCommonProseForwardMotion()).length - 1,
    commonProseCount: flat.split("[COMMON PROSE]").length - 1,
    safeContract: flat.includes("[SAFE SEXUAL LIMIT — 15+ RP]"),
    normalAuthoring: flat.includes(USER_COAUTHOR_OWNER_TITLE),
  };
}

function messageText(content: string | { text: string }[]): string {
  if (typeof content === "string") return content;
  return content.map((block) => block.text).join("\n\n");
}

function assembleScene(
  caseData: CanonicalQualificationCase,
  candidate: boolean,
  input: ContextBuildInput,
  names: { charName: string; personaName: string; userNickname?: string }
) {
  const turn = resolveBodyCueProductionTurn(
    caseData.currentUserMessage,
    names.personaName,
    names.userNickname ?? names.personaName
  );
  const built = buildContext({
    ...input,
    currentUserMessage: turn.promptUserMessage,
    currentTurnAuthoringDelegation: turn.delegation,
  });
  if (built.meta.runtimeMode !== turn.runtimeMode) {
    throw new Error(`runtime mode drifted for ${caseData.id}`);
  }
  const split = built.openRouterSystemSplit;
  if (!split) throw new Error("canonical review scene produced no system split");
  const delivered = candidate
    ? {
        systemRulesBlock: replaceCommonProseEmotionCue(split.systemRulesBlock).text,
        characterSettingsBlock: replaceCommonProseEmotionCue(split.characterSettingsBlock).text,
        dynamicBlock: replaceCommonProseEmotionCue(split.dynamicBlock).text,
      }
    : split;
  const system = candidate ? replaceCommonProseEmotionCue(built.systemPrompt).text : built.systemPrompt;
  const history = built.history ?? [];
  const directive = buildSceneDirective({
    mode: "interactive",
    recentMessages: history,
    currentUserMessage: turn.policyUserMessage,
    chatId: "body-cue-review",
    currentTurn: 2,
    contentKind: "character",
    primaryCharacterName: names.charName,
    party: false,
  });
  const messageOpts: OpenRouterMessageOpts = {
    charName: names.charName,
    personaName: names.personaName,
    systemSplit: delivered,
    sessionId: "body-cue-review",
    transportProvider: "cheaperinference",
    sceneServerControls: {
      mode: "interactive",
      contentKind: "character",
      party: false,
      primaryCharacterName: names.charName,
      currentUserMessage: turn.policyUserMessage,
      recentMessages: history,
      adultModeEnabled: false,
      chatId: "body-cue-review",
      currentTurn: 2,
      canonicalSceneDirective: directive,
      skipMotionCue: false,
    },
  };
  const baseMessages = buildOpenRouterMessages(system, history, messageOpts);
  const cached = applyCacheAndPrefillForTransport(
    { provider: "cheaperinference" },
    baseMessages,
    BODY_CUE_REVIEW_MODEL,
    names.charName,
    { skipAssistantPrefill: true }
  );
  const assembled = assemblePrimaryRpRequest({
    system,
    history,
    modelId: BODY_CUE_REVIEW_MODEL,
    targetResponseChars: caseData.targetResponseChars,
    messageOpts,
    stream: true,
    messagesOverride: cached.messages,
  });
  const promptChars = assembled.messages.reduce((sum, message) => {
    const content = message.content;
    if (typeof content === "string") return sum + content.length;
    return sum + content.reduce((inner, block) => inner + block.text.length, 0);
  }, 0);
  const assembledUserText = assembled.messages
    .filter((message) => message.role === "user")
    .map((message) => messageText(message.content))
    .join("\n");
  return {
    promptChars,
    arm: armFromMessages(assembled.messages),
    turn,
    assembledUserText,
    sceneControlUserMessage: turn.policyUserMessage,
    assembledRequest: assembled,
  };
}

/** Same-process #1377 scene assembly. Exposes the already-built request objects. */
export function assembleLiveDeployedBodyCueSceneRequests(
  rows: LiveDeployedBodyCueRows,
  caseData: CanonicalQualificationCase
): {
  baseline: AssembledPrimaryRpRequest;
  candidate: AssembledPrimaryRpRequest;
} {
  const names = resolveLiveRowNames(rows);
  const input = buildLiveDeployedBodyCueContextInput({ rows, caseData });
  return {
    baseline: assembleScene(caseData, false, input, names).assembledRequest,
    candidate: assembleScene(caseData, true, input, names).assembledRequest,
  };
}

function historicalNames() {
  return {
    charName: CANONICAL_RP_QUALIFICATION_SOURCE.characterName,
    personaName: CANONICAL_RP_QUALIFICATION_SOURCE.personaName,
  };
}

function reviewSceneFromRuns(
  caseData: CanonicalQualificationCase,
  baselineRun: ReturnType<typeof assembleScene>,
  candidateRun: ReturnType<typeof assembleScene>
): BodyCueReviewScene {
  const baseline = baselineRun.arm;
  const candidate = candidateRun.arm;
  const expectedDelta =
    COMMON_PROSE_EMOTION_CUE_CANDIDATE.length - liveCommonProseEmotionCueBaseline().length;
  const assembledUserEqual = baselineRun.assembledUserText === candidateRun.assembledUserText;
  const soleAllowedDiff =
    baseline.cueBaselineCount === 1 &&
    baseline.cueCandidateCount === 0 &&
    candidate.cueBaselineCount === 0 &&
    candidate.cueCandidateCount === 1 &&
    baseline.forwardMotionCount === 1 &&
    candidate.forwardMotionCount === 1 &&
    baseline.commonProseCount === 1 &&
    candidate.commonProseCount === 1 &&
    baseline.rulesSha256 === candidate.rulesSha256 &&
    baseline.dynamicSha256 === candidate.dynamicSha256 &&
    baseline.characterSha256 !== candidate.characterSha256 &&
    candidate.flatChars - baseline.flatChars === expectedDelta &&
    baseline.cached.join() === candidate.cached.join() &&
    baseline.safeContract &&
    candidate.safeContract &&
    baseline.normalAuthoring &&
    candidate.normalAuthoring &&
    assembledUserEqual &&
    baselineRun.sceneControlUserMessage === baselineRun.turn.policyUserMessage;
  return {
    id: caseData.id,
    targetResponseChars: caseData.targetResponseChars,
    currentUserMessage: caseData.currentUserMessage,
    reviewFocus: caseData.reviewFocus,
    productionTurn: {
      intent: baselineRun.turn.intent,
      policyUserMessage: baselineRun.turn.policyUserMessage,
      promptUserMessage: baselineRun.turn.promptUserMessage,
      delegationActive: baselineRun.turn.delegationActive,
      delegation: baselineRun.turn.delegation,
      runtimeMode: baselineRun.turn.runtimeMode,
    },
    promptChars: Math.max(baselineRun.promptChars, candidateRun.promptChars),
    userTurnSha256: sha256(caseData.currentUserMessage),
    promptUserSha256: sha256(baselineRun.turn.promptUserMessage),
    assembledUserSha256: sha256(baselineRun.assembledUserText),
    assembledUserCarriesScene:
      baselineRun.assembledUserText.includes("CURRENT USER INPUT") &&
      baselineRun.assembledUserText.includes("다른 인물은 없다"),
    sceneControlMatchesPolicy:
      baselineRun.sceneControlUserMessage === baselineRun.turn.policyUserMessage,
    baseline,
    candidate,
    soleAllowedDiff,
    rulesShaEqual: baseline.rulesSha256 === candidate.rulesSha256,
    dynamicShaEqual: baseline.dynamicSha256 === candidate.dynamicSha256,
    characterShaChanged: baseline.characterSha256 !== candidate.characterSha256,
    flatCharDelta: candidate.flatChars - baseline.flatChars,
  };
}

function costFromScenes(scenes: BodyCueReviewScene[]): BodyCueReviewPacketCost {
  const pricing = getPublishedPricing(BODY_CUE_REVIEW_MODEL);
  const largerPromptChars = Math.max(...scenes.map((scene) => scene.promptChars));
  const rates = resolvePublishedReferenceRatesForPrompt(pricing, largerPromptChars);
  const promptTokenCeiling = largerPromptChars * 2;
  const perCallUsd =
    (promptTokenCeiling / 1_000_000) * rates.inputUsdPerMillion +
    (BODY_CUE_OUTPUT_TOKEN_CEILING / 1_000_000) * rates.outputUsdPerMillion;
  const providerUsd = perCallUsd * BODY_CUE_REVIEW_CALLS;
  const userChargeKrw =
    (providerUsd * BODY_CUE_PLANNING_FX.effectiveKrwPerUsd) / (1 - pricing.targetMargin);
  return {
    budgetEstimate: {
      kind: "budget_estimate",
      enforceable: false,
      calls: BODY_CUE_REVIEW_CALLS,
      largerPromptChars,
      promptTokenCeiling,
      outputTokenCeiling: BODY_CUE_OUTPUT_TOKEN_CEILING,
      cacheReadTokens: 0,
      inputUsdPerMillion: rates.inputUsdPerMillion,
      outputUsdPerMillion: rates.outputUsdPerMillion,
      cacheReadUsdPerMillion: pricing.billingReferenceCacheReadUsdPerMillion ?? 0,
      targetMargin: pricing.targetMargin,
      publishedAt: pricing.publishedAt,
      providerUsd,
      userChargeKrw,
      fx: BODY_CUE_PLANNING_FX,
      maxTokensSent: resolveOpenRouterMaxTokens(3200, undefined, BODY_CUE_REVIEW_MODEL) != null,
    },
    supplierRoute: {
      provider: "cheaperinference",
      modelId: BODY_CUE_REVIEW_MODEL,
      expectedProviderModelId:
        getModelPricingPolicy(BODY_CUE_REVIEW_MODEL)?.expectedProviderModelId ?? "",
      baselineMode: getModelPricingPolicy(BODY_CUE_REVIEW_MODEL)?.baselineMode ?? "",
      liveCatalogFetched: false,
    },
    approvalBound: BODY_CUE_PROPOSED_APPROVAL,
    stop: {
      kind: "operator_pre_call_check",
      productionMaxTokensOmitted: true,
      singleCallCanExceedBound: true,
    },
  };
}

function deployedFieldHashesFromProof(): LiveDeployedFieldHashes {
  return {
    greetingSha256: LIVE_DEPLOYED_ROW_PROOF.greetingSha256,
    systemPromptSha256: LIVE_DEPLOYED_ROW_PROOF.systemPromptSha256,
    worldSha256: LIVE_DEPLOYED_ROW_PROOF.worldSha256,
    settingChunksSha256: LIVE_DEPLOYED_ROW_PROOF.settingChunksSha256,
    personaPublicSha256: LIVE_DEPLOYED_ROW_PROOF.personaPublicSha256,
  };
}

export function fieldHashesFromLiveDeployedRows(rows: LiveDeployedBodyCueRows): LiveDeployedFieldHashes {
  return {
    greetingSha256: sha256(rows.character.greeting ?? ""),
    systemPromptSha256: sha256(rows.character.system_prompt ?? ""),
    worldSha256: sha256(rows.character.world ?? ""),
    settingChunksSha256: sha256(rows.character.setting_chunks ?? ""),
    personaPublicSha256: sha256(String(toPublicPersonaDescription(rows.persona.description ?? ""))),
  };
}

function hashesEqualProof(hashes: LiveDeployedFieldHashes): boolean {
  const proof = deployedFieldHashesFromProof();
  return (
    hashes.greetingSha256 === proof.greetingSha256 &&
    hashes.systemPromptSha256 === proof.systemPromptSha256 &&
    hashes.worldSha256 === proof.worldSha256 &&
    hashes.settingChunksSha256 === proof.settingChunksSha256 &&
    hashes.personaPublicSha256 === proof.personaPublicSha256
  );
}

/** Name and id are not enough. Payload field hashes must match the recorded proof. */
export function payloadMatchesLiveDeployedRowProof(rows: LiveDeployedBodyCueRows): boolean {
  return (
    rows.character.id === LIVE_DEPLOYED_ROW_PROOF.characterId &&
    rows.character.name.trim() === LIVE_DEPLOYED_ROW_PROOF.characterName &&
    rows.persona.name.trim() === CANONICAL_RP_QUALIFICATION_SOURCE.personaName &&
    hashesEqualProof(fieldHashesFromLiveDeployedRows(rows))
  );
}

function historicalPinnedEvidence(): HistoricalPinnedEvidence {
  return {
    source: BODY_CUE_EVIDENCE_SOURCE.HISTORICAL_PINNED,
    historicalSourceCharacterId: CANONICAL_RP_QUALIFICATION_SOURCE.sourceCharacterId,
    historicalHashes: HISTORICAL_RP_IDENTITY_HASHES,
    liveRowIdentity: LIVE_ROW_IDENTITY_STATUS,
    liveAssembledRequest: LIVE_ASSEMBLED_REQUEST_STATUS,
    recordedLiveRow: {
      deployedCommit: LIVE_DEPLOYED_ROW_PROOF.deployedCommit,
      characterId: LIVE_DEPLOYED_ROW_PROOF.characterId,
      hashes: deployedFieldHashesFromProof(),
      englishLayerPresent: true,
      englishLayerApplied: "UNVERIFIED",
    },
    assemblyGaps: LIVE_ASSEMBLED_REQUEST_UNVERIFIED_GAPS,
  };
}

function syntheticEvidence(characterId: number, syntheticUsedEnglish: boolean): SyntheticEvidence {
  return {
    source: BODY_CUE_EVIDENCE_SOURCE.SYNTHETIC,
    inputCharacterId: characterId,
    liveRowIdentity: "NOT_CLAIMED",
    liveAssembledRequest: "NOT_CLAIMED",
    syntheticUsedEnglish,
  };
}

function liveVerifiedEvidence(): LiveVerifiedEvidence {
  return {
    source: BODY_CUE_EVIDENCE_SOURCE.LIVE_VERIFIED,
    liveRowIdentity: LIVE_ROW_IDENTITY_STATUS,
    liveAssembledRequest: LIVE_ASSEMBLED_REQUEST_STATUS,
    deployedCommit: LIVE_DEPLOYED_ROW_PROOF.deployedCommit,
    characterId: LIVE_DEPLOYED_ROW_PROOF.characterId,
    hashes: deployedFieldHashesFromProof(),
    englishLayerPresent: true,
    englishLayerApplied: "UNVERIFIED",
    assemblyGaps: LIVE_ASSEMBLED_REQUEST_UNVERIFIED_GAPS,
  };
}

function evidenceForLiveDeployedRows(
  rows: LiveDeployedBodyCueRows,
  usedEnglish: boolean,
  claim: BodyCueRowEvidenceClaim = { source: "SYNTHETIC" }
): SyntheticEvidence | LiveVerifiedEvidence {
  if (claim.source === "LIVE_VERIFIED" && payloadMatchesLiveDeployedRowProof(rows)) {
    return liveVerifiedEvidence();
  }
  return syntheticEvidence(rows.character.id, usedEnglish);
}

function resolveLiveRowNames(rows: LiveDeployedBodyCueRows): {
  charName: string;
  personaName: string;
  userNickname: string;
} {
  const personaName = rows.persona.name.trim();
  const charName = rows.character.name.trim();
  if (!personaName) throw new Error("live persona name missing");
  if (!charName) throw new Error("live character name missing");
  const userNickname = rows.userNickname?.trim() || personaName;
  return { charName, personaName, userNickname };
}

export function buildLiveDeployedBodyCueContextInput(opts: {
  rows: LiveDeployedBodyCueRows;
  caseData: CanonicalQualificationCase;
}): ContextBuildInput {
  const { charName, personaName, userNickname } = resolveLiveRowNames(opts.rows);
  const turn = resolveBodyCueProductionTurn(
    opts.caseData.currentUserMessage,
    personaName,
    userNickname
  );
  const { chunks, usedEnglish } = loadCharacterChunksForPromptReadOnly(
    opts.rows.character,
    personaName,
    userNickname
  );
  const personaGender = resolveCharacterGender(opts.rows.persona.gender);
  const personaPublic = toPublicPersonaDescription(opts.rows.persona.description ?? "");
  return {
    charName,
    contentKind: opts.rows.character.content_kind === "simulation" ? "simulation" : "character",
    chunks,
    systemPrompt: opts.rows.character.system_prompt,
    world: opts.rows.character.world ?? "",
    exampleDialog: resolveExampleDialogForPrompt(opts.rows.character.example_dialog, charName),
    speechProfileJson: opts.rows.character.speech_profile,
    characterPersonality: opts.rows.character.description ?? "",
    creatorNarrationStyle: opts.rows.character.narration_style_instructions ?? "",
    userNickname,
    personaDisplayName: personaName,
    userPersona:
      formatPublicPersonaForPrompt(personaName, personaGender, personaPublic, {
        coNarrationEnabled: turn.delegation.allowDialogue === true,
      }) ?? undefined,
    userPersonaGender: personaGender,
    gender: resolveCharacterGender(opts.rows.character.gender),
    shortTermHistory: opts.caseData.history,
    currentUserMessage: opts.caseData.currentUserMessage,
    nsfw: false,
    provider: "cheaperinference",
    modelId: BODY_CUE_REVIEW_MODEL,
    targetResponseChars: opts.caseData.targetResponseChars,
    completedTurns: Math.max(
      1,
      opts.caseData.history.filter((message) => message.role === "assistant").length
    ),
    novelModeEnabled: false,
    isContinue: false,
    currentTurnAuthoringDelegation: turn.delegation,
    narrativePov: { mode: "third_person", povCharacterName: charName },
    useEnglishCharacterPrompt: usedEnglish,
  };
}

export function buildLiveDeployedBodyCueReviewPacket(
  rows: LiveDeployedBodyCueRows,
  claim: BodyCueRowEvidenceClaim = { source: "SYNTHETIC" }
): SyntheticBodyCueReviewPacket | LiveVerifiedBodyCueReviewPacket {
  const greeting = rows.character.greeting?.trim() ?? "";
  const names = resolveLiveRowNames(rows);
  let usedEnglish = false;
  const scenes = buildGreetingBodyCueReviewCases(
    greeting,
    COMMON_PROSE_BODY_CUE_PAIRWISE_REVIEW_SEED_IDS
  ).map((caseData) => {
    const input = buildLiveDeployedBodyCueContextInput({ rows, caseData });
    usedEnglish = input.useEnglishCharacterPrompt === true;
    return reviewSceneFromRuns(
      caseData,
      assembleScene(caseData, false, input, names),
      assembleScene(caseData, true, input, names)
    );
  });
  const evidence = evidenceForLiveDeployedRows(rows, usedEnglish, claim);
  const packet: BodyCueReviewPacketShared & { usedEnglish: boolean } = {
    providerCalls: 0,
    mainCommit: BODY_CUE_COMPARISON_REFS.historicalProseOwnerCommit,
    candidateHead: BODY_CUE_COMPARISON_REFS.candidateHead,
    modelId: BODY_CUE_REVIEW_MODEL,
    authoringLevel: "NORMAL",
    nsfw: false,
    scenes,
    usedEnglish,
    proseOwnerUnchanged: true,
    cost: costFromScenes(scenes),
  };
  return evidence.source === "LIVE_VERIFIED"
    ? { ...packet, evidence }
    : { ...packet, evidence };
}

export function buildBodyCueReviewPacket(): HistoricalBodyCueReviewPacket {
  const names = historicalNames();
  const scenes = buildCommonProseBodyCueReviewCases().map((caseData) => {
    const input = buildCanonicalRpQualificationContextInput({
      modelId: BODY_CUE_REVIEW_MODEL,
      caseData,
      provider: "cheaperinference",
      nsfw: false,
    });
    return reviewSceneFromRuns(
      caseData,
      assembleScene(caseData, false, input, names),
      assembleScene(caseData, true, input, names)
    );
  });
  return {
    providerCalls: 0,
    mainCommit: BODY_CUE_COMPARISON_REFS.historicalProseOwnerCommit,
    candidateHead: BODY_CUE_COMPARISON_REFS.candidateHead,
    modelId: BODY_CUE_REVIEW_MODEL,
    authoringLevel: "NORMAL",
    nsfw: false,
    scenes,
    evidence: historicalPinnedEvidence(),
    proseOwnerUnchanged: true,
    cost: costFromScenes(scenes),
  };
}
