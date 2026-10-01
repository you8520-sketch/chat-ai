import { JSX_BRIDGE_MAX_TEXT, JSX_BRIDGE_MIN_INTERVAL_MS, JSX_SANDBOX_MESSAGE_BURST } from "./limits";

export type JsxHostBridgeAction =
  | { action: "ignore"; reason: string }
  | { action: "setChatDraft"; text: string }
  | { action: "requestChatSend"; text: string };

export type JsxHostBridgeRateState = {
  lastAcceptedAt: number;
  burst: number;
};

/**
 * Canonical JSX → host chat-bridge policy.
 * Never returns a provider send. iframe postMessage cannot prove a user
 * gesture, so sendToChat only drafts + asks the host user to press Send.
 */
export function normalizeJsxBridgeText(raw: unknown): string {
  return String(raw ?? "").slice(0, JSX_BRIDGE_MAX_TEXT).trim();
}

export function nextJsxBridgeRateState(
  prev: JsxHostBridgeRateState,
  now: number
): JsxHostBridgeRateState {
  const burst = now - prev.lastAcceptedAt < 50 ? prev.burst + 1 : 1;
  return { lastAcceptedAt: now, burst };
}

export function decideJsxHostBridgeAction(input: {
  kind: string;
  text: unknown;
  chatSendEnabled: boolean;
  now: number;
  rate: JsxHostBridgeRateState;
}): { decision: JsxHostBridgeAction; rate: JsxHostBridgeRateState } {
  const rate = nextJsxBridgeRateState(input.rate, input.now);
  if (rate.burst > JSX_SANDBOX_MESSAGE_BURST) {
    return { decision: { action: "ignore", reason: "burst" }, rate };
  }
  if (
    input.rate.lastAcceptedAt > 0 &&
    input.now - input.rate.lastAcceptedAt < JSX_BRIDGE_MIN_INTERVAL_MS &&
    rate.burst > 2
  ) {
    return { decision: { action: "ignore", reason: "rate_limit" }, rate };
  }

  const text = normalizeJsxBridgeText(input.text);
  if (!text) {
    return { decision: { action: "ignore", reason: "empty" }, rate };
  }
  if (input.kind === "setChatDraft") {
    return { decision: { action: "setChatDraft", text }, rate };
  }
  if (input.kind !== "sendToChat") {
    return { decision: { action: "ignore", reason: "unknown_kind" }, rate };
  }
  if (!input.chatSendEnabled) {
    return { decision: { action: "setChatDraft", text }, rate };
  }
  return { decision: { action: "requestChatSend", text }, rate };
}
