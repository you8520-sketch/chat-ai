import type { TrpgStatDefinition } from "./types";
import { scoreStatHints } from "./stats";

export const TRPG_ACTION_TYPES = [
  "attack",
  "defend",
  "investigate",
  "persuade",
  "stealth",
  "support",
  "use_item",
  "free",
] as const;

export type TrpgActionType = (typeof TRPG_ACTION_TYPES)[number];

/**
 * Composer quick-action chips only. Backend still owns stealth / use_item
 * for server semantics and contextual owners; those chips stay hidden.
 */
export const TRPG_VISIBLE_ACTION_TYPES = [
  "attack",
  "defend",
  "investigate",
  "persuade",
  "support",
  "free",
] as const;

export type TrpgVisibleActionType = (typeof TRPG_VISIBLE_ACTION_TYPES)[number];

export function isTrpgActionType(value: string): value is TrpgActionType {
  return (TRPG_ACTION_TYPES as readonly string[]).includes(value);
}

export function isTrpgVisibleActionType(value: string): value is TrpgVisibleActionType {
  return (TRPG_VISIBLE_ACTION_TYPES as readonly string[]).includes(value);
}

/** Preferred sheet keys for each action, first match on the scenario sheet wins. */
export const ACTION_STAT_PREFS: Record<TrpgActionType, readonly string[]> = {
  attack: ["str", "mag", "acc", "spd", "dex"],
  defend: ["con", "grd", "res", "siz", "wil"],
  investigate: ["int", "per", "occ", "edu", "ins"],
  persuade: ["cha", "emp", "app", "pre", "inf", "hon"],
  stealth: ["dex", "spd", "surv", "tec", "lck"],
  support: ["wis", "rec", "fth", "emp", "wil", "san"],
  use_item: ["int", "tec", "foc", "mag", "dex"],
  free: ["dex", "foc", "ins", "int", "str"],
};

export function defaultStatForAction(actionType: TrpgActionType | null): string {
  switch (actionType) {
    case "attack":
      return "str";
    case "defend":
      return "con";
    case "investigate":
      return "int";
    case "persuade":
      return "cha";
    case "stealth":
      return "dex";
    case "support":
      return "wis";
    case "use_item":
      return "int";
    case "free":
    case null:
      return "dex";
    default: {
      const _exhaustive: never = actionType;
      return _exhaustive;
    }
  }
}

function firstPrefOnSheet(prefs: readonly string[], defs: TrpgStatDefinition[]): string | null {
  for (const key of prefs) {
    if (defs.some((d) => d.key === key)) return key;
  }
  return null;
}

/**
 * Pick which scenario-sheet stat this action uses.
 * Player override → body keywords on this sheet → action-type prefs → first sheet stat.
 */
export function pickStatForAction(opts: {
  actionType: TrpgActionType | null;
  selectedStat: string | null;
  body?: string;
  defs: TrpgStatDefinition[];
}): string {
  if (opts.selectedStat && opts.defs.some((d) => d.key === opts.selectedStat)) {
    return opts.selectedStat;
  }
  const text = opts.body?.trim() ?? "";
  if (text && opts.defs.length > 0) {
    let bestKey = "";
    let bestScore = 0;
    for (const def of opts.defs) {
      const score = scoreStatHints(text, def.key);
      if (score > bestScore) {
        bestScore = score;
        bestKey = def.key;
      }
    }
    if (bestScore > 0 && bestKey) return bestKey;
  }
  const prefs = opts.actionType ? ACTION_STAT_PREFS[opts.actionType] : ACTION_STAT_PREFS.free;
  return firstPrefOnSheet(prefs, opts.defs) ?? opts.defs[0]?.key ?? defaultStatForAction(opts.actionType);
}

export function resolveAdjudicationStat(opts: {
  actionType: TrpgActionType | null;
  selectedStat: string | null;
  defs: TrpgStatDefinition[];
  body?: string;
}): string {
  return pickStatForAction(opts);
}

export function actionTypeLabelKo(actionType: TrpgActionType): string {
  switch (actionType) {
    case "attack":
      return "공격";
    case "defend":
      return "방어";
    case "investigate":
      return "조사";
    case "persuade":
      return "설득";
    case "stealth":
      return "은신";
    case "support":
      return "지원";
    case "use_item":
      return "도구";
    case "free":
      return "기타 행동";
    default: {
      const _exhaustive: never = actionType;
      return _exhaustive;
    }
  }
}
