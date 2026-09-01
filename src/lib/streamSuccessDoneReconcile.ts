/**
 * Success-path server done → visual reveal reconciliation.
 * NETWORK_DONE != VISUAL_REVEAL_DONE — never instant-snap full finalContent while reveal pending.
 *
 * Owner contract (appendStreamText):
 *   provider chunk → sessionTargetText += chunk → reveal.enqueue(chunk)
 * UI reveal may lag: sessionDisplayedText < sessionTargetText.
 * The undisplayed suffix (streamTarget − displayed) is already queue-owned.
 */

import {
  collapseStreamCompareText,
  preferDisplayedNewlineLayout,
  resolveStreamAppendTail,
} from "@/lib/streamReveal";

export const SUCCESS_DONE_FINAL_RECONCILE_OWNER =
  "planSuccessDoneFinalContentReveal() in streamSuccessDoneReconcile.ts";

export type SuccessDoneFinalRevealPlan =
  | { action: "noop"; reason: string }
  | { action: "enqueue"; enqueue: string; reason: string }
  | { action: "defer_canonical"; reason: string };

export type SuccessDoneRevealDiagnostics = {
  doneReceived: true;
  displayedLenAtDone: number;
  targetLenAtDone: number;
  finalContentLen: number;
  revealIdleAtDone: boolean;
  visualRevealPendingAtDone: boolean;
  finalVsTargetExactMatch: boolean;
  finalVsTargetCollapsedMatch: boolean;
  finalVsDisplayedCollapsedPrefix: boolean;
  queueOwnedGapLen: number;
  newEnqueueLen: number;
  reconcilePlan: SuccessDoneFinalRevealPlan["action"];
  reconcileReason: string;
};

export function planSuccessDoneFinalContentReveal(input: {
  displayed: string;
  streamTarget: string;
  finalContent: string;
  priorTarget?: string;
  revealIdle: boolean;
  instantRevealMode: boolean;
}): SuccessDoneFinalRevealPlan {
  const { displayed, streamTarget, finalContent, revealIdle, instantRevealMode } = input;

  if (instantRevealMode || revealIdle) {
    return { action: "noop", reason: "instant_or_idle_not_success_defer_path" };
  }

  if (!finalContent.trim()) {
    return { action: "noop", reason: "empty_final" };
  }

  const queueOwnedGap =
    streamTarget.length > displayed.length && streamTarget.startsWith(displayed);

  // Case A — finalContent === streamTarget while displayed lags: queue already owns the gap.
  if (finalContent === streamTarget) {
    if (queueOwnedGap) {
      return { action: "noop", reason: "case_a_target_owned_by_queue" };
    }
    if (finalContent === displayed) {
      return { action: "noop", reason: "already_displayed" };
    }
    return { action: "defer_canonical", reason: "case_a_canonical_layout" };
  }

  // Case B — finalContent extends streamTarget: enqueue only the done-only tail.
  if (streamTarget && finalContent.startsWith(streamTarget)) {
    const tail = finalContent.slice(streamTarget.length);
    if (tail) {
      return { action: "enqueue", enqueue: tail, reason: "case_b_done_only_tail" };
    }
    return { action: "noop", reason: "case_b_no_extra_tail" };
  }

  // Case C — streamTarget caught up to displayed; finalContent may extend from here.
  if (streamTarget === displayed && finalContent.startsWith(displayed)) {
    const tail = finalContent.slice(displayed.length);
    if (tail) {
      return { action: "enqueue", enqueue: tail, reason: "case_c_displayed_caught_up" };
    }
    return { action: "defer_canonical", reason: "case_c_layout_only" };
  }

  // Case D — queue-owned gap: never re-enqueue from displayed prefix.
  if (queueOwnedGap) {
    if (
      displayed.length > 0 &&
      collapseStreamCompareText(displayed) === collapseStreamCompareText(finalContent)
    ) {
      return { action: "defer_canonical", reason: "case_d_collapsed_match_pending_queue" };
    }
    return { action: "defer_canonical", reason: "case_d_diverge_or_shorter_pending_queue" };
  }

  if (finalContent === displayed) {
    return { action: "defer_canonical", reason: "layout_only" };
  }

  if (
    displayed.length > 0 &&
    collapseStreamCompareText(displayed) === collapseStreamCompareText(finalContent)
  ) {
    return { action: "defer_canonical", reason: "collapsed_match" };
  }

  const appendTail = resolveStreamAppendTail(displayed, streamTarget, finalContent);
  if (appendTail) {
    return { action: "enqueue", enqueue: appendTail, reason: "append_beyond_stream_target" };
  }

  if (finalContent.startsWith(displayed)) {
    const tail = finalContent.slice(displayed.length);
    if (tail) {
      return { action: "enqueue", enqueue: tail, reason: "displayed_prefix_tail" };
    }
    return { action: "defer_canonical", reason: "prefix_no_tail" };
  }

  return { action: "defer_canonical", reason: "case_d_default" };
}

export function buildSuccessDoneRevealDiagnostics(input: {
  displayed: string;
  streamTarget: string;
  finalContent: string;
  revealIdle: boolean;
  visualRevealPending: boolean;
  plan: SuccessDoneFinalRevealPlan;
}): SuccessDoneRevealDiagnostics {
  const { displayed, streamTarget, finalContent, revealIdle, visualRevealPending, plan } = input;
  const cd = collapseStreamCompareText(displayed);
  const cn = collapseStreamCompareText(finalContent);
  const queueOwnedGapLen =
    streamTarget.length > displayed.length && streamTarget.startsWith(displayed)
      ? streamTarget.length - displayed.length
      : 0;
  const newEnqueueLen = plan.action === "enqueue" ? plan.enqueue.length : 0;

  return {
    doneReceived: true,
    displayedLenAtDone: displayed.length,
    targetLenAtDone: streamTarget.length,
    finalContentLen: finalContent.length,
    revealIdleAtDone: revealIdle,
    visualRevealPendingAtDone: visualRevealPending,
    finalVsTargetExactMatch: finalContent === streamTarget,
    finalVsTargetCollapsedMatch:
      collapseStreamCompareText(finalContent) === collapseStreamCompareText(streamTarget),
    finalVsDisplayedCollapsedPrefix: cn.startsWith(cd) && cd.length > 0,
    queueOwnedGapLen,
    newEnqueueLen,
    reconcilePlan: plan.action,
    reconcileReason: plan.reason,
  };
}

/** Canonical reconciliation owner — run once when visual reveal queue is idle. */
export function resolveCanonicalContentAtRevealIdle(
  displayed: string,
  deferredCanonical: string
): string {
  if (!deferredCanonical) return displayed;
  if (displayed === deferredCanonical) return displayed;
  return preferDisplayedNewlineLayout(displayed, deferredCanonical);
}
