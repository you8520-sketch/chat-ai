/**
 * Provider-free #1288 body-cue comparison on the pinned production 라이크/렌 snapshot.
 * Does not call a model and does not change the live COMMON_PROSE sentence.
 */
import { createHash } from "node:crypto";

import { buildContext } from "@/services/contextBuilder";
import { CHEAPER_INFERENCE_DEEPSEEK_V41_FLASH_MODEL } from "@/lib/chatModels";
import {
  COMMON_PROSE_EMOTION_CUE_CANDIDATE,
  liveCommonProseEmotionCueBaseline,
  liveCommonProseForwardMotion,
  replaceCommonProseEmotionCue,
} from "@/lib/mainRpFinalWireAudit";
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
    deployedCommit: "ec7f0cbe91a7e1d7801821bc9ece8fc0eed0ff15";
    proseOwnerUnchanged: true;
    rowRead: false;
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
export function resolveBodyCueProductionTurn(storedUserMessage: string): BodyCueProductionTurn {
  const personaName = CANONICAL_RP_QUALIFICATION_SOURCE.personaName;
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

function assembleScene(caseData: CanonicalQualificationCase, candidate: boolean) {
  const turn = resolveBodyCueProductionTurn(caseData.currentUserMessage);
  const input = buildCanonicalRpQualificationContextInput({
    modelId: BODY_CUE_REVIEW_MODEL,
    caseData,
    provider: "cheaperinference",
    nsfw: false,
  });
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
    primaryCharacterName: CANONICAL_RP_QUALIFICATION_SOURCE.characterName,
    party: false,
  });
  const messageOpts: OpenRouterMessageOpts = {
    charName: CANONICAL_RP_QUALIFICATION_SOURCE.characterName,
    personaName: CANONICAL_RP_QUALIFICATION_SOURCE.personaName,
    systemSplit: delivered,
    sessionId: "body-cue-review",
    transportProvider: "cheaperinference",
    sceneServerControls: {
      mode: "interactive",
      contentKind: "character",
      party: false,
      primaryCharacterName: CANONICAL_RP_QUALIFICATION_SOURCE.characterName,
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
    CANONICAL_RP_QUALIFICATION_SOURCE.characterName,
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

export function buildBodyCueReviewPacket(): BodyCueReviewPacket {
  const scenes = buildCommonProseBodyCueReviewCases().map((caseData) => {
    const baselineRun = assembleScene(caseData, false);
    const candidateRun = assembleScene(caseData, true);
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
  });
  const pricing = getPublishedPricing(BODY_CUE_REVIEW_MODEL);
  const largerPromptChars = Math.max(...scenes.map((scene) => scene.promptChars));
  const rates = resolvePublishedReferenceRatesForPrompt(pricing, largerPromptChars);
  // Korean tokenizers can exceed one token per character. Two tokens per
  // character is the planning ceiling, not a measured provider count.
  const promptTokenCeiling = largerPromptChars * 2;
  const perCallUsd =
    (promptTokenCeiling / 1_000_000) * rates.inputUsdPerMillion +
    (BODY_CUE_OUTPUT_TOKEN_CEILING / 1_000_000) * rates.outputUsdPerMillion;
  const providerUsd = perCallUsd * BODY_CUE_REVIEW_CALLS;
  const userChargeKrw =
    (providerUsd * BODY_CUE_PLANNING_FX.effectiveKrwPerUsd) / (1 - pricing.targetMargin);
  return {
    providerCalls: 0,
    mainCommit: "11e9e96aa729922d05249695f36a1e3c699aaba0",
    candidateHead: "73908e134ef28e47be8a50e6c8ebad3bcb4c6c60",
    source: CANONICAL_RP_QUALIFICATION_SOURCE,
    modelId: BODY_CUE_REVIEW_MODEL,
    authoringLevel: "NORMAL",
    nsfw: false,
    scenes,
    liveIdentity: {
      status: BODY_CUE_LIVE_IDENTITY_STATUS,
      deployedCommit: "ec7f0cbe91a7e1d7801821bc9ece8fc0eed0ff15",
      proseOwnerUnchanged: true,
      rowRead: false,
    },
    cost: {
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
    },
  };
}
