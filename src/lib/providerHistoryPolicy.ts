import type { ChatMsg } from "@/lib/ai";
import { OPENING_TURN_USER } from "@/lib/chatGreetingContext";
import { trimHistoryToBudget } from "@/lib/hybridMemory";
import { estimateTokens } from "@/lib/tokenEstimate";

/** Synthetic general-route continuity pair — NOT real RP RAW. */
export const GENERAL_ROUTE_BRIDGE_USER_MARKER =
  "[이전 장면 이후의 안전한 연속성 정보]";

export function isOpeningUserMessage(content: string): boolean {
  const t = content.trim();
  return t === OPENING_TURN_USER || t.startsWith(`${OPENING_TURN_USER}\n`);
}

export function isGeneralRouteBridgeUserMessage(content: string): boolean {
  return content.trim() === GENERAL_ROUTE_BRIDGE_USER_MARKER;
}

export function isRealPlayableUserMessage(content: string): boolean {
  return !isOpeningUserMessage(content) && !isGeneralRouteBridgeUserMessage(content);
}

/** Real playable exchanges only — excludes opening turn0 and general-route bridge. */
export function countRealPlayableHistoryTurns(history: ChatMsg[]): number {
  let pendingUser: ChatMsg | null = null;
  let playableTurns = 0;

  for (const message of history) {
    if (message.role === "user") {
      pendingUser = message;
      continue;
    }
    if (message.role !== "assistant" || !pendingUser) continue;
    if (isRealPlayableUserMessage(pendingUser.content)) playableTurns += 1;
    pendingUser = null;
  }

  return playableTurns;
}

export type ProviderHistoryHealth = {
  realRawCompleteExchanges: number;
  realRawMessages: number;
  realRawChars: number;
  openingPreludePresent: boolean;
  openingPreludeChars: number;
  generalRouteBridgePresent: boolean;
  generalRouteBridgeChars: number;
};

export function analyzeProviderHistoryHealth(history: ChatMsg[]): ProviderHistoryHealth {
  let pendingUser: ChatMsg | null = null;
  let realRawMessages = 0;
  let realRawChars = 0;
  let openingPreludeChars = 0;
  let openingPreludePresent = false;
  let generalRouteBridgePresent = false;
  let generalRouteBridgeChars = 0;

  for (const message of history) {
    if (message.role === "user") {
      pendingUser = message;
      continue;
    }
    if (message.role !== "assistant" || !pendingUser) continue;

    const userContent = pendingUser.content;
    const pairChars = userContent.length + message.content.length;

    if (isOpeningUserMessage(userContent)) {
      openingPreludePresent = true;
      openingPreludeChars += pairChars;
    } else if (isGeneralRouteBridgeUserMessage(userContent)) {
      generalRouteBridgePresent = true;
      generalRouteBridgeChars += pairChars;
    } else {
      realRawMessages += 2;
      realRawChars += pairChars;
    }
    pendingUser = null;
  }

  return {
    realRawCompleteExchanges: realRawMessages / 2,
    realRawMessages,
    realRawChars,
    openingPreludePresent,
    openingPreludeChars,
    generalRouteBridgePresent,
    generalRouteBridgeChars,
  };
}

export type TrimProviderHistoryOpts = {
  minRealPlayableExchanges: number;
  /** While true, opening turn0 survives even above soft token budget. */
  protectOpening: boolean;
};

function collectRealPlayablePairs(history: ChatMsg[]): ChatMsg[][] {
  const pairs: ChatMsg[][] = [];
  let pendingUser: ChatMsg | null = null;
  for (const message of history) {
    if (message.role === "user") {
      pendingUser = message;
      continue;
    }
    if (!pendingUser || message.role !== "assistant") continue;
    if (isRealPlayableUserMessage(pendingUser.content)) {
      pairs.push([pendingUser, message]);
    }
    pendingUser = null;
  }
  return pairs;
}

function extractBridgePair(history: ChatMsg[]): ChatMsg[] {
  for (let i = 0; i < history.length - 1; i++) {
    const user = history[i]!;
    const assistant = history[i + 1]!;
    if (user.role === "user" && isGeneralRouteBridgeUserMessage(user.content) && assistant.role === "assistant") {
      return [user, assistant];
    }
  }
  return [];
}

function historyHasProtectedOpening(history: ChatMsg[]): boolean {
  return (
    history.length >= 2 &&
    history[0]?.role === "user" &&
    isOpeningUserMessage(history[0].content) &&
    history[1]?.role === "assistant"
  );
}

export function resolveProviderHistoryTurnFloor(opts: {
  minRealPlayableExchanges: number;
  protectOpening: boolean;
  history: ChatMsg[];
}): number {
  const hasOpening = opts.protectOpening && historyHasProtectedOpening(opts.history);
  const hasBridge = extractBridgePair(opts.history).length > 0;
  return (
    Math.max(1, opts.minRealPlayableExchanges) +
    (hasOpening ? 1 : 0) +
    (hasBridge ? 1 : 0)
  );
}

/**
 * Provider-history trim — protects opening (when active) + latest N real playable exchanges.
 * 10K is soft: opening + RAW4 win over budget; bridge metadata kept when present.
 */
export function trimProviderHistoryToBudget(
  history: ChatMsg[],
  budget: number,
  opts: TrimProviderHistoryOpts
): ChatMsg[] {
  if (history.length === 0) return [];

  const turnFloor = resolveProviderHistoryTurnFloor({
    minRealPlayableExchanges: opts.minRealPlayableExchanges,
    protectOpening: opts.protectOpening,
    history,
  });

  let trimmed = trimHistoryToBudget(history, budget, turnFloor);

  const openingActive =
    opts.protectOpening && historyHasProtectedOpening(history);
  const bridgePair = extractBridgePair(history);
  const mustRecompose =
    (openingActive && !historyHasProtectedOpening(trimmed)) ||
    (bridgePair.length > 0 && extractBridgePair(trimmed).length === 0);

  if (mustRecompose) {
    const openingPair = openingActive && historyHasProtectedOpening(history)
      ? history.slice(0, 2)
      : [];
    const latestReal = collectRealPlayablePairs(history).slice(
      -opts.minRealPlayableExchanges
    );
    const bridge = extractBridgePair(history);
    trimmed = [...openingPair, ...latestReal.flat(), ...bridge];
  }

  return trimmed;
}
