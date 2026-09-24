import {
  EMPTY_SUGGESTED_REPLIES_CLIENT,
  SUGGESTED_REPLY_COUNT,
  SUGGESTED_REPLY_KINDS,
  SUGGESTED_REPLY_MAX_CHARS,
  SUGGESTED_REPLY_MIN_CHARS,
  type SuggestedRepliesClientFields,
  type SuggestedRepliesRecord,
  type SuggestedRepliesRecordSource,
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
  return value === "natural" || value === "twist" || value === "banter";
}

/** Explicit non-canonical kinds (e.g. escalate/soften/pivot) must not be relabeled. */
export function storedRepliesHaveStaleLegacyKinds(raw: unknown): boolean {
  if (!Array.isArray(raw)) return false;
  for (const item of raw) {
    if (typeof item === "string") continue;
    if (!item || typeof item !== "object") continue;
    const kind = (item as { kind?: unknown }).kind;
    if (typeof kind === "string" && !isSuggestedReplyKind(kind)) return true;
  }
  return false;
}

function parseRawItem(raw: unknown): { kind: SuggestedReplyKind | null; text: unknown } | null {
  if (typeof raw === "string") {
    return { kind: null, text: raw };
  }
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const obj = raw as { kind?: unknown; text?: unknown; reply?: unknown };
  const text = typeof obj.text === "string" ? obj.text : obj.reply;
  if (typeof text !== "string") return null;
  if (typeof obj.kind === "string" && !isSuggestedReplyKind(obj.kind)) {
    return null;
  }
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
    if (item.kind) {
      // Explicit duplicate categories are semantically invalid. Never relabel a
      // second natural/twist/banter item as another category just to fill 3 slots.
      if (byKind.has(item.kind)) return [];
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
      if (typeof obj.kind === "string" && !isSuggestedReplyKind(obj.kind)) {
        return null;
      }
      const kind = isSuggestedReplyKind(obj.kind) ? obj.kind : SUGGESTED_REPLY_KINDS[index];
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

    const rawReplies = parsed.items ?? parsed.replies;
    const source: SuggestedRepliesRecordSource =
      parsed.source === "standalone-extract"
        ? "standalone-extract"
        : "post-turn-shared";

    const baseFields = {
      extractedAt: typeof parsed.extractedAt === "string" ? parsed.extractedAt : "",
      source,
      generationSequence:
        typeof parsed.generationSequence === "number" &&
        Number.isInteger(parsed.generationSequence) &&
        parsed.generationSequence >= 0
          ? parsed.generationSequence
          : undefined,
      generationRequestId:
        typeof parsed.generationRequestId === "string"
          ? parsed.generationRequestId
          : parsed.generationRequestId === null
            ? null
            : undefined,
    };

    if (storedRepliesHaveStaleLegacyKinds(rawReplies)) {
      return {
        replies: [],
        ...baseFields,
        pending: false,
        failed: true,
        noRetry: true,
      };
    }

    const replies = coerceStoredReplies(rawReplies);
    return {
      replies,
      ...baseFields,
      pending: parsed.pending === true,
      failed: parsed.failed === true,
      ...(parsed.noRetry === true ? { noRetry: true } : {}),
      ...(parsed.terminalReason === "original_turn_ineligible"
        ? { terminalReason: parsed.terminalReason }
        : {}),
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
  // A stored record that is no longer pending has no writer left to wait for.
  // If it does not contain a valid canonical trio, treat it as terminal failure
  // even when a legacy row omitted/incorrectly stored the failed flag.
  const failed = !has && !pending;
  return {
    suggestedReplies: has ? normalized : [],
    suggestedRepliesPending: pending,
    suggestedRepliesRequested: record.terminalReason !== "original_turn_ineligible",
    suggestedRepliesFailed: failed,
  };
}

/** Poll GET while the server post-turn owner is still writing (read-only). */
export function clientNeedsSuggestedRepliesPoll(
  fields: SuggestedRepliesClientFields
): boolean {
  if (suggestedRepliesHaveContent(fields.suggestedReplies)) return false;
  if (fields.suggestedRepliesFailed === true && fields.suggestedRepliesPending !== true) {
    return false;
  }
  // GET /api/chat/suggested-replies is read-only. A completely missing record
  // cannot create work, so only poll generations the server/client explicitly
  // marked as requested or pending.
  return (
    fields.suggestedRepliesPending === true ||
    fields.suggestedRepliesRequested === true
  );
}

/** Show the bar only for ready replies or a generation explicitly awaiting replies. */
export function clientShouldShowSuggestedRepliesBar(
  fields: SuggestedRepliesClientFields
): boolean {
  if (suggestedRepliesHaveContent(fields.suggestedReplies)) return true;
  if (fields.suggestedRepliesFailed === true && fields.suggestedRepliesPending !== true) {
    return false;
  }
  return (
    fields.suggestedRepliesPending === true ||
    fields.suggestedRepliesRequested === true
  );
}
