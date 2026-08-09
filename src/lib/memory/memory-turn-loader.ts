import { getDb } from "@/lib/db";
import { OPENING_TURN_USER } from "@/lib/chatGreetingContext";
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
};

function loadChatTurnsWithMessageIdsCore(
  db: Database.Database,
  chatId: number
): ChatTurnWithMessageIds[] {
  const rows = db
    .prepare("SELECT id, role, content, model, user_message_id FROM messages WHERE chat_id=? ORDER BY id ASC")
    .all(chatId) as {
    id: number;
    role: string;
    content: string;
    model: string;
    user_message_id: number | null;
  }[];

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
    if (sourceUser == null || sourceUserId == null) continue;
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

export function loadChatTurnsWithMessageIds(chatId: number): ChatTurnWithMessageIds[] {
  return loadChatTurnsWithMessageIdsCore(getDb(), chatId);
}

export function loadMemoryEligibleChatTurnsWithMessageIdsCore(
  db: Database.Database,
  chatId: number,
  boundary: MemorySourceBoundary = getMemorySourceBoundaryCore(db, chatId)
): ChatTurnWithMessageIds[] {
  let memoryTurnNumber = 0;
  return loadChatTurnsWithMessageIdsCore(db, chatId)
    .filter(
      (turn) =>
        turn.turnNumber > 0 &&
        isMemorySourceEligible({ sourceUserMessageId: turn.userMessageId, boundary })
    )
    .map((turn) => ({ ...turn, turnNumber: ++memoryTurnNumber }));
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
  const rows = db
    .prepare(
      `SELECT id, role, model, user_message_id
       FROM messages WHERE chat_id=? ORDER BY id ASC`
    )
    .all(chatId) as {
    id: number;
    role: string;
    model: string;
    user_message_id: number | null;
  }[];
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
    if (sourceUserId == null) continue;
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
    (candidate) => candidate.userMessageId === sourceUserMessageId
  );
  return turn?.turnNumber ?? null;
}

export function countChatTurns(chatId: number): number {
  const all = loadChatTurnsWithMessageIds(chatId);
  return all.filter((t) => t.turnNumber > 0).length;
}
