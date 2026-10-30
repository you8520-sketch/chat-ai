import type { ChatMsg } from "@/lib/ai";
import {
  GEMINI_38_FLASH_MODEL,
  OPENROUTER_GEMINI_38_FLASH_MODEL,
} from "@/lib/chatModels";
import {
  trimProviderHistoryToBudget,
  type TrimProviderHistoryOpts,
} from "@/lib/providerHistoryPolicy";

const GEMINI_38_FLASH_HISTORY_ECHO_MODELS = new Set<string>([
  GEMINI_38_FLASH_MODEL,
  OPENROUTER_GEMINI_38_FLASH_MODEL,
]);

/**
 * Gemini 3.8 Flash Main RP only. Other ids, including Gemini 3.7 and Gemini 4,
 * stay on the unprojected history.
 */
export function isGemini38FlashHistoryEchoModel(modelId: string | null | undefined): boolean {
  return GEMINI_38_FLASH_HISTORY_ECHO_MODELS.has((modelId ?? "").trim());
}

function collapseWhitespace(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

function blankLineParagraphs(text: string): string[] {
  return text
    .split(/\n\s*\n/)
    .map((part) => part.trim())
    .filter((part) => part.length > 0);
}

const DIALOGUE_WRAPPERS: ReadonlyArray<readonly [string, string]> = [
  ['"', '"'],
  ["“", "”"],
  ["「", "」"],
  ["『", "』"],
];

function whollyContainedInUser(paragraph: string, userCollapsed: string): boolean {
  const collapsed = collapseWhitespace(paragraph);
  return collapsed.length >= 2 && userCollapsed.includes(collapsed);
}

/** One utterance wrapped as speech. Inner quote marks keep a mixed paragraph out. */
function quoteWrappedDialogue(paragraph: string): boolean {
  const collapsed = collapseWhitespace(paragraph);
  for (const [open, close] of DIALOGUE_WRAPPERS) {
    if (!collapsed.startsWith(open) || !collapsed.endsWith(close)) continue;
    if (collapsed.length <= open.length + close.length) continue;
    const inner = collapsed.slice(open.length, collapsed.length - close.length);
    if (open === close) {
      if (!inner.includes(open)) return true;
      continue;
    }
    if (!inner.includes(open) && !inner.includes(close)) return true;
  }
  return false;
}

/**
 * True when each paragraph occurs later in the previous user than the one
 * before it. A reversed quotation does not match.
 */
function forwardCopyInUserOrder(
  parts: readonly string[],
  start: number,
  end: number,
  userCollapsed: string
): boolean {
  let from = 0;
  for (let index = start; index < end; index += 1) {
    const needle = collapseWhitespace(parts[index] ?? "");
    const at = userCollapsed.indexOf(needle, from);
    if (at < 0) return false;
    from = at + needle.length;
  }
  return true;
}

/** The same contained line repeated. Order cannot advance, but it is still a dump. */
function identicalContainedRepetition(
  parts: readonly string[],
  start: number,
  end: number,
  userCollapsed: string
): boolean {
  const first = collapseWhitespace(parts[start] ?? "");
  if (first.length < 2 || !userCollapsed.includes(first)) return false;
  for (let index = start + 1; index < end; index += 1) {
    if (collapseWhitespace(parts[index] ?? "") !== first) return false;
  }
  return true;
}

/**
 * Two quote-wrapped lines are a callback or NPC quotation.
 * A longer run, or a line that is not wholly wrapped, stays a copy candidate.
 */
function protectedDialogueCallback(parts: readonly string[], start: number, end: number): boolean {
  if (end - start !== 2) return false;
  return quoteWrappedDialogue(parts[start] ?? "") && quoteWrappedDialogue(parts[end - 1] ?? "");
}

/**
 * Drop a blank-line paragraph only when it belongs to a contiguous run of at
 * least two paragraphs that are each wholly contained in the immediately
 * previous user message, in that message's order or as the same line repeated.
 * An out-of-order quotation, a pair of quote-wrapped dialogue lines, an
 * isolated match, a mixed paragraph, and a reply that would become empty stay
 * as stored.
 */
export function omitContiguousReinjectedUserParagraphs<T extends { role: string; content: string }>(
  history: readonly T[]
): T[] {
  if (history.length === 0) return history as T[];
  let changed = false;
  const next = history.map((message, index) => {
    if (message.role !== "assistant") return message;
    const previous = history[index - 1];
    if (!previous || previous.role !== "user") return message;
    const rewritten = omitContiguousRun(message.content, previous.content);
    if (rewritten === null) return message;
    changed = true;
    return { ...message, content: rewritten };
  });
  return changed ? next : (history as T[]);
}

function omitContiguousRun(assistant: string, user: string): string | null {
  const parts = blankLineParagraphs(assistant);
  if (parts.length < 2) return null;
  const userCollapsed = collapseWhitespace(user);
  const duplicated = parts.map((part) => whollyContainedInUser(part, userCollapsed));
  const kept: string[] = [];
  let removed = false;
  let index = 0;
  while (index < parts.length) {
    if (!duplicated[index]) {
      kept.push(parts[index]!);
      index += 1;
      continue;
    }
    let end = index + 1;
    while (end < parts.length && duplicated[end]) end += 1;
    const copyRun =
      end - index >= 2 &&
      (forwardCopyInUserOrder(parts, index, end, userCollapsed) ||
        identicalContainedRepetition(parts, index, end, userCollapsed)) &&
      !protectedDialogueCallback(parts, index, end);
    if (copyRun) {
      removed = true;
    } else {
      for (let keep = index; keep < end; keep += 1) kept.push(parts[keep]!);
    }
    index = end;
  }
  if (!removed || kept.length === 0) return null;
  return kept.join("\n\n");
}

export function applyGemini38HistoryEchoProjection<T extends { role: string; content: string }>(
  modelId: string | null | undefined,
  history: readonly T[]
): T[] {
  if (!isGemini38FlashHistoryEchoModel(modelId)) return history as T[];
  return omitContiguousReinjectedUserParagraphs(history);
}

/**
 * Project the pre-trim canonical history, then trim, so the budget sees the
 * shorter text. Returns `trimmedHistory` unchanged when the model is not
 * Gemini 3.8 Flash or when no paragraph run was omitted.
 */
export function gemini38ProviderHistoryFromCanonical(input: {
  modelId: string | null | undefined;
  canonicalRecentHistoryFull: ChatMsg[];
  trimmedHistory: ChatMsg[];
  historyTokenBudget: number;
  trim: TrimProviderHistoryOpts;
}): ChatMsg[] {
  if (!isGemini38FlashHistoryEchoModel(input.modelId)) return input.trimmedHistory;
  const projected = omitContiguousReinjectedUserParagraphs(input.canonicalRecentHistoryFull);
  if (projected === input.canonicalRecentHistoryFull) return input.trimmedHistory;
  return trimProviderHistoryToBudget(projected, input.historyTokenBudget, input.trim);
}

/** Exact stored reply, or the same reply after this projection, as sent. */
export function findProviderHistoryEchoRetainedAssistant(
  storedAssistant: string | null | undefined,
  history: ReadonlyArray<{ role?: string | null; content?: string | null }>
): string | null {
  const stored = String(storedAssistant ?? "");
  const storedTrim = stored.trim();
  if (!storedTrim) return null;
  for (const message of history) {
    if (message?.role !== "assistant") continue;
    const sent = String(message.content ?? "").trim();
    if (sent && sent === storedTrim) return sent;
  }
  for (let index = 0; index < history.length; index += 1) {
    const message = history[index];
    if (message?.role !== "assistant") continue;
    const sent = String(message.content ?? "").trim();
    if (!sent) continue;
    const previous = history[index - 1];
    if (previous?.role !== "user") continue;
    const projected = omitContiguousReinjectedUserParagraphs([
      { role: "user", content: String(previous.content ?? "") },
      { role: "assistant", content: stored },
    ]);
    const projectedTrim = projected[1]?.content.trim() ?? "";
    if (projectedTrim && projectedTrim === sent) return sent;
  }
  return null;
}
