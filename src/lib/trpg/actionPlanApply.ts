import type Database from "better-sqlite3";
import type { MechanicsResolution } from "./mechanicsTypes";
import { consumeInventoryItem, inventoryHasName } from "./inventory";
import type { TrpgActionPlan } from "./actionContract";
import type { TrpgSheetSnapshot } from "./types";

export type TrpgPlanItemEffect = {
  participantId: number;
  item: string;
  consumed: boolean;
  hpBefore: number;
  hpAfter: number;
  owner: "server_plan" | "mechanics";
};

function healAmountFor(item: string, maxHp: number): number {
  if (/회복약|healing potion|potion/i.test(item)) return Math.max(1, Math.ceil(maxHp * 0.25));
  if (/붕대|bandage/i.test(item)) return Math.max(1, Math.ceil(maxHp * 0.1));
  return 0;
}

/**
 * Applies the committed plan's own item use only when the mechanics owner did
 * not already consume that item. This keeps one item-use result and one
 * consumption per turn; the GM never supplies either number.
 */
export function applyPlanItemEffects(
  sheets: readonly TrpgSheetSnapshot[],
  plans: readonly TrpgActionPlan[],
  mechanics: MechanicsResolution | null
): { sheets: TrpgSheetSnapshot[]; effects: TrpgPlanItemEffect[] } {
  const next = sheets.map((sheet) => ({
    ...sheet,
    inventory: sheet.inventory.map((entry) => ({ ...entry })),
  }));
  const byId = new Map(next.map((sheet) => [sheet.participantId, sheet]));
  const consumedByMechanics = new Set(
    (mechanics?.consumeItems ?? []).map((row) => `${row.participantId}\u0000${row.item}`)
  );
  const effects: TrpgPlanItemEffect[] = [];
  for (const plan of plans) {
    for (const act of plan.acts) {
      if (act.status !== "planned" || act.kind !== "item_use" || !act.item) continue;
      const sheet = byId.get(act.actorParticipantId);
      if (!sheet) continue;
      const key = `${act.actorParticipantId}\u0000${act.item}`;
      if (consumedByMechanics.has(key)) {
        effects.push({
          participantId: act.actorParticipantId,
          item: act.item,
          consumed: true,
          hpBefore: sheet.hp,
          hpAfter: sheet.hp,
          owner: "mechanics",
        });
        continue;
      }
      if (!inventoryHasName(sheet.inventory, act.item)) continue;
      const consumed = consumeInventoryItem(sheet.inventory, act.item);
      if (!consumed.ok) continue;
      sheet.inventory = consumed.next;
      const before = sheet.hp;
      const heal = healAmountFor(act.item, sheet.maxHp);
      sheet.hp = Math.min(sheet.maxHp, sheet.hp + heal);
      effects.push({
        participantId: act.actorParticipantId,
        item: act.item,
        consumed: true,
        hpBefore: before,
        hpAfter: sheet.hp,
        owner: "server_plan",
      });
    }
  }
  return { sheets: next, effects };
}

export function loadPlanEffectRows(db: Database.Database, roundId: number): TrpgActionPlan[] {
  const rows = db
    .prepare(`SELECT action_plan_json FROM trpg_action_submissions WHERE round_id=? AND locked=1 ORDER BY id`)
    .all(roundId) as Array<{ action_plan_json: string | null }>;
  const out: TrpgActionPlan[] = [];
  for (const row of rows) {
    if (!row.action_plan_json) continue;
    try {
      out.push(JSON.parse(row.action_plan_json) as TrpgActionPlan);
    } catch {
      // ignore malformed old rows
    }
  }
  return out;
}
