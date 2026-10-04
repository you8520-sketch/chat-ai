import {
  UNDER_RECOVERED_BILLING_MESSAGE,
  isUnderRecoveredOutcome,
  type ChatBillingSettlementOutcome,
} from "./chatBillingSettlementOutcome";

export type ChatSseUserCharge = {
  cost: number;
  totalPointsCost: number;
  settledPoints: number;
  requestedPoints: number;
  billingOutcome: ChatBillingSettlementOutcome;
  billingError?: string;
};

/** SSE user-charge fields use settlement. Requested product cost stays separate. */
export function chatSseUserChargeFromSettlement(input: {
  outcome: ChatBillingSettlementOutcome;
  settledPoints: number;
  requestedPoints: number;
}): ChatSseUserCharge {
  const settledPoints = Math.max(0, input.settledPoints);
  const fields: ChatSseUserCharge = {
    cost: settledPoints,
    totalPointsCost: settledPoints,
    settledPoints,
    requestedPoints: Math.max(0, input.requestedPoints),
    billingOutcome: input.outcome,
  };
  if (isUnderRecoveredOutcome(input.outcome)) {
    fields.billingError = UNDER_RECOVERED_BILLING_MESSAGE;
  }
  return fields;
}

export type ChatStreamDoneBilling = {
  cost?: number;
  totalPointsCost?: number;
  settledPoints?: number;
  requestedPoints?: number;
  remainingPoints?: number;
  paidPoints?: number;
  freePoints?: number;
  billingOutcome?: string;
  billingError?: string;
};

export type ChatStreamDeduction = {
  turnCost: number;
  remainingPoints: number;
  paidPoints: number;
  freePoints: number;
};

export type ChatStreamSettlementView = {
  deduction?: ChatStreamDeduction;
  billingWarning: string | null;
  keepAssistantResponse: boolean;
};

function settledUserCharge(data: ChatStreamDoneBilling): number {
  if (typeof data.settledPoints === "number" && Number.isFinite(data.settledPoints)) {
    return Math.max(0, data.settledPoints);
  }
  const fallback = data.totalPointsCost ?? data.cost ?? 0;
  return Number.isFinite(fallback) ? Math.max(0, fallback) : 0;
}

/**
 * Client-visible settlement truth. Never treat requested/product cost as a
 * user deduction. under_recovered keeps the assistant product and warns.
 */
export function extractChatStreamSettlement(
  data: ChatStreamDoneBilling
): ChatStreamSettlementView {
  if (isUnderRecoveredOutcome(data.billingOutcome)) {
    const warning = data.billingError?.trim() || UNDER_RECOVERED_BILLING_MESSAGE;
    return {
      deduction: undefined,
      billingWarning: warning,
      keepAssistantResponse: true,
    };
  }
  const turnCost = settledUserCharge(data);
  if (turnCost <= 0 || data.remainingPoints == null) {
    return {
      deduction: undefined,
      billingWarning: null,
      keepAssistantResponse: true,
    };
  }
  return {
    deduction: {
      turnCost,
      remainingPoints: data.remainingPoints,
      paidPoints: data.paidPoints ?? 0,
      freePoints: data.freePoints ?? 0,
    },
    billingWarning: null,
    keepAssistantResponse: true,
  };
}

export type ChatBillingPresentationOwner<T> = {
  pendingByRequestId: Map<string, T>;
  presentedRequestIds: Set<string>;
};

export function createChatBillingPresentationOwner<T>(): ChatBillingPresentationOwner<T> {
  return {
    pendingByRequestId: new Map(),
    presentedRequestIds: new Set(),
  };
}

/** Stage server-settled billing until this request's visual reveal is complete. */
export function stageChatBillingPresentation<T>(
  owner: ChatBillingPresentationOwner<T>,
  input: { requestId: string; billing: T; visualRevealPending: boolean }
): T | null {
  if (owner.presentedRequestIds.has(input.requestId)) return null;
  if (input.visualRevealPending) {
    if (!owner.pendingByRequestId.has(input.requestId)) {
      owner.pendingByRequestId.set(input.requestId, input.billing);
    }
    return null;
  }
  owner.pendingByRequestId.delete(input.requestId);
  owner.presentedRequestIds.add(input.requestId);
  return input.billing;
}

/** Flush exactly one staged presentation for the reveal request that completed. */
export function completeChatBillingPresentation<T>(
  owner: ChatBillingPresentationOwner<T>,
  requestId: string
): T | null {
  const billing = owner.pendingByRequestId.get(requestId);
  if (!billing || owner.presentedRequestIds.has(requestId)) return null;
  owner.pendingByRequestId.delete(requestId);
  owner.presentedRequestIds.add(requestId);
  return billing;
}

export function clearChatBillingPresentations<T>(
  owner: ChatBillingPresentationOwner<T>
): void {
  owner.pendingByRequestId.clear();
  owner.presentedRequestIds.clear();
}
