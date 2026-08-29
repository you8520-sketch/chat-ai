/**
 * Effective live pricing input/output basis — LEVEL 2 divergence from route assembly.
 * Pure: model identity + token math only; no FX or charge computation.
 *
 * Note: production calls computeTurnBilling via @/lib/points → pointsReasoningMargins,
 * which routes unified-reasoning models through apiPromptTokens/apiCompletionTokens.
 */
import {
  isCheaperInferenceClaudeOpus5Model,
  isCheaperInferenceDeepSeekV4FlashModel,
  isCheaperInferenceDeepSeekV4ProModel,
  isCheaperInferenceGemini31ProModel,
  isCheaperInferenceGemini37FlashModel,
  isCheaperInferenceQwen38MaxModel,
  isDeepSeekV4ProModel,
  isGemini36FlashModel,
  isGpt56LunaModel,
  isGpt56TerraModel,
  isMuseModel,
} from "@/lib/chatModels";
import { resolveGemini37FlashBilledOutputTokens } from "@/lib/gemini37FlashPricing";

/** Models whose live @/lib/points path prefers API-reported prompt over route totalInput. */
export function prefersApiPromptForLivePricing(modelId: string): boolean {
  return (
    isCheaperInferenceGemini37FlashModel(modelId) ||
    isCheaperInferenceClaudeOpus5Model(modelId) ||
    isCheaperInferenceGemini31ProModel(modelId) ||
    isCheaperInferenceDeepSeekV4ProModel(modelId) ||
    isCheaperInferenceDeepSeekV4FlashModel(modelId) ||
    isDeepSeekV4ProModel(modelId) ||
    isGemini36FlashModel(modelId) ||
    isMuseModel(modelId) ||
    isGpt56TerraModel(modelId) ||
    isGpt56LunaModel(modelId) ||
    isCheaperInferenceQwen38MaxModel(modelId)
  );
}

export function resolveLivePricingPromptBasis(
  modelId: string,
  routeTotalInput: number,
  apiPromptTokensForCost: number
): number {
  if (prefersApiPromptForLivePricing(modelId)) {
    return apiPromptTokensForCost;
  }
  return routeTotalInput;
}

export function resolveLivePricingCompletionBasis(
  modelId: string,
  routeChargeOutputTokens: number,
  apiCompletionTokensForCost: number,
  reasoningTokens: number
): number {
  if (isCheaperInferenceGemini37FlashModel(modelId)) {
    return resolveGemini37FlashBilledOutputTokens({
      completionTokens: apiCompletionTokensForCost,
      reasoningTokens,
    });
  }
  if (prefersApiPromptForLivePricing(modelId)) {
    return apiCompletionTokensForCost;
  }
  return routeChargeOutputTokens;
}
