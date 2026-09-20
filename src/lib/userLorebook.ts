import type Database from "better-sqlite3";

import {
  LOREBOOK_CONTENT_MAX,
  LOREBOOK_ENTRY_MAX,
  LOREBOOK_KEYWORDS_PER_ENTRY,
  KEYWORD_FIELD_SPLIT,
  buildKeywordLorebookPromptBlock,
  ensureLorebookActiveEntriesTable,
  loadCarryoverLorebookMatches,
  lorebookEntryKey,
  matchKeywordLorebookEntryDetails,
  mergeMatches,
  parseStoredLorebookEntries,
  saveActiveLorebookMatches,
  serializeLorebookEntries,
  type KeywordLorebookEntry,
  type KeywordLorebookMatch,
} from "@/lib/keywordLorebooks";
import type { SubscriptionMemoryCapability } from "@/lib/subscriptionMemoryCapability";

export const LOREBOOK_SCOPE_CREATOR = "creator";
export const LOREBOOK_SCOPE_USER_CHAT = "user_chat";

export type UserLorebookStoredEntry = KeywordLorebookEntry & {
  enabled?: boolean;
};

export type UserLorebookEntryInput = {
  keywords: string;
  content: string;
  enabled?: boolean;
};

export type UserLorebookEntryEffectiveState = {
  effectiveActive: boolean;
  inactiveReason?: "disabled" | "entry_count_cap" | "content_cap";
};

export type UserLorebookView = {
  id: number;
  chatId: number;
  userId: number;
  name: string;
  entries: UserLorebookStoredEntry[];
  entryEffectiveStates: UserLorebookEntryEffectiveState[];
  capability: SubscriptionMemoryCapability;
  effectiveActiveEntryCount: number;
  effectiveActiveContentChars: number;
};

function tableHasColumn(db: Database.Database, table: string, column: string): boolean {
  const rows = db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>;
  return rows.some((row) => row.name === column);
}

export function ensureUserLorebookSchema(db: Database.Database): void {
  if (!tableHasColumn(db, "keyword_lorebooks", "scope")) {
    db.exec(`ALTER TABLE keyword_lorebooks ADD COLUMN scope TEXT NOT NULL DEFAULT 'creator'`);
  }
  if (!tableHasColumn(db, "keyword_lorebooks", "chat_id")) {
    db.exec(`ALTER TABLE keyword_lorebooks ADD COLUMN chat_id INTEGER`);
  }
  if (!tableHasColumn(db, "chats", "user_lorebook_id")) {
    db.exec(`ALTER TABLE chats ADD COLUMN user_lorebook_id INTEGER`);
  }
  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_keyword_lorebooks_user_chat
      ON keyword_lorebooks(scope, chat_id, creator_id);
  `);
  db.exec(`
    CREATE UNIQUE INDEX IF NOT EXISTS idx_keyword_lorebooks_one_user_chat_per_chat
      ON keyword_lorebooks(chat_id)
      WHERE scope = 'user_chat' AND chat_id IS NOT NULL;
  `);
  ensureLorebookActiveEntriesTable(db);
}

function normalizeKeywordsField(raw: unknown): string[] {
  if (Array.isArray(raw)) {
    return raw.map((k) => String(k).trim()).filter(Boolean).slice(0, LOREBOOK_KEYWORDS_PER_ENTRY);
  }
  return String(raw ?? "")
    .split(KEYWORD_FIELD_SPLIT)
    .map((k) => k.trim())
    .filter(Boolean)
    .slice(0, LOREBOOK_KEYWORDS_PER_ENTRY);
}

export function computeUserLorebookEntryEffectiveStates(
  entries: readonly UserLorebookStoredEntry[],
  capability: SubscriptionMemoryCapability
): UserLorebookEntryEffectiveState[] {
  const states: UserLorebookEntryEffectiveState[] = [];
  let activeCount = 0;
  let contentChars = 0;
  for (const entry of entries) {
    if (entry.enabled === false) {
      states.push({ effectiveActive: false, inactiveReason: "disabled" });
      continue;
    }
    if (activeCount >= capability.userLorebookActiveEntryMax) {
      states.push({ effectiveActive: false, inactiveReason: "entry_count_cap" });
      continue;
    }
    if (contentChars + entry.content.length > capability.userLorebookActiveContentMaxChars) {
      states.push({ effectiveActive: false, inactiveReason: "content_cap" });
      continue;
    }
    states.push({ effectiveActive: true });
    activeCount += 1;
    contentChars += entry.content.length;
  }
  return states;
}

export function parseStoredUserLorebookEntries(json: string): UserLorebookStoredEntry[] {
  try {
    const parsed = JSON.parse(json || "[]") as unknown[];
    if (!Array.isArray(parsed)) return [];
    const entries: UserLorebookStoredEntry[] = [];
    for (const item of parsed) {
      if (!item || typeof item !== "object") continue;
      const record = item as UserLorebookStoredEntry & { keywords?: unknown };
      const keywords = Array.isArray(record.keywords)
        ? record.keywords.map((k) => String(k).trim()).filter(Boolean).slice(0, LOREBOOK_KEYWORDS_PER_ENTRY)
        : String(record.keywords ?? "")
            .split(/[|│｜]/)
            .map((k) => k.trim())
            .filter(Boolean)
            .slice(0, LOREBOOK_KEYWORDS_PER_ENTRY);
      const content = String(record.content ?? "").trim().slice(0, LOREBOOK_CONTENT_MAX);
      if (keywords.length === 0 || !content) continue;
      entries.push({
        keywords,
        content,
        enabled: record.enabled !== false,
      });
    }
    return entries;
  } catch {
    return [];
  }
}

export function serializeUserLorebookEntries(entries: UserLorebookStoredEntry[]): string {
  return JSON.stringify(
    entries.map((entry) => ({
      keywords: entry.keywords,
      content: entry.content,
      enabled: entry.enabled !== false,
    }))
  );
}

export function normalizeUserLorebookEntries(
  raw: unknown
): { ok: true; entries: UserLorebookStoredEntry[] } | { ok: false; error: string } {
  if (!Array.isArray(raw)) {
    return { ok: false, error: "내 로어북 항목 형식이 올바르지 않습니다." };
  }
  if (raw.length > LOREBOOK_ENTRY_MAX) {
    return { ok: false, error: `로어북 항목은 최대 ${LOREBOOK_ENTRY_MAX}개까지 등록할 수 있습니다.` };
  }

  const entries: UserLorebookStoredEntry[] = [];
  for (let i = 0; i < raw.length; i++) {
    const item = raw[i];
    if (!item || typeof item !== "object") continue;
    const record = item as UserLorebookEntryInput;
    const enabled = record.enabled !== false;
    const keywords = normalizeKeywordsField(record.keywords);
    const content = String(record.content ?? "").trim();
    if (keywords.length === 0 && !content) continue;
    if (keywords.length === 0) {
      return { ok: false, error: `${i + 1}번째 항목의 키워드를 입력해 주세요.` };
    }
    if (!content) {
      return { ok: false, error: `${i + 1}번째 항목의 내용을 입력해 주세요.` };
    }
    if (content.length > LOREBOOK_CONTENT_MAX) {
      return {
        ok: false,
        error: `${i + 1}번째 항목 내용은 ${LOREBOOK_CONTENT_MAX}자 이하여야 합니다.`,
      };
    }
    entries.push({ keywords, content, enabled });
  }
  return { ok: true, entries };
}

export function selectEffectiveActiveUserLorebookEntries(
  entries: readonly UserLorebookStoredEntry[],
  capability: SubscriptionMemoryCapability
): KeywordLorebookEntry[] {
  const enabled = entries.filter((entry) => entry.enabled !== false);
  const active: KeywordLorebookEntry[] = [];
  let contentChars = 0;
  for (const entry of enabled) {
    if (active.length >= capability.userLorebookActiveEntryMax) break;
    if (contentChars + entry.content.length > capability.userLorebookActiveContentMaxChars) {
      continue;
    }
    active.push({ keywords: entry.keywords, content: entry.content });
    contentChars += entry.content.length;
  }
  return active;
}

export function applyUserLorebookTurnInjectionBudget(
  matches: readonly KeywordLorebookMatch[],
  maxChars: number
): KeywordLorebookMatch[] {
  const selected: KeywordLorebookMatch[] = [];
  let used = 0;
  const seen = new Set<string>();
  for (const match of matches) {
    const content = match.content.trim();
    if (!content || seen.has(content)) continue;
    const separator = selected.length > 0 ? 2 : 0;
    if (used + separator + content.length > maxChars) continue;
    seen.add(content);
    used += separator + content.length;
    selected.push(match);
  }
  return selected;
}

export function buildUserLorebookPromptBlock(contents: readonly string[]): string {
  if (contents.length === 0) return "";
  return `[USER LOREBOOK - 개인 키워드 매칭, 원문 그대로 적용]\n${contents.join("\n\n")}`;
}

export function getUserLorebookRowForChat(
  db: Database.Database,
  chatId: number,
  userId: number
): { id: number; entries_json: string; name: string } | null {
  ensureUserLorebookSchema(db);
  const chat = db
    .prepare(`SELECT user_lorebook_id FROM chats WHERE id=? AND user_id=?`)
    .get(chatId, userId) as { user_lorebook_id: number | null } | undefined;
  if (!chat?.user_lorebook_id) return null;
  const row = db
    .prepare(
      `SELECT id, entries_json, name FROM keyword_lorebooks
       WHERE id=? AND scope=? AND chat_id=? AND creator_id=?`
    )
    .get(chat.user_lorebook_id, LOREBOOK_SCOPE_USER_CHAT, chatId, userId) as
    | { id: number; entries_json: string; name: string }
    | undefined;
  return row ?? null;
}

export function getOrCreateUserLorebookForChat(
  db: Database.Database,
  chatId: number,
  userId: number
): { id: number; entries_json: string; name: string } {
  ensureUserLorebookSchema(db);
  const existing = getUserLorebookRowForChat(db, chatId, userId);
  if (existing) return existing;

  const byChatScope = db
    .prepare(
      `SELECT id, entries_json, name FROM keyword_lorebooks
       WHERE scope=? AND chat_id=? AND creator_id=?`
    )
    .get(LOREBOOK_SCOPE_USER_CHAT, chatId, userId) as
    | { id: number; entries_json: string; name: string }
    | undefined;
  if (byChatScope) {
    db.prepare(`UPDATE chats SET user_lorebook_id=? WHERE id=? AND user_id=?`).run(
      byChatScope.id,
      chatId,
      userId
    );
    return byChatScope;
  }

  const insert = db
    .prepare(
      `INSERT INTO keyword_lorebooks (creator_id, name, summary, entries_json, scope, chat_id)
       VALUES (?, ?, '', '[]', ?, ?)`
    )
    .run(userId, "내 로어북", LOREBOOK_SCOPE_USER_CHAT, chatId);
  const lorebookId = Number(insert.lastInsertRowid);
  db.prepare(`UPDATE chats SET user_lorebook_id=? WHERE id=? AND user_id=?`).run(
    lorebookId,
    chatId,
    userId
  );
  return { id: lorebookId, entries_json: "[]", name: "내 로어북" };
}

export function loadUserLorebookView(
  db: Database.Database,
  chatId: number,
  userId: number,
  capability: SubscriptionMemoryCapability
): UserLorebookView {
  const row = getOrCreateUserLorebookForChat(db, chatId, userId);
  const entries = parseStoredUserLorebookEntries(row.entries_json);
  const effective = selectEffectiveActiveUserLorebookEntries(entries, capability);
  const entryEffectiveStates = computeUserLorebookEntryEffectiveStates(entries, capability);
  return {
    id: row.id,
    chatId,
    userId,
    name: row.name,
    entries,
    entryEffectiveStates,
    capability,
    effectiveActiveEntryCount: effective.length,
    effectiveActiveContentChars: effective.reduce((sum, entry) => sum + entry.content.length, 0),
  };
}

export function saveUserLorebookEntries(
  db: Database.Database,
  chatId: number,
  userId: number,
  entries: UserLorebookStoredEntry[]
): void {
  const row = getOrCreateUserLorebookForChat(db, chatId, userId);
  ensureLorebookActiveEntriesTable(db);
  db.prepare(`DELETE FROM lorebook_active_entries WHERE chat_id=? AND lorebook_id=?`).run(
    chatId,
    row.id
  );
  db.prepare(
    `UPDATE keyword_lorebooks SET entries_json=?, updated_at=datetime('now') WHERE id=? AND scope=? AND chat_id=? AND creator_id=?`
  ).run(serializeUserLorebookEntries(entries), row.id, LOREBOOK_SCOPE_USER_CHAT, chatId, userId);
}

export function deleteUserLorebookForChat(
  db: Database.Database,
  chatId: number,
  userId?: number
): void {
  ensureUserLorebookSchema(db);
  const chat = userId != null
    ? (db.prepare(`SELECT user_lorebook_id FROM chats WHERE id=? AND user_id=?`).get(chatId, userId) as
        | { user_lorebook_id: number | null }
        | undefined)
    : (db.prepare(`SELECT user_lorebook_id FROM chats WHERE id=?`).get(chatId) as
        | { user_lorebook_id: number | null }
        | undefined);
  if (!chat?.user_lorebook_id) return;
  db.prepare(`DELETE FROM lorebook_active_entries WHERE chat_id=? AND lorebook_id=?`).run(
    chatId,
    chat.user_lorebook_id
  );
  db.prepare(`DELETE FROM keyword_lorebooks WHERE id=? AND scope=?`).run(
    chat.user_lorebook_id,
    LOREBOOK_SCOPE_USER_CHAT
  );
  if (userId != null) {
    db.prepare(`UPDATE chats SET user_lorebook_id=NULL WHERE id=? AND user_id=?`).run(chatId, userId);
  } else {
    db.prepare(`UPDATE chats SET user_lorebook_id=NULL WHERE id=?`).run(chatId);
  }
}

export function clearUserLorebookCarryoverEntry(
  db: Database.Database,
  chatId: number,
  lorebookId: number,
  entryKey: string
): void {
  ensureLorebookActiveEntriesTable(db);
  db.prepare(
    `DELETE FROM lorebook_active_entries WHERE chat_id=? AND lorebook_id=? AND entry_key=?`
  ).run(chatId, lorebookId, entryKey);
}

export function loadUserLorebookPromptBlockFromActivation(
  db: Database.Database,
  opts: {
    chatId: number;
    userId: number;
    capability: SubscriptionMemoryCapability;
    activation: { currentUserText?: string; recentRawText?: string };
    currentTurn?: number;
    excludeContents?: ReadonlySet<string>;
    onMatch?: (match: KeywordLorebookMatch) => void;
  }
): string {
  const row = getUserLorebookRowForChat(db, opts.chatId, opts.userId);
  if (!row) return "";

  const stored = parseStoredUserLorebookEntries(row.entries_json);
  const activeEntries = selectEffectiveActiveUserLorebookEntries(stored, opts.capability);
  const validEntryKeys = new Set(activeEntries.map((entry) => lorebookEntryKey(entry)));
  const direct = matchKeywordLorebookEntryDetails(activeEntries, opts.activation);
  const carryover =
    opts.currentTurn != null
      ? loadCarryoverLorebookMatches(db, {
          chatId: opts.chatId,
          lorebookId: row.id,
          currentTurn: opts.currentTurn,
        }).filter((match) => validEntryKeys.has(match.entryKey))
      : [];
  const merged = mergeMatches(direct, carryover);

  if (opts.currentTurn != null) {
    saveActiveLorebookMatches(db, {
      chatId: opts.chatId,
      lorebookId: row.id,
      currentTurn: opts.currentTurn,
      matches: direct,
    });
  }

  const exclude = opts.excludeContents ?? new Set<string>();
  const deduped = merged.filter((match) => !exclude.has(match.content.trim()));
  const budgeted = applyUserLorebookTurnInjectionBudget(
    deduped,
    opts.capability.userLorebookTurnInjectMaxChars
  );
  for (const match of budgeted) opts.onMatch?.(match);
  return buildUserLorebookPromptBlock(budgeted.map((match) => match.content));
}

export { buildKeywordLorebookPromptBlock, parseStoredLorebookEntries, serializeLorebookEntries };
