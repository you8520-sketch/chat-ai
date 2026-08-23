/**
 * Client stream EOF reconciliation — when the SSE body closes without
 * `done` / `error`, re-check the server message row before clearing UI lock.
 */

import {
  hasPostProcessPhaseEvidence,
  type PostProcessPhaseEvidence,
} from "@/lib/chatStreamPostProcessEvidence";
import {
  isInFlightGenerationStatus,
  isTerminalGenerationStatus,
  type GenerationStatus,
} from "@/lib/streamingPersistence";
import type { SuggestedReplyItem } from "@/lib/suggestedReplies/types";

/** Matches resolveOpenRouterCompletionTimeoutMs("background-status-widget-extract") default. */
export const EOF_RECONCILE_BACKGROUND_POSTPROCESS_DEADLINE_MS = 120_000;

export type StreamTerminalFlags = {
  sawDone: boolean;
  sawError: boolean;
};

/**
 * Short retries for true interruptions / pre-postprocess EOF.
 * attempts=6 · retry=350ms → sleeps between polls = 5×350 = 1750ms max
 */
export const EOF_RECONCILE_MAX_ATTEMPTS = 6;
export const EOF_RECONCILE_RETRY_MS = 350;

/** Substantial RP prose threshold for extended reconcile eligibility. */
export const EOF_RECONCILE_SUBSTANTIAL_PROSE_MIN_CHARS = 400;

/**
 * Extended reconcile budget — secondary safety net when terminal SSE is lost
 * AFTER post-process evidence was observed.
 *
 * Derived from background-status-widget-extract completion timeout (120s) and
 * chat 707 observed post-main finalize (~55s). Heartbeats are the primary
 * defense; 60s sleep budget covers observed finalize + DB write margin without
 * the prior 116s prose-only window.
 */
export const EOF_RECONCILE_EXTENDED_RETRY_MS = 4000;
export const EOF_RECONCILE_EXTENDED_MAX_ATTEMPTS = 16;
export const EOF_RECONCILE_EXTENDED_MAX_SLEEP_MS =
  (EOF_RECONCILE_EXTENDED_MAX_ATTEMPTS - 1) * EOF_RECONCILE_EXTENDED_RETRY_MS;

export const EOF_RECONCILE_TRUE_INTERRUPTION_MAX_SLEEP_MS =
  (EOF_RECONCILE_MAX_ATTEMPTS - 1) * EOF_RECONCILE_RETRY_MS;

/** Max cumulative sleep between polls (excludes fetch latency). */
export function eofReconcileMaxSleepMs(
  maxAttempts: number = EOF_RECONCILE_MAX_ATTEMPTS,
  retryMs: number = EOF_RECONCILE_RETRY_MS
): number {
  return Math.max(0, maxAttempts - 1) * retryMs;
}

export function resolveEofReconcilePollBudget(opts: {
  snapshotContentChars?: number;
  streamedContentChars?: number;
  postProcessPhaseObserved?: boolean;
  postProcessEvidence?: PostProcessPhaseEvidence | null;
}): { maxAttempts: number; retryMs: number; extended: boolean } {
  const chars = Math.max(opts.snapshotContentChars ?? 0, opts.streamedContentChars ?? 0);
  const substantial = chars >= EOF_RECONCILE_SUBSTANTIAL_PROSE_MIN_CHARS;
  const postProcessObserved =
    opts.postProcessPhaseObserved === true ||
    hasPostProcessPhaseEvidence(opts.postProcessEvidence);
  const extended = substantial && postProcessObserved;

  if (extended) {
    return {
      maxAttempts: EOF_RECONCILE_EXTENDED_MAX_ATTEMPTS,
      retryMs: EOF_RECONCILE_EXTENDED_RETRY_MS,
      extended: true,
    };
  }
  return {
    maxAttempts: EOF_RECONCILE_MAX_ATTEMPTS,
    retryMs: EOF_RECONCILE_RETRY_MS,
    extended: false,
  };
}

export function needsEofReconcile(flags: StreamTerminalFlags): boolean {
  return !flags.sawDone && !flags.sawError;
}

export type EofReconcileSnapshot = {
  messageId: number;
  chatId: number;
  generationStatus: string;
  content: string;
  usage: unknown;
  variants?: unknown;
  activeVariant?: number;
  variantCount?: number;
  statusWidgetValues?: unknown;
  statusWidgetTurnActive?: boolean;
  statusMetaPending?: boolean;
  statusMetaRequested?: boolean;
  suggestedRepliesPending?: boolean;
  suggestedReplies?: SuggestedReplyItem[];
  userMessageId?: number | null;
  model?: string;
};

export type EofReconcileResult =
  | { kind: "completed"; snapshot: EofReconcileSnapshot; fetchCount: number }
  | {
      kind: "terminal";
      status: string;
      snapshot: EofReconcileSnapshot;
      fetchCount: number;
    }
  | {
      kind: "interrupted";
      reason: "missing_message_id" | "still_generating" | "fetch_failed";
      fetchCount: number;
      snapshot?: EofReconcileSnapshot | null;
    };

function normalizeStatus(status: string | null | undefined): string {
  return (status ?? "").trim().toLowerCase();
}

function isCompletedStatus(status: string): boolean {
  return (
    status === "completed" ||
    status === "ok" ||
    status === "completed_with_postprocess_error"
  );
}

function isFailedLikeStatus(status: string): boolean {
  return status === "failed" || status === "failed_partial" || status === "interrupted";
}

export function classifyReconcileStatus(
  generationStatus: string | null | undefined
): "completed" | "failed_like" | "in_flight" | "unknown" {
  const s = normalizeStatus(generationStatus);
  if (isCompletedStatus(s)) return "completed";
  if (isFailedLikeStatus(s)) return "failed_like";
  if (isInFlightGenerationStatus(s) || s === "") return "in_flight";
  if (isTerminalGenerationStatus(s)) return "failed_like";
  return "unknown";
}

export async function reconcileStreamEof(opts: {
  messageId: number | null | undefined;
  fetchSnapshot: (messageId: number) => Promise<EofReconcileSnapshot | null>;
  sleep?: (ms: number) => Promise<void>;
  maxAttempts?: number;
  retryMs?: number;
  streamedContentChars?: number;
  postProcessPhaseObserved?: boolean;
  postProcessEvidence?: PostProcessPhaseEvidence | null;
}): Promise<EofReconcileResult> {
  const messageId = opts.messageId != null && Number.isFinite(opts.messageId) ? Number(opts.messageId) : null;
  if (messageId == null || messageId <= 0) {
    return { kind: "interrupted", reason: "missing_message_id", fetchCount: 0 };
  }

  const pollBudget =
    opts.maxAttempts != null && opts.retryMs != null
      ? {
          maxAttempts: opts.maxAttempts,
          retryMs: opts.retryMs,
          extended: opts.maxAttempts > EOF_RECONCILE_MAX_ATTEMPTS,
        }
      : resolveEofReconcilePollBudget({
          streamedContentChars: opts.streamedContentChars,
          postProcessPhaseObserved: opts.postProcessPhaseObserved,
          postProcessEvidence: opts.postProcessEvidence,
        });
  const maxAttempts = opts.maxAttempts ?? pollBudget.maxAttempts;
  const retryMs = opts.retryMs ?? pollBudget.retryMs;
  const sleep = opts.sleep ?? ((ms: number) => new Promise((r) => setTimeout(r, ms)));

  let lastSnapshot: EofReconcileSnapshot | null = null;
  let fetchCount = 0;

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    if (attempt > 0) await sleep(retryMs);
    let snapshot: EofReconcileSnapshot | null = null;
    try {
      snapshot = await opts.fetchSnapshot(messageId);
      fetchCount += 1;
    } catch {
      fetchCount += 1;
      snapshot = null;
    }
    if (!snapshot) continue;
    lastSnapshot = snapshot;

    const cls = classifyReconcileStatus(snapshot.generationStatus);
    if (cls === "completed") {
      return { kind: "completed", snapshot, fetchCount };
    }
    if (cls === "failed_like") {
      return {
        kind: "terminal",
        status: normalizeStatus(snapshot.generationStatus) || "interrupted",
        snapshot,
        fetchCount,
      };
    }
    // in_flight / unknown → retry
  }

  if (lastSnapshot && classifyReconcileStatus(lastSnapshot.generationStatus) === "in_flight") {
    return {
      kind: "interrupted",
      reason: "still_generating",
      fetchCount,
      snapshot: lastSnapshot,
    };
  }

  return {
    kind: "interrupted",
    reason: lastSnapshot ? "still_generating" : "fetch_failed",
    fetchCount,
    snapshot: lastSnapshot,
  };
}

/** Map reconcile outcome to a client generationStatus. */
export function generationStatusFromEofResult(
  result: EofReconcileResult
): GenerationStatus {
  if (result.kind === "completed") return "completed";
  if (result.kind === "terminal") {
    const s = normalizeStatus(result.status);
    if (s === "failed" || s === "failed_partial" || s === "interrupted") {
      return s as GenerationStatus;
    }
    return "interrupted";
  }
  return "interrupted";
}
