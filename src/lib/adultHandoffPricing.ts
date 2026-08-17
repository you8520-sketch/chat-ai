import {
  CHEAPER_INFERENCE_CLAUDE_OPUS_5_MODEL,
  CHEAPER_INFERENCE_GEMINI_31_PRO_PREVIEW_MODEL,
  CHEAPER_INFERENCE_MUSE_SPARK_12_MODEL,
  isCheaperInferenceMuseSpark12Model,
} from "@/lib/chatModels";
import { normalizeAdultHandoffSourceModelId } from "@/lib/adultHandoffSourceRouting";

/**
 * User-facing Muse handoff discount is not approved in this change.
 * Keep the owner split only; do not apply a percentage.
 */
export const ADULT_HANDOFF_USER_DISCOUNT_PERCENT: null = null;

export type AdultHandoffPricingOwners = {
  userChargeOwner: string | null;
  actualCostOwner: string | null;
  chargeModelId: string;
  discountPercent: null;
};

export function resolveAdultHandoffUserChargeOwner(input: {
  sourceModelId?: string;
  deliveredModelId?: string;
  activeRoute?: string;
}): string | null {
  if (input.activeRoute !== "adult") return null;
  if (!isCheaperInferenceMuseSpark12Model(input.deliveredModelId ?? "")) {
    return null;
  }
  const source = normalizeAdultHandoffSourceModelId(input.sourceModelId ?? "");
  if (source === CHEAPER_INFERENCE_CLAUDE_OPUS_5_MODEL) {
    return CHEAPER_INFERENCE_CLAUDE_OPUS_5_MODEL;
  }
  if (source === CHEAPER_INFERENCE_GEMINI_31_PRO_PREVIEW_MODEL) {
    return CHEAPER_INFERENCE_GEMINI_31_PRO_PREVIEW_MODEL;
  }
  return null;
}

export function resolveAdultHandoffActualCostOwner(input: {
  deliveredModelId?: string;
}): string | null {
  if (!isCheaperInferenceMuseSpark12Model(input.deliveredModelId ?? "")) {
    return null;
  }
  return CHEAPER_INFERENCE_MUSE_SPARK_12_MODEL;
}

export function resolveAdultHandoffChargeModelId(input: {
  sourceModelId?: string;
  deliveredModelId: string;
  activeRoute?: string;
}): AdultHandoffPricingOwners {
  const userChargeOwner = resolveAdultHandoffUserChargeOwner(input);
  const actualCostOwner = resolveAdultHandoffActualCostOwner(input);
  return {
    userChargeOwner,
    actualCostOwner,
    chargeModelId: userChargeOwner ?? input.deliveredModelId,
    discountPercent: ADULT_HANDOFF_USER_DISCOUNT_PERCENT,
  };
}
