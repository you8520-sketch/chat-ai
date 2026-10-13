import { inventoryUnits } from "./inventory";
import type { TrpgCampaignLedger } from "./campaignLedger";
import type { TrpgSheetSnapshot, TrpgStateDelta } from "./types";

export const REGEN_CANON_INVERT_REASONS = [
  "inventory_holder",
  "inventory_new",
  "inventory_remove",
  "hp",
  "conditions",
  "sheet_location",
  "campaign_location",
  "quest_add",
  "quest_remove",
  "npc_add",
  "npc_remove",
  "flag_add",
  "flag_remove",
] as const;

export type RegenCanonInvertReason = (typeof REGEN_CANON_INVERT_REASONS)[number];

export type RegenCanonInvertResult = {
  invert: boolean;
  reasons: RegenCanonInvertReason[];
};

function sameSet(left: readonly string[], right: readonly string[]): boolean {
  if (left.length !== right.length) return false;
  const counted = new Map<string, number>();
  for (const item of left) counted.set(item, (counted.get(item) ?? 0) + 1);
  for (const item of right) {
    const next = (counted.get(item) ?? 0) - 1;
    if (next < 0) return false;
    counted.set(item, next);
  }
  return true;
}

function holdersByItem(sheets: readonly TrpgSheetSnapshot[]): Map<string, Set<number>> {
  const holders = new Map<string, Set<number>>();
  for (const sheet of sheets) {
    for (const name of inventoryUnits(sheet.inventory)) {
      const set = holders.get(name) ?? new Set<number>();
      set.add(sheet.participantId);
      holders.set(name, set);
    }
  }
  return holders;
}

function hasName(list: readonly string[], name: string): boolean {
  return list.includes(name);
}

/**
 * Rewrite-only regenerate may change prose. A structured delta that would change
 * committed inventory, HP, location, quests, NPCs or flags inverts those facts.
 * Restating an already-held item or an already-recorded ledger entry is not invert.
 */
export function regenerateOutputInvertsCommittedCanon(opts: {
  delta: TrpgStateDelta;
  location?: string;
  sheets: readonly TrpgSheetSnapshot[];
  ledger: TrpgCampaignLedger;
}): RegenCanonInvertResult {
  const reasons = new Set<RegenCanonInvertReason>();
  const holders = holdersByItem(opts.sheets);
  const sheetsById = new Map(opts.sheets.map((sheet) => [sheet.participantId, sheet]));

  for (const patch of opts.delta.players ?? []) {
    const sheet = sheetsById.get(patch.participantId);
    for (const name of patch.inventoryAdd ?? []) {
      const trimmed = name.trim();
      if (!trimmed) continue;
      const who = holders.get(trimmed);
      if (!who || who.size === 0) reasons.add("inventory_new");
      else if (!who.has(patch.participantId)) reasons.add("inventory_holder");
    }
    for (const name of patch.inventoryRemove ?? []) {
      const trimmed = name.trim();
      if (!trimmed || !sheet) continue;
      if (inventoryUnits(sheet.inventory).includes(trimmed)) reasons.add("inventory_remove");
    }
    if (typeof patch.hp === "number" && sheet && patch.hp !== sheet.hp) reasons.add("hp");
    if (patch.conditions && sheet && !sameSet(patch.conditions, sheet.conditions)) reasons.add("conditions");
    const seatLocation = patch.location?.trim() ?? "";
    if (seatLocation && sheet && seatLocation !== sheet.location) reasons.add("sheet_location");
  }

  const campaignLocation = (opts.location ?? opts.delta.location ?? "").trim();
  if (campaignLocation && campaignLocation !== opts.ledger.location) reasons.add("campaign_location");

  for (const title of opts.delta.questsAdd ?? []) {
    if (title && !hasName(opts.ledger.quests, title)) reasons.add("quest_add");
  }
  for (const title of opts.delta.questsRemove ?? []) {
    if (title && hasName(opts.ledger.quests, title)) reasons.add("quest_remove");
  }
  for (const name of opts.delta.npcsAdd ?? []) {
    if (name && !hasName(opts.ledger.npcs, name)) reasons.add("npc_add");
  }
  for (const name of opts.delta.npcsRemove ?? []) {
    if (name && hasName(opts.ledger.npcs, name)) reasons.add("npc_remove");
  }
  for (const flag of opts.delta.flagsAdd ?? []) {
    if (flag && !hasName(opts.ledger.worldFlags, flag)) reasons.add("flag_add");
  }
  for (const flag of opts.delta.flagsRemove ?? []) {
    if (flag && hasName(opts.ledger.worldFlags, flag)) reasons.add("flag_remove");
  }

  return { invert: reasons.size > 0, reasons: [...reasons] };
}
