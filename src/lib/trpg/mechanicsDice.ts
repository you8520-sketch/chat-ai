import { randomInt } from "node:crypto";
import type { MechanicsClass, TickClass } from "./mechanicsTypes";
import { BASIC_FIRST_AID_HP_CEILING_RATIO, SAFE_REST_HEAL_RATIO, TOTAL_ONGOING_DAMAGE_RATIO } from "./mechanicsTypes";
import type { TrpgSuccessTier } from "./types";
import { isHealingIntentAction as intentIsHealing } from "./mechanicsIntent";

export type DiceRng = (sides: number) => number;

export const DEFAULT_DICE_RNG: DiceRng = (sides) => randomInt(1, sides + 1);

export const DIRECT_DICE: Record<Exclude<MechanicsClass, "NONE">, { count: number; sides: number }> = {
  CHIP: { count: 1, sides: 2 },
  LIGHT: { count: 1, sides: 4 },
  MEDIUM: { count: 1, sides: 6 },
  HEAVY: { count: 1, sides: 8 },
  SEVERE: { count: 2, sides: 6 },
  CRITICAL: { count: 2, sides: 8 },
};

export const HEAL_CLASSES = ["LIGHT", "MEDIUM", "HEAVY"] as const;

export const RECOVERY_DC_ADJ: Record<MechanicsClass, number> = {
  NONE: 0,
  CHIP: -4,
  LIGHT: -2,
  MEDIUM: 0,
  HEAVY: 2,
  SEVERE: 4,
  CRITICAL: 4,
};

export const CONTROL_MODIFIER: Record<MechanicsClass, number> = {
  NONE: 0,
  CHIP: 0,
  LIGHT: -1,
  MEDIUM: -2,
  HEAVY: -4,
  SEVERE: -4,
  CRITICAL: -4,
};

export const DURATION_TICKS = {
  SHORT: 2,
  MEDIUM: 3,
  LONG: 4,
} as const;

export const TIER_HARM_CAP: Record<TrpgSuccessTier, MechanicsClass> = {
  CRITICAL_SUCCESS: "NONE",
  GREAT_SUCCESS: "CHIP",
  SUCCESS: "CHIP",
  PARTIAL_SUCCESS: "MEDIUM",
  FAILURE: "HEAVY",
  SEVERE_FAILURE: "SEVERE",
  CRITICAL_FAILURE: "CRITICAL",
};

export const TIER_HEAL_CAP: Record<TrpgSuccessTier, MechanicsClass> = {
  CRITICAL_SUCCESS: "HEAVY",
  GREAT_SUCCESS: "HEAVY",
  SUCCESS: "MEDIUM",
  PARTIAL_SUCCESS: "LIGHT",
  FAILURE: "NONE",
  SEVERE_FAILURE: "NONE",
  CRITICAL_FAILURE: "NONE",
};

export const BASIC_FIRST_AID_TIER_CAP: Record<TrpgSuccessTier, MechanicsClass> = {
  CRITICAL_SUCCESS: "MEDIUM",
  GREAT_SUCCESS: "MEDIUM",
  SUCCESS: "LIGHT",
  PARTIAL_SUCCESS: "LIGHT",
  FAILURE: "NONE",
  SEVERE_FAILURE: "NONE",
  CRITICAL_FAILURE: "NONE",
};

const CLASS_RANK: Record<MechanicsClass, number> = {
  NONE: 0,
  CHIP: 1,
  LIGHT: 2,
  MEDIUM: 3,
  HEAVY: 4,
  SEVERE: 5,
  CRITICAL: 6,
};

export function hpUnit(maxHp: number): number {
  return Math.max(1, Math.round(Math.max(1, maxHp) / 25));
}

export function totalOngoingDamageCap(maxHp: number): number {
  return Math.ceil(Math.max(1, maxHp) * TOTAL_ONGOING_DAMAGE_RATIO);
}

export function classRank(value: MechanicsClass): number {
  return CLASS_RANK[value];
}

export function minClass(a: MechanicsClass, b: MechanicsClass): MechanicsClass {
  return classRank(a) <= classRank(b) ? a : b;
}

export function diceExpression(klass: Exclude<MechanicsClass, "NONE">): string {
  const spec = DIRECT_DICE[klass];
  return `${spec.count}d${spec.sides}`;
}

export function rollDiceExpression(
  klass: Exclude<MechanicsClass, "NONE">,
  maxHp: number,
  rng: DiceRng = DEFAULT_DICE_RNG
): { expression: string; rolls: number[]; total: number; amount: number } {
  const spec = DIRECT_DICE[klass];
  const rolls: number[] = [];
  let total = 0;
  for (let i = 0; i < spec.count; i++) {
    const face = rng(spec.sides);
    rolls.push(face);
    total += face;
  }
  return {
    expression: diceExpression(klass),
    rolls,
    total,
    amount: total * hpUnit(maxHp),
  };
}

export function recoveryDc(baseDc: number, severity: MechanicsClass): number {
  return Math.max(1, baseDc + RECOVERY_DC_ADJ[severity]);
}

export function clampHpAmount(hp: number, maxHp: number): number {
  if (!Number.isFinite(hp)) return 0;
  return Math.min(Math.max(0, Math.floor(hp)), Math.max(0, Math.floor(maxHp)));
}

export function isPhysicalThreatAction(actionType: string | null): boolean {
  return actionType === "attack" || actionType === "defend";
}

export function isHealingIntentAction(
  actionType: string | null,
  body = "",
  sourceInventory: readonly string[] = [],
  extraKnown: readonly string[] = []
): boolean {
  return intentIsHealing(actionType, body, sourceInventory, extraKnown);
}

export function basicFirstAidHpCeiling(maxHp: number): number {
  return Math.ceil(Math.max(1, maxHp) * BASIC_FIRST_AID_HP_CEILING_RATIO);
}

export function safeRestHealAmount(maxHp: number): number {
  return Math.max(1, Math.ceil(Math.max(1, maxHp) * SAFE_REST_HEAL_RATIO));
}
