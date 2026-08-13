import { renderStatusWidgetHtml } from "@/lib/statusWidget/render";
import type { StatusWidget, StatusWidgetValues } from "@/lib/statusWidget/types";
import { DEFAULT_TRPG_SHEET_WIDGET } from "./defaultSheet";
import { clampHp } from "./stats";
import type { TrpgSheetSnapshot, TrpgStateDelta } from "./types";

export type TrpgSheetHudCard = {
  participantId: number;
  isSelf: boolean;
  /** Structured source of truth — never derived from HTML. */
  sheet: TrpgSheetSnapshot;
  /** Sanitized HUD HTML compiled from the sheet. */
  html: string;
};

export function sheetToWidgetValues(sheet: TrpgSheetSnapshot): StatusWidgetValues {
  const stats: StatusWidgetValues = {};
  for (const [key, value] of Object.entries(sheet.stats)) {
    stats[key] = String(value);
  }
  return {
    name: sheet.name,
    player: sheet.playerName,
    level: String(sheet.level),
    hp: `${sheet.hp} / ${sheet.maxHp}`,
    location: sheet.location || "—",
    conditions: sheet.conditions.length ? sheet.conditions.join(", ") : "없음",
    inventory: sheet.inventory.length ? sheet.inventory.join(", ") : "없음",
    modifiers: sheet.modifiersNote || "—",
    ...stats,
  };
}

/** Compile a status-window card from structured sheet data. HTML is display-only. */
export function renderTrpgSheetCard(
  sheet: TrpgSheetSnapshot,
  widget: StatusWidget = DEFAULT_TRPG_SHEET_WIDGET
): string {
  return renderStatusWidgetHtml(widget, sheetToWidgetValues(sheet), {
    characterName: sheet.name,
    personaName: sheet.playerName,
  });
}

/**
 * Each participant sees every party sheet as a status window.
 * Own card is marked isSelf; values still come from DB snapshots, not HTML.
 */
export function buildPartySheetHud(opts: {
  viewerParticipantId: number;
  sheets: TrpgSheetSnapshot[];
  widget?: StatusWidget;
}): TrpgSheetHudCard[] {
  return opts.sheets.map((sheet) => ({
    participantId: sheet.participantId,
    isSelf: sheet.participantId === opts.viewerParticipantId,
    sheet,
    html: renderTrpgSheetCard(sheet, opts.widget ?? DEFAULT_TRPG_SHEET_WIDGET),
  }));
}

export type DeltaApplyError =
  | "unknown_participant"
  | "hp_out_of_range"
  | "missing_item"
  | "duplicate_player";

export function applyValidatedStateDelta(
  sheets: TrpgSheetSnapshot[],
  delta: TrpgStateDelta
): { ok: true; next: TrpgSheetSnapshot[] } | { ok: false; error: DeltaApplyError; detail: string } {
  const byId = new Map(sheets.map((s) => [s.participantId, { ...s, stats: { ...s.stats }, conditions: [...s.conditions], inventory: [...s.inventory] }]));
  const seen = new Set<number>();

  for (const patch of delta.players) {
    if (seen.has(patch.participantId)) {
      return { ok: false, error: "duplicate_player", detail: String(patch.participantId) };
    }
    seen.add(patch.participantId);
    const cur = byId.get(patch.participantId);
    if (!cur) {
      return { ok: false, error: "unknown_participant", detail: String(patch.participantId) };
    }
    if (patch.hp != null) {
      if (!Number.isInteger(patch.hp) || patch.hp < 0 || patch.hp > cur.maxHp) {
        return { ok: false, error: "hp_out_of_range", detail: String(patch.participantId) };
      }
      cur.hp = clampHp(patch.hp, cur.maxHp);
    }
    if (patch.conditions) cur.conditions = patch.conditions.map((c) => c.trim()).filter(Boolean);
    if (patch.location != null) cur.location = patch.location.trim();
    if (patch.inventoryAdd) {
      for (const item of patch.inventoryAdd) {
        const t = item.trim();
        if (t) cur.inventory.push(t);
      }
    }
    if (patch.inventoryRemove) {
      for (const item of patch.inventoryRemove) {
        const t = item.trim();
        const idx = cur.inventory.indexOf(t);
        if (idx < 0) {
          return { ok: false, error: "missing_item", detail: t };
        }
        cur.inventory.splice(idx, 1);
      }
    }
    byId.set(patch.participantId, cur);
  }

  return { ok: true, next: sheets.map((s) => byId.get(s.participantId)!) };
}
