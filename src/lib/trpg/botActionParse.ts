import { clipTrpgChars } from "./clip";
import { TRPG_BOT_ACTION_MAX_CHARS, TRPG_BOT_INTENT_MAX_CHARS } from "./types";

export const TRPG_BOT_INTENT_OPEN = "<<<INTENT>>>";

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

export function parseTrpgBotAction(raw: string): { prose: string; intent: string } {
  const text = raw.replace(/\r\n/g, "\n").trim();
  const at = text.indexOf(TRPG_BOT_INTENT_OPEN);
  if (at < 0) {
    return { prose: finishAtSentenceBoundary(text, TRPG_BOT_ACTION_MAX_CHARS), intent: "" };
  }
  return {
    prose: finishAtSentenceBoundary(text.slice(0, at).trim(), TRPG_BOT_ACTION_MAX_CHARS),
    intent: clipTrpgChars(text.slice(at + TRPG_BOT_INTENT_OPEN.length), TRPG_BOT_INTENT_MAX_CHARS),
  };
}

export function sanitizeBotActionText(
  raw: string,
  maxChars = TRPG_BOT_ACTION_MAX_CHARS
): string {
  const parsed = parseTrpgBotAction(raw);
  const prose = finishAtSentenceBoundary(parsed.prose, maxChars);
  if (!parsed.intent) return prose;
  return `${prose}\n\n${TRPG_BOT_INTENT_OPEN}\n${parsed.intent}`;
}
