import {
  extractUniqueRecoveryTail,
  isRecoveryEchoMerge,
} from "@/lib/antiRepetition";
import { visibleAssistantDisplayCharCount } from "@/lib/chatDisplayLength";
import {
  capRecoveryContinuation,
  finalizeRecoveryMerge,
  type RecoveryMergeOpts,
} from "@/lib/responseLength";
import { preserveStreamFirstContinuationMerge } from "@/lib/streamFirstSave";
import { extractProseWithoutHtml } from "@/lib/htmlVisualCardRecovery";

export type RecoveryMergeRejectReason =
  | "echo_detected"
  | "empty_response"
  | "cap_exceeded"
  | "sanitize_stripped"
  | "stream_first_rejected"
  | "duplicate_tail_stripped"
  | null;

export type RecoveryMergeTrace = {
  recoveryRaw: string;
  dedupedTail: string;
  cappedTail: string;
  mergedAfterFinalize: string;
  clean: string;
  finalProse: string;
  rejectReason: RecoveryMergeRejectReason;
};

/** Step-through recovery merge — pinpoints silent discard (finalizeRecoveryMerge, tail dedupe, etc.). */
export function traceRecoveryMerge(opts: {
  prior: string;
  recoveryRaw: string;
  targetResponseChars?: number | null;
  mergeOpts?: RecoveryMergeOpts;
}): RecoveryMergeTrace {
  const prior = opts.prior.trim();
  const raw = opts.recoveryRaw ?? "";
  const mergeOpts = opts.mergeOpts ?? {};
  const dedupedTail = extractUniqueRecoveryTail(prior, raw, mergeOpts);
  const cappedTail = capRecoveryContinuation(prior, raw, opts.targetResponseChars, mergeOpts);
  const mergedCandidate = prior + cappedTail;
  const mergedAfterFinalize = finalizeRecoveryMerge(prior, mergedCandidate, mergeOpts);
  const clean = extractProseWithoutHtml(mergedAfterFinalize) || mergedAfterFinalize.trim();
  const finalProse = preserveStreamFirstContinuationMerge(
    prior,
    clean,
    opts.targetResponseChars
  );

  const rejectReason = determineRecoveryMergeRejectReason({
    prior,
    recoveryRaw: raw,
    dedupedTail,
    cappedTail,
    mergedAfterFinalize,
    clean,
    finalProse,
    mergeOpts,
    targetResponseChars: opts.targetResponseChars,
  });

  return {
    recoveryRaw: raw,
    dedupedTail,
    cappedTail,
    mergedAfterFinalize,
    clean,
    finalProse,
    rejectReason,
  };
}

export function determineRecoveryMergeRejectReason(opts: {
  prior: string;
  recoveryRaw: string;
  dedupedTail: string;
  cappedTail: string;
  mergedAfterFinalize: string;
  clean: string;
  finalProse: string;
  mergeOpts?: RecoveryMergeOpts;
  targetResponseChars?: number | null;
}): RecoveryMergeRejectReason {
  const prior = opts.prior.trim();
  const raw = opts.recoveryRaw.trim();
  const before = visibleAssistantDisplayCharCount(prior);
  const after = visibleAssistantDisplayCharCount(opts.finalProse);

  if (after > before) return null;

  if (!raw) return "empty_response";

  if (!opts.dedupedTail.trim()) return "duplicate_tail_stripped";

  if (opts.dedupedTail.trim() && !opts.cappedTail.trim()) {
    return "duplicate_tail_stripped";
  }

  const mergedCandidate = prior + opts.cappedTail;
  if (
    opts.cappedTail.trim() &&
    opts.mergedAfterFinalize.trim() === prior &&
    isRecoveryEchoMerge(prior, mergedCandidate, opts.mergeOpts)
  ) {
    return "echo_detected";
  }

  if (opts.cappedTail.trim() && opts.mergedAfterFinalize.trim() === prior) {
    return "echo_detected";
  }

  const mergedChars = visibleAssistantDisplayCharCount(opts.mergedAfterFinalize);
  const cleanChars = visibleAssistantDisplayCharCount(opts.clean);
  if (mergedChars > cleanChars + 20) return "sanitize_stripped";

  const cleanGain = cleanChars > before;
  if (cleanGain && after <= before) return "stream_first_rejected";

  if (opts.mergedAfterFinalize.length > prior.length && opts.finalProse.length <= prior.length) {
    return "stream_first_rejected";
  }

  return "duplicate_tail_stripped";
}
