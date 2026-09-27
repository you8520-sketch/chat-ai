/**
 * Research ledger — durable dedupe / rejection memory across cycles.
 * Persisted as JSON on the `memory-research-ledger` data branch (never merged
 * into main, never read by production).
 */
import type { ResearchCandidate } from "@/lib/memoryResearch/types";

export const LEDGER_SCHEMA_VERSION = 1;
export const LEDGER_CYCLE_HISTORY_LIMIT = 104;

export type LedgerCycleEntry = {
  cycleKey: string;
  mode: string;
  finishedAt: string;
  mainSha: string;
  counts: Record<string, number>;
};

export type ResearchLedger = {
  schemaVersion: typeof LEDGER_SCHEMA_VERSION;
  candidates: Record<string, ResearchCandidate>;
  cycles: LedgerCycleEntry[];
};

export function emptyLedger(): ResearchLedger {
  return { schemaVersion: LEDGER_SCHEMA_VERSION, candidates: {}, cycles: [] };
}

export function parseLedger(json: string | null): ResearchLedger {
  if (json === null || json.trim() === "") return emptyLedger();
  const parsed = JSON.parse(json) as Partial<ResearchLedger>;
  if (parsed.schemaVersion !== LEDGER_SCHEMA_VERSION) {
    throw new Error(`unsupported research ledger schemaVersion ${String(parsed.schemaVersion)}`);
  }
  if (typeof parsed.candidates !== "object" || parsed.candidates === null || !Array.isArray(parsed.cycles)) {
    throw new Error("malformed research ledger");
  }
  return parsed as ResearchLedger;
}

export function serializeLedger(ledger: ResearchLedger): string {
  const candidates: ResearchLedger["candidates"] = {};
  for (const key of Object.keys(ledger.candidates).sort()) candidates[key] = ledger.candidates[key]!;
  return `${JSON.stringify({ ...ledger, candidates, cycles: ledger.cycles.slice(-LEDGER_CYCLE_HISTORY_LIMIT) }, null, 2)}\n`;
}

export type DraftPrResult = { candidateKey: string; url: string | null; error: string | null };
export type ImplementationPrResultRecord = { candidateKey: string; url: string | null; error: string | null };

/** Records Draft PR outcomes; failures leave `draftPrUrl` null so the next cycle re-emits the packet. */
export function applyDraftPrResults(ledger: ResearchLedger, results: readonly DraftPrResult[]): ResearchLedger {
  const candidates = { ...ledger.candidates };
  for (const r of results) {
    const c = candidates[r.candidateKey];
    if (!c || c.state !== "ACCEPTED" || !r.url) continue;
    candidates[r.candidateKey] = { ...c, draftPrUrl: r.url };
  }
  return { ...ledger, candidates };
}


/** Records implementation Draft PR outcomes without changing the candidate decision/state. */
export function applyImplementationPrResults(
  ledger: ResearchLedger,
  results: readonly ImplementationPrResultRecord[]
): ResearchLedger {
  const candidates = { ...ledger.candidates };
  for (const result of results) {
    const candidate = candidates[result.candidateKey];
    if (
      !candidate ||
      candidate.state !== "WATCH" ||
      candidate.lastDecision !== "WATCH_IMPLEMENTATION_PR_PENDING" ||
      !result.url
    ) {
      continue;
    }
    candidates[result.candidateKey] = { ...candidate, implementationPrUrl: result.url };
  }
  return { ...ledger, candidates };
}
