import {
  DEFAULT_TRPG_DICE_RULES,
  LEGACY_DEFAULT_TRPG_DICE_RULES,
  type TrpgDiceRules,
  type TrpgNatRule,
} from "./types";

const NAT_RULES: readonly TrpgNatRule[] = ["critical", "shift_one", "numeric"];

function asNatRule(value: unknown, fallback: TrpgNatRule): TrpgNatRule {
  return typeof value === "string" && (NAT_RULES as readonly string[]).includes(value)
    ? (value as TrpgNatRule)
    : fallback;
}

function asPositiveInt(value: unknown, fallback: number): number {
  const n = typeof value === "number" ? value : Number(value);
  return Number.isInteger(n) && n > 0 ? n : fallback;
}

function asNonNegativeInt(value: unknown, fallback: number): number {
  const n = typeof value === "number" ? value : Number(value);
  return Number.isInteger(n) && n >= 0 ? n : fallback;
}

export function parseTrpgDiceRules(raw: unknown): TrpgDiceRules | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const row = raw as Record<string, unknown>;
  return {
    die: 20,
    dc: asPositiveInt(row.dc, DEFAULT_TRPG_DICE_RULES.dc),
    severeFailureMargin: asNonNegativeInt(row.severeFailureMargin, DEFAULT_TRPG_DICE_RULES.severeFailureMargin),
    greatSuccessMargin: asNonNegativeInt(row.greatSuccessMargin, DEFAULT_TRPG_DICE_RULES.greatSuccessMargin),
    partialWindow: asNonNegativeInt(row.partialWindow, DEFAULT_TRPG_DICE_RULES.partialWindow),
    nat1: asNatRule(row.nat1, DEFAULT_TRPG_DICE_RULES.nat1),
    nat20: asNatRule(row.nat20, DEFAULT_TRPG_DICE_RULES.nat20),
  };
}

export function diceRulesSemanticallyEqual(a: TrpgDiceRules, b: TrpgDiceRules): boolean {
  return (
    a.die === b.die &&
    a.dc === b.dc &&
    a.severeFailureMargin === b.severeFailureMargin &&
    a.greatSuccessMargin === b.greatSuccessMargin &&
    a.partialWindow === b.partialWindow &&
    a.nat1 === b.nat1 &&
    a.nat20 === b.nat20
  );
}

export function isLegacyDefaultDiceRules(rules: TrpgDiceRules): boolean {
  return diceRulesSemanticallyEqual(rules, LEGACY_DEFAULT_TRPG_DICE_RULES);
}

export function isStandardV2DiceRules(rules: TrpgDiceRules): boolean {
  return diceRulesSemanticallyEqual(rules, DEFAULT_TRPG_DICE_RULES);
}
