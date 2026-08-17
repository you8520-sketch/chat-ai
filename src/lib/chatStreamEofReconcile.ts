/**
 * Client stream EOF reconciliation — when the SSE body closes without
 * `done` / `error`, re-check the server message row before clearing UI lock.
 */

import {
  isInFlightGenerationStatus,
  isTerminalGenerationStatus,
  type GenerationStatus,
} from "@/lib/streamingPersistence";
import type { SuggestedReplyItem } from "@/lib/suggestedReplies/types";

export type StreamTerminalFlags = {
  sawDone: boolean;
  sawError: boolean;
};

/**
 * Short retries while server may still be finalizing (status widget / DB write).
 * attempts=6 · retry=350ms → sleeps between polls = 5×350 = 1750ms max
 * (covers status-widget finalize that lands slightly after the prior 1050ms budget).
 */
export const EOF_RECONCILE_MAX_ATTEMPTS = 6;
export const EOF_RECONCILE_RETRY_MS = 350;

/**
 * Longer poll after the SSE transport drops during post-process
 * (status-widget extract LLM + episodic fact persist + finalize).
 * attempts=40 · retry=1000ms → 39s sleep budget (plus fetch latency).
 */
export const EOF_RECONCILE_POSTPROCESS_MAX_ATTEMPTS = 40;
export const EOF_RECONCILE_POSTPROCESS_RETRY_MS = 1000;

/** Max cumulative sleep between polls (excludes fetch latency). */
export function eofReconcileMaxSleepMs(
  maxAttempts: number = EOF_RECONCILE_MAX_ATTEMPTS,
  retryMs: number = EOF_RECONCILE_RETRY_MS
): number {
  return Math.max(0, maxAttempts - 1) * retryMs;
}

export function needsEofReconcile(flags: StreamTerminalFlags): boolean {
  return !flags.sawDone && !flags.sawError;
}

/**
 * Whether to poll `/api/chat/message` for finalize after the SSE ends.
 * Transport drops during post-process must still recover widget values even when
 * the client catch set a streamError (otherwise soft-rollback hides widgets).
 */
export function shouldRecoverStreamFinalize(flags: {
  sawDone: boolean;
  sawError: boolean;
  /** Client reader/decode threw (not SSE `type:error`). */
  streamTransportFailed?: boolean;
  hasPersistedMessageId: boolean;
}): boolean {
  if (flags.sawDone) return false;
  if (!flags.hasPersistedMessageId) return false;
  if (flags.streamTransportFailed) return true;
  return needsEofReconcile({ sawDone: flags.sawDone, sawError: flags.sawError });
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
}): Promise<EofReconcileResult> {
  const messageId = opts.messageId != null && Number.isFinite(opts.messageId) ? Number(opts.messageId) : null;
  if (messageId == null || messageId <= 0) {
    return { kind: "interrupted", reason: "missing_message_id", fetchCount: 0 };
  }

  const maxAttempts = opts.maxAttempts ?? EOF_RECONCILE_MAX_ATTEMPTS;
  const retryMs = opts.retryMs ?? EOF_RECONCILE_RETRY_MS;
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
