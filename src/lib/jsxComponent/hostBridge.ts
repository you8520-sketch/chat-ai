import {
  JSX_BRIDGE_ACTION_TYPE_MAX,
  JSX_BRIDGE_MAX_TEXT,
  JSX_BRIDGE_MIN_INTERVAL_MS,
  JSX_SANDBOX_AUTO_HEIGHT_MAX_PX,
  JSX_SANDBOX_AUTO_HEIGHT_MIN_PX,
  JSX_SANDBOX_MESSAGE_BURST,
} from "./limits";

export type JsxHostBridgeAction =
  | { action: "ignore"; reason: string }
  | { action: "setChatDraft"; text: string }
  | { action: "requestChatSend"; text: string }
  | { action: "setTrpgActionDraft"; actionType: string; text: string }
  | { action: "setTrpgSelectedStat"; statKey: string };

export type JsxHostBridgeRateState = {
  lastAcceptedAt: number;
  burst: number;
};

export type JsxTrpgActionDraftRequest = { actionType: string; text: string };

/** Explicit stat override for the viewer's own ACTION composer. Draft/config only. */
export type JsxTrpgSelectedStatRequest = { statKey: string };

/**
 * Canonical JSX → host bridge policy.
 * Never returns a provider send. iframe postMessage cannot prove a user
 * gesture, so sendToChat only drafts + asks the host user to press Send.
 * setTrpgActionDraft is draft-only; the TRPG host owns allowlist + length.
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
  actionType?: unknown;
  statKey?: unknown;
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

  if (input.kind === "setTrpgActionDraft") {
    const text = String(input.text ?? "");
    if (!text.trim()) {
      return { decision: { action: "ignore", reason: "empty" }, rate };
    }
    const actionType = String(input.actionType ?? "").slice(0, JSX_BRIDGE_ACTION_TYPE_MAX);
    return { decision: { action: "setTrpgActionDraft", actionType, text }, rate };
  }

  if (input.kind === "setTrpgSelectedStat") {
    const statKey = String(input.statKey ?? "").trim().slice(0, JSX_BRIDGE_ACTION_TYPE_MAX);
    if (!statKey) {
      return { decision: { action: "ignore", reason: "empty" }, rate };
    }
    return { decision: { action: "setTrpgSelectedStat", statKey }, rate };
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

/** Host-side clamp for a child-reported content height; null keeps the current height. */
export function clampJsxSandboxHeight(
  raw: unknown,
  min = JSX_SANDBOX_AUTO_HEIGHT_MIN_PX,
  max = JSX_SANDBOX_AUTO_HEIGHT_MAX_PX
): number | null {
  if (typeof raw !== "number" || !Number.isFinite(raw)) return null;
  return Math.min(max, Math.max(min, Math.ceil(raw)));
}
