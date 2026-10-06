import { isTrpgActionType } from "./actionTypes";
import { ongoingEffectActionDraft, useItemActionDraft, type TrpgActionDraftFill } from "./commandDock";
import { formatOngoingBadge, hpPercent, hpRiskLevel, type TrpgHpRisk } from "./sheetHud";
import type { TrpgSheetHudCard } from "./sheetView";
import type { TrpgMechanicsHudLine, TrpgPublicOngoingEffect } from "./snapshot";
import { statModifier } from "./stats";
import { TRPG_ACTION_MAX_CHARS, type TrpgStatDefinition } from "./types";

/**
 * Read-only presentation copy of one participant sheet. Native and sandboxed JSX
 * renderers both draw from this; the engine/snapshot stay the state owner.
 * Drafts are present only on the viewer's own (interactive) sheet.
 */
export type TrpgSheetSurface = {
  participantId: number;
  interactive: boolean;
  name: string;
  level: number;
  hp: number;
  maxHp: number;
  hpPercent: number;
  hpRisk: TrpgHpRisk;
  place: string;
  stats: { key: string; label: string; value: number; modifier: number }[];
  conditions: string[];
  effects: { key: string; label: string; badge: string; hint: string; draft: TrpgActionDraftFill | null }[];
  inventory: { key: string; name: string; draft: TrpgActionDraftFill | null }[];
  mechanics: string[];
  modifiersNote: string;
};

export function buildTrpgSheetSurface(
  card: TrpgSheetHudCard,
  opts: {
    statDefs: readonly TrpgStatDefinition[];
    ongoingEffects: readonly TrpgPublicOngoingEffect[] | undefined;
    mechanicsLines: readonly TrpgMechanicsHudLine[] | undefined;
    interactive: boolean;
  }
): TrpgSheetSurface {
  const sheet = card.sheet;
  const participantId = card.participantId;
  return {
    participantId,
    interactive: opts.interactive,
    name: sheet.name,
    level: sheet.level,
    hp: sheet.hp,
    maxHp: sheet.maxHp,
    hpPercent: hpPercent(sheet.hp, sheet.maxHp),
    hpRisk: hpRiskLevel(sheet.hp, sheet.maxHp),
    place: sheet.location.trim(),
    stats: opts.statDefs.map((def) => {
      const raw = sheet.stats[def.key];
      const value = typeof raw === "number" ? raw : 5;
      return { key: def.key, label: def.label, value, modifier: statModifier(value) };
    }),
    conditions: sheet.conditions.map((item) => item.trim()).filter(Boolean),
    effects: (opts.ongoingEffects ?? [])
      .filter((effect) => effect.participantId === participantId)
      .map((effect) => ({
        key: `${effect.label}:${effect.severity}:${effect.kind}`,
        label: effect.label,
        badge: formatOngoingBadge(effect),
        hint: effect.recoveryHint,
        draft: opts.interactive ? ongoingEffectActionDraft(effect) : null,
      })),
    inventory: sheet.inventory
      .map((item) => item.trim())
      .filter(Boolean)
      .map((name, index) => ({
        key: `${name}:${index}`,
        name,
        draft: opts.interactive ? useItemActionDraft(name) : null,
      })),
    mechanics: (opts.mechanicsLines ?? [])
      .filter((line) => line.participantId === participantId)
      .map((line) => line.text),
    modifiersNote: sheet.modifiersNote.trim(),
  };
}

/**
 * TRPG owner for sandbox setTrpgActionDraft: allowlisted type, normalized body
 * within the action length owner. Anything else is dropped (no truncation).
 */
export function acceptTrpgSheetActionDraft(request: { actionType: string; text: string }): TrpgActionDraftFill | null {
  if (!isTrpgActionType(request.actionType)) return null;
  const body = request.text.replace(/\r\n?/g, "\n").trim();
  if (!body) return null;
  if ([...body].length > TRPG_ACTION_MAX_CHARS) return null;
  return { actionType: request.actionType, body };
}

export type TrpgSheetRenderer = "jsx" | "native";

export function trpgSheetRenderer(opts: { compiled: string | null; failedCompiled: string | null }): TrpgSheetRenderer {
  if (!opts.compiled) return "native";
  return opts.failedCompiled === opts.compiled ? "native" : "jsx";
}
