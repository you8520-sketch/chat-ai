import type Database from "better-sqlite3";
import {
  DEFAULT_TRPG_BILLING_MODE,
  TRPG_BILLING_MODE_FORBIDDEN_MESSAGE,
  TRPG_BILLING_MODE_LOCKED_MESSAGE,
  TRPG_HOST_INSUFFICIENT_POINTS_MESSAGE,
  TRPG_PLAYER_INSUFFICIENT_POINTS_MESSAGE,
  type TrpgBillingMode,
} from "./types";
import { loadCampaign } from "./store";

export function isTrpgLobbyStatus(status: string): boolean {
  return status === "CHARACTER_SETUP" || status === "WAITING_FOR_PLAYERS";
}

export function trpgInsufficientBalanceMessage(opts: {
  billingMode: TrpgBillingMode;
  hostUserId: number;
  shortUserId: number;
}): string {
  if (opts.billingMode === "host_pays" && opts.shortUserId === opts.hostUserId) {
    return TRPG_HOST_INSUFFICIENT_POINTS_MESSAGE;
  }
  return TRPG_PLAYER_INSUFFICIENT_POINTS_MESSAGE;
}

export function canChangeTrpgBillingMode(opts: {
  current: TrpgBillingMode;
  next: TrpgBillingMode;
  started: boolean;
}): boolean {
  if (opts.current === opts.next) return true;
  if (!opts.started) return true;
  return opts.current === "split_even" && opts.next === "host_pays";
}

export function saveTrpgBillingMode(
  db: Database.Database,
  opts: { campaignId: number; userId: number; billingMode: TrpgBillingMode }
): void {
  const campaign = loadCampaign(db, opts.campaignId);
  if (!campaign) throw new Error("캠페인을 찾을 수 없습니다.");
  if (campaign.host_user_id !== opts.userId) {
    throw new Error(TRPG_BILLING_MODE_FORBIDDEN_MESSAGE);
  }
  const current = (campaign.billing_mode as TrpgBillingMode) || DEFAULT_TRPG_BILLING_MODE;
  const started = !isTrpgLobbyStatus(campaign.status);
  if (!canChangeTrpgBillingMode({ current, next: opts.billingMode, started })) {
    throw new Error(TRPG_BILLING_MODE_LOCKED_MESSAGE);
  }
  if (current === opts.billingMode) return;
  db.prepare(`UPDATE trpg_campaigns SET billing_mode=?, updated_at=datetime('now') WHERE id=?`).run(
    opts.billingMode,
    opts.campaignId
  );
}
