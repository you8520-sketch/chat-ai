/**
 * Chat-scoped user co-authoring state.
 *
 * Normal POST runtime authority is chats.user_coauthor_mode. Historical USER
 * text is never replayed on an ordinary request.
 *
 * Reconstruction (fork / user-edit / last-turn-delete / regen boundary) may
 * replay only canonical USER messages whose user_coauthor_semantics_version
 * is >= 1. Version 0 is the legacy / pre-feature epoch and is never treated
 * as a persistent coauthor directive.
 *
 * Assistant / RAW / memory / lorebook are never authority.
 *
 * Canonical product flow: STANDARD → explicit leading-OOC grant → persistent
 * coauthor (DIALOGUE / ACTIONS / FULL) → explicit leading-OOC revoke or scope
 * change. Exactly one primary owner per turn: STANDARD or COAUTHOR.
 *
 * TURN-ONLY classification is kept for deterministic state (a grant with
 * `이번 턴만` does not persist). There is no prompt machinery to enforce
 * next-turn expiry. After an explicit TURN-ONLY grant, server state correctly
 * returns OFF, but Gemini may stochastically continue consequential [B]
 * authorship from RAW history on the first following turn. Explicit revoke is
 * the canonical reliable reclaim mechanism. Do not advertise TURN-ONLY as a
 * guaranteed hard isolation feature.
 */

import type Database from "better-sqlite3";
import {
  INACTIVE_CURRENT_TURN_AUTHORING_DELEGATION,
  type CurrentTurnAuthoringDelegation,
  type UserCoauthorDuration,
} from "@/lib/currentTurnUserAuthoringDelegation";
import {
  EMPTY_USER_COAUTHOR_DIRECTIVE,
  resolveUserCoauthorDirective,
  type UserCoauthorDirective,
  type UserCoauthorSlotOp,
} from "@/lib/userCoauthorDirective";

export const USER_COAUTHOR_MODES = ["OFF", "DIALOGUE", "ACTIONS", "FULL"] as const;
export type UserCoauthorMode = (typeof USER_COAUTHOR_MODES)[number];

export const DEFAULT_USER_COAUTHOR_MODE: UserCoauthorMode = "OFF";
export const USER_COAUTHOR_MODE_COLUMN = "user_coauthor_mode";
export const USER_COAUTHOR_SEMANTICS_VERSION_COLUMN = "user_coauthor_semantics_version";
export const LEGACY_USER_COAUTHOR_SEMANTICS_VERSION = 0;
export const CURRENT_USER_COAUTHOR_SEMANTICS_VERSION = 1;

export type UserCoauthorBooleans = {
  allowDialogue: boolean;
  allowMajorActions: boolean;
};

export type AppliedUserCoauthorDirective = {
  persistentBefore: UserCoauthorMode;
  persistentAfter: UserCoauthorMode;
  currentMode: UserCoauthorMode;
  current: UserCoauthorBooleans;
  duration: UserCoauthorDuration | null;
  directive: UserCoauthorDirective;
  delegation: CurrentTurnAuthoringDelegation;
};

type CoauthorDb = Pick<Database.Database, "exec" | "prepare">;

export function booleansFromUserCoauthorMode(mode: UserCoauthorMode): UserCoauthorBooleans {
  switch (mode) {
    case "OFF":
      return { allowDialogue: false, allowMajorActions: false };
    case "DIALOGUE":
      return { allowDialogue: true, allowMajorActions: false };
    case "ACTIONS":
      return { allowDialogue: false, allowMajorActions: true };
    case "FULL":
      return { allowDialogue: true, allowMajorActions: true };
    default: {
      const _exhaustive: never = mode;
      return _exhaustive;
    }
  }
}

export function userCoauthorModeFromBooleans(flags: UserCoauthorBooleans): UserCoauthorMode {
  if (flags.allowDialogue && flags.allowMajorActions) return "FULL";
  if (flags.allowDialogue) return "DIALOGUE";
  if (flags.allowMajorActions) return "ACTIONS";
  return "OFF";
}

export function parseUserCoauthorMode(raw: unknown): UserCoauthorMode {
  const value = String(raw ?? "").trim().toUpperCase();
  if (value === "DIALOGUE" || value === "ACTIONS" || value === "FULL") return value;
  return "OFF";
}

function applySlot(previous: boolean, op: UserCoauthorSlotOp): boolean {
  switch (op) {
    case "grant":
      return true;
    case "deny":
      return false;
    case "unchanged":
      return previous;
    default: {
      const _exhaustive: never = op;
      return _exhaustive;
    }
  }
}

export function isUserCoauthorModeActive(mode: UserCoauthorMode): boolean {
  return mode !== "OFF";
}

export function applyUserCoauthorDirective(
  persistentMode: UserCoauthorMode,
  directive: UserCoauthorDirective
): AppliedUserCoauthorDirective {
  const persistentBefore = parseUserCoauthorMode(persistentMode);
  if (directive.duration === "none") {
    const current = booleansFromUserCoauthorMode(persistentBefore);
    const active = isUserCoauthorModeActive(persistentBefore);
    return {
      persistentBefore,
      persistentAfter: persistentBefore,
      currentMode: persistentBefore,
      current,
      duration: active ? "persistent" : null,
      directive,
      delegation: active
        ? {
            active: true,
            allowDialogue: current.allowDialogue,
            allowMajorActions: current.allowMajorActions,
            source: "explicit_ooc",
            duration: "persistent",
          }
        : { ...INACTIVE_CURRENT_TURN_AUTHORING_DELEGATION },
    };
  }

  const nextFlags = {
    allowDialogue: applySlot(
      booleansFromUserCoauthorMode(persistentBefore).allowDialogue,
      directive.dialogue
    ),
    allowMajorActions: applySlot(
      booleansFromUserCoauthorMode(persistentBefore).allowMajorActions,
      directive.majorActions
    ),
  };
  const currentMode = userCoauthorModeFromBooleans(nextFlags);
  const persistentAfter =
    directive.duration === "persistent" ? currentMode : persistentBefore;
  const active = isUserCoauthorModeActive(currentMode);
  const duration: UserCoauthorDuration | null = active
    ? directive.duration === "turn"
      ? "turn"
      : "persistent"
    : null;
  return {
    persistentBefore,
    persistentAfter,
    currentMode,
    current: nextFlags,
    duration,
    directive,
    delegation: active
      ? {
          active: true,
          allowDialogue: nextFlags.allowDialogue,
          allowMajorActions: nextFlags.allowMajorActions,
          source: "explicit_ooc",
          duration,
        }
      : { ...INACTIVE_CURRENT_TURN_AUTHORING_DELEGATION },
  };
}

export function resolveEffectiveUserAuthoring(input: {
  persistentMode?: UserCoauthorMode | null;
  currentUserInput?: string | null;
  /** Ignored. Kept for call-site compatibility. No prompt injection. */
  previousUserInput?: string | null;
}): AppliedUserCoauthorDirective {
  return applyUserCoauthorDirective(
    parseUserCoauthorMode(input.persistentMode),
    resolveUserCoauthorDirective({ currentUserInput: input.currentUserInput })
  );
}

/**
 * Pure text replay. Unit tests / audits only.
 * Production mutation reconstruction must use the version>=1 helper.
 */
export function recomputeUserCoauthorModeFromUserMessages(
  userContents: Array<string | null | undefined>
): UserCoauthorMode {
  let mode: UserCoauthorMode = DEFAULT_USER_COAUTHOR_MODE;
  for (const content of userContents) {
    const directive = resolveUserCoauthorDirective({ currentUserInput: content });
    if (directive.duration === "none") continue;
    mode = applyUserCoauthorDirective(mode, directive).persistentAfter;
  }
  return mode;
}

function tableExists(db: CoauthorDb, table: string): boolean {
  const row = db
    .prepare(`SELECT 1 AS ok FROM sqlite_master WHERE type='table' AND name=?`)
    .get(table) as { ok?: number } | undefined;
  return row != null;
}

function columnExists(db: CoauthorDb, table: string, column: string): boolean {
  if (!tableExists(db, table)) return false;
  const cols = db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>;
  return cols.some((col) => col.name === column);
}

export function ensureUserCoauthorModeColumn(db: CoauthorDb): void {
  if (!tableExists(db, "chats")) return;
  if (columnExists(db, "chats", USER_COAUTHOR_MODE_COLUMN)) return;
  db.exec(
    `ALTER TABLE chats ADD COLUMN ${USER_COAUTHOR_MODE_COLUMN} TEXT NOT NULL DEFAULT 'OFF'`
  );
}

export function ensureUserCoauthorSemanticsVersionColumn(db: CoauthorDb): void {
  if (!tableExists(db, "messages")) return;
  if (columnExists(db, "messages", USER_COAUTHOR_SEMANTICS_VERSION_COLUMN)) return;
  db.exec(
    `ALTER TABLE messages ADD COLUMN ${USER_COAUTHOR_SEMANTICS_VERSION_COLUMN} INTEGER NOT NULL DEFAULT ${LEGACY_USER_COAUTHOR_SEMANTICS_VERSION}`
  );
}

export function ensureUserCoauthorSchema(db: CoauthorDb): void {
  ensureUserCoauthorModeColumn(db);
  ensureUserCoauthorSemanticsVersionColumn(db);
}

export function readUserCoauthorMode(db: CoauthorDb, chatId: number): UserCoauthorMode {
  ensureUserCoauthorModeColumn(db);
  if (!tableExists(db, "chats")) return DEFAULT_USER_COAUTHOR_MODE;
  const row = db
    .prepare(`SELECT ${USER_COAUTHOR_MODE_COLUMN} AS mode FROM chats WHERE id=?`)
    .get(chatId) as { mode?: unknown } | undefined;
  return parseUserCoauthorMode(row?.mode);
}

export function persistUserCoauthorMode(
  db: CoauthorDb,
  chatId: number,
  mode: UserCoauthorMode
): void {
  ensureUserCoauthorModeColumn(db);
  if (!tableExists(db, "chats")) return;
  db.prepare(`UPDATE chats SET ${USER_COAUTHOR_MODE_COLUMN}=? WHERE id=?`).run(
    parseUserCoauthorMode(mode),
    chatId
  );
}

export function parseUserCoauthorSemanticsVersion(raw: unknown): number {
  const value = Number(raw);
  if (!Number.isFinite(value) || value < CURRENT_USER_COAUTHOR_SEMANTICS_VERSION) {
    return LEGACY_USER_COAUTHOR_SEMANTICS_VERSION;
  }
  return CURRENT_USER_COAUTHOR_SEMANTICS_VERSION;
}

export function readUserCoauthorSemanticsVersion(db: CoauthorDb, messageId: number): number {
  ensureUserCoauthorSemanticsVersionColumn(db);
  if (!columnExists(db, "messages", USER_COAUTHOR_SEMANTICS_VERSION_COLUMN)) {
    return LEGACY_USER_COAUTHOR_SEMANTICS_VERSION;
  }
  const row = db
    .prepare(
      `SELECT ${USER_COAUTHOR_SEMANTICS_VERSION_COLUMN} AS version FROM messages WHERE id=?`
    )
    .get(messageId) as { version?: unknown } | undefined;
  return parseUserCoauthorSemanticsVersion(row?.version);
}

export function markUserMessageCoauthorSemanticsVersion(
  db: CoauthorDb,
  messageId: number,
  version: number = CURRENT_USER_COAUTHOR_SEMANTICS_VERSION
): void {
  ensureUserCoauthorSemanticsVersionColumn(db);
  if (!columnExists(db, "messages", USER_COAUTHOR_SEMANTICS_VERSION_COLUMN)) return;
  db.prepare(
    `UPDATE messages SET ${USER_COAUTHOR_SEMANTICS_VERSION_COLUMN}=? WHERE id=?`
  ).run(parseUserCoauthorSemanticsVersion(version), messageId);
}

export function persistUserCoauthorAfterSuccessfulUserInsert(
  db: CoauthorDb,
  input: {
    chatId: number;
    userMessageId: number;
    persistentAfter: UserCoauthorMode;
  }
): void {
  markUserMessageCoauthorSemanticsVersion(db, input.userMessageId);
  persistUserCoauthorMode(db, input.chatId, input.persistentAfter);
}

export type EligibleUserCoauthorMessageQuery = {
  beforeMessageId?: number;
  upToMessageId?: number;
};

export function listEligibleUserCoauthorMessageContents(
  db: CoauthorDb,
  chatId: number,
  query: EligibleUserCoauthorMessageQuery = {}
): string[] {
  ensureUserCoauthorSemanticsVersionColumn(db);
  if (!columnExists(db, "messages", USER_COAUTHOR_SEMANTICS_VERSION_COLUMN)) return [];
  const rows = db
    .prepare(
      `SELECT content FROM messages
       WHERE chat_id=? AND role='user'
         AND ${USER_COAUTHOR_SEMANTICS_VERSION_COLUMN}>=?
         AND (? IS NULL OR id < ?)
         AND (? IS NULL OR id <= ?)
       ORDER BY id ASC`
    )
    .all(
      chatId,
      CURRENT_USER_COAUTHOR_SEMANTICS_VERSION,
      query.beforeMessageId ?? null,
      query.beforeMessageId ?? null,
      query.upToMessageId ?? null,
      query.upToMessageId ?? null
    ) as Array<{ content?: string }>;
  return rows.map((row) => String(row.content ?? ""));
}

export function recomputeUserCoauthorModeFromEligibleMessages(
  db: CoauthorDb,
  chatId: number,
  query: EligibleUserCoauthorMessageQuery = {}
): UserCoauthorMode {
  return recomputeUserCoauthorModeFromUserMessages(
    listEligibleUserCoauthorMessageContents(db, chatId, query)
  );
}

export function recomputeAndPersistUserCoauthorMode(
  db: CoauthorDb,
  chatId: number
): UserCoauthorMode {
  const mode = recomputeUserCoauthorModeFromEligibleMessages(db, chatId);
  persistUserCoauthorMode(db, chatId, mode);
  return mode;
}

export function resolveEffectiveUserAuthoringFromChatColumn(
  db: CoauthorDb,
  chatId: number,
  currentUserInput?: string | null
): AppliedUserCoauthorDirective {
  return resolveEffectiveUserAuthoring({
    persistentMode: readUserCoauthorMode(db, chatId),
    currentUserInput,
  });
}

export function resolveEffectiveUserAuthoringForRegeneration(
  db: CoauthorDb,
  chatId: number,
  parentUserMessageId: number
): AppliedUserCoauthorDirective {
  const persistentBefore = recomputeUserCoauthorModeFromEligibleMessages(db, chatId, {
    beforeMessageId: parentUserMessageId,
  });
  const parentVersion = readUserCoauthorSemanticsVersion(db, parentUserMessageId);
  if (parentVersion < CURRENT_USER_COAUTHOR_SEMANTICS_VERSION) {
    return applyUserCoauthorDirective(persistentBefore, EMPTY_USER_COAUTHOR_DIRECTIVE);
  }
  const row = db
    .prepare(`SELECT content FROM messages WHERE id=? AND chat_id=? AND role='user'`)
    .get(parentUserMessageId, chatId) as { content?: string } | undefined;
  return resolveEffectiveUserAuthoring({
    persistentMode: persistentBefore,
    currentUserInput: row?.content ?? "",
  });
}

/** @deprecated Test/audit helper. Not the production POST owner. */
export function resolveEffectiveUserAuthoringFromHistory(input: {
  historyUserContents: Array<string | null | undefined>;
  currentUserInput?: string | null;
}): AppliedUserCoauthorDirective {
  return resolveEffectiveUserAuthoring({
    persistentMode: recomputeUserCoauthorModeFromUserMessages(input.historyUserContents),
    currentUserInput: input.currentUserInput,
  });
}

export { EMPTY_USER_COAUTHOR_DIRECTIVE };
