import { randomInt } from "node:crypto";
import {
  DEFAULT_TRPG_DICE_RULES,
  type TrpgDiceRules,
  type TrpgNatRule,
  type TrpgSuccessTier,
} from "./types";
import { successLabelKo } from "./labels";

export { successLabelKo } from "./labels";

export type TrpgRollInput = {
  d20: number;
  statModifier: number;
  equipmentModifier?: number;
  conditionModifier?: number;
  supportModifier?: number;
  environmentModifier?: number;
  dc?: number;
  rules?: TrpgDiceRules;
};

export type TrpgRollResult = {
  d20: number;
  finalScore: number;
  dc: number;
  tier: TrpgSuccessTier;
  success: boolean;
};

/** Server-only d20. Never accept a client-supplied face value as the roll. */
export function rollServerD20(): number {
  return randomInt(1, 21);
}

export function computeFinalScore(input: TrpgRollInput): number {
  return (
    input.d20 +
    input.statModifier +
    (input.equipmentModifier ?? 0) +
    (input.conditionModifier ?? 0) +
    (input.supportModifier ?? 0) +
    (input.environmentModifier ?? 0)
  );
}

function applyNatRule(
  d20: number,
  numericTier: TrpgSuccessTier,
  nat1: TrpgNatRule,
  nat20: TrpgNatRule
): TrpgSuccessTier {
  if (d20 === 1) {
    switch (nat1) {
      case "critical":
        return "CRITICAL_FAILURE";
      case "shift_one":
        return shiftTier(numericTier, -1);
      case "numeric":
        return numericTier;
      default: {
        const _exhaustive: never = nat1;
        return _exhaustive;
      }
    }
  }
  if (d20 === 20) {
    switch (nat20) {
      case "critical":
        return "CRITICAL_SUCCESS";
      case "shift_one":
        return shiftTier(numericTier, 1);
      case "numeric":
        return numericTier;
      default: {
        const _exhaustive: never = nat20;
        return _exhaustive;
      }
    }
  }
  return numericTier;
}

const TIER_ORDER: TrpgSuccessTier[] = [
  "CRITICAL_FAILURE",
  "SEVERE_FAILURE",
  "FAILURE",
  "PARTIAL_SUCCESS",
  "SUCCESS",
  "GREAT_SUCCESS",
  "CRITICAL_SUCCESS",
];

function shiftTier(tier: TrpgSuccessTier, delta: number): TrpgSuccessTier {
  const idx = TIER_ORDER.indexOf(tier);
  const next = Math.min(TIER_ORDER.length - 1, Math.max(0, idx + delta));
  return TIER_ORDER[next]!;
}

export function resolveSuccessTier(
  d20: number,
  finalScore: number,
  rules: TrpgDiceRules = DEFAULT_TRPG_DICE_RULES
): TrpgSuccessTier {
  const { dc, severeFailureMargin, greatSuccessMargin, partialWindow } = rules;
  let numeric: TrpgSuccessTier;
  if (finalScore <= dc - severeFailureMargin) numeric = "SEVERE_FAILURE";
  else if (finalScore < dc - partialWindow) numeric = "FAILURE";
  else if (finalScore < dc) numeric = "PARTIAL_SUCCESS";
  else if (finalScore < dc + greatSuccessMargin) numeric = "SUCCESS";
  else numeric = "GREAT_SUCCESS";

  return applyNatRule(d20, numeric, rules.nat1, rules.nat20);
}

export function resolveTrpgRoll(input: TrpgRollInput): TrpgRollResult {
  const rules = input.rules ?? DEFAULT_TRPG_DICE_RULES;
  const d20 = input.d20;
  if (!Number.isInteger(d20) || d20 < 1 || d20 > 20) {
    throw new Error("[TRPG] d20 must be an integer 1–20 from the server roller");
  }
  const finalScore = computeFinalScore(input);
  const dc = input.dc ?? rules.dc;
  const tier = resolveSuccessTier(d20, finalScore, { ...rules, dc });
  const success =
    tier === "PARTIAL_SUCCESS" ||
    tier === "SUCCESS" ||
    tier === "GREAT_SUCCESS" ||
    tier === "CRITICAL_SUCCESS";
  return { d20, finalScore, dc, tier, success };
}
