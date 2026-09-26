import type Database from "better-sqlite3";

import {
  LOREBOOK_CONTENT_MAX,
  LOREBOOK_KEYWORDS_PER_ENTRY,
  LOREBOOK_NAME_LIMIT,
  LOREBOOK_SUMMARY_LIMIT,
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
export const CREATOR_LOREBOOK_MIGRATION_FLAG = "creator_lorebook_attachments_v1";

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
  invalidLegacyReferences: number;
  multiEntryCreatorRows: number;
};

export class CreatorLorebookMigrationError extends Error {
  readonly code: string;

  constructor(message: string, code: string) {
    super(message);
    this.name = "CreatorLorebookMigrationError";
    this.code = code;
  }
}

export class CreatorUnitInvariantViolationError extends Error {
  readonly entryCount: number;

  constructor(entryCount: number) {
    super(`CREATOR_UNIT_INVARIANT_VIOLATION: creator lorebook has ${entryCount} entries`);
    this.name = "CreatorUnitInvariantViolationError";
    this.entryCount = entryCount;
  }
}

const SOURCE_PRIORITY: Record<LorebookActivationSource, number> = {
  current_user: 0,
  recent_raw: 1,
  carryover: 2,
};

type LegacyCreatorLorebookRow = {
  id: number;
  creator_id: number;
  name: string;
  summary: string;
  entries_json: string;
};

type LegacyCharacterRow = {
  id: number;
  creator_id: number | null;
  lorebook_id: number;
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

export function schemaFlagApplied(db: Database.Database, key: string): boolean {
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

function parseCreatorLorebookKeywordsRaw(raw: unknown): string[] {
  if (Array.isArray(raw)) {
    return raw.map((k) => String(k).trim()).filter(Boolean);
  }
  return String(raw ?? "")
    .split(/[|│｜]/)
    .map((k) => k.trim())
    .filter(Boolean);
}

export function classifyCreatorLorebookEntryCount(entriesJson: string): "empty" | "single" | "multi" {
  const count = parseStoredLorebookEntries(entriesJson).length;
  if (count === 0) return "empty";
  if (count === 1) return "single";
  return "multi";
}

export function parseCreatorLorebookUnitEntry(entriesJson: string): KeywordLorebookEntry | null {
  const entries = parseStoredLorebookEntries(entriesJson);
  if (entries.length === 0) return null;
  if (entries.length > 1) {
    throw new CreatorUnitInvariantViolationError(entries.length);
  }
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
  const keywords = parseCreatorLorebookKeywordsRaw(record.keywords);
  const content = String(record.content ?? "").trim();
  if (keywords.length === 0) {
    return { ok: false, error: "활성화 키워드를 1개 이상 입력해 주세요." };
  }
  if (keywords.length > LOREBOOK_KEYWORDS_PER_ENTRY) {
    return {
      ok: false,
      error: `키워드는 최대 ${LOREBOOK_KEYWORDS_PER_ENTRY}개까지 등록할 수 있습니다.`,
    };
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

/** Canonical creator-scope lorebook writer (API route and official supply staging). */
export function insertCreatorLorebookForOwner(
  db: Database.Database,
  input: { creatorId: number; name: unknown; summary: unknown; keywords: unknown; content: unknown }
):
  | { ok: true; id: number; entry: KeywordLorebookEntry }
  | { ok: false; error: string } {
  const name = String(input.name ?? "").trim().slice(0, LOREBOOK_NAME_LIMIT);
  const summary = String(input.summary ?? "").trim().slice(0, LOREBOOK_SUMMARY_LIMIT);
  const normalized = normalizeCreatorLorebookUnit({
    keywords: input.keywords,
    content: input.content,
  });
  if (!name) return { ok: false, error: "로어북 이름을 입력해 주세요." };
  if (!normalized.ok) return { ok: false, error: normalized.error };

  const info = db
    .prepare(
      `INSERT INTO keyword_lorebooks (creator_id, name, summary, entries_json, scope, updated_at)
       VALUES (?, ?, ?, ?, 'creator', datetime('now'))`
    )
    .run(input.creatorId, name, summary, serializeCreatorLorebookUnit(normalized.entry));
  return { ok: true, id: Number(info.lastInsertRowid), entry: normalized.entry };
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

function listCreatorScopeLorebookIds(db: Database.Database): number[] {
  const rows = db
    .prepare(
      `SELECT id FROM keyword_lorebooks
       WHERE COALESCE(scope, ?) = ?`
    )
    .all(LOREBOOK_SCOPE_CREATOR, LOREBOOK_SCOPE_CREATOR) as Array<{ id: number }>;
  return rows.map((row) => row.id);
}

function isCreatorScopeLorebookId(db: Database.Database, lorebookId: number): boolean {
  const row = db
    .prepare(
      `SELECT id FROM keyword_lorebooks
       WHERE id=? AND COALESCE(scope, ?) = ?`
    )
    .get(lorebookId, LOREBOOK_SCOPE_CREATOR, LOREBOOK_SCOPE_CREATOR) as { id: number } | undefined;
  return Boolean(row);
}

export function clearCreatorScopeCarryoverForChat(
  db: Database.Database,
  chatId: number,
  lorebookId: number
): void {
  if (!isCreatorScopeLorebookId(db, lorebookId)) return;
  ensureLorebookActiveEntriesTable(db);
  db.prepare("DELETE FROM lorebook_active_entries WHERE chat_id=? AND lorebook_id=?").run(
    chatId,
    lorebookId
  );
}

export function clearCreatorScopeCarryoverForLorebook(
  db: Database.Database,
  lorebookId: number
): void {
  if (!isCreatorScopeLorebookId(db, lorebookId)) return;
  ensureLorebookActiveEntriesTable(db);
  db.prepare("DELETE FROM lorebook_active_entries WHERE lorebook_id=?").run(lorebookId);
}

function clearDetachedCreatorCarryoverForCharacter(
  db: Database.Database,
  characterId: number,
  detachedCreatorLorebookIds: readonly number[]
): void {
  if (detachedCreatorLorebookIds.length === 0) return;
  ensureLorebookActiveEntriesTable(db);
  if (!tableExists(db, "chats")) return;

  const chatRows = db
    .prepare("SELECT id FROM chats WHERE character_id=?")
    .all(characterId) as Array<{ id: number }>;
  if (chatRows.length === 0) return;

  const scopedDetached = detachedCreatorLorebookIds.filter((id) =>
    isCreatorScopeLorebookId(db, id)
  );
  if (scopedDetached.length === 0) return;

  const placeholders = scopedDetached.map(() => "?").join(",");
  const deleteStmt = db.prepare(
    `DELETE FROM lorebook_active_entries
     WHERE chat_id=?
       AND lorebook_id IN (${placeholders})
       AND lorebook_id IN (
         SELECT id FROM keyword_lorebooks WHERE COALESCE(scope, ?) = ?
       )`
  );
  for (const chat of chatRows) {
    deleteStmt.run(chat.id, ...scopedDetached, LOREBOOK_SCOPE_CREATOR, LOREBOOK_SCOPE_CREATOR);
  }
}

export function clearStaleCreatorScopeCarryoverForChat(
  db: Database.Database,
  chatId: number,
  attachedCreatorLorebookIds: readonly number[]
): void {
  ensureLorebookActiveEntriesTable(db);
  const creatorScopeSubquery = `SELECT id FROM keyword_lorebooks WHERE COALESCE(scope, ?) = ?`;

  if (attachedCreatorLorebookIds.length === 0) {
    db.prepare(
      `DELETE FROM lorebook_active_entries
       WHERE chat_id=?
         AND lorebook_id IN (${creatorScopeSubquery})`
    ).run(chatId, LOREBOOK_SCOPE_CREATOR, LOREBOOK_SCOPE_CREATOR);
    return;
  }

  const placeholders = attachedCreatorLorebookIds.map(() => "?").join(",");
  db.prepare(
    `DELETE FROM lorebook_active_entries
     WHERE chat_id=?
       AND lorebook_id IN (${creatorScopeSubquery})
       AND lorebook_id NOT IN (${placeholders})`
  ).run(
    chatId,
    LOREBOOK_SCOPE_CREATOR,
    LOREBOOK_SCOPE_CREATOR,
    ...attachedCreatorLorebookIds
  );
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
  const oldAttachmentIds = listCharacterCreatorLorebookAttachmentIds(db, characterId);
  const newAttachmentSet = new Set(lorebookIds);
  const detachedIds = oldAttachmentIds.filter((id) => !newAttachmentSet.has(id));

  const tx = db.transaction(() => {
    db.prepare("DELETE FROM character_lorebook_attachments WHERE character_id=?").run(characterId);
    const insert = db.prepare(
      `INSERT INTO character_lorebook_attachments (character_id, lorebook_id, position)
       VALUES (?, ?, ?)`
    );
    lorebookIds.forEach((lorebookId, position) => {
      insert.run(characterId, lorebookId, position);
    });
    clearDetachedCreatorCarryoverForCharacter(db, characterId, detachedIds);
  });
  tx();
}

export function deleteCharacterCreatorLorebookAttachments(
  db: Database.Database,
  characterId: number
): void {
  if (!tableExists(db, "character_lorebook_attachments")) return;
  const oldIds = listCharacterCreatorLorebookAttachmentIds(db, characterId);
  db.prepare("DELETE FROM character_lorebook_attachments WHERE character_id=?").run(characterId);
  clearDetachedCreatorCarryoverForCharacter(db, characterId, oldIds);
}

export function deleteCreatorLorebookAttachmentsForLorebook(
  db: Database.Database,
  lorebookId: number
): void {
  if (!tableExists(db, "character_lorebook_attachments")) return;
  db.prepare("DELETE FROM character_lorebook_attachments WHERE lorebook_id=?").run(lorebookId);
}

export function deleteCreatorLorebookForOwner(
  db: Database.Database,
  lorebookId: number,
  creatorId: number
): boolean {
  const existing = db
    .prepare(
      `SELECT id FROM keyword_lorebooks
       WHERE id=? AND creator_id=? AND COALESCE(scope, ?)=?`
    )
    .get(lorebookId, creatorId, LOREBOOK_SCOPE_CREATOR, LOREBOOK_SCOPE_CREATOR) as
    | { id: number }
    | undefined;
  if (!existing) return false;

  const tx = db.transaction(() => {
    clearCreatorScopeCarryoverForLorebook(db, lorebookId);
    deleteCreatorLorebookAttachmentsForLorebook(db, lorebookId);
    db.prepare(
      `DELETE FROM keyword_lorebooks
       WHERE id=? AND creator_id=? AND COALESCE(scope, ?)=?`
    ).run(lorebookId, creatorId, LOREBOOK_SCOPE_CREATOR, LOREBOOK_SCOPE_CREATOR);
  });
  tx();
  return true;
}

/** @deprecated use clearCreatorScopeCarryoverForChat */
export function clearCreatorLorebookCarryoverForChat(
  db: Database.Database,
  chatId: number,
  lorebookId: number
): void {
  clearCreatorScopeCarryoverForChat(db, chatId, lorebookId);
}

/** @deprecated use clearCreatorScopeCarryoverForLorebook */
export function clearCreatorLorebookCarryoverForLorebook(
  db: Database.Database,
  lorebookId: number
): void {
  clearCreatorScopeCarryoverForLorebook(db, lorebookId);
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
  const attachedLorebookIds = attached.map((item) => item.lorebookId);

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
    clearStaleCreatorScopeCarryoverForChat(db, opts.chatId, attachedLorebookIds);
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

function loadLegacyCreatorLorebooks(db: Database.Database): LegacyCreatorLorebookRow[] {
  const hasScope = tableHasColumn(db, "keyword_lorebooks", "scope");
  return (
    hasScope
      ? db
          .prepare(
            `SELECT id, creator_id, name, summary, entries_json
             FROM keyword_lorebooks
             WHERE COALESCE(scope, ?) = ?
             ORDER BY id ASC`
          )
          .all(LOREBOOK_SCOPE_CREATOR, LOREBOOK_SCOPE_CREATOR)
      : db
          .prepare(
            `SELECT id, creator_id, name, summary, entries_json
             FROM keyword_lorebooks
             ORDER BY id ASC`
          )
          .all()
  ) as LegacyCreatorLorebookRow[];
}

function loadLegacyAttachedCharacters(db: Database.Database): LegacyCharacterRow[] {
  if (!tableHasColumn(db, "characters", "lorebook_id")) return [];
  const hasCreatorId = tableHasColumn(db, "characters", "creator_id");
  return db
    .prepare(
      hasCreatorId
        ? `SELECT id, creator_id, lorebook_id FROM characters WHERE lorebook_id IS NOT NULL ORDER BY id ASC`
        : `SELECT id, NULL AS creator_id, lorebook_id FROM characters WHERE lorebook_id IS NOT NULL ORDER BY id ASC`
    )
    .all() as LegacyCharacterRow[];
}

function flattenUnitName(baseName: string, index: number): string {
  if (index === 0) return baseName.slice(0, 40);
  return `${baseName} #${index + 1}`.slice(0, 40);
}

export function auditExistingCreatorContainerData(db: Database.Database): CreatorLorebookMigrationAudit {
  const containers = loadLegacyCreatorLorebooks(db);
  const distribution: Record<string, number> = {};
  let maxEntriesInAttachedContainer = 0;
  let multiEntryCreatorRows = 0;

  const flattenUnitCounts = new Map<number, number>();
  for (const row of containers) {
    const count = parseStoredLorebookEntries(row.entries_json).length;
    const key = String(count);
    distribution[key] = (distribution[key] ?? 0) + 1;
    if (count > 1) multiEntryCreatorRows += 1;
    flattenUnitCounts.set(row.id, Math.max(count, 1));
  }

  const attachedCharacters = loadLegacyAttachedCharacters(db);
  const exceeding: number[] = [];
  let invalidLegacyReferences = 0;
  const lorebookById = new Map(containers.map((row) => [row.id, row]));

  for (const character of attachedCharacters) {
    const lorebook = lorebookById.get(character.lorebook_id);
    if (!lorebook) {
      invalidLegacyReferences += 1;
      continue;
    }
    if (character.creator_id != null && character.creator_id !== lorebook.creator_id) {
      invalidLegacyReferences += 1;
      continue;
    }
    const entryCount = parseStoredLorebookEntries(lorebook.entries_json).length;
    const unitCount = entryCount === 0 ? 0 : Math.max(entryCount, 1);
    maxEntriesInAttachedContainer = Math.max(maxEntriesInAttachedContainer, entryCount);
    if (unitCount > CHARACTER_CREATOR_LOREBOOK_ATTACH_LIMIT) {
      exceeding.push(character.id);
    }
  }

  return {
    containerCount: containers.length,
    attachedCharacterCount: attachedCharacters.length,
    entryCountDistribution: distribution,
    maxEntriesInAttachedContainer,
    charactersExceedingAttachLimitAfterFlatten: exceeding,
    invalidLegacyReferences,
    multiEntryCreatorRows,
  };
}

function preflightCreatorLorebookMigration(db: Database.Database): {
  lorebooks: LegacyCreatorLorebookRow[];
  attachedCharacters: LegacyCharacterRow[];
  plannedUnitCounts: Map<number, number>;
} {
  const lorebooks = loadLegacyCreatorLorebooks(db);
  const attachedCharacters = loadLegacyAttachedCharacters(db);
  const lorebookById = new Map(lorebooks.map((row) => [row.id, row]));
  const plannedUnitCounts = new Map<number, number>();

  for (const row of lorebooks) {
    const entryCount = parseStoredLorebookEntries(row.entries_json).length;
    plannedUnitCounts.set(row.id, entryCount === 0 ? 0 : Math.max(entryCount, 1));
  }

  for (const character of attachedCharacters) {
    const lorebook = lorebookById.get(character.lorebook_id);
    if (!lorebook) {
      throw new CreatorLorebookMigrationError(
        `character ${character.id} references missing lorebook ${character.lorebook_id}`,
        "LEGACY_MISSING_LOREBOOK"
      );
    }
    if (character.creator_id != null && character.creator_id !== lorebook.creator_id) {
      throw new CreatorLorebookMigrationError(
        `character ${character.id} lorebook ${character.lorebook_id} creator mismatch`,
        "LEGACY_CREATOR_MISMATCH"
      );
    }
    const unitCount = plannedUnitCounts.get(lorebook.id) ?? 0;
    if (unitCount > CHARACTER_CREATOR_LOREBOOK_ATTACH_LIMIT) {
      throw new CreatorLorebookMigrationError(
        `character ${character.id} would exceed attach limit after flatten (${unitCount})`,
        "LEGACY_ATTACH_LIMIT_EXCEEDED"
      );
    }
  }

  return { lorebooks, attachedCharacters, plannedUnitCounts };
}

function flattenCreatorLibraryOnce(
  db: Database.Database,
  lorebooks: readonly LegacyCreatorLorebookRow[]
): Map<number, number[]> {
  const mapping = new Map<number, number[]>();
  const updateRow = db.prepare(
    `UPDATE keyword_lorebooks
     SET entries_json=?, updated_at=datetime('now')
     WHERE id=? AND COALESCE(scope, ?) = ?`
  );
  const insertRow = db.prepare(
    `INSERT INTO keyword_lorebooks (creator_id, name, summary, entries_json, scope, updated_at)
     VALUES (?, ?, ?, ?, ?, datetime('now'))`
  );

  for (const row of lorebooks) {
    const entries = parseStoredLorebookEntries(row.entries_json);
    if (entries.length <= 1) {
      mapping.set(row.id, entries.length === 1 ? [row.id] : []);
      continue;
    }

    updateRow.run(
      serializeLorebookEntries([entries[0]!]),
      row.id,
      LOREBOOK_SCOPE_CREATOR,
      LOREBOOK_SCOPE_CREATOR
    );
    const unitIds = [row.id];
    for (let index = 1; index < entries.length; index++) {
      const info = insertRow.run(
        row.creator_id,
        flattenUnitName(row.name, index),
        row.summary,
        serializeLorebookEntries([entries[index]!]),
        LOREBOOK_SCOPE_CREATOR
      );
      unitIds.push(Number(info.lastInsertRowid));
    }
    mapping.set(row.id, unitIds);
  }

  return mapping;
}

function migrateCharacterAttachmentsFromLegacyFk(
  db: Database.Database,
  attachedCharacters: readonly LegacyCharacterRow[],
  flattenMap: ReadonlyMap<number, number[]>
): void {
  const deleteAttachments = db.prepare(
    "DELETE FROM character_lorebook_attachments WHERE character_id=?"
  );
  const insertAttachment = db.prepare(
    `INSERT INTO character_lorebook_attachments (character_id, lorebook_id, position)
     VALUES (?, ?, ?)`
  );
  const clearLegacyFk = db.prepare("UPDATE characters SET lorebook_id=NULL WHERE id=?");

  for (const character of attachedCharacters) {
    deleteAttachments.run(character.id);
    const unitIds = flattenMap.get(character.lorebook_id) ?? [];
    unitIds.forEach((lorebookId, position) => {
      insertAttachment.run(character.id, lorebookId, position);
    });
    clearLegacyFk.run(character.id);
  }
}

function createCharacterLorebookAttachmentsSchema(db: Database.Database): void {
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
}

export function migrateCreatorLorebookLegacyState(db: Database.Database): void {
  ensureCreatorLorebookSchema(db);
}

export function ensureCreatorLorebookSchema(db: Database.Database): void {
  if (schemaFlagApplied(db, CREATOR_LOREBOOK_MIGRATION_FLAG)) {
    createCharacterLorebookAttachmentsSchema(db);
    return;
  }

  const preflight = preflightCreatorLorebookMigration(db);

  const tx = db.transaction(() => {
    createCharacterLorebookAttachmentsSchema(db);
    const flattenMap = flattenCreatorLibraryOnce(db, preflight.lorebooks);
    migrateCharacterAttachmentsFromLegacyFk(db, preflight.attachedCharacters, flattenMap);
    markSchemaFlag(db, CREATOR_LOREBOOK_MIGRATION_FLAG);
  });
  tx();
}

export function creatorLorebookEntryCount(entriesJson: string): number {
  const state = classifyCreatorLorebookEntryCount(entriesJson);
  return state === "single" ? 1 : 0;
}

export function isAttachableCreatorLorebookScope(scope: string | null | undefined): boolean {
  return (scope ?? LOREBOOK_SCOPE_CREATOR) === LOREBOOK_SCOPE_CREATOR;
}

export function rejectUserChatScopeLorebook(scope: string | null | undefined): boolean {
  return scope === LOREBOOK_SCOPE_USER_CHAT;
}
