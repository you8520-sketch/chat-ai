/**
 * Deterministic completion-integrity candidate adapter.
 * Reuses canonical Main RP helpers — does NOT invent a competing heuristic.
 */
import {
  endsIncomplete,
  isTokenLimitFinish,
  needsResponseLengthFix,
} from "@/lib/responseLength";
import type { CompletionIntegrityFixture } from "@/lib/completionIntegrityCorpus";

export type CompletionCandidateReason =
  | "endsIncomplete"
  | "needsResponseLengthFix"
  | "tokenLimitFinish"
  | "localRecoveryApplied"
  | "missingFinishReasonIncomplete";

export type CompletionCandidateResult = {
  candidate: boolean;
  reasons: CompletionCandidateReason[];
};

/** High-recall candidate discovery from existing owners + fixture recovery flags. */
export function evaluateCompletionIntegrityCandidate(input: {
  finalProse: string;
  finishReason: string | null;
  localRecoveryApplied: boolean;
}): CompletionCandidateResult {
  const reasons: CompletionCandidateReason[] = [];
  const prose = input.finalProse;
  const finish = input.finishReason ?? undefined;

  if (endsIncomplete(prose)) reasons.push("endsIncomplete");
  if (needsResponseLengthFix(prose, finish)) reasons.push("needsResponseLengthFix");
  if (isTokenLimitFinish(finish)) reasons.push("tokenLimitFinish");
  if (input.localRecoveryApplied) reasons.push("localRecoveryApplied");
  if (!input.finishReason && endsIncomplete(prose)) {
    if (!reasons.includes("missingFinishReasonIncomplete")) {
      reasons.push("missingFinishReasonIncomplete");
    }
  }

  // Deduplicate while preserving order
  const unique = [...new Set(reasons)];
  return { candidate: unique.length > 0, reasons: unique };
}

export function evaluateFixtureCompletionCandidate(
  fixture: CompletionIntegrityFixture
): CompletionCandidateResult {
  return evaluateCompletionIntegrityCandidate({
    finalProse: fixture.finalProse,
    finishReason: fixture.finishReason,
    localRecoveryApplied: fixture.localRecoveryApplied,
  });
}
