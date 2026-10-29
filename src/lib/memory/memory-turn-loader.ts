import { getDb } from "@/lib/db";
import { OPENING_TURN_USER } from "@/lib/chatGreetingContext";
import { filterCanonicalMessageRows, isCanonAdoptedScene } from "@/lib/oocSceneRender";
import type Database from "better-sqlite3";
import {
  getMemorySourceBoundary,
  getMemorySourceBoundaryCore,
  isMemorySourceEligible,
  type MemorySourceBoundary,
} from "./memory-source-boundary";

export type ChatTurnWithMessageIds = {
  turnNumber: number;
  user: string;
  assistant: string;
  userMessageId: number | null;
  assistantMessageId: number;
  assistantOnly?: boolean;
};

type ChatMessageRow = {
  id: number;
  role: string;
  content: string;
  model: string;
  user_message_id: number | null;
  usage?: unknown;
};

function loadChatMessageRowsCore(
  db: Database.Database,
  chatId: number
): ChatMessageRow[] {
  return db
    .prepare(
      "SELECT id, role, content, model, user_message_id, usage FROM messages WHERE chat_id=? ORDER BY id ASC"
    )
    .all(chatId) as ChatMessageRow[];
}

/** User text is required to number canon turns. Assistant bodies stay out of this scan. */
function loadChatMessageIndexRowsCore(
  db: Database.Database,
  chatId: number
): ChatMessageRow[] {
  return db
    .prepare(
      `SELECT id, role, model, user_message_id, usage,
              CASE WHEN role = 'user' THEN content ELSE '' END AS content
       FROM messages WHERE chat_id=? ORDER BY id ASC`
    )
    .all(chatId) as ChatMessageRow[];
}

function pairChatTurnsWithMessageIds(rows: ChatMessageRow[]): ChatTurnWithMessageIds[] {

  const userById = new Map(
    rows.filter((row) => row.role === "user").map((row) => [row.id, row.content] as const)
  );
  const turns: ChatTurnWithMessageIds[] = [];
  let pendingUser: string | null = null;
  let pendingUserId: number | null = null;
  let playableTurnNumber = 0;

  for (const row of rows) {
    if (row.role === "user") {
      pendingUser = row.content;
      pendingUserId = row.id;
      continue;
    }
    if (row.role !== "assistant") continue;
    if (row.model === "greeting") {
      turns.push({
        turnNumber: 0,
        user: OPENING_TURN_USER,
        assistant: row.content,
        userMessageId: null,
        assistantMessageId: row.id,
      });
      continue;
    }

    const linkedId = Number.isSafeInteger(row.user_message_id) && Number(row.user_message_id) > 0
      ? Number(row.user_message_id)
      : null;
    const sourceUserId = linkedId != null && userById.has(linkedId) ? linkedId : pendingUserId;
    const sourceUser = sourceUserId != null ? userById.get(sourceUserId) ?? pendingUser : pendingUser;
    if (sourceUser == null || sourceUserId == null) {
      if (isCanonAdoptedScene(row.usage)) {
        playableTurnNumber += 1;
        turns.push({
          turnNumber: playableTurnNumber,
          user: "",
          assistant: row.content,
          userMessageId: null,
          assistantMessageId: row.id,
          assistantOnly: true,
        });
      }
      continue;
    }
    playableTurnNumber += 1;
    turns.push({
      turnNumber: playableTurnNumber,
      user: sourceUser,
      assistant: row.content,
      userMessageId: sourceUserId,
      assistantMessageId: row.id,
    });
    if (pendingUserId === sourceUserId) {
      pendingUser = null;
      pendingUserId = null;
    }
  }
  return turns;
}

function loadChatTurnsWithMessageIdsCore(
  db: Database.Database,
  chatId: number
): ChatTurnWithMessageIds[] {
  return pairChatTurnsWithMessageIds(loadChatMessageRowsCore(db, chatId));
}

export function loadChatTurnsWithMessageIds(chatId: number): ChatTurnWithMessageIds[] {
  return loadChatTurnsWithMessageIdsCore(getDb(), chatId);
}

function toMemoryEligibleTurns(
  rows: ChatMessageRow[],
  boundary: MemorySourceBoundary
): ChatTurnWithMessageIds[] {
  let memoryTurnNumber = 0;
  return pairChatTurnsWithMessageIds(filterCanonicalMessageRows(rows))
    .filter(
      (turn) =>
        turn.turnNumber > 0 &&
        isMemorySourceEligible({
          sourceUserMessageId: turn.userMessageId ?? turn.assistantMessageId,
          boundary,
        })
    )
    .map((turn) => ({ ...turn, turnNumber: ++memoryTurnNumber }));
}

export function loadMemoryEligibleChatTurnsWithMessageIdsCore(
  db: Database.Database,
  chatId: number,
  boundary: MemorySourceBoundary = getMemorySourceBoundaryCore(db, chatId)
): ChatTurnWithMessageIds[] {
  return toMemoryEligibleTurns(loadChatMessageRowsCore(db, chatId), boundary);
}

type TurnIndexCache = {
  chatId: number;
  revision: number;
  rows: ChatTurnWithMessageIds[];
};
const turnIndexCaches = new WeakMap<Database.Database, TurnIndexCache>();

/** A write on this connection, including a write to another table, advances this counter. */
function readConnectionRevision(db: Database.Database): number {
  const row = db.prepare("SELECT total_changes() AS revision").get() as
    | { revision?: number | bigint | null }
    | undefined;
  const revision = Number(row?.revision ?? 0);
  return Number.isFinite(revision) ? revision : 0;
}

function loadMemoryEligibleTurnIndexCore(
  db: Database.Database,
  chatId: number
): ChatTurnWithMessageIds[] {
  const revision = readConnectionRevision(db);
  const cached = turnIndexCaches.get(db);
  if (cached?.chatId === chatId && cached.revision === revision) return cached.rows;
  const rows = toMemoryEligibleTurns(
    loadChatMessageIndexRowsCore(db, chatId),
    getMemorySourceBoundaryCore(db, chatId)
  );
  turnIndexCaches.set(db, { chatId, revision, rows });
  queueMicrotask(() => {
    const current = turnIndexCaches.get(db);
    if (current?.chatId === chatId && current.rows === rows) turnIndexCaches.delete(db);
  });
  return rows;
}

function loadMessageContentsById(
  db: Database.Database,
  ids: readonly number[]
): Map<number, string> {
  const contents = new Map<number, string>();
  for (let offset = 0; offset < ids.length; offset += 300) {
    const chunk = ids.slice(offset, offset + 300);
    const placeholders = chunk.map(() => "?").join(",");
    const rows = db
      .prepare(`SELECT id, content FROM messages WHERE id IN (${placeholders})`)
      .all(...chunk) as { id: number; content: string }[];
    for (const row of rows) contents.set(row.id, row.content);
  }
  return contents;
}

/**
 * Assistant text for the summary batches that need an item-role check.
 * Turn numbers still come from one index scan. Assistant bodies outside
 * those turn ranges are not copied into the result.
 */
export function loadMemoryEligibleTurnContentsForRangesCore(
  db: Database.Database,
  chatId: number,
  ranges: readonly { turnStart: number; turnEnd: number }[]
): ChatTurnWithMessageIds[] {
  if (ranges.length === 0) return [];
  const selected = loadMemoryEligibleTurnIndexCore(db, chatId).filter((turn) =>
    ranges.some((range) => turn.turnNumber >= range.turnStart && turn.turnNumber <= range.turnEnd)
  );
  if (selected.length === 0) return [];
  const contents = loadMessageContentsById(
    db,
    [...new Set(selected.map((turn) => turn.assistantMessageId))]
  );
  return selected.map((turn) => ({
    ...turn,
    assistant: contents.get(turn.assistantMessageId) ?? "",
  }));
}

export function loadMemoryEligibleTurnContentsForRanges(
  chatId: number,
  ranges: readonly { turnStart: number; turnEnd: number }[]
): ChatTurnWithMessageIds[] {
  return loadMemoryEligibleTurnContentsForRangesCore(getDb(), chatId, ranges);
}

export function loadMemoryEligibleChatTurnsWithMessageIds(
  chatId: number,
  boundary: MemorySourceBoundary = getMemorySourceBoundary(chatId)
): ChatTurnWithMessageIds[] {
  return loadMemoryEligibleChatTurnsWithMessageIdsCore(getDb(), chatId, boundary);
}

export function countMemoryEligibleCompletedTurns(chatId: number): number {
  return countMemoryEligibleCompletedTurnsCore(getDb(), chatId);
}

export function countMemoryEligibleCompletedTurnsCore(
  db: Database.Database,
  chatId: number
): number {
  const boundary = getMemorySourceBoundaryCore(db, chatId);
  const rows = filterCanonicalMessageRows(
    db
      .prepare(
        `SELECT id, role, model, user_message_id, usage
         FROM messages WHERE chat_id=? ORDER BY id ASC`
      )
      .all(chatId) as {
      id: number;
      role: string;
      model: string;
      user_message_id: number | null;
      usage?: unknown;
    }[]
  );
  const userIds = new Set(
    rows.filter((row) => row.role === "user").map((row) => row.id)
  );
  let pendingUserId: number | null = null;
  let count = 0;

  for (const row of rows) {
    if (row.role === "user") {
      pendingUserId = row.id;
      continue;
    }
    if (row.role !== "assistant" || row.model === "greeting") continue;
    const linkedId =
      Number.isSafeInteger(row.user_message_id) && Number(row.user_message_id) > 0
        ? Number(row.user_message_id)
        : null;
    const sourceUserId = linkedId != null && userIds.has(linkedId) ? linkedId : pendingUserId;
    if (sourceUserId == null) {
      if (
        isCanonAdoptedScene(row.usage) &&
        isMemorySourceEligible({ sourceUserMessageId: row.id, boundary })
      ) {
        count += 1;
      }
      continue;
    }
    if (isMemorySourceEligible({ sourceUserMessageId: sourceUserId, boundary })) {
      count += 1;
    }
    if (pendingUserId === sourceUserId) pendingUserId = null;
  }

  return count;
}

export function resolveMemoryEligibleTurnNumberCore(
  db: Database.Database,
  chatId: number,
  sourceUserMessageId: number
): number | null {
  const turn = loadMemoryEligibleChatTurnsWithMessageIdsCore(db, chatId).find(
    (candidate) =>
      candidate.userMessageId === sourceUserMessageId ||
      candidate.assistantMessageId === sourceUserMessageId
  );
  return turn?.turnNumber ?? null;
}

export type MemorySourceTurnIdentity = {
  memoryTurnNumber: number;
  sourceUserMessageId: number | null;
  sourceAssistantMessageId: number;
  assistantOnly: boolean;
};

/** Thrown when a material edit would flip memory canonicality (unsupported). */
export class MemoryCanonicalityEditNotSupportedError extends Error {
  readonly code = "memory_canonicality_edit_not_supported" as const;

  constructor() {
    super("memory_canonicality_edit_not_supported");
    this.name = "MemoryCanonicalityEditNotSupportedError";
  }
}

/** True when PRE/POST differ on memory-eligibility presence (canonicality flip). */
export function memorySourceEligibilityChanged(
  preIdentity: MemorySourceTurnIdentity | null,
  postIdentity: MemorySourceTurnIdentity | null
): boolean {
  return (preIdentity != null) !== (postIdentity != null);
}

/** Canonical memory turn identity for a message row (memory-turn-loader owner). */
export function resolveMemorySourceTurnIdentityCore(
  db: Database.Database,
  chatId: number,
  messageId: number
): MemorySourceTurnIdentity | null {
  const turn = loadMemoryEligibleChatTurnsWithMessageIdsCore(db, chatId).find(
    (candidate) =>
      candidate.userMessageId === messageId ||
      candidate.assistantMessageId === messageId
  );
  if (!turn) return null;
  return {
    memoryTurnNumber: turn.turnNumber,
    sourceUserMessageId: turn.userMessageId,
    sourceAssistantMessageId: turn.assistantMessageId,
    assistantOnly: turn.assistantOnly === true,
  };
}

export function countChatTurns(chatId: number): number {
  const all = loadChatTurnsWithMessageIds(chatId);
  return all.filter((t) => t.turnNumber > 0).length;
}
