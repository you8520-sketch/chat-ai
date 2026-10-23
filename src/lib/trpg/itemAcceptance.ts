import type Database from "better-sqlite3";
import { hangulObjectParticle } from "./commandDock";
import { TRPG_INVENTORY_ITEM_NAME_LIMIT } from "./inventory";
import { parseJson } from "./store";
import type { TrpgStateDelta } from "./types";

/**
 * Human PC item ownership contract.
 *
 * GM output is a proposal (`itemOffers`), the player's submit is the acceptance
 * (`acceptItems`), and the server commit is ownership. A GM `inventoryAdd` for a
 * human PC is never ownership authority; AI companion seats keep that path.
 */

export const TRPG_ITEM_OFFER_MAX_PER_SEAT = 4;
export const TRPG_ACCEPT_ITEMS_MAX = TRPG_ITEM_OFFER_MAX_PER_SEAT;

export type TrpgSeatItemOffers = { fromRound: number; items: string[] };

export type TrpgAcceptItemRequest = { name: string; fromRound: number };

export type TrpgAcceptedItems = { fromRound: number; items: string[] };

type DeltaPlayer = TrpgStateDelta["players"][number];

/** Single normalization owner: trim, collapse whitespace, length limit, dedupe, cap. */
export function normalizeTrpgItemOffers(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  const seen = new Set<string>();
  const items: string[] = [];
  for (const entry of raw) {
    if (typeof entry !== "string") continue;
    const name = entry.replace(/\s+/g, " ").trim();
    if (!name || name.length > TRPG_INVENTORY_ITEM_NAME_LIMIT || seen.has(name)) continue;
    seen.add(name);
    items.push(name);
    if (items.length >= TRPG_ITEM_OFFER_MAX_PER_SEAT) break;
  }
  return items;
}

export function ensureDeltaPlayer(delta: TrpgStateDelta, participantId: number): DeltaPlayer {
  const existing = delta.players.find((row) => row.participantId === participantId);
  if (existing) return existing;
  const created: DeltaPlayer = { participantId };
  delta.players.push(created);
  return created;
}

function committedOffersFromDelta(delta: TrpgStateDelta | undefined, participantId: number): string[] {
  const patch = delta?.players?.find((row) => row.participantId === participantId);
  return normalizeTrpgItemOffers(patch?.itemOffers);
}

/**
 * Offers a human seat may accept this round: the previous committed round's own-seat
 * offers only. A round without a committed GM message offers nothing.
 */
export function loadTrpgSeatItemOffers(
  db: Database.Database,
  campaignId: number,
  currentRoundNumber: number,
  participantId: number
): TrpgSeatItemOffers | null {
  const fromRound = currentRoundNumber - 1;
  if (fromRound < 0) return null;
  const row = db
    .prepare(
      `SELECT g.structured_json FROM trpg_gm_messages g
       JOIN trpg_rounds r ON r.id = g.round_id
       WHERE r.campaign_id=? AND r.round_number=?`
    )
    .get(campaignId, fromRound) as { structured_json: string | null } | undefined;
  if (!row?.structured_json) return null;
  const stored = parseJson<{ delta?: TrpgStateDelta } | null>(row.structured_json, null);
  const items = committedOffersFromDelta(stored?.delta, participantId);
  return items.length > 0 ? { fromRound, items } : null;
}

export function parseTrpgAcceptItemsRequest(raw: unknown): TrpgAcceptItemRequest[] {
  if (raw == null) return [];
  if (!Array.isArray(raw) || raw.length > TRPG_ACCEPT_ITEMS_MAX) {
    throw new Error("받을 아이템 요청이 올바르지 않습니다.");
  }
  return raw.map((entry) => {
    const row = entry && typeof entry === "object" ? (entry as Record<string, unknown>) : null;
    const name = typeof row?.name === "string" ? row.name.replace(/\s+/g, " ").trim() : "";
    const fromRound = row?.fromRound;
    if (!name || typeof fromRound !== "number" || !Number.isInteger(fromRound)) {
      throw new Error("받을 아이템 요청이 올바르지 않습니다.");
    }
    return { name, fromRound };
  });
}

/** Binds each requested name to the source round and this seat's own committed offers. */
export function resolveTrpgItemAcceptance(
  offers: TrpgSeatItemOffers | null,
  requested: readonly TrpgAcceptItemRequest[]
): TrpgAcceptedItems | null {
  if (requested.length === 0) return null;
  if (!offers) throw new Error("받을 수 있는 아이템 제안이 없습니다.");
  const items: string[] = [];
  for (const entry of requested) {
    if (entry.fromRound !== offers.fromRound) {
      throw new Error("아이템 제안이 지난 장면의 것입니다. 화면을 새로고침하세요.");
    }
    if (!offers.items.includes(entry.name)) {
      throw new Error(`"${entry.name}"은(는) 이번에 제안받은 아이템이 아닙니다.`);
    }
    if (!items.includes(entry.name)) items.push(entry.name);
  }
  return { fromRound: offers.fromRound, items };
}

export function serializeAcceptedItems(accepted: TrpgAcceptedItems | null): string | null {
  return accepted && accepted.items.length > 0 ? JSON.stringify(accepted) : null;
}

export function parseStoredAcceptedItems(raw: string | null | undefined): TrpgAcceptedItems | null {
  const stored = parseJson<{ fromRound?: unknown; items?: unknown } | null>(raw, null);
  if (!stored || typeof stored.fromRound !== "number") return null;
  const items = normalizeTrpgItemOffers(stored.items);
  return items.length > 0 ? { fromRound: stored.fromRound, items } : null;
}

/** Server-composed action sentence for an accept-only submit. */
export function formatAcceptedItemsAction(items: readonly string[]): string {
  return `${items.map((name) => `${name}${hangulObjectParticle(name)}`).join(", ")} 받는다.`;
}

/**
 * Commit boundary, before server exploration results are applied: human seats
 * lose GM-proposed `inventoryAdd`; AI seats lose `itemOffers`. Idempotent.
 */
export function stripUnacceptedItemProposals(delta: TrpgStateDelta, humanSeatIds: ReadonlySet<number>): void {
  for (const patch of delta.players) {
    if (humanSeatIds.has(patch.participantId)) {
      delete patch.inventoryAdd;
      if (patch.itemOffers) patch.itemOffers = normalizeTrpgItemOffers(patch.itemOffers);
      if (!patch.itemOffers?.length) delete patch.itemOffers;
    } else {
      delete patch.itemOffers;
    }
  }
}

/**
 * Commit boundary, after server exploration results: appends this round's
 * server-validated acceptances. Same-name items stack through the normal
 * inventory merge (+1 per valid acquisition).
 */
export function grantAcceptedItems(delta: TrpgStateDelta, accepted: ReadonlyMap<number, readonly string[]>): void {
  for (const [participantId, items] of accepted) {
    if (items.length === 0) continue;
    const patch = ensureDeltaPlayer(delta, participantId);
    const have = new Set(patch.inventoryAdd ?? []);
    for (const name of items) {
      if (have.has(name)) continue;
      patch.inventoryAdd = [...(patch.inventoryAdd ?? []), name];
      have.add(name);
    }
  }
}

/**
 * Regen restates committed human item facts. The rewrite can neither add, drop nor
 * swap offers or grants, so its own values for human seats are discarded.
 */
export function restoreCommittedHumanItemFacts(
  delta: TrpgStateDelta,
  committedDelta: TrpgStateDelta | undefined,
  humanSeatIds: ReadonlySet<number>
): void {
  for (const participantId of humanSeatIds) {
    const committed = committedDelta?.players?.find((row) => row.participantId === participantId);
    const offers = normalizeTrpgItemOffers(committed?.itemOffers);
    const added = committed?.inventoryAdd?.length ? [...committed.inventoryAdd] : [];
    const live = delta.players.filter((row) => row.participantId === participantId);
    if (offers.length === 0 && added.length === 0 && live.length === 0) continue;
    const patch = live[0] ?? ensureDeltaPlayer(delta, participantId);
    for (const row of live) {
      delete row.itemOffers;
      delete row.inventoryAdd;
    }
    if (offers.length) patch.itemOffers = offers;
    if (added.length) patch.inventoryAdd = added;
  }
}

/** Committed own-seat offers of one round, for the regenerate committed-facts block. */
export function loadCommittedItemOffersByParticipant(
  db: Database.Database,
  roundId: number
): Map<number, string[]> {
  const row = db.prepare(`SELECT structured_json FROM trpg_gm_messages WHERE round_id=?`).get(roundId) as
    | { structured_json: string | null }
    | undefined;
  const stored = parseJson<{ delta?: TrpgStateDelta } | null>(row?.structured_json, null);
  const byParticipant = new Map<number, string[]>();
  for (const patch of stored?.delta?.players ?? []) {
    const items = normalizeTrpgItemOffers(patch.itemOffers);
    if (items.length > 0) byParticipant.set(patch.participantId, items);
  }
  return byParticipant;
}
