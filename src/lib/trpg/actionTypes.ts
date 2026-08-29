import type { TrpgStatDefinition } from "./types";
import {
  compatibleStatsForAction,
  scoreActionMethodHints,
} from "./actionMethodHints";

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
  attack: ["str", "mag", "spd", "dex"],
  defend: ["con", "res", "wil"],
  investigate: ["int", "per", "ins"],
  persuade: ["cha", "wis", "wil"],
  stealth: ["dex", "spd", "surv", "tec", "lck"],
  support: ["wis", "fth", "wil", "san"],
  use_item: ["int", "tec", "foc", "mag", "dex"],
  free: ["dex", "foc", "ins", "int", "str"],
};

export type StatSelectionReason = "selected" | "method" | "action_pref" | "fallback";

export type StatSelectionResult = {
  statKey: string;
  reason: StatSelectionReason;
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

function pickMethodStat(opts: {
  actionType: TrpgActionType | null;
  body: string;
  defs: TrpgStatDefinition[];
}): { statKey: string; reason: StatSelectionReason } | null {
  const text = opts.body.trim();
  if (!text || opts.defs.length === 0) return null;
  const compatible = new Set(compatibleStatsForAction(opts.actionType));
  let bestKey = "";
  let bestScore = 0;
  for (const def of opts.defs) {
    if (!compatible.has(def.key)) continue;
    const score = scoreActionMethodHints(text, def.key);
    if (score > bestScore) {
      bestScore = score;
      bestKey = def.key;
    }
  }
  if (bestScore > 0 && bestKey) {
    return { statKey: bestKey, reason: "method" };
  }
  return null;
}

/**
 * Pick which scenario-sheet stat this action uses.
 * Player override → action-compatible method semantics → action-type prefs → first sheet stat.
 */
export function pickStatForActionDetailed(opts: {
  actionType: TrpgActionType | null;
  selectedStat: string | null;
  body?: string;
  defs: TrpgStatDefinition[];
}): StatSelectionResult {
  if (opts.selectedStat && opts.defs.some((d) => d.key === opts.selectedStat)) {
    return { statKey: opts.selectedStat, reason: "selected" };
  }

  const method = pickMethodStat({
    actionType: opts.actionType,
    body: opts.body?.trim() ?? "",
    defs: opts.defs,
  });
  if (method) return method;

  const prefs = opts.actionType ? ACTION_STAT_PREFS[opts.actionType] : ACTION_STAT_PREFS.free;
  const pref = firstPrefOnSheet(prefs, opts.defs);
  if (pref) return { statKey: pref, reason: "action_pref" };

  return {
    statKey: opts.defs[0]?.key ?? defaultStatForAction(opts.actionType),
    reason: "fallback",
  };
}

export function pickStatForAction(opts: {
  actionType: TrpgActionType | null;
  selectedStat: string | null;
  body?: string;
  defs: TrpgStatDefinition[];
}): string {
  return pickStatForActionDetailed(opts).statKey;
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
