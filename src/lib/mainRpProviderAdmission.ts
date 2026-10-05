/**
 * Canonical Main RP pre-provider point admission.
 * Consumes Published next-turn estimates. Does not charge, reserve, or settle.
 */

import { MIN_POINTS_TO_CHAT } from "@/lib/points";

export const MAIN_RP_PROVIDER_ADMISSION_ESTIMATE_MULTIPLIER = 3;

export function resolveMainRpProviderAdmissionRequiredPoints(
  publishedNextTurnEstimatePoints: number | null | undefined
): number {
  const estimate =
    typeof publishedNextTurnEstimatePoints === "number" &&
    Number.isFinite(publishedNextTurnEstimatePoints) &&
    publishedNextTurnEstimatePoints > 0
      ? Math.ceil(
          publishedNextTurnEstimatePoints * MAIN_RP_PROVIDER_ADMISSION_ESTIMATE_MULTIPLIER
        )
      : 0;
  return Math.max(MIN_POINTS_TO_CHAT, estimate);
}

export type MainRpProviderPointAdmission = {
  ok: boolean;
  requiredPoints: number;
  balancePoints: number;
};

export function admitMainRpProviderByRequiredPoints(input: {
  balancePoints: number;
  publishedNextTurnEstimatePoints?: number | null;
}): MainRpProviderPointAdmission {
  const requiredPoints = resolveMainRpProviderAdmissionRequiredPoints(
    input.publishedNextTurnEstimatePoints
  );
  const balancePoints = Number.isFinite(input.balancePoints) ? input.balancePoints : 0;
  return {
    ok: balancePoints >= requiredPoints,
    requiredPoints,
    balancePoints,
  };
}
