import { actionTypeLabelKo } from "./actionTypes";
import { parseTrpgBotAction } from "./botActionParse";
import { sanitizeTrpgActionDisplayText } from "./gmSceneAssets";
import {
  formatTrpgSignedModifier,
  successLabelKo,
  trpgCombinedModifier,
} from "./labels";
import type { ActivePresentationRollProgress } from "./roundPresentation";
import type { TrpgPublicRoll } from "./snapshot";
import type { TrpgStatDefinition } from "./types";

export const TRPG_DICE_ACTION_SUMMARY_MAX_CHARS = 140;

function conciseDiceActionSummary(text: string): string {
  const normalized = sanitizeTrpgActionDisplayText(text)
    .replace(/\s+/g, " ")
    .trim();
  const chars = Array.from(normalized);
  if (chars.length <= TRPG_DICE_ACTION_SUMMARY_MAX_CHARS) return normalized;
  return `${chars.slice(0, TRPG_DICE_ACTION_SUMMARY_MAX_CHARS - 1).join("").trimEnd()}…`;
}

export function trpgDiceActionSummary(roll: TrpgPublicRoll): string {
  if (roll.kind === "ai_character") {
    const parsed = parseTrpgBotAction(roll.actionBody);
    return conciseDiceActionSummary(parsed.intent || parsed.prose);
  }
  return conciseDiceActionSummary(roll.actionBody);
}

export type TrpgDiceContextViewModel = {
  rollOrdinal: number;
  rollTotal: number;
  actorId: number;
  actorName: string;
  statKey: string;
  statLabel: string;
  actionType: TrpgPublicRoll["actionType"];
  actionTypeLabel: string | null;
  actionSummary: string;
  d20: number;
  combinedModifier: number;
  combinedModifierLabel: string;
  finalScore: number;
  dc: number;
  tier: TrpgPublicRoll["tier"];
  tierLabel: string;
};

export function buildTrpgDiceContextViewModel(opts: {
  roll: TrpgPublicRoll;
  progress: ActivePresentationRollProgress | null;
  statDefs: readonly TrpgStatDefinition[];
}): TrpgDiceContextViewModel {
  const statLabel =
    opts.statDefs.find((definition) => definition.key === opts.roll.statKey)?.label ??
    opts.roll.statKey;
  const combinedModifier = trpgCombinedModifier(opts.roll);
  return {
    rollOrdinal: opts.progress?.rollOrdinal ?? 1,
    rollTotal: opts.progress?.rollTotal ?? 1,
    actorId: opts.roll.participantId,
    actorName: opts.roll.name,
    statKey: opts.roll.statKey,
    statLabel,
    actionType: opts.roll.actionType,
    actionTypeLabel:
      opts.roll.actionType == null ? null : actionTypeLabelKo(opts.roll.actionType),
    actionSummary: trpgDiceActionSummary(opts.roll),
    d20: opts.roll.d20,
    combinedModifier,
    combinedModifierLabel: formatTrpgSignedModifier(combinedModifier),
    finalScore: opts.roll.finalScore,
    dc: opts.roll.dc,
    tier: opts.roll.tier,
    tierLabel: successLabelKo(opts.roll.tier),
  };
}

/** Rolling + result: actor and stat stay paired for unmistakable identity. */
export function trpgDiceActorStatLine(context: Pick<TrpgDiceContextViewModel, "actorName" | "statLabel">): string {
  return `${context.actorName} · ${context.statLabel} 판정`;
}

export function trpgDiceTargetDcLine(dc: number): string {
  return `목표 DC ${dc}`;
}

/** Single-line result formula; uses combined modifier only (no component breakdown). */
export function trpgDiceResultFormulaLine(
  context: Pick<TrpgDiceContextViewModel, "d20" | "combinedModifierLabel" | "finalScore">
): string {
  return `d20 ${context.d20} + 총 보정 ${context.combinedModifierLabel} = 최종 ${context.finalScore}`;
}

export function trpgDiceA11yStatus(
  context: TrpgDiceContextViewModel,
  resultVisible: boolean
): string {
  const identity = `${context.actorName}, ${context.statLabel} 판정`;
  if (!resultVisible) {
    return `판정 ${context.rollOrdinal}/${context.rollTotal}, ${identity}, ${trpgDiceTargetDcLine(context.dc)}`;
  }
  return `${identity}, ${context.d20}, 총 보정 ${context.combinedModifierLabel}, 최종 ${context.finalScore}, ${trpgDiceTargetDcLine(context.dc)}, ${context.tierLabel}`;
}

export function trpgDiceResultVisible(
  phase: "rolling" | "entering" | "holding" | "exiting"
): boolean {
  return phase !== "rolling";
}
