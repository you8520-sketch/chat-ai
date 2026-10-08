import type Database from "better-sqlite3";
import { persistSheetInventory } from "./engineSheets";
import { loadTrpgSnapshot } from "./engineSnapshot";
import { parseStoredInventory, setInventoryEquipped } from "./inventory";
import { loadCampaign, loadParticipants } from "./store";
import type { TrpgCampaignSnapshot } from "./snapshot";

export const TRPG_INVENTORY_EQUIP_NOT_STARTED_MESSAGE = "캠페인이 시작된 뒤에 장비를 변경할 수 있습니다.";
export const TRPG_INVENTORY_EQUIP_NOT_FOUND_MESSAGE = "소지품을 찾을 수 없습니다.";
export const TRPG_INVENTORY_EQUIP_INVALID_MESSAGE = "장착 상태는 true 또는 false로 보내 주세요.";

function parseEquippedFlag(value: unknown): boolean {
  if (value === true) return true;
  if (value === false) return false;
  throw new Error(TRPG_INVENTORY_EQUIP_INVALID_MESSAGE);
}

/**
 * SET equipped on the viewer's own human inventory stack.
 * Does not accept a target participant — other humans, AI companions, and
 * PARTY sheets are not user-mutable in V1.
 */
export function setTrpgInventoryEquipped(
  db: Database.Database,
  opts: { campaignId: number; userId: number; entryId: string; equipped: unknown }
): TrpgCampaignSnapshot {
  const campaign = loadCampaign(db, opts.campaignId);
  if (!campaign) throw new Error("캠페인을 찾을 수 없습니다.");
  if (campaign.status === "CHARACTER_SETUP" || campaign.status === "WAITING_FOR_PLAYERS") {
    throw new Error(TRPG_INVENTORY_EQUIP_NOT_STARTED_MESSAGE);
  }
  const participant = loadParticipants(db, opts.campaignId).find(
    (row) => row.kind === "human" && row.user_id === opts.userId
  );
  if (!participant) throw new Error("이 캠페인의 참가자가 아닙니다.");
  const equipped = parseEquippedFlag(opts.equipped);
  const row = db
    .prepare(`SELECT inventory_json FROM trpg_character_sheets WHERE campaign_id=? AND participant_id=?`)
    .get(opts.campaignId, participant.id) as { inventory_json: string } | undefined;
  if (!row) throw new Error("시트를 찾을 수 없습니다.");
  const current = parseStoredInventory(row.inventory_json);
  const result = setInventoryEquipped(current, String(opts.entryId ?? ""), equipped);
  if (!result.ok) throw new Error(TRPG_INVENTORY_EQUIP_NOT_FOUND_MESSAGE);
  const unchanged =
    current.length === result.next.length &&
    current.every((entry, index) => {
      const next = result.next[index];
      return next != null && entry.id === next.id && entry.equipped === next.equipped && entry.quantity === next.quantity;
    });
  if (!unchanged) {
    persistSheetInventory(db, {
      campaignId: opts.campaignId,
      participantId: participant.id,
      inventory: result.next,
    });
  }
  const snapshot = loadTrpgSnapshot(db, opts.campaignId, opts.userId);
  if (!snapshot) throw new Error("캠페인을 찾을 수 없습니다.");
  return snapshot;
}
