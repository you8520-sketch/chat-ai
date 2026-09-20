import type Database from "better-sqlite3";

import {
  LOREBOOK_CONTENT_MAX,
  LOREBOOK_KEYWORDS_PER_ENTRY,
  LOREBOOK_ACTIVE_ENTRY_TTL_TURNS,
  buildKeywordLorebookPromptBlock,
  ensureLorebookActiveEntriesTable,
  loadCarryoverLorebookMatches,
  lorebookEntryKey,
  matchKeywordLorebookEntryDetails,
  parseStoredLorebookEntries,
  saveActiveLorebookMatches,
  serializeLorebookEntries,
  type KeywordLorebookEntry,
  type KeywordLorebookMatch,
  type LorebookActivationSource,
} from "@/lib/keywordLorebooks";
import { LOREBOOK_SCOPE_CREATOR, LOREBOOK_SCOPE_USER_CHAT } from "@/lib/userLorebook";

export const CHARACTER_CREATOR_LOREBOOK_ATTACH_LIMIT = 20;
export const CREATOR_LOREBOOK_TURN_INJECT_MAX_CHARS = 4000;

export type CreatorLorebookAttachmentRow = {
  character_id: number;
  lorebook_id: number;
  position: number;
};

export type CreatorLorebookUnitInput = {
  keywords: string;
  content: string;
};

export type CreatorLorebookMatch = KeywordLorebookMatch & {
  lorebookId: number;
  attachmentPosition: number;
};

export type CreatorLorebookMigrationAudit = {
  containerCount: number;
  attachedCharacterCount: number;
  entryCountDistribution: Record<string, number>;
  maxEntriesInAttachedContainer: number;
  charactersExceedingAttachLimitAfterFlatten: number[];
};

const SOURCE_PRIORITY: Record<LorebookActivationSource, number> = {
  current_user: 0,
  recent_raw: 1,
  carryover: 2,
};

function tableExists(db: Database.Database, table: string): boolean {
  return Boolean(
    db.prepare(`SELECT 1 AS ok FROM sqlite_master WHERE type='table' AND name=?`).get(table)
  );
}

function tableHasColumn(db: Database.Database, table: string, column: string): boolean {
  if (!tableExists(db, table)) return false;
  const rows = db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>;
  return rows.some((row) => row.name === column);
}

function schemaFlagApplied(db: Database.Database, key: string): boolean {
  if (!tableExists(db, "_schema_flags")) return false;
  return Boolean(db.prepare("SELECT 1 AS ok FROM _schema_flags WHERE key=?").get(key));
}

function markSchemaFlag(db: Database.Database, key: string): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS _schema_flags (
      key TEXT PRIMARY KEY,
      applied_at TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `);
  db.prepare("INSERT OR IGNORE INTO _schema_flags (key) VALUES (?)").run(key);
}

function normalizeKeywordsField(raw: unknown): string[] {
  if (Array.isArray(raw)) {
    return raw.map((k) => String(k).trim()).filter(Boolean).slice(0, LOREBOOK_KEYWORDS_PER_ENTRY);
  }
  return String(raw ?? "")
    .split(/[|│｜]/)
    .map((k) => k.trim())
    .filter(Boolean)
    .slice(0, LOREBOOK_KEYWORDS_PER_ENTRY);
}

export function parseCreatorLorebookUnitEntry(entriesJson: string): KeywordLorebookEntry | null {
  const entries = parseStoredLorebookEntries(entriesJson);
  return entries[0] ?? null;
}

export function normalizeCreatorLorebookUnit(
  raw: unknown
): { ok: true; entry: KeywordLorebookEntry } | { ok: false; error: string } {
  if (!raw || typeof raw !== "object") {
    return { ok: false, error: "로어북 내용 형식이 올바르지 않습니다." };
  }
  const record = raw as CreatorLorebookUnitInput & { entries?: unknown };
  if (Array.isArray(record.entries)) {
    return { ok: false, error: "제작자 로어북은 항목 1개만 등록할 수 있습니다." };
  }
  const keywords = normalizeKeywordsField(record.keywords);
  const content = String(record.content ?? "").trim();
  if (keywords.length === 0) {
    return { ok: false, error: "활성화 키워드를 1개 이상 입력해 주세요." };
  }
  if (!content) {
    return { ok: false, error: "로어북 내용을 입력해 주세요." };
  }
  if (content.length > LOREBOOK_CONTENT_MAX) {
    return {
      ok: false,
      error: `로어북 내용은 ${LOREBOOK_CONTENT_MAX}자 이하여야 합니다.`,
    };
  }
  return { ok: true, entry: { keywords, content } };
}

export function serializeCreatorLorebookUnit(entry: KeywordLorebookEntry): string {
  return serializeLorebookEntries([entry]);
}

export function normalizeCreatorLorebookIds(raw: unknown): number[] {
  const source = Array.isArray(raw) ? raw : raw != null && raw !== "" ? [raw] : [];
  const ids: number[] = [];
  const seen = new Set<number>();
  for (const item of source) {
    const id = Number(item);
    if (!Number.isInteger(id) || id <= 0 || seen.has(id)) continue;
    seen.add(id);
    ids.push(id);
  }
  return ids;
}

export function validateCreatorLorebookAttachmentIds(
  db: Database.Database,
  creatorId: number,
  lorebookIds: readonly number[]
): { ok: true } | { ok: false; error: string; status: number } {
  if (lorebookIds.length > CHARACTER_CREATOR_LOREBOOK_ATTACH_LIMIT) {
    return {
      ok: false,
      error: `캐릭터당 제작자 로어북은 최대 ${CHARACTER_CREATOR_LOREBOOK_ATTACH_LIMIT}개까지 연결할 수 있습니다.`,
      status: 400,
    };
  }
  if (lorebookIds.length === 0) return { ok: true };

  const placeholders = lorebookIds.map(() => "?").join(",");
  const rows = db
    .prepare(
      `SELECT id FROM keyword_lorebooks
       WHERE id IN (${placeholders})
         AND creator_id = ?
         AND COALESCE(scope, ?) = ?`
    )
    .all(...lorebookIds, creatorId, LOREBOOK_SCOPE_CREATOR, LOREBOOK_SCOPE_CREATOR) as Array<{ id: number }>;

  if (rows.length !== lorebookIds.length) {
    return {
      ok: false,
      error: "연결할 수 없는 로어북 ID가 포함되어 있습니다.",
      status: 400,
    };
  }
  return { ok: true };
}

export function listCharacterCreatorLorebookAttachmentIds(
  db: Database.Database,
  characterId: number
): number[] {
  if (!tableExists(db, "character_lorebook_attachments")) return [];
  const rows = db
    .prepare(
      `SELECT lorebook_id FROM character_lorebook_attachments
       WHERE character_id=?
       ORDER BY position ASC, lorebook_id ASC`
    )
    .all(characterId) as Array<{ lorebook_id: number }>;
  return rows.map((row) => row.lorebook_id);
}

export function replaceCharacterCreatorLorebookAttachments(
  db: Database.Database,
  characterId: number,
  lorebookIds: readonly number[]
): void {
  ensureCreatorLorebookSchema(db);
  const tx = db.transaction(() => {
    db.prepare("DELETE FROM character_lorebook_attachments WHERE character_id=?").run(characterId);
    const insert = db.prepare(
      `INSERT INTO character_lorebook_attachments (character_id, lorebook_id, position)
       VALUES (?, ?, ?)`
    );
    lorebookIds.forEach((lorebookId, position) => {
      insert.run(characterId, lorebookId, position);
    });
  });
  tx();
}

export function deleteCharacterCreatorLorebookAttachments(
  db: Database.Database,
  characterId: number
): void {
  if (!tableExists(db, "character_lorebook_attachments")) return;
  db.prepare("DELETE FROM character_lorebook_attachments WHERE character_id=?").run(characterId);
}

export function deleteCreatorLorebookAttachmentsForLorebook(
  db: Database.Database,
  lorebookId: number
): void {
  if (!tableExists(db, "character_lorebook_attachments")) return;
  db.prepare("DELETE FROM character_lorebook_attachments WHERE lorebook_id=?").run(lorebookId);
}

export function clearCreatorLorebookCarryoverForChat(
  db: Database.Database,
  chatId: number,
  lorebookId: number
): void {
  ensureLorebookActiveEntriesTable(db);
  db.prepare("DELETE FROM lorebook_active_entries WHERE chat_id=? AND lorebook_id=?").run(
    chatId,
    lorebookId
  );
}

export function clearCreatorLorebookCarryoverForLorebook(
  db: Database.Database,
  lorebookId: number
): void {
  ensureLorebookActiveEntriesTable(db);
  db.prepare("DELETE FROM lorebook_active_entries WHERE lorebook_id=?").run(lorebookId);
}

export function sortCreatorLorebookMatchesByPriority(
  matches: readonly CreatorLorebookMatch[]
): CreatorLorebookMatch[] {
  return [...matches].sort((a, b) => {
    const sourceDelta = SOURCE_PRIORITY[a.source] - SOURCE_PRIORITY[b.source];
    if (sourceDelta !== 0) return sourceDelta;
    if (a.attachmentPosition !== b.attachmentPosition) {
      return a.attachmentPosition - b.attachmentPosition;
    }
    return a.lorebookId - b.lorebookId;
  });
}

export function dedupeCreatorLorebookMatchesByContent(
  matches: readonly CreatorLorebookMatch[]
): CreatorLorebookMatch[] {
  const deduped: CreatorLorebookMatch[] = [];
  const seen = new Set<string>();
  for (const match of matches) {
    const content = match.content.trim();
    if (!content || seen.has(content)) continue;
    seen.add(content);
    deduped.push(match);
  }
  return deduped;
}

export function applyCreatorLorebookTurnInjectionBudget(
  matches: readonly CreatorLorebookMatch[],
  maxChars: number = CREATOR_LOREBOOK_TURN_INJECT_MAX_CHARS
): CreatorLorebookMatch[] {
  const selected: CreatorLorebookMatch[] = [];
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

export function buildCreatorLorebookPromptBlock(contents: readonly string[]): string {
  return buildKeywordLorebookPromptBlock([...contents]);
}

type AttachedCreatorLorebook = {
  lorebookId: number;
  position: number;
  entry: KeywordLorebookEntry;
};

function loadAttachedCreatorLorebooks(
  db: Database.Database,
  characterId: number
): AttachedCreatorLorebook[] {
  ensureCreatorLorebookSchema(db);
  const rows = db
    .prepare(
      `SELECT a.lorebook_id, a.position, k.entries_json
       FROM character_lorebook_attachments a
       JOIN keyword_lorebooks k ON k.id = a.lorebook_id
       WHERE a.character_id = ?
         AND COALESCE(k.scope, ?) = ?
       ORDER BY a.position ASC, a.lorebook_id ASC`
    )
    .all(characterId, LOREBOOK_SCOPE_CREATOR, LOREBOOK_SCOPE_CREATOR) as Array<{
    lorebook_id: number;
    position: number;
    entries_json: string;
  }>;

  const attached: AttachedCreatorLorebook[] = [];
  for (const row of rows) {
    const entry = parseCreatorLorebookUnitEntry(row.entries_json);
    if (!entry) continue;
    attached.push({
      lorebookId: row.lorebook_id,
      position: row.position,
      entry,
    });
  }
  return attached;
}

export function loadAttachedCreatorLorebooksPromptBlockFromActivation(
  db: Database.Database,
  characterId: number,
  activation: { currentUserText?: string; recentRawText?: string },
  opts?: {
    chatId?: number;
    currentTurn?: number;
    ttlTurns?: number;
    onMatch?: (match: CreatorLorebookMatch) => void;
  }
): string {
  const attached = loadAttachedCreatorLorebooks(db, characterId);
  if (attached.length === 0) return "";

  const attachedLorebookIds = new Set(attached.map((item) => item.lorebookId));
  const directMatches: CreatorLorebookMatch[] = [];
  for (const item of attached) {
    const hits = matchKeywordLorebookEntryDetails([item.entry], activation);
    for (const hit of hits) {
      directMatches.push({
        ...hit,
        lorebookId: item.lorebookId,
        attachmentPosition: item.position,
      });
    }
  }

  const carryoverMatches: CreatorLorebookMatch[] = [];
  if (opts?.chatId != null && opts.currentTurn != null) {
    for (const item of attached) {
      const carryover = loadCarryoverLorebookMatches(db, {
        chatId: opts.chatId,
        lorebookId: item.lorebookId,
        currentTurn: opts.currentTurn,
      }).filter((match) => match.entryKey === lorebookEntryKey(item.entry));
      for (const hit of carryover) {
        carryoverMatches.push({
          ...hit,
          lorebookId: item.lorebookId,
          attachmentPosition: item.position,
        });
      }
    }
  }

  if (opts?.chatId != null && opts.currentTurn != null) {
    for (const item of attached) {
      const itemDirect = directMatches.filter((match) => match.lorebookId === item.lorebookId);
      saveActiveLorebookMatches(db, {
        chatId: opts.chatId,
        lorebookId: item.lorebookId,
        currentTurn: opts.currentTurn,
        matches: itemDirect,
        ttlTurns: opts.ttlTurns ?? LOREBOOK_ACTIVE_ENTRY_TTL_TURNS,
      });
    }

    const staleRows = db
      .prepare(
        `SELECT DISTINCT lorebook_id FROM lorebook_active_entries
         WHERE chat_id=? AND lorebook_id NOT IN (${[...attachedLorebookIds].map(() => "?").join(",") || "NULL"})`
      )
      .all(opts.chatId, ...attachedLorebookIds) as Array<{ lorebook_id: number }>;
    for (const row of staleRows) {
      clearCreatorLorebookCarryoverForChat(db, opts.chatId, row.lorebook_id);
    }
  }

  const merged = sortCreatorLorebookMatchesByPriority([
    ...directMatches,
    ...carryoverMatches.filter(
      (carryover) =>
        !directMatches.some(
          (direct) =>
            direct.lorebookId === carryover.lorebookId && direct.content.trim() === carryover.content.trim()
        )
    ),
  ]);
  const deduped = dedupeCreatorLorebookMatchesByContent(merged);
  const budgeted = applyCreatorLorebookTurnInjectionBudget(deduped);
  for (const match of budgeted) opts?.onMatch?.(match);
  return buildCreatorLorebookPromptBlock(budgeted.map((match) => match.content));
}

export function auditExistingCreatorContainerData(db: Database.Database): CreatorLorebookMigrationAudit {
  const hasScope = tableHasColumn(db, "keyword_lorebooks", "scope");
  const containers = (
    hasScope
      ? db
          .prepare(
            `SELECT id, entries_json FROM keyword_lorebooks
             WHERE COALESCE(scope, ?) = ?`
          )
          .all(LOREBOOK_SCOPE_CREATOR, LOREBOOK_SCOPE_CREATOR)
      : db.prepare(`SELECT id, entries_json FROM keyword_lorebooks`).all()
  ) as Array<{ id: number; entries_json: string }>;

  const distribution: Record<string, number> = {};
  let maxEntriesInAttachedContainer = 0;
  for (const row of containers) {
    const count = parseStoredLorebookEntries(row.entries_json).length;
    const key = String(count);
    distribution[key] = (distribution[key] ?? 0) + 1;
  }

  const attachedCharacters = db
    .prepare(
      `SELECT id, lorebook_id FROM characters
       WHERE lorebook_id IS NOT NULL`
    )
    .all() as Array<{ id: number; lorebook_id: number }>;

  const exceeding: number[] = [];
  for (const character of attachedCharacters) {
    const row = containers.find((container) => container.id === character.lorebook_id);
    const entryCount = row ? parseStoredLorebookEntries(row.entries_json).length : 0;
    maxEntriesInAttachedContainer = Math.max(maxEntriesInAttachedContainer, entryCount);
    if (entryCount > CHARACTER_CREATOR_LOREBOOK_ATTACH_LIMIT) {
      exceeding.push(character.id);
    }
  }

  return {
    containerCount: containers.length,
    attachedCharacterCount: attachedCharacters.length,
    entryCountDistribution: distribution,
    maxEntriesInAttachedContainer,
    charactersExceedingAttachLimitAfterFlatten: exceeding,
  };
}

function migrateLegacyCharacterLorebookAttachments(db: Database.Database): void {
  if (!tableHasColumn(db, "characters", "lorebook_id")) return;

  const audit = auditExistingCreatorContainerData(db);
  if (audit.charactersExceedingAttachLimitAfterFlatten.length > 0) {
    console.error(
      "[CreatorLorebook] migration blocked: characters would exceed attach limit after flatten:",
      audit.charactersExceedingAttachLimitAfterFlatten
    );
    return;
  }

  const hasCreatorId = tableHasColumn(db, "characters", "creator_id");
  const attachedCharacters = db
    .prepare(
      hasCreatorId
        ? `SELECT id, creator_id, lorebook_id FROM characters WHERE lorebook_id IS NOT NULL`
        : `SELECT id, NULL AS creator_id, lorebook_id FROM characters WHERE lorebook_id IS NOT NULL`
    )
    .all() as Array<{ id: number; creator_id: number | null; lorebook_id: number }>;

  const tx = db.transaction(() => {
    for (const character of attachedCharacters) {
      const lorebook = db
        .prepare(
          `SELECT id, creator_id, name, summary, entries_json
           FROM keyword_lorebooks
           WHERE id=? AND COALESCE(scope, ?) = ?`
        )
        .get(character.lorebook_id, LOREBOOK_SCOPE_CREATOR, LOREBOOK_SCOPE_CREATOR) as
        | {
            id: number;
            creator_id: number;
            name: string;
            summary: string;
            entries_json: string;
          }
        | undefined;

      db.prepare("DELETE FROM character_lorebook_attachments WHERE character_id=?").run(character.id);

      if (!lorebook || character.creator_id !== lorebook.creator_id) {
        db.prepare("UPDATE characters SET lorebook_id=NULL WHERE id=?").run(character.id);
        continue;
      }

      const entries = parseStoredLorebookEntries(lorebook.entries_json);
      if (entries.length === 0) {
        db.prepare("UPDATE characters SET lorebook_id=NULL WHERE id=?").run(character.id);
        continue;
      }

      const insertAttachment = db.prepare(
        `INSERT INTO character_lorebook_attachments (character_id, lorebook_id, position)
         VALUES (?, ?, ?)`
      );

      if (entries.length === 1) {
        insertAttachment.run(character.id, lorebook.id, 0);
      } else {
        const insertLorebook = db.prepare(
          `INSERT INTO keyword_lorebooks (creator_id, name, summary, entries_json, scope, updated_at)
           VALUES (?, ?, ?, ?, ?, datetime('now'))`
        );
        entries.forEach((entry, index) => {
          const info = insertLorebook.run(
            lorebook.creator_id,
            `${lorebook.name} #${index + 1}`.slice(0, 40),
            lorebook.summary,
            serializeLorebookEntries([entry]),
            LOREBOOK_SCOPE_CREATOR
          );
          insertAttachment.run(character.id, Number(info.lastInsertRowid), index);
        });
      }

      db.prepare("UPDATE characters SET lorebook_id=NULL WHERE id=?").run(character.id);
    }
  });
  tx();
}

export function ensureCreatorLorebookSchema(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS character_lorebook_attachments (
      character_id INTEGER NOT NULL,
      lorebook_id INTEGER NOT NULL,
      position INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      PRIMARY KEY (character_id, lorebook_id)
    );
    CREATE INDEX IF NOT EXISTS idx_character_lorebook_attachments_lorebook
      ON character_lorebook_attachments(lorebook_id, character_id);
  `);

  const migrationKey = "creator_lorebook_attachments_v1";
  if (schemaFlagApplied(db, migrationKey)) return;

  migrateLegacyCharacterLorebookAttachments(db);
  markSchemaFlag(db, migrationKey);
}

export function creatorLorebookEntryCount(entriesJson: string): number {
  const entries = parseStoredLorebookEntries(entriesJson);
  return entries.length > 0 ? 1 : 0;
}

export function isAttachableCreatorLorebookScope(scope: string | null | undefined): boolean {
  return (scope ?? LOREBOOK_SCOPE_CREATOR) === LOREBOOK_SCOPE_CREATOR;
}

export function rejectUserChatScopeLorebook(scope: string | null | undefined): boolean {
  return scope === LOREBOOK_SCOPE_USER_CHAT;
}
