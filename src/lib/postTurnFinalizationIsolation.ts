/**
 * Post-turn failure boundaries — optional post-processing must not abort
 * MAIN_GENERATION_SUCCESS → settlement → receipt when main prose is already saved.
 */

import type { StageUsage } from "@/lib/ai";
import type { BillingFxSnapshot } from "@/lib/billingFxSnapshot";
import {
  resolveChatBillingContract,
  type ChatBillingContractDecision,
  type ResolveChatBillingContractInput,
} from "@/lib/chatBillingContractDispatch";
import type { BillingWaiverReason } from "@/lib/points";
import type { ParsedStatusWidgetTurnValues } from "@/lib/statusWidget/types";
import type { ResolveStatusWidgetTurnValuesInput } from "@/lib/statusWidget/telemetry";
import { resolveStatusWidgetTurnValues } from "@/lib/statusWidget/telemetry";

export const POST_TURN_FINALIZATION_ISOLATION_OWNER =
  "postTurnFinalizationIsolation.ts";

export type BillingContractDispatchOutcome = {
  decision: ChatBillingContractDecision;
  /** When dispatch threw or violated producer contract. */
  isolatedFailure: boolean;
  failureReason: string | null;
};

export type StatusWidgetIsolationOutcome = {
  prose: string;
  values: ParsedStatusWidgetTurnValues | null;
  failed: boolean;
  errorMessage: string | null;
  /** Passthrough when widget path succeeded. */
  resolved?: Awaited<ReturnType<typeof resolveStatusWidgetTurnValues>>;
};

export type ResolveBillingContractForTurnInput = {
  deliveredModelId: string;
  stages: StageUsage[];
  refusalFallbackDelivered?: boolean;
  promptAuditTotal?: number | null;
  legacyFinalPoints: number;
  billingWaiverReason: BillingWaiverReason | null;
  legacyWaiverMinimum: number;
  fxSnapshot?: BillingFxSnapshot;
  phase1PublishedBillingEnabled?: boolean;
};

function legacyFallbackDecision(
  input: ResolveBillingContractForTurnInput,
  reason: string
): ChatBillingContractDecision {
  return {
    contract: "legacy",
    points: input.legacyFinalPoints,
    reason: "usage_unresolved",
    telemetry: {
      billingContract: "legacy",
      billingContractReason: reason,
      deliveredModelId: input.deliveredModelId,
      publishedCandidateStatus: "unavailable",
      publishedBlockReason: reason,
      pricingVersion: null,
    },
  };
}

export type ResolveBillingContractForTurnDeps = {
  resolveChatBillingContract?: typeof resolveChatBillingContract;
};

/** Billing contract dispatch — fail-closed to legacy; never throws to route. */
export function resolveBillingContractForTurn(
  input: ResolveBillingContractForTurnInput,
  deps?: ResolveBillingContractForTurnDeps
): BillingContractDispatchOutcome {
  const dispatch = deps?.resolveChatBillingContract ?? resolveChatBillingContract;
  try {
    const dispatchInput: ResolveChatBillingContractInput = {
      deliveredModelId: input.deliveredModelId,
      stages: input.stages,
      refusalFallbackDelivered: input.refusalFallbackDelivered,
      promptAuditTotal: input.promptAuditTotal,
      legacyFinalPoints: input.legacyFinalPoints,
      billingWaiverReason: input.billingWaiverReason,
      legacyWaiverMinimum: input.legacyWaiverMinimum,
      fxSnapshot: input.fxSnapshot,
      phase1PublishedBillingEnabled: input.phase1PublishedBillingEnabled,
    };
    const decision = dispatch(dispatchInput);
    return { decision, isolatedFailure: false, failureReason: null };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[postTurnFinalization] billing contract dispatch isolated failure:", message);
    return {
      decision: legacyFallbackDecision(input, "billing_contract_dispatch_exception"),
      isolatedFailure: true,
      failureReason: message,
    };
  }
}

export type RunStatusWidgetTurnIsolatedDeps = {
  resolveStatusWidgetTurnValues?: typeof resolveStatusWidgetTurnValues;
};

/** Status widget — platform-funded optional post-processing; fail-open. */
export async function runStatusWidgetTurnIsolated(
  input: ResolveStatusWidgetTurnValuesInput,
  savedText: string,
  deps?: RunStatusWidgetTurnIsolatedDeps
): Promise<StatusWidgetIsolationOutcome> {
  const resolveWidget = deps?.resolveStatusWidgetTurnValues ?? resolveStatusWidgetTurnValues;
  try {
    const resolved = await resolveWidget(input);
    return {
      prose: resolved.prose,
      values: resolved.values,
      failed: false,
      errorMessage: null,
      resolved,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[postTurnFinalization] status widget isolated failure:", message);
    return {
      prose: savedText,
      values: null,
      failed: true,
      errorMessage: message,
    };
  }
}

/** Client done payload must tolerate optional field omission without throwing. */
export function sanitizeClientDonePayload<T extends Record<string, unknown>>(payload: T): T {
  const copy = { ...payload } as Record<string, unknown>;
  if ("usage" in copy && copy.usage == null) {
    delete copy.usage;
  }
  if ("variants" in copy && copy.variants == null) {
    delete copy.variants;
  }
  if ("statusWidgetValues" in copy && copy.statusWidgetValues == null) {
    copy.statusWidgetValues = null;
  }
  return copy as T;
}
