import {
  EMPTY_SUGGESTED_REPLIES_CLIENT,
  SUGGESTED_REPLY_COUNT,
  SUGGESTED_REPLY_MAX_CHARS,
  SUGGESTED_REPLY_MIN_CHARS,
  type SuggestedRepliesClientFields,
  type SuggestedRepliesRecord,
} from "./types";

export function suggestedReplyCharCount(text: string): number {
  return Array.from(text).length;
}

function sliceByChars(text: string, maxChars: number): string {
  const chars = Array.from(text);
  if (chars.length <= maxChars) return text;
  return chars.slice(0, maxChars).join("").trimEnd();
}

export function normalizeSuggestedReply(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const trimmed = raw.replace(/\s+/g, " ").trim();
  if (!trimmed) return null;
  const clipped =
    suggestedReplyCharCount(trimmed) > SUGGESTED_REPLY_MAX_CHARS
      ? sliceByChars(trimmed, SUGGESTED_REPLY_MAX_CHARS)
      : trimmed;
  const count = suggestedReplyCharCount(clipped);
  if (count < SUGGESTED_REPLY_MIN_CHARS || count > SUGGESTED_REPLY_MAX_CHARS) {
    return null;
  }
  return clipped;
}

function dedupeKey(text: string): string {
  return text.replace(/\s+/g, "").toLowerCase();
}

export function normalizeSuggestedReplies(raw: unknown): string[] {
  const list = Array.isArray(raw)
    ? raw
    : raw && typeof raw === "object" && Array.isArray((raw as { replies?: unknown }).replies)
      ? (raw as { replies: unknown[] }).replies
      : [];
  const out: string[] = [];
  const seen = new Set<string>();
  for (const item of list) {
    const normalized = normalizeSuggestedReply(item);
    if (!normalized) continue;
    const key = dedupeKey(normalized);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(normalized);
    if (out.length >= SUGGESTED_REPLY_COUNT) break;
  }
  return out.length === SUGGESTED_REPLY_COUNT ? out : [];
}

export function extractJsonObject(text: string): Record<string, unknown> | null {
  const trimmed = text.trim();
  const fence = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = fence ? fence[1]!.trim() : trimmed;
  const start = candidate.indexOf("{");
  const end = candidate.lastIndexOf("}");
  if (start < 0 || end <= start) return null;
  try {
    return JSON.parse(candidate.slice(start, end + 1)) as Record<string, unknown>;
  } catch {
    return null;
  }
}

export function parseSuggestedRepliesFromModelText(text: string): string[] {
  const parsed = extractJsonObject(text);
  if (!parsed) return [];
  return normalizeSuggestedReplies(parsed);
}

export function parseSuggestedRepliesRecord(
  raw: string | null | undefined
): SuggestedRepliesRecord | null {
  if (!raw?.trim()) return null;
  try {
    const parsed = JSON.parse(raw) as Partial<SuggestedRepliesRecord> & {
      replies?: unknown;
    };
    if (!parsed || typeof parsed !== "object") return null;
    const replies = Array.isArray(parsed.replies)
      ? parsed.replies.filter((item): item is string => typeof item === "string")
      : [];
    return {
      replies,
      extractedAt: typeof parsed.extractedAt === "string" ? parsed.extractedAt : "",
      source: "background-deepseek",
      pending: parsed.pending === true,
      failed: parsed.failed === true,
    };
  } catch {
    return null;
  }
}

export function serializeSuggestedRepliesRecord(record: SuggestedRepliesRecord): string {
  return JSON.stringify(record);
}

export function suggestedRepliesHaveContent(replies: string[] | null | undefined): boolean {
  return (replies?.length ?? 0) === SUGGESTED_REPLY_COUNT;
}

export function resolveClientSuggestedReplies(
  record: SuggestedRepliesRecord | null
): SuggestedRepliesClientFields {
  if (!record) return EMPTY_SUGGESTED_REPLIES_CLIENT;
  const normalized = normalizeSuggestedReplies(record.replies);
  const has = suggestedRepliesHaveContent(normalized);
  const pending = record.pending === true && !has;
  const failed = record.failed === true && !has && !pending;
  return {
    suggestedReplies: has ? normalized : [],
    suggestedRepliesPending: pending,
    suggestedRepliesRequested: true,
    suggestedRepliesFailed: failed,
  };
}
