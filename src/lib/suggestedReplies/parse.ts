import {
  EMPTY_SUGGESTED_REPLIES_CLIENT,
  SUGGESTED_REPLY_COUNT,
  SUGGESTED_REPLY_KINDS,
  SUGGESTED_REPLY_MAX_CHARS,
  SUGGESTED_REPLY_MIN_CHARS,
  type SuggestedRepliesClientFields,
  type SuggestedRepliesRecord,
  type SuggestedReplyItem,
  type SuggestedReplyKind,
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

function isSuggestedReplyKind(value: unknown): value is SuggestedReplyKind {
  return (
    value === "escalate" ||
    value === "soften" ||
    value === "pivot"
  );
}

function parseRawItem(raw: unknown): { kind: SuggestedReplyKind | null; text: unknown } | null {
  if (typeof raw === "string") {
    return { kind: null, text: raw };
  }
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const obj = raw as { kind?: unknown; text?: unknown; reply?: unknown };
  const text = typeof obj.text === "string" ? obj.text : obj.reply;
  if (typeof text !== "string") return null;
  return {
    kind: isSuggestedReplyKind(obj.kind) ? obj.kind : null,
    text,
  };
}

function collectRawItems(raw: unknown): Array<{ kind: SuggestedReplyKind | null; text: unknown }> {
  if (Array.isArray(raw)) {
    return raw.map(parseRawItem).filter((item): item is NonNullable<typeof item> => item != null);
  }
  if (!raw || typeof raw !== "object") return [];
  const obj = raw as { items?: unknown; replies?: unknown };
  if (Array.isArray(obj.items)) {
    return obj.items.map(parseRawItem).filter((item): item is NonNullable<typeof item> => item != null);
  }
  if (Array.isArray(obj.replies)) {
    return obj.replies.map(parseRawItem).filter((item): item is NonNullable<typeof item> => item != null);
  }
  return [];
}

export function normalizeSuggestedReplies(raw: unknown): SuggestedReplyItem[] {
  const collected = collectRawItems(raw);
  const byKind = new Map<SuggestedReplyKind, string>();
  const leftovers: string[] = [];
  const seen = new Set<string>();

  for (const item of collected) {
    const text = normalizeSuggestedReply(item.text);
    if (!text) continue;
    const key = dedupeKey(text);
    if (seen.has(key)) continue;
    seen.add(key);
    if (item.kind && !byKind.has(item.kind)) {
      byKind.set(item.kind, text);
    } else {
      leftovers.push(text);
    }
  }

  const out: SuggestedReplyItem[] = [];
  for (const kind of SUGGESTED_REPLY_KINDS) {
    const text = byKind.get(kind) ?? leftovers.shift();
    if (!text) return [];
    out.push({ kind, text });
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

export function parseSuggestedRepliesFromModelText(text: string): SuggestedReplyItem[] {
  const parsed = extractJsonObject(text);
  if (!parsed) return [];
  return normalizeSuggestedReplies(parsed);
}

function coerceStoredReplies(raw: unknown): SuggestedReplyItem[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((item, index) => {
      if (typeof item === "string") {
        const kind = SUGGESTED_REPLY_KINDS[index];
        return kind ? { kind, text: item } : null;
      }
      if (!item || typeof item !== "object") return null;
      const obj = item as { kind?: unknown; text?: unknown };
      if (typeof obj.text !== "string") return null;
      const kind = isSuggestedReplyKind(obj.kind)
        ? obj.kind
        : SUGGESTED_REPLY_KINDS[index];
      return kind ? { kind, text: obj.text } : null;
    })
    .filter((item): item is SuggestedReplyItem => item != null);
}

export function parseSuggestedRepliesRecord(
  raw: string | null | undefined
): SuggestedRepliesRecord | null {
  if (!raw?.trim()) return null;
  try {
    const parsed = JSON.parse(raw) as Partial<SuggestedRepliesRecord> & {
      replies?: unknown;
      items?: unknown;
    };
    if (!parsed || typeof parsed !== "object") return null;
    const replies = coerceStoredReplies(parsed.items ?? parsed.replies);
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

export function suggestedRepliesHaveContent(
  replies: SuggestedReplyItem[] | null | undefined
): boolean {
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
