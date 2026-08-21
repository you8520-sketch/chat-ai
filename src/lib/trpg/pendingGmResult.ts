import type Database from "better-sqlite3";
import type { ParsedTrpgGmOutput } from "./gmPrompt";
import {
  parsePostGmOngoingPromotions,
  type PostGmOngoingPromotion,
} from "./postGmOngoing";

export type TrpgPendingGmResult = {
  v: 1;
  narration: string;
  location: string | null;
  campaignFinished: boolean;
  nextRoundContext: string;
  delta: ParsedTrpgGmOutput["delta"];
  postGmOngoingPromotions: PostGmOngoingPromotion[];
};

export function toPendingGmResult(
  parsed: ParsedTrpgGmOutput,
  postGmOngoingPromotions: readonly PostGmOngoingPromotion[] = []
): TrpgPendingGmResult {
  return {
    v: 1,
    narration: parsed.narration,
    location: parsed.location,
    campaignFinished: parsed.campaignFinished === true,
    nextRoundContext: parsed.nextRoundContext ?? "",
    delta: parsed.delta,
    postGmOngoingPromotions: [...postGmOngoingPromotions],
  };
}

export function parsedFromPending(pending: TrpgPendingGmResult): ParsedTrpgGmOutput {
  return {
    narration: pending.narration,
    location: pending.location,
    campaignFinished: pending.campaignFinished,
    nextRoundContext: pending.nextRoundContext,
    delta: pending.delta,
  };
}

export function savePendingGmResult(
  db: Database.Database,
  roundId: number,
  parsed: ParsedTrpgGmOutput,
  postGmOngoingPromotions: readonly PostGmOngoingPromotion[] = []
): void {
  db.prepare(`UPDATE trpg_rounds SET pending_gm_result_json=? WHERE id=?`).run(
    JSON.stringify(toPendingGmResult(parsed, postGmOngoingPromotions)),
    roundId
  );
}

export function clearPendingGmResult(db: Database.Database, roundId: number): void {
  db.prepare(`UPDATE trpg_rounds SET pending_gm_result_json=NULL WHERE id=?`).run(roundId);
}

export function loadPendingGmResult(db: Database.Database, roundId: number): TrpgPendingGmResult | null {
  const row = db.prepare(`SELECT pending_gm_result_json FROM trpg_rounds WHERE id=?`).get(roundId) as
    | { pending_gm_result_json: string | null }
    | undefined;
  const raw = row?.pending_gm_result_json?.trim();
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as Partial<TrpgPendingGmResult>;
    if (parsed.v !== 1 || typeof parsed.narration !== "string") return null;
    return {
      v: 1,
      narration: parsed.narration,
      location: typeof parsed.location === "string" ? parsed.location : null,
      campaignFinished: parsed.campaignFinished === true,
      nextRoundContext: typeof parsed.nextRoundContext === "string" ? parsed.nextRoundContext : "",
      delta: parsed.delta && typeof parsed.delta === "object" ? parsed.delta : { players: [] },
      postGmOngoingPromotions: parsePostGmOngoingPromotions(parsed.postGmOngoingPromotions),
    };
  } catch {
    return null;
  }
}

export function hasPendingGmResult(db: Database.Database, roundId: number): boolean {
  return loadPendingGmResult(db, roundId) != null;
}
