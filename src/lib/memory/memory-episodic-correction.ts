/**
 * Episodic correction link contract — the single owner of "which stored record does this
 * user correction replace". The server shows the extractor a bounded list of past records
 * under opaque handles; the extractor may only copy one of those handles, the server resolves
 * it to a fact id and validates it at save time, and retrieval substitutes exactly that record.
 * A shared logical key alone never makes a correction.
 */
import { readVerifiedEvidence } from "./memory-episodic-evidence";

export const EPISODIC_CORRECTION_CANDIDATE_LIMIT = 6;

/** Fixed wire enum (stable schema); the server rejects handles that were not offered this turn. */
export const EPISODIC_CORRECTION_HANDLES = [
  "",
  ...Array.from({ length: EPISODIC_CORRECTION_CANDIDATE_LIMIT }, (_, index) => `C${index + 1}`),
] as const;

export type EpisodicCorrectionCandidate = {
  handle: string;
  factId: number;
  sourceTurn: number;
  factText: string;
  quote: string | null;
};

/**
 * Stored in the correcting row's metadata as `correction`. `root_*` names the record the whole
 * chain started from (copied from the target's own link at save), so every correction of one
 * event shares one group however long the chain grows or whichever member is later removed.
 */
export type EpisodicCorrectionLink = {
  target_fact_id: number;
  target_source_turn: number;
  root_fact_id: number;
  root_source_turn: number;
};

export function buildEpisodicCorrectionHandleMap(
  candidates: readonly EpisodicCorrectionCandidate[] | null | undefined
): Map<string, number> {
  const map = new Map<string, number>();
  for (const candidate of candidates ?? []) map.set(candidate.handle, candidate.factId);
  return map;
}

export function formatEpisodicCorrectionCandidatesBlock(
  candidates: readonly EpisodicCorrectionCandidate[] | null | undefined
): string {
  const header = "[CORRECTABLE PAST RECORDS — episodic corrects may only copy one of these handles]";
  const list = candidates ?? [];
  if (list.length === 0) return `${header}\n(none → corrects "")`;
  return [
    header,
    ...list.map((candidate) =>
      `- ${candidate.handle} [T${candidate.sourceTurn}] ${candidate.factText}${candidate.quote ? ` (source: “${candidate.quote}”)` : ""}`
    ),
  ].join("\n");
}

function positiveInt(value: unknown): number | null {
  const n = Number(value);
  return Number.isInteger(n) && n > 0 ? n : null;
}

export function readEpisodicCorrectionLink(
  metadata: string | null | undefined
): EpisodicCorrectionLink | null {
  if (!metadata) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(metadata);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
  const link = (parsed as Record<string, unknown>).correction;
  if (!link || typeof link !== "object" || Array.isArray(link)) return null;
  const record = link as Record<string, unknown>;
  const targetFactId = positiveInt(record.target_fact_id);
  const targetSourceTurn = positiveInt(record.target_source_turn);
  if (targetFactId == null || targetSourceTurn == null) return null;
  const rootFactId = positiveInt(record.root_fact_id) ?? targetFactId;
  const rootSourceTurn = positiveInt(record.root_source_turn) ?? targetSourceTurn;
  if (rootSourceTurn > targetSourceTurn) return null;
  return {
    target_fact_id: targetFactId,
    target_source_turn: targetSourceTurn,
    root_fact_id: rootFactId,
    root_source_turn: rootSourceTurn,
  };
}

/**
 * A stored row corrects its linked target only when its own quote was verified against the
 * user's message (USER_EXPLICIT) and the target is earlier. Verification of the quote proves
 * the user said it; the link says which record it replaces.
 */
export function readValidEpisodicCorrectionLink(row: {
  metadata: string | null;
  source_turn: number;
}): EpisodicCorrectionLink | null {
  const link = readEpisodicCorrectionLink(row.metadata);
  if (!link || link.target_source_turn >= row.source_turn) return null;
  const evidence = readVerifiedEvidence(row.metadata);
  if (evidence?.role !== "user" || evidence.authority !== "USER_EXPLICIT") return null;
  return link;
}
