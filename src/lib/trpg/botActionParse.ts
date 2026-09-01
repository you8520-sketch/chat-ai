import { isTrpgActionType, type TrpgActionType } from "./actionTypes";

export const TRPG_BOT_INTENT_OPEN = "<<<INTENT>>>";
export const TRPG_BOT_ACTION_TYPE_OPEN = "<<<ACTION_TYPE>>>";

function clipMultiline(text: string, max: number): string {
  const normalized = text.replace(/\r\n/g, "\n").replace(/[ \t]+\n/g, "\n").trim();
  const chars = Array.from(normalized);
  if (chars.length <= max) return chars.join("");
  return chars.slice(0, max).join("").trimEnd();
}

function endsCompleteSentence(text: string): boolean {
  const t = text.trim();
  if (!t) return false;
  if (/[.!?。…？]["”」』]?\s*$/.test(t)) return true;
  if (/["”」』]\s*$/.test(t)) return true;
  return false;
}

/** Prefer a finished sentence over a mid-clause clip. */
export function finishAtSentenceBoundary(text: string, max: number): string {
  const clipped = clipMultiline(text, max);
  if (!clipped) return "";
  if (endsCompleteSentence(clipped)) return clipped;
  const matches = [...clipped.matchAll(/[.!?。…？]+["”」』]?(?:\s+|$)/g)];
  const last = matches.at(-1);
  if (!last || last.index == null) return clipped;
  const end = last.index + last[0].length;
  const tail = clipped.slice(end).trim();
  if (!tail) return clipped;
  if (end < 8 || end < clipped.length * 0.45) return clipped;
  return clipped.slice(0, end).trimEnd();
}

function firstMarkerIndex(text: string): number {
  const markers = [TRPG_BOT_INTENT_OPEN, TRPG_BOT_ACTION_TYPE_OPEN]
    .map((marker) => text.indexOf(marker))
    .filter((idx) => idx >= 0);
  if (markers.length === 0) return -1;
  return Math.min(...markers);
}

function sliceAfterMarker(text: string, marker: string): string {
  const at = text.indexOf(marker);
  if (at < 0) return "";
  const rest = text.slice(at + marker.length);
  const next = firstMarkerIndex(rest);
  return (next < 0 ? rest : rest.slice(0, next)).trim();
}

function parseActionTypeToken(raw: string): TrpgActionType {
  const token = raw.split(/\s+/)[0]?.trim().toLowerCase() ?? "";
  return isTrpgActionType(token) ? token : "free";
}

export function parseTrpgBotAction(raw: string): {
  prose: string;
  intent: string;
  actionType: TrpgActionType;
} {
  const text = raw.replace(/\r\n/g, "\n").trim();
  const first = firstMarkerIndex(text);
  const proseSource = first < 0 ? text : text.slice(0, first).trim();
  return {
    prose: proseSource.replace(/\r\n/g, "\n").trim(),
    intent: sliceAfterMarker(text, TRPG_BOT_INTENT_OPEN).trim(),
    actionType: parseActionTypeToken(sliceAfterMarker(text, TRPG_BOT_ACTION_TYPE_OPEN)),
  };
}

export function sanitizeBotActionText(raw: string): string {
  const parsed = parseTrpgBotAction(raw);
  const prose = parsed.prose;
  const parts = [prose];
  if (parsed.actionType && parsed.actionType !== "free") {
    parts.push(`${TRPG_BOT_ACTION_TYPE_OPEN}\n${parsed.actionType}`);
  } else if (raw.includes(TRPG_BOT_ACTION_TYPE_OPEN)) {
    parts.push(`${TRPG_BOT_ACTION_TYPE_OPEN}\n${parsed.actionType}`);
  }
  if (parsed.intent) {
    parts.push(`${TRPG_BOT_INTENT_OPEN}\n${parsed.intent}`);
  }
  return parts.filter(Boolean).join("\n\n");
}
