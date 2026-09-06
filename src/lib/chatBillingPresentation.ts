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
