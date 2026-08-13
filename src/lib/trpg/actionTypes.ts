import type { TrpgStatDefinition } from "./types";

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

export function isTrpgActionType(value: string): value is TrpgActionType {
  return (TRPG_ACTION_TYPES as readonly string[]).includes(value);
}

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

export function resolveAdjudicationStat(opts: {
  actionType: TrpgActionType | null;
  selectedStat: string | null;
  defs: TrpgStatDefinition[];
}): string {
  if (opts.selectedStat && opts.defs.some((d) => d.key === opts.selectedStat)) {
    return opts.selectedStat;
  }
  const fallback = defaultStatForAction(opts.actionType);
  if (opts.defs.some((d) => d.key === fallback)) return fallback;
  return opts.defs[0]?.key ?? "str";
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
      return "자유 행동";
    default: {
      const _exhaustive: never = actionType;
      return _exhaustive;
    }
  }
}
