import {
  CHEAPER_INFERENCE_DEEPSEEK_V4_FLASH_MODEL,
  CHEAPER_INFERENCE_DEEPSEEK_V4_FLASH_MODEL_LEGACY,
  CHEAPER_INFERENCE_DEEPSEEK_V4_PRO_MODEL,
  CHEAPER_INFERENCE_DEEPSEEK_V4_PRO_MODEL_LEGACY,
  isCheaperInferenceDeepSeekV4FlashModel,
  isCheaperInferenceDeepSeekV4ProModel,
} from "@/lib/chatModels";

export type CheaperInferenceCatalogPricing = {
  modelId: string;
  inputUsdPerMillion: number;
  cacheReadUsdPerMillion: number;
  cacheWriteUsdPerMillion: number;
  outputUsdPerMillion: number;
  discountPercent?: number;
  fetchedAt: number;
};

const pricingByModel = new Map<string, CheaperInferenceCatalogPricing>();

function normalizeModelId(modelId: string): string {
  return modelId.trim().toLowerCase();
}

export function resolveCheaperInferenceCatalogPricing(
  modelId: string
): CheaperInferenceCatalogPricing | null {
  const id = normalizeModelId(modelId);
  const direct = pricingByModel.get(id);
  if (direct) return direct;
  if (isCheaperInferenceDeepSeekV4ProModel(id)) {
    return (
      pricingByModel.get(CHEAPER_INFERENCE_DEEPSEEK_V4_PRO_MODEL) ??
      pricingByModel.get(CHEAPER_INFERENCE_DEEPSEEK_V4_PRO_MODEL_LEGACY) ??
      null
    );
  }
  if (isCheaperInferenceDeepSeekV4FlashModel(id)) {
    return (
      pricingByModel.get(CHEAPER_INFERENCE_DEEPSEEK_V4_FLASH_MODEL) ??
      pricingByModel.get(CHEAPER_INFERENCE_DEEPSEEK_V4_FLASH_MODEL_LEGACY) ??
      null
    );
  }
  return null;
}

export function updateCheaperInferenceCatalogPricing(
  pricing: CheaperInferenceCatalogPricing
): void {
  pricingByModel.set(normalizeModelId(pricing.modelId), {
    ...pricing,
    modelId: normalizeModelId(pricing.modelId),
  });
}

export function clearCheaperInferenceCatalogPricingForTest(): void {
  pricingByModel.clear();
}
