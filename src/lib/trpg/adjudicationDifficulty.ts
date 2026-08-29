import type { TrpgActionCheckReason } from "./actionCheck";
import type { TrpgActionType } from "./actionTypes";
import { isBasicFirstAidIntent, isCoverFireSupport } from "./mechanicsIntent";

export type TrpgDifficultyBand = "EASY" | "STANDARD" | "HARD";

export function clampTrpgDc(dc: number): number {
  return Math.max(5, Math.min(30, dc));
}

export function difficultyDcFromAnchor(anchorDc: number, band: TrpgDifficultyBand): number {
  switch (band) {
    case "EASY":
      return clampTrpgDc(anchorDc - 4);
    case "STANDARD":
      return clampTrpgDc(anchorDc - 2);
    case "HARD":
      return clampTrpgDc(anchorDc);
    default: {
      const _never: never = band;
      return _never;
    }
  }
}

function isStraightforwardSupportChallenge(
  actionType: TrpgActionType,
  checkReason: TrpgActionCheckReason,
  intent: string
): boolean {
  if (actionType !== "support") return false;
  if (checkReason === "hazard" || checkReason === "contested") return false;
  const text = intent.trim();
  if (!text) return false;
  return isBasicFirstAidIntent(text) || isCoverFireSupport(text);
}

export function classifyTrpgDifficultyBand(opts: {
  actionType: TrpgActionType;
  checkReason: TrpgActionCheckReason;
  intent?: string;
}): TrpgDifficultyBand {
  const { actionType, checkReason } = opts;
  const intent = opts.intent ?? "";

  if (checkReason === "hazard" || checkReason === "contested") return "HARD";
  if (actionType === "attack" || actionType === "stealth") return "HARD";

  if (actionType === "support") {
    if (isStraightforwardSupportChallenge(actionType, checkReason, intent)) return "EASY";
    if (checkReason === "challenge") return "STANDARD";
    return "EASY";
  }

  if (actionType === "investigate" || actionType === "defend") return "STANDARD";

  if (actionType === "persuade") {
    return checkReason === "explicit_resolution" ? "HARD" : "STANDARD";
  }

  if (checkReason === "challenge") return "STANDARD";
  return "STANDARD";
}

/** Single canonical difficulty owner — stored scenario DC is the HARD anchor. */
export function resolveTrpgAdjudicationDifficulty(opts: {
  anchorDc: number;
  actionType: TrpgActionType;
  checkReason: TrpgActionCheckReason;
  intent?: string;
}): { band: TrpgDifficultyBand; anchorDc: number; effectiveDc: number } {
  const band = classifyTrpgDifficultyBand(opts);
  return {
    band,
    anchorDc: opts.anchorDc,
    effectiveDc: difficultyDcFromAnchor(opts.anchorDc, band),
  };
}
