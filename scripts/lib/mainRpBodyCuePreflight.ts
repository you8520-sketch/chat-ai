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
export const BODY_CUE_LIVE_IDENTITY_STATUS = "LIVE_IDENTITY_UNVERIFIED" as const;

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
});

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
};

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

export type BodyCueReviewPacket = {
  providerCalls: 0;
  mainCommit: "11e9e96aa729922d05249695f36a1e3c699aaba0";
  candidateHead: "73908e134ef28e47be8a50e6c8ebad3bcb4c6c60";
  source: typeof CANONICAL_RP_QUALIFICATION_SOURCE;
  modelId: typeof BODY_CUE_REVIEW_MODEL;
  authoringLevel: "NORMAL";
  nsfw: false;
  scenes: BodyCueReviewScene[];
  liveIdentity: {
    status: typeof BODY_CUE_LIVE_IDENTITY_STATUS;
    deployedCommit: typeof LIVE_DEPLOYED_ROW_PROOF.deployedCommit;
    proseOwnerUnchanged: true;
    rowRead: true;
    historicalSourceCharacterId: typeof CANONICAL_RP_QUALIFICATION_SOURCE.sourceCharacterId;
    deployedCharacterId: typeof LIVE_DEPLOYED_ROW_PROOF.characterId;
    greetingMatchesHistoricalOpening: typeof LIVE_DEPLOYED_ROW_PROOF.greetingMatchesHistoricalOpening;
    personaMatchesHistoricalDump: typeof LIVE_DEPLOYED_ROW_PROOF.personaMatchesHistoricalDump;
    characterCoreDumpMatchesLiveRow: typeof LIVE_DEPLOYED_ROW_PROOF.characterCoreDumpMatchesLiveRow;
    uniqueAdminRen: true;
    listingNsfwDoesNotForceAdultRp: true;
    hashes: {
      historical: typeof HISTORICAL_RP_IDENTITY_HASHES;
      deployed: {
        greetingSha256: typeof LIVE_DEPLOYED_ROW_PROOF.greetingSha256;
        systemPromptSha256: typeof LIVE_DEPLOYED_ROW_PROOF.systemPromptSha256;
        worldSha256: typeof LIVE_DEPLOYED_ROW_PROOF.worldSha256;
        settingChunksSha256: typeof LIVE_DEPLOYED_ROW_PROOF.settingChunksSha256;
        personaPublicSha256: typeof LIVE_DEPLOYED_ROW_PROOF.personaPublicSha256;
      };
    };
  };
  cost: {
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
      maxTokensSent: false;
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
};

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
  personaName = CANONICAL_RP_QUALIFICATION_SOURCE.personaName
): BodyCueProductionTurn {
  const policyUserMessage = replaceUserPlaceholder(storedUserMessage, personaName, personaName);
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
  names: { charName: string; personaName: string }
) {
  const turn = resolveBodyCueProductionTurn(caseData.currentUserMessage, names.personaName);
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
    adultModeEnabled: false,
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

function costFromScenes(scenes: BodyCueReviewScene[]): BodyCueReviewPacket["cost"] {
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

function liveIdentityRecord(): BodyCueReviewPacket["liveIdentity"] {
  return {
    status: BODY_CUE_LIVE_IDENTITY_STATUS,
    deployedCommit: LIVE_DEPLOYED_ROW_PROOF.deployedCommit,
    proseOwnerUnchanged: true,
    rowRead: true,
    historicalSourceCharacterId: CANONICAL_RP_QUALIFICATION_SOURCE.sourceCharacterId,
    deployedCharacterId: LIVE_DEPLOYED_ROW_PROOF.characterId,
    greetingMatchesHistoricalOpening: LIVE_DEPLOYED_ROW_PROOF.greetingMatchesHistoricalOpening,
    personaMatchesHistoricalDump: LIVE_DEPLOYED_ROW_PROOF.personaMatchesHistoricalDump,
    characterCoreDumpMatchesLiveRow: LIVE_DEPLOYED_ROW_PROOF.characterCoreDumpMatchesLiveRow,
    uniqueAdminRen: true,
    listingNsfwDoesNotForceAdultRp: true,
    hashes: {
      historical: HISTORICAL_RP_IDENTITY_HASHES,
      deployed: {
        greetingSha256: LIVE_DEPLOYED_ROW_PROOF.greetingSha256,
        systemPromptSha256: LIVE_DEPLOYED_ROW_PROOF.systemPromptSha256,
        worldSha256: LIVE_DEPLOYED_ROW_PROOF.worldSha256,
        settingChunksSha256: LIVE_DEPLOYED_ROW_PROOF.settingChunksSha256,
        personaPublicSha256: LIVE_DEPLOYED_ROW_PROOF.personaPublicSha256,
      },
    },
  };
}

export function buildLiveDeployedBodyCueContextInput(opts: {
  rows: LiveDeployedBodyCueRows;
  caseData: CanonicalQualificationCase;
}): ContextBuildInput {
  const personaName = opts.rows.persona.name.trim();
  const charName = opts.rows.character.name.trim();
  if (!personaName) throw new Error("live persona name missing");
  if (!charName) throw new Error("live character name missing");
  const turn = resolveBodyCueProductionTurn(opts.caseData.currentUserMessage, personaName);
  const { chunks, usedEnglish } = loadCharacterChunksForPromptReadOnly(
    opts.rows.character,
    personaName,
    personaName
  );
  const personaGender = resolveCharacterGender(opts.rows.persona.gender);
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
    userNickname: personaName,
    personaDisplayName: personaName,
    userPersona:
      formatPublicPersonaForPrompt(personaName, personaGender, opts.rows.persona.description, {
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
  rows: LiveDeployedBodyCueRows
): BodyCueReviewPacket & { usedEnglish: boolean } {
  const greeting = rows.character.greeting?.trim() ?? "";
  const names = { charName: rows.character.name.trim(), personaName: rows.persona.name.trim() };
  let usedEnglish = false;
  const scenes = buildGreetingBodyCueReviewCases(greeting).map((caseData) => {
    const input = buildLiveDeployedBodyCueContextInput({ rows, caseData });
    usedEnglish = input.useEnglishCharacterPrompt === true;
    return reviewSceneFromRuns(
      caseData,
      assembleScene(caseData, false, input, names),
      assembleScene(caseData, true, input, names)
    );
  });
  return {
    providerCalls: 0,
    mainCommit: "11e9e96aa729922d05249695f36a1e3c699aaba0",
    candidateHead: "73908e134ef28e47be8a50e6c8ebad3bcb4c6c60",
    source: CANONICAL_RP_QUALIFICATION_SOURCE,
    modelId: BODY_CUE_REVIEW_MODEL,
    authoringLevel: "NORMAL",
    nsfw: false,
    scenes,
    usedEnglish,
    liveIdentity: liveIdentityRecord(),
    cost: costFromScenes(scenes),
  };
}

export function buildBodyCueReviewPacket(): BodyCueReviewPacket {
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
    mainCommit: "11e9e96aa729922d05249695f36a1e3c699aaba0",
    candidateHead: "73908e134ef28e47be8a50e6c8ebad3bcb4c6c60",
    source: CANONICAL_RP_QUALIFICATION_SOURCE,
    modelId: BODY_CUE_REVIEW_MODEL,
    authoringLevel: "NORMAL",
    nsfw: false,
    scenes,
    liveIdentity: liveIdentityRecord(),
    cost: costFromScenes(scenes),
  };
}
