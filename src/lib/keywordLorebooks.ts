export const LOREBOOK_NAME_LIMIT = 40;
export const LOREBOOK_SUMMARY_LIMIT = 100;
export const LOREBOOK_ENTRY_MAX = 100;
/** 로어북 항목 내용 최대 길이 — 제작 페이지 입력/검증 공통값 */
export const LOREBOOK_CONTENT_MAX = 800;
export const LOREBOOK_KEYWORDS_PER_ENTRY = 10;
export const LOREBOOK_ACTIVATION_RECENT_TURNS = 4;
export const LOREBOOK_ACTIVATION_RECENT_MESSAGES_FALLBACK = 8;
export const LOREBOOK_ACTIVATION_MAX_CHARS = 12_000;
export const LOREBOOK_ACTIVE_ENTRY_TTL_TURNS = 3;

/** Keyword delimiter for legacy text input. Newer UI can store keyword arrays directly. */
export const KEYWORD_FIELD_SPLIT = /[|│｜]/;

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

export type LorebookActivationMessage = {
  role: "user" | "assistant" | "system";
  content: string;
};

export type LorebookActivationTurn = {
  user: string;
  assistant: string;
};

export type LorebookActivationSource = "current_user" | "recent_raw" | "carryover";

export type KeywordLorebookMatch = {
  entryKey: string;
  content: string;
  keyword: string;
  source: LorebookActivationSource;
  carryoverTurnsRemaining?: number;
};

type ActiveLorebookRow = {
  entry_key: string;
  content: string;
  keyword: string;
  expires_after_turn: number;
};

export function parseKeywordField(raw: string): string[] {
  return String(raw ?? "")
    .split(KEYWORD_FIELD_SPLIT)
    .map((k) => k.trim())
    .filter(Boolean)
    .slice(0, LOREBOOK_KEYWORDS_PER_ENTRY);
}

function normalizeKeywords(raw: unknown): string[] {
  if (Array.isArray(raw)) {
    return raw.map((k) => String(k).trim()).filter(Boolean).slice(0, LOREBOOK_KEYWORDS_PER_ENTRY);
  }
  return parseKeywordField(String(raw ?? ""));
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
    const keywords = normalizeKeywords((item as KeywordLorebookEntryInput).keywords);
    const content = String((item as KeywordLorebookEntryInput).content ?? "").trim();
    if (keywords.length === 0 && !content) continue;
    if (keywords.length === 0) {
      return { ok: false, error: `${i + 1}번째 항목의 키워드를 입력해 주세요.` };
    }
    if (!content) {
      return { ok: false, error: `${i + 1}번째 항목의 내용을 입력해 주세요.` };
    }
    if (content.length > LOREBOOK_CONTENT_MAX) {
      return { ok: false, error: `${i + 1}번째 항목 내용은 ${LOREBOOK_CONTENT_MAX}자 이하여야 합니다.` };
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
        keywords: normalizeKeywords((e as unknown as { keywords?: unknown }).keywords),
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

export function stripLorebookActivationInternalContent(raw: string): string {
  let text = String(raw ?? "");
  text = text.replace(/<<<STATUS_VALUES>>>[\s\S]*?(?:<<<END_STATUS>>>|$)/gi, "\n");
  text = text.replace(/<([a-z][\w:-]*)\b[^>]*(?:data-status|status-widget|status-window)[^>]*>[\s\S]*?<\/\1>/gi, "\n");
  text = text.replace(/<script[\s\S]*?<\/script>/gi, "\n");
  text = text.replace(/<style[\s\S]*?<\/style>/gi, "\n");
  text = text.replace(/<[^>]+>/g, " ");
  text = text.replace(/\{[\s\S]*?(?:extracted_facts|runtime_events|source_turn|trigger_id|event_key|status_key)[\s\S]*?\}/gi, "\n");
  text = text.replace(
    /^\s*(?:extracted_facts|runtime_events|source_turn|trigger_id|event_key|status_key|category|subject|attribute|value)\s*[:=].*$/gim,
    ""
  );
  text = text.replace(/^\s*\[(?:EPISODIC MEMORY|LONG_TERM_MEMORY|LOREBOOK|TRIGGERED SCENARIO EVENTS)[^\]]*\].*$/gim, "");
  text = text.replace(/\b[a-z][a-z0-9]+(?:_[a-z0-9]+){1,}\b/g, " ");
  return text.replace(/[ \t]+/g, " ").replace(/\n{3,}/g, "\n\n").trim();
}

function excerptHeadTail(text: string, maxChars: number): string {
  const trimmed = text.trim();
  if (trimmed.length <= maxChars) return trimmed;
  if (maxChars <= 80) return trimmed.slice(0, maxChars).trim();
  const half = Math.floor((maxChars - 16) / 2);
  return `${trimmed.slice(0, half).trim()}\n...\n${trimmed.slice(trimmed.length - half).trim()}`;
}

function flattenTurns(turns: LorebookActivationTurn[]): LorebookActivationMessage[] {
  const messages: LorebookActivationMessage[] = [];
  for (const turn of turns) {
    messages.push({ role: "user", content: turn.user });
    messages.push({ role: "assistant", content: turn.assistant });
  }
  return messages;
}

function buildRecentRawText(input: {
  recentMessages: LorebookActivationMessage[];
  maxChars: number;
}): { text: string; truncated: boolean } {
  const visible = input.recentMessages.filter((message) => message.role === "user" || message.role === "assistant");
  if (visible.length === 0 || input.maxChars <= 0) return { text: "", truncated: false };

  const perMessageBudget = Math.max(800, Math.floor(input.maxChars / visible.length));
  const chunks: string[] = [];
  let used = 0;
  let truncated = false;

  for (let i = visible.length - 1; i >= 0; i--) {
    const clean = stripLorebookActivationInternalContent(visible[i]!.content);
    if (!clean) continue;
    const excerpt = excerptHeadTail(clean, perMessageBudget);
    if (clean.length > excerpt.length) truncated = true;
    const additional = excerpt.length + (chunks.length > 0 ? 1 : 0);
    if (used + additional > input.maxChars) {
      truncated = true;
      continue;
    }
    chunks.unshift(excerpt);
    used += additional;
  }

  return { text: chunks.join("\n").trim(), truncated };
}

export function buildLorebookActivationText(input: {
  currentUserMessage?: string | null;
  recentMessages?: LorebookActivationMessage[];
  recentTurns?: LorebookActivationTurn[];
  recentTurnLimit?: number;
  recentMessageLimit?: number;
  maxChars?: number;
}): {
  currentUserText: string;
  recentRawText: string;
  activationText: string;
  recentRawCount: number;
  recentRawTurnCount: number;
  maxChars: number;
  truncated: boolean;
} {
  const maxChars = Math.max(200, input.maxChars ?? LOREBOOK_ACTIVATION_MAX_CHARS);
  const currentUserText = stripLorebookActivationInternalContent(input.currentUserMessage ?? "");
  const recentTurnLimit = Math.max(0, input.recentTurnLimit ?? LOREBOOK_ACTIVATION_RECENT_TURNS);
  const recentMessageLimit = Math.max(0, input.recentMessageLimit ?? LOREBOOK_ACTIVATION_RECENT_MESSAGES_FALLBACK);
  const recentTurns = input.recentTurns?.slice(-recentTurnLimit) ?? [];
  const recentMessages =
    recentTurns.length > 0
      ? flattenTurns(recentTurns)
      : (input.recentMessages ?? [])
          .filter((message) => message.role === "user" || message.role === "assistant")
          .slice(-recentMessageLimit);
  const recentBudget = Math.max(0, maxChars - currentUserText.length);
  const recent = buildRecentRawText({ recentMessages, maxChars: recentBudget });
  const activationText = [currentUserText, recent.text].filter(Boolean).join("\n").trim();

  return {
    currentUserText,
    recentRawText: recent.text,
    activationText,
    recentRawCount: recentMessages.length,
    recentRawTurnCount: recentTurns.length,
    maxChars,
    truncated: recent.truncated || activationText.length > maxChars,
  };
}

function entryKey(entry: KeywordLorebookEntry): string {
  let hash = 2166136261;
  const raw = `${entry.keywords.join("|")}\n${entry.content}`;
  for (let i = 0; i < raw.length; i++) {
    hash ^= raw.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return `entry_${(hash >>> 0).toString(36)}`;
}

export function matchKeywordLorebookEntryDetails(
  entries: KeywordLorebookEntry[],
  activation: { currentUserText?: string; recentRawText?: string }
): KeywordLorebookMatch[] {
  if (entries.length === 0) return [];
  const currentText = (activation.currentUserText ?? "").trim();
  const recentText = (activation.recentRawText ?? "").trim();
  if (!currentText && !recentText) return [];
  const upperCurrent = currentText.toUpperCase();
  const upperRecent = recentText.toUpperCase();

  const matched: KeywordLorebookMatch[] = [];
  const seen = new Set<string>();
  for (const entry of entries) {
    let hitKeyword = "";
    let hitSource: LorebookActivationSource | null = null;
    for (const kw of entry.keywords) {
      const keyword = kw.trim();
      if (!keyword) continue;
      const upperKeyword = keyword.toUpperCase();
      if (upperCurrent.includes(upperKeyword)) {
        hitKeyword = keyword;
        hitSource = "current_user";
        break;
      }
      if (upperRecent.includes(upperKeyword)) {
        hitKeyword = keyword;
        hitSource = "recent_raw";
        break;
      }
    }
    if (!hitSource) continue;
    if (seen.has(entry.content)) continue;
    seen.add(entry.content);
    matched.push({ entryKey: entryKey(entry), content: entry.content, keyword: hitKeyword, source: hitSource });
  }
  return matched;
}

export function ensureLorebookActiveEntriesTable(db: import("better-sqlite3").Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS lorebook_active_entries (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      chat_id INTEGER NOT NULL,
      lorebook_id INTEGER NOT NULL,
      entry_key TEXT NOT NULL,
      content TEXT NOT NULL,
      keyword TEXT NOT NULL DEFAULT '',
      last_source TEXT NOT NULL DEFAULT 'recent_raw',
      last_turn INTEGER NOT NULL,
      expires_after_turn INTEGER NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE(chat_id, lorebook_id, entry_key)
    );
    CREATE INDEX IF NOT EXISTS idx_lorebook_active_entries_chat
      ON lorebook_active_entries(chat_id, lorebook_id, expires_after_turn);
  `);
}

export function loadCarryoverLorebookMatches(
  db: import("better-sqlite3").Database,
  opts: { chatId: number; lorebookId: number; currentTurn: number }
): KeywordLorebookMatch[] {
  ensureLorebookActiveEntriesTable(db);
  const rows = db
    .prepare(
      `SELECT entry_key, content, keyword, expires_after_turn
       FROM lorebook_active_entries
       WHERE chat_id=? AND lorebook_id=? AND expires_after_turn >= ?
       ORDER BY updated_at DESC, id DESC`
    )
    .all(opts.chatId, opts.lorebookId, opts.currentTurn) as ActiveLorebookRow[];
  return rows.map((row) => ({
    entryKey: row.entry_key,
    content: row.content,
    keyword: row.keyword,
    source: "carryover",
    carryoverTurnsRemaining: Math.max(0, row.expires_after_turn - opts.currentTurn + 1),
  }));
}

export function saveActiveLorebookMatches(
  db: import("better-sqlite3").Database,
  opts: {
    chatId: number;
    lorebookId: number;
    currentTurn: number;
    matches: KeywordLorebookMatch[];
    ttlTurns?: number;
  }
): void {
  const directMatches = opts.matches.filter((match) => match.source === "current_user" || match.source === "recent_raw");
  if (directMatches.length === 0) return;
  ensureLorebookActiveEntriesTable(db);
  const ttl = Math.max(0, opts.ttlTurns ?? LOREBOOK_ACTIVE_ENTRY_TTL_TURNS);
  const expires = opts.currentTurn + ttl;
  const stmt = db.prepare(
    `INSERT INTO lorebook_active_entries
       (chat_id, lorebook_id, entry_key, content, keyword, last_source, last_turn, expires_after_turn, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
     ON CONFLICT(chat_id, lorebook_id, entry_key) DO UPDATE SET
       content=excluded.content,
       keyword=excluded.keyword,
       last_source=excluded.last_source,
       last_turn=excluded.last_turn,
       expires_after_turn=excluded.expires_after_turn,
       updated_at=datetime('now')`
  );
  for (const match of directMatches) {
    stmt.run(opts.chatId, opts.lorebookId, match.entryKey, match.content, match.keyword, match.source, opts.currentTurn, expires);
  }
}

function mergeMatches(direct: KeywordLorebookMatch[], carryover: KeywordLorebookMatch[]): KeywordLorebookMatch[] {
  const merged: KeywordLorebookMatch[] = [];
  const seen = new Set<string>();
  for (const match of [...direct, ...carryover]) {
    if (seen.has(match.content)) continue;
    seen.add(match.content);
    merged.push(match);
  }
  return merged;
}

/** Legacy API: current-user style scan only. New chat route should use activation + carryover API. */
export function matchKeywordLorebookEntries(entries: KeywordLorebookEntry[], scanText: string): string[] {
  const text = stripLorebookActivationInternalContent(scanText);
  return matchKeywordLorebookEntryDetails(entries, { currentUserText: text, recentRawText: "" }).map((match) => match.content);
}

export function buildKeywordLorebookPromptBlock(contents: string[]): string {
  if (contents.length === 0) return "";
  return `[KEYWORD LOREBOOK - 최근 visible 대화/현재 입력 키워드 매칭, 원문 그대로 적용]\n${contents.join("\n\n")}`;
}

export function loadKeywordLorebookPromptBlock(
  db: import("better-sqlite3").Database,
  lorebookId: number | null | undefined,
  scanText: string
): string {
  if (lorebookId == null || !Number.isFinite(lorebookId) || lorebookId <= 0) return "";
  const row = db
    .prepare("SELECT entries_json FROM keyword_lorebooks WHERE id = ?")
    .get(lorebookId) as { entries_json: string } | undefined;
  if (!row) return "";
  const entries = parseStoredLorebookEntries(row.entries_json);
  return buildKeywordLorebookPromptBlock(matchKeywordLorebookEntries(entries, scanText));
}

export function loadKeywordLorebookPromptBlockFromActivation(
  db: import("better-sqlite3").Database,
  lorebookId: number | null | undefined,
  activation: { currentUserText?: string; recentRawText?: string },
  opts?: {
    chatId?: number;
    currentTurn?: number;
    ttlTurns?: number;
    onMatch?: (match: KeywordLorebookMatch) => void;
  }
): string {
  if (lorebookId == null || !Number.isFinite(lorebookId) || lorebookId <= 0) return "";
  const row = db
    .prepare("SELECT entries_json FROM keyword_lorebooks WHERE id = ?")
    .get(lorebookId) as { entries_json: string } | undefined;
  if (!row) return "";
  const entries = parseStoredLorebookEntries(row.entries_json);
  const direct = matchKeywordLorebookEntryDetails(entries, activation);
  const carryover =
    opts?.chatId && opts.currentTurn != null
      ? loadCarryoverLorebookMatches(db, {
          chatId: opts.chatId,
          lorebookId,
          currentTurn: opts.currentTurn,
        })
      : [];
  const matches = mergeMatches(direct, carryover);
  if (opts?.chatId && opts.currentTurn != null) {
    saveActiveLorebookMatches(db, {
      chatId: opts.chatId,
      lorebookId,
      currentTurn: opts.currentTurn,
      matches: direct,
      ttlTurns: opts.ttlTurns,
    });
  }
  for (const match of matches) opts?.onMatch?.(match);
  return buildKeywordLorebookPromptBlock(matches.map((match) => match.content));
}
