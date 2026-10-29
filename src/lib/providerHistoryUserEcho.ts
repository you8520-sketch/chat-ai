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

function whollyContainedInUser(paragraph: string, userCollapsed: string): boolean {
  const collapsed = collapseWhitespace(paragraph);
  return collapsed.length >= 2 && userCollapsed.includes(collapsed);
}

/**
 * Drop a blank-line paragraph only when it belongs to a contiguous run of at
 * least two paragraphs that are each wholly contained in the immediately
 * previous user message. An isolated match, a mixed paragraph, and a reply
 * that would become empty stay as stored.
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
    if (end - index >= 2) {
      removed = true;
    } else {
      kept.push(parts[index]!);
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
