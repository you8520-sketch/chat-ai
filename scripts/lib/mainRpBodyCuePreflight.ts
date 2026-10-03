/**
 * Provider-free #1288 body-cue comparison on the pinned production 라이크/렌 snapshot.
 * Does not call a model and does not change the live COMMON_PROSE sentence.
 */
import { createHash } from "node:crypto";

import { buildContext } from "@/services/contextBuilder";
import { CHEAPER_INFERENCE_DEEPSEEK_V41_FLASH_MODEL } from "@/lib/chatModels";
import {
  COMMON_PROSE_EMOTION_CUE_BASELINE,
  COMMON_PROSE_EMOTION_CUE_CANDIDATE,
  COMMON_PROSE_FORWARD_MOTION,
  replaceCommonProseEmotionCue,
} from "@/lib/advancedProseNsfwGuidelines";
import {
  applyCacheAndPrefillForTransport,
  assemblePrimaryRpRequest,
  buildOpenRouterMessages,
  type OpenRouterMessageOpts,
} from "@/lib/openRouterAdult";
import { OPENROUTER_MAX_OUTPUT_TOKENS } from "@/lib/openRouterClient";
import {
  getPublishedPricing,
  resolvePublishedReferenceRatesForPrompt,
} from "@/lib/publishedModelPricing";
import { estimateTokens } from "@/lib/tokenEstimate";
import { buildSceneDirective } from "@/lib/sceneDirective";
import { USER_COAUTHOR_OWNER_TITLE } from "@/lib/noGodmodding";
import {
  CANONICAL_RP_QUALIFICATION_SOURCE,
  buildCanonicalRpQualificationContextInput,
  buildCommonProseBodyCueReviewCases,
  type CanonicalQualificationCase,
} from "./rpModelQualificationFixture";

export const BODY_CUE_REVIEW_MODEL = CHEAPER_INFERENCE_DEEPSEEK_V41_FLASH_MODEL;
export const BODY_CUE_REVIEW_CALLS = 4;
/** Planning ceiling only. Production omits max_tokens. */
export const BODY_CUE_OUTPUT_TOKEN_CEILING = OPENROUTER_MAX_OUTPUT_TOKENS;
/** Same FX snapshot as src/lib/points.gpt61Sol.test.ts. Not a live rate. */
export const BODY_CUE_PLANNING_FX = Object.freeze({
  usdToKrw: 1530,
  effectiveKrwPerUsd: 1560.6,
});

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
  promptChars: number;
      userTurnSha256: string;
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
  costCeiling: {
    calls: number;
    largerPromptChars: number;
    promptTokenCeiling: number;
    outputTokenCeiling: number;
    cacheReadTokens: 0;
    inputUsdPerMillion: number;
    outputUsdPerMillion: number;
    targetMargin: number;
    providerUsd: number;
    userChargeKrw: number;
    fx: typeof BODY_CUE_PLANNING_FX;
  };
};

function sha256(text: string): string {
  return createHash("sha256").update(text, "utf8").digest("hex");
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
    cueBaselineCount: flat.split(COMMON_PROSE_EMOTION_CUE_BASELINE).length - 1,
    cueCandidateCount: flat.split(COMMON_PROSE_EMOTION_CUE_CANDIDATE).length - 1,
    forwardMotionCount: flat.split(COMMON_PROSE_FORWARD_MOTION).length - 1,
    commonProseCount: flat.split("[COMMON PROSE]").length - 1,
    safeContract: flat.includes("[SAFE SEXUAL LIMIT — 15+ RP]"),
    normalAuthoring: flat.includes(USER_COAUTHOR_OWNER_TITLE),
  };
}

function assembleScene(caseData: CanonicalQualificationCase, candidate: boolean) {
  const input = buildCanonicalRpQualificationContextInput({
    modelId: BODY_CUE_REVIEW_MODEL,
    caseData,
    provider: "cheaperinference",
    nsfw: false,
  });
  const built = buildContext(input);
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
    currentUserMessage: caseData.currentUserMessage,
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
      currentUserMessage: caseData.currentUserMessage,
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
  return { promptChars, arm: armFromMessages(assembled.messages) };
}

export function buildBodyCueReviewPacket(): BodyCueReviewPacket {
  const scenes = buildCommonProseBodyCueReviewCases().map((caseData) => {
    const baselineRun = assembleScene(caseData, false);
    const candidateRun = assembleScene(caseData, true);
    const baseline = baselineRun.arm;
    const candidate = candidateRun.arm;
    const expectedDelta =
      COMMON_PROSE_EMOTION_CUE_CANDIDATE.length - COMMON_PROSE_EMOTION_CUE_BASELINE.length;
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
      candidate.normalAuthoring;
    return {
      id: caseData.id,
      targetResponseChars: caseData.targetResponseChars,
      currentUserMessage: caseData.currentUserMessage,
      reviewFocus: caseData.reviewFocus,
      promptChars: Math.max(baselineRun.promptChars, candidateRun.promptChars),
      userTurnSha256: sha256(caseData.currentUserMessage),
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
    costCeiling: {
      calls: BODY_CUE_REVIEW_CALLS,
      largerPromptChars,
      promptTokenCeiling,
      outputTokenCeiling: BODY_CUE_OUTPUT_TOKEN_CEILING,
      cacheReadTokens: 0,
      inputUsdPerMillion: rates.inputUsdPerMillion,
      outputUsdPerMillion: rates.outputUsdPerMillion,
      targetMargin: pricing.targetMargin,
      providerUsd,
      userChargeKrw,
      fx: BODY_CUE_PLANNING_FX,
    },
  };
}
