/**
 * Success-path server done → visual reveal reconciliation.
 * NETWORK_DONE != VISUAL_REVEAL_DONE — never instant-snap full finalContent while reveal pending.
 */

import {
  collapseStreamCompareText,
  planStreamRevealCatchUp,
  preferDisplayedNewlineLayout,
  resolveStreamAppendTail,
} from "@/lib/streamReveal";

export const SUCCESS_DONE_FINAL_RECONCILE_OWNER =
  "planSuccessDoneFinalContentReveal() in streamSuccessDoneReconcile.ts";

export type SuccessDoneFinalRevealPlan =
  | { action: "noop"; reason: string }
  | {
      action: "enqueue";
      deferredCanonical: string;
      enqueue: string;
    }
  | {
      action: "defer_canonical";
      deferredCanonical: string;
    };

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
  appendTailResult: string | null;
  catchUpPlanSetPrefixLen: number | null;
  catchUpPlanResetQueue: boolean | null;
  catchUpPlanEnqueueLen: number | null;
  setAssistantContentInstantCalled: false;
  revealResetCalled: false;
  reconcilePlan: SuccessDoneFinalRevealPlan["action"];
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
  const priorTarget = input.priorTarget ?? streamTarget;

  if (instantRevealMode || revealIdle) {
    return { action: "noop", reason: "instant_or_idle_not_success_defer_path" };
  }

  if (!finalContent.trim()) {
    return { action: "noop", reason: "empty_final" };
  }

  if (finalContent === displayed) {
    return { action: "defer_canonical", deferredCanonical: finalContent };
  }

  if (
    displayed.length > 0 &&
    collapseStreamCompareText(displayed) === collapseStreamCompareText(finalContent)
  ) {
    return { action: "defer_canonical", deferredCanonical: finalContent };
  }

  const appendTail = resolveStreamAppendTail(displayed, streamTarget, finalContent);
  if (appendTail) {
    return { action: "enqueue", deferredCanonical: finalContent, enqueue: appendTail };
  }

  if (finalContent.startsWith(displayed)) {
    const tail = finalContent.slice(displayed.length);
    if (tail) {
      return { action: "enqueue", deferredCanonical: finalContent, enqueue: tail };
    }
    return { action: "defer_canonical", deferredCanonical: finalContent };
  }

  const catchUp = planStreamRevealCatchUp(displayed, finalContent, priorTarget, streamTarget);
  if (catchUp) {
    if (catchUp.setPrefix === "" && displayed.length > 80) {
      return { action: "defer_canonical", deferredCanonical: finalContent };
    }
    if (catchUp.enqueue) {
      return {
        action: "enqueue",
        deferredCanonical: finalContent,
        enqueue: catchUp.enqueue,
      };
    }
  }

  return { action: "defer_canonical", deferredCanonical: finalContent };
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
  const appendTail = resolveStreamAppendTail(displayed, streamTarget, finalContent);
  const catchUp = planStreamRevealCatchUp(displayed, finalContent, streamTarget, streamTarget);

  return {
    doneReceived: true,
    displayedLenAtDone: displayed.length,
    targetLenAtDone: streamTarget.length,
    finalContentLen: finalContent.length,
    revealIdleAtDone: revealIdle,
    visualRevealPendingAtDone: visualRevealPending,
    finalVsTargetExactMatch: finalContent === streamTarget,
    finalVsTargetCollapsedMatch: collapseStreamCompareText(finalContent) === collapseStreamCompareText(streamTarget),
    finalVsDisplayedCollapsedPrefix: cn.startsWith(cd) && cd.length > 0,
    appendTailResult: appendTail,
    catchUpPlanSetPrefixLen: catchUp?.setPrefix.length ?? null,
    catchUpPlanResetQueue: catchUp?.resetQueue ?? null,
    catchUpPlanEnqueueLen: catchUp?.enqueue.length ?? null,
    setAssistantContentInstantCalled: false,
    revealResetCalled: false,
    reconcilePlan: plan.action,
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

export function inferFirstDisplayJumpOwner(diag: SuccessDoneRevealDiagnostics): string {
  if (diag.setAssistantContentInstantCalled) {
    return "setAssistantContentInstant() during success done while reveal pending";
  }
  if (diag.revealResetCalled) {
    return "reveal.reset() during success done while reveal pending";
  }
  if (diag.reconcilePlan === "enqueue") {
    return "none — enqueue-only success done reconcile";
  }
  if (diag.reconcilePlan === "defer_canonical") {
    return "none — deferred canonical until reveal idle";
  }
  return "none — no success defer path";
}
