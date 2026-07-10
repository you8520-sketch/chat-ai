import { STATE_WINDOW_POLICY_BLOCK } from "@/lib/stateWindowPolicy";
import { STREAM_SAVE_MIN_RETENTION } from "@/lib/streamFirstSaveConstants";
import {
  collapseStreamCompareText,
  rawPrefixForCollapsedCompare,
} from "@/lib/streamReveal";

export type StatusWindowOutputMode = "markdown";

export type ResolvedStatusWindow = {
  hasRequest: false;
  hasCreatorRequest: false;
  hasUserRequest: false;
  strippedPersona: string;
  strippedUserNote: string;
  creatorSpec: null;
  userSpec: null;
  combinedSpec: null;
  outputMode: StatusWindowOutputMode;
  templateFields: [];
  templateLabels: [];
};

const EMPTY_RESOLVED: ResolvedStatusWindow = {
  hasRequest: false,
  hasCreatorRequest: false,
  hasUserRequest: false,
  strippedPersona: "",
  strippedUserNote: "",
  creatorSpec: null,
  userSpec: null,
  combinedSpec: null,
  outputMode: "markdown",
  templateFields: [],
  templateLabels: [],
};

export function resolveStatusWindow(_opts?: unknown): ResolvedStatusWindow {
  return EMPTY_RESOLVED;
}

export function characterRequiresStatusWindow(
  _characterSetting?: string,
  _statusWindowPrompt?: string | null
): boolean {
  return false;
}

export function normalizeStatusWindowEnabled(_value: unknown): boolean {
  return false;
}

export function stripStatusFromLiveStream(text: string, _opts?: { allowHtml?: boolean }): string {
  return text;
}

export function stripLiveStreamForClient(
  text: string,
  _preserve?: boolean,
  _opts?: { allowHtml?: boolean }
): string {
  return text;
}


/** 라이브 스트림 — append-only (replace·되감기 금지) */
export function pushLiveStreamAppendToClient(
  send: (obj: object) => void,
  target: string,
  lastSentToClient: string,
  explicitDelta?: string
): string {
  if (!target || target === lastSentToClient) return lastSentToClient;

  if (target.startsWith(lastSentToClient)) {
    const tail = explicitDelta ?? target.slice(lastSentToClient.length);
    if (tail) send({ type: "append", text: tail, forceAppend: true });
    return target;
  }

  const cd = collapseStreamCompareText(lastSentToClient);
  const cn = collapseStreamCompareText(target);
  if (cd.length >= 40 && cn.startsWith(cd)) {
    const mapped = rawPrefixForCollapsedCompare(target, cd);
    if (mapped.length >= lastSentToClient.length * STREAM_SAVE_MIN_RETENTION) {
      const tail = target.slice(mapped.length);
      if (tail) send({ type: "append", text: tail, forceAppend: true });
      return target;
    }
  }

  /** prefix 불일치 — 라이브 되감기 대신 route finalContent에서 1회 동기화 */
  return lastSentToClient;
}

export function pushLiveStreamDelta(
  send: (obj: object) => void,
  fullClean: string,
  lastCleanSent: string,
  replace?: string | null,
  opts?: { replaceInstant?: boolean; explicitDelta?: string; lastSentToClient?: string }
): { lastCleanSent: string; lastSentToClient: string } {
  const sent = opts?.lastSentToClient ?? lastCleanSent;
  const target = replace ?? fullClean;
  if (!target || target === sent) {
    return { lastCleanSent: target || lastCleanSent, lastSentToClient: sent };
  }

  if (replace != null && opts?.replaceInstant) {
    // Prefer append when collapsed target extends what the client already has.
    const appended = pushLiveStreamAppendToClient(send, target, sent);
    if (appended === target) {
      return { lastCleanSent: target, lastSentToClient: target };
    }
    send({ type: "replace", text: target, instant: true });
    return { lastCleanSent: target, lastSentToClient: target };
  }

  const nextSent = pushLiveStreamAppendToClient(
    send,
    target,
    sent,
    replace == null ? opts?.explicitDelta : undefined
  );

  if (nextSent === sent && target !== sent) {
    // Prefix diverged — one instant snap. Avoid when target is only a shorter prefix
    // of what was already sent (transient strip); keep client text stable.
    const sentCollapsed = collapseStreamCompareText(sent);
    const targetCollapsed = collapseStreamCompareText(target);
    if (
      targetCollapsed.length >= 40 &&
      sentCollapsed.includes(targetCollapsed) &&
      target.length < sent.length
    ) {
      return { lastCleanSent: target, lastSentToClient: sent };
    }
    send({ type: "replace", text: target, instant: true });
    return { lastCleanSent: target, lastSentToClient: target };
  }

  return {
    lastCleanSent: target || lastCleanSent,
    lastSentToClient: nextSent,
  };
}

export function stripStatusWindowFromChunkContent(content: string): string {
  return content;
}

export function stripStatusWindowFromSource(source: string): string {
  return source;
}

export function buildStatusWindowBanBlock(): string {
  return STATE_WINDOW_POLICY_BLOCK;
}

export function buildCompactStatusWindowBlock(_ctx?: unknown): string {
  return "";
}

export function normalizeAssistantStatusOutput(text: string): string {
  return text;
}

export function stripAllStatusWindowFromOutput(text: string): string {
  return text;
}

export function appendMissingStatusWindow(text: string): string {
  return text;
}

export type StatusOnlyLocalRepairOpts = {
  templateLabels?: string[];
  templateFields?: unknown[];
  outputMode?: string;
  allowHtml?: boolean;
  previousTurn?: string | null;
  targetInput?: number | null;
};

export function needsStatusOnlyLocalRepair(_text: string, _opts?: StatusOnlyLocalRepairOpts): boolean {
  return false;
}

export function repairStatusWindowLocally(
  text: string,
  _opts?: StatusOnlyLocalRepairOpts
): { text: string; repaired: false; reason?: string } {
  return { text, repaired: false };
}

export function extractAndStripStatusWindowFromText(text: string): string {
  return text;
}

export function detectStatusOutputMode(_spec: string): StatusWindowOutputMode {
  return "markdown";
}

export function isValidStatusWindowFormatSpec(_spec: string): boolean {
  return false;
}

export function extractCreatorMandatoryStatusFromSetting(
  _characterSetting: string,
  _statusWindowPrompt?: string | null
): string | null {
  return null;
}

export function fieldsToPromptSpec(_fields: unknown[]): string {
  return "";
}

export { splitAssistantMessageStatus } from "@/lib/statusWindowTemplate";
