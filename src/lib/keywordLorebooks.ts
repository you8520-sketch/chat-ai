export const LOREBOOK_NAME_LIMIT = 40;
export const LOREBOOK_SUMMARY_LIMIT = 100;
export const LOREBOOK_ENTRY_MAX = 100;
export const LOREBOOK_CONTENT_MAX = 400;
export const LOREBOOK_KEYWORDS_PER_ENTRY = 5;

/** 키워드 구분자: │ ｜ | */
export const KEYWORD_FIELD_SPLIT = /[|｜│]/;

export type KeywordLorebookEntryInput = {
  keywords: string;
  content: string;
};

export type KeywordLorebookEntry = {
  keywords: string[];
  content: string;
};

export type KeywordLorebookRow = {
  id: number;
  creator_id: number;
  name: string;
  summary: string;
  entries_json: string;
  created_at: string;
  updated_at: string;
};

export type KeywordLorebookListItem = {
  id: number;
  name: string;
  summary: string;
  entryCount: number;
  createdAt: string;
  updatedAt: string;
};

export function parseKeywordField(raw: string): string[] {
  return String(raw ?? "")
    .split(KEYWORD_FIELD_SPLIT)
    .map((k) => k.trim())
    .filter(Boolean)
    .slice(0, LOREBOOK_KEYWORDS_PER_ENTRY);
}

export function normalizeLorebookEntries(
  raw: unknown
): { ok: true; entries: KeywordLorebookEntry[] } | { ok: false; error: string } {
  if (!Array.isArray(raw)) {
    return { ok: false, error: "로어북 항목 형식이 올바르지 않습니다." };
  }
  if (raw.length > LOREBOOK_ENTRY_MAX) {
    return { ok: false, error: `로어북 항목은 최대 ${LOREBOOK_ENTRY_MAX}개까지 등록할 수 있습니다.` };
  }

  const entries: KeywordLorebookEntry[] = [];
  for (let i = 0; i < raw.length; i++) {
    const item = raw[i];
    if (!item || typeof item !== "object") {
      return { ok: false, error: `${i + 1}번째 항목 형식이 올바르지 않습니다.` };
    }
    const keywords = parseKeywordField(String((item as KeywordLorebookEntryInput).keywords ?? ""));
    const content = String((item as KeywordLorebookEntryInput).content ?? "").trim();
    if (keywords.length === 0 && !content) continue;
    if (keywords.length === 0) {
      return { ok: false, error: `${i + 1}번째 항목에 키워드를 입력해 주세요.` };
    }
    if (!content) {
      return { ok: false, error: `${i + 1}번째 항목에 내용을 입력해 주세요.` };
    }
    if (content.length > LOREBOOK_CONTENT_MAX) {
      return {
        ok: false,
        error: `${i + 1}번째 항목 내용은 ${LOREBOOK_CONTENT_MAX}자 이하여야 합니다.`,
      };
    }
    entries.push({ keywords, content });
  }

  return { ok: true, entries };
}

export function parseStoredLorebookEntries(json: string): KeywordLorebookEntry[] {
  try {
    const parsed = JSON.parse(json || "[]") as KeywordLorebookEntry[];
    if (!Array.isArray(parsed)) return [];
    return parsed
      .map((e) => ({
        keywords: Array.isArray(e.keywords)
          ? e.keywords.filter((k): k is string => typeof k === "string").slice(0, LOREBOOK_KEYWORDS_PER_ENTRY)
          : parseKeywordField(String((e as unknown as { keywords?: string }).keywords ?? "")),
        content: String(e.content ?? "").trim().slice(0, LOREBOOK_CONTENT_MAX),
      }))
      .filter((e) => e.keywords.length > 0 && e.content);
  } catch {
    return [];
  }
}

export function serializeLorebookEntries(entries: KeywordLorebookEntry[]): string {
  return JSON.stringify(entries);
}

export function rowToLorebookListItem(row: KeywordLorebookRow): KeywordLorebookListItem {
  const entries = parseStoredLorebookEntries(row.entries_json);
  return {
    id: row.id,
    name: row.name,
    summary: row.summary,
    entryCount: entries.length,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/** 유저 입력에 키워드가 포함되면 해당 항목 내용 반환 (중복 내용 제거) */
export function matchKeywordLorebookEntries(
  entries: KeywordLorebookEntry[],
  userText: string
): string[] {
  const text = userText.trim();
  if (!text || entries.length === 0) return [];

  const matched: string[] = [];
  const seen = new Set<string>();
  for (const entry of entries) {
    const hit = entry.keywords.some((kw) => kw.length > 0 && text.includes(kw));
    if (!hit) continue;
    if (seen.has(entry.content)) continue;
    seen.add(entry.content);
    matched.push(entry.content);
  }
  return matched;
}

/** 프롬프트 주입 — 번역·改変 없이 원문 사용 */
export function buildKeywordLorebookPromptBlock(contents: string[]): string {
  if (contents.length === 0) return "";
  return `[KEYWORD LOREBOOK — 유저 입력 키워드 매칭 · 원문 그대로 적용 · 번역·요약·改変 금지]\n${contents.join("\n\n")}`;
}

export function loadKeywordLorebookPromptBlock(
  db: import("better-sqlite3").Database,
  lorebookId: number | null | undefined,
  userMessage: string
): string {
  if (lorebookId == null || !Number.isFinite(lorebookId) || lorebookId <= 0) return "";
  const row = db
    .prepare("SELECT entries_json FROM keyword_lorebooks WHERE id = ?")
    .get(lorebookId) as { entries_json: string } | undefined;
  if (!row) return "";
  const entries = parseStoredLorebookEntries(row.entries_json);
  return buildKeywordLorebookPromptBlock(matchKeywordLorebookEntries(entries, userMessage));
}
