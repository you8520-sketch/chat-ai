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
import {
  DEFAULT_USER_AUTHORING_LEVEL,
  USER_AUTHORING_LEVEL_COLUMN,
  capabilitiesFromUserAuthoringLevel,
  parseUserAuthoringLevel,
  type UserAuthoringCapabilities,
  type UserAuthoringLevel,
} from "@/lib/userAuthoringPolicy";

export const USER_COAUTHOR_MODES = [
  "OFF",
  "LIMITED",
  "DIALOGUE",
  "ACTIONS",
  "FULL",
  "NOVEL",
  "ABSOLUTE",
] as const;
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

export type UserCoauthorCapabilities = UserAuthoringCapabilities;

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

export function capabilitiesFromUserCoauthorMode(
  mode: UserCoauthorMode,
  baseLevel: UserAuthoringLevel = DEFAULT_USER_AUTHORING_LEVEL
): UserCoauthorCapabilities {
  const base = capabilitiesFromUserAuthoringLevel(baseLevel);
  switch (parseUserCoauthorMode(mode)) {
    case "OFF":
      return base;
    case "LIMITED":
      return {
        allowDialogue: false,
        allowMajorActions: false,
        allowInnerPov: false,
        allowIrreversibleFate: false,
      };
    case "DIALOGUE":
      return {
        allowDialogue: true,
        allowMajorActions: false,
        allowInnerPov: false,
        allowIrreversibleFate: false,
      };
    case "ACTIONS":
      return {
        allowDialogue: false,
        allowMajorActions: true,
        allowInnerPov: false,
        allowIrreversibleFate: false,
      };
    case "FULL":
      return {
        allowDialogue: true,
        allowMajorActions: true,
        allowInnerPov: false,
        allowIrreversibleFate: false,
      };
    case "NOVEL":
      return {
        allowDialogue: true,
        allowMajorActions: true,
        allowInnerPov: true,
        allowIrreversibleFate: false,
      };
    case "ABSOLUTE":
      return {
        allowDialogue: true,
        allowMajorActions: true,
        allowInnerPov: true,
        allowIrreversibleFate: true,
      };
  }
}

export function booleansFromUserCoauthorMode(
  mode: UserCoauthorMode,
  baseLevel: UserAuthoringLevel = DEFAULT_USER_AUTHORING_LEVEL
): UserCoauthorBooleans {
  const capabilities = capabilitiesFromUserCoauthorMode(mode, baseLevel);
  return {
    allowDialogue: capabilities.allowDialogue,
    allowMajorActions: capabilities.allowMajorActions,
  };
}

function sameCapabilities(
  a: UserCoauthorCapabilities,
  b: UserCoauthorCapabilities
): boolean {
  return (
    a.allowDialogue === b.allowDialogue &&
    a.allowMajorActions === b.allowMajorActions &&
    a.allowInnerPov === b.allowInnerPov &&
    a.allowIrreversibleFate === b.allowIrreversibleFate
  );
}

export function effectiveUserCoauthorModeFromCapabilities(
  flags: UserCoauthorCapabilities
): UserCoauthorMode {
  if (
    flags.allowDialogue &&
    flags.allowMajorActions &&
    flags.allowInnerPov &&
    flags.allowIrreversibleFate
  ) {
    return "ABSOLUTE";
  }
  if (
    flags.allowDialogue &&
    flags.allowMajorActions &&
    flags.allowInnerPov
  ) {
    return "NOVEL";
  }
  if (flags.allowDialogue && flags.allowMajorActions) return "FULL";
  if (flags.allowDialogue) return "DIALOGUE";
  if (flags.allowMajorActions) return "ACTIONS";
  return "LIMITED";
}

export function userCoauthorModeFromCapabilities(
  flags: UserCoauthorCapabilities,
  baseLevel: UserAuthoringLevel = DEFAULT_USER_AUTHORING_LEVEL
): UserCoauthorMode {
  const base = capabilitiesFromUserAuthoringLevel(baseLevel);
  if (sameCapabilities(flags, base)) return "OFF";
  return effectiveUserCoauthorModeFromCapabilities(flags);
}

export function userCoauthorModeFromBooleans(flags: UserCoauthorBooleans): UserCoauthorMode {
  return effectiveUserCoauthorModeFromCapabilities({
    ...flags,
    allowInnerPov: false,
    allowIrreversibleFate: false,
  });
}

export function parseUserCoauthorMode(raw: unknown): UserCoauthorMode {
  const value = String(raw ?? "").trim().toUpperCase();
  if (
    value === "LIMITED" ||
    value === "DIALOGUE" ||
    value === "ACTIONS" ||
    value === "FULL" ||
    value === "NOVEL" ||
    value === "ABSOLUTE"
  ) {
    return value;
  }
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

function anyAuthoringCapability(flags: UserCoauthorCapabilities): boolean {
  return (
    flags.allowDialogue ||
    flags.allowMajorActions ||
    flags.allowInnerPov ||
    flags.allowIrreversibleFate
  );
}

export function applyUserCoauthorDirective(
  persistentMode: UserCoauthorMode,
  directive: UserCoauthorDirective,
  baseLevel: UserAuthoringLevel = DEFAULT_USER_AUTHORING_LEVEL
): AppliedUserCoauthorDirective {
  const normalizedBase = parseUserAuthoringLevel(baseLevel);
  const persistentBefore = parseUserCoauthorMode(persistentMode);
  const currentBefore = capabilitiesFromUserCoauthorMode(
    persistentBefore,
    normalizedBase
  );

  if (directive.duration === "none") {
    const active = anyAuthoringCapability(currentBefore);
    return {
      persistentBefore,
      persistentAfter: persistentBefore,
      currentMode: effectiveUserCoauthorModeFromCapabilities(currentBefore),
      current: {
        allowDialogue: currentBefore.allowDialogue,
        allowMajorActions: currentBefore.allowMajorActions,
      },
      duration: active ? "persistent" : null,
      directive,
      delegation: active
        ? {
            active: true,
            ...currentBefore,
            source: persistentBefore === "OFF" ? "chat_setting" : "explicit_ooc",
            duration: "persistent",
          }
        : { ...INACTIVE_CURRENT_TURN_AUTHORING_DELEGATION },
    };
  }

  const nextCapabilities: UserCoauthorCapabilities = {
    allowDialogue: applySlot(currentBefore.allowDialogue, directive.dialogue),
    allowMajorActions: applySlot(
      currentBefore.allowMajorActions,
      directive.majorActions
    ),
    allowInnerPov: applySlot(
      currentBefore.allowInnerPov,
      directive.innerPov ?? "unchanged"
    ),
    allowIrreversibleFate: applySlot(
      currentBefore.allowIrreversibleFate,
      directive.irreversibleFate ?? "unchanged"
    ),
  };

  // Higher-order permissions are meaningful only when the model can co-author
  // both dialogue and deliberate actions. A partial persistent narrowing drops
  // inner/fate authority instead of inventing an unrepresentable hidden state.
  if (!nextCapabilities.allowDialogue || !nextCapabilities.allowMajorActions) {
    nextCapabilities.allowInnerPov = false;
    nextCapabilities.allowIrreversibleFate = false;
  }
  if (!nextCapabilities.allowInnerPov) {
    nextCapabilities.allowIrreversibleFate = false;
  }

  const currentMode = effectiveUserCoauthorModeFromCapabilities(nextCapabilities);
  const persistentAfter =
    directive.duration === "persistent"
      ? userCoauthorModeFromCapabilities(nextCapabilities, normalizedBase)
      : persistentBefore;
  const active = anyAuthoringCapability(nextCapabilities);
  const duration: UserCoauthorDuration | null = active
    ? directive.duration === "turn"
      ? "turn"
      : "persistent"
    : null;

  return {
    persistentBefore,
    persistentAfter,
    currentMode,
    current: {
      allowDialogue: nextCapabilities.allowDialogue,
      allowMajorActions: nextCapabilities.allowMajorActions,
    },
    duration,
    directive,
    delegation: active
      ? {
          active: true,
          ...nextCapabilities,
          source: "explicit_ooc",
          duration,
        }
      : { ...INACTIVE_CURRENT_TURN_AUTHORING_DELEGATION },
  };
}

export function resolveEffectiveUserAuthoring(input: {
  persistentMode?: UserCoauthorMode | null;
  baseLevel?: UserAuthoringLevel | null;
  currentUserInput?: string | null;
  /** Ignored. Kept for call-site compatibility. No prompt injection. */
  previousUserInput?: string | null;
}): AppliedUserCoauthorDirective {
  return applyUserCoauthorDirective(
    parseUserCoauthorMode(input.persistentMode),
    resolveUserCoauthorDirective({ currentUserInput: input.currentUserInput }),
    parseUserAuthoringLevel(input.baseLevel)
  );
}

/**
 * Pure text replay. Unit tests / audits only.
 * Production mutation reconstruction must use the version>=1 helper.
 */
export function recomputeUserCoauthorModeFromUserMessages(
  userContents: Array<string | null | undefined>,
  baseLevel: UserAuthoringLevel = DEFAULT_USER_AUTHORING_LEVEL
): UserCoauthorMode {
  let mode: UserCoauthorMode = DEFAULT_USER_COAUTHOR_MODE;
  for (const content of userContents) {
    const directive = resolveUserCoauthorDirective({ currentUserInput: content });
    if (directive.duration === "none") continue;
    mode = applyUserCoauthorDirective(mode, directive, baseLevel).persistentAfter;
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

export function ensureUserAuthoringLevelColumn(db: CoauthorDb): void {
  if (!tableExists(db, "chats")) return;
  if (columnExists(db, "chats", USER_AUTHORING_LEVEL_COLUMN)) return;
  db.exec(
    `ALTER TABLE chats ADD COLUMN ${USER_AUTHORING_LEVEL_COLUMN} TEXT NOT NULL DEFAULT '${DEFAULT_USER_AUTHORING_LEVEL}'`
  );
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
  ensureUserAuthoringLevelColumn(db);
  ensureUserCoauthorModeColumn(db);
  ensureUserCoauthorSemanticsVersionColumn(db);
}

export function readUserAuthoringLevel(
  db: CoauthorDb,
  chatId: number
): UserAuthoringLevel {
  ensureUserAuthoringLevelColumn(db);
  if (!tableExists(db, "chats")) return DEFAULT_USER_AUTHORING_LEVEL;
  const row = db
    .prepare(`SELECT ${USER_AUTHORING_LEVEL_COLUMN} AS level FROM chats WHERE id=?`)
    .get(chatId) as { level?: unknown } | undefined;
  return parseUserAuthoringLevel(row?.level);
}

export function persistUserAuthoringLevel(
  db: CoauthorDb,
  chatId: number,
  level: UserAuthoringLevel,
  opts?: { clearOocOverride?: boolean }
): void {
  ensureUserCoauthorSchema(db);
  if (!tableExists(db, "chats")) return;
  const normalized = parseUserAuthoringLevel(level);
  if (opts?.clearOocOverride === false) {
    db.prepare(
      `UPDATE chats SET ${USER_AUTHORING_LEVEL_COLUMN}=? WHERE id=?`
    ).run(normalized, chatId);
    return;
  }
  db.prepare(
    `UPDATE chats SET ${USER_AUTHORING_LEVEL_COLUMN}=?, ${USER_COAUTHOR_MODE_COLUMN}='OFF' WHERE id=?`
  ).run(normalized, chatId);
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
  const baseLevel = readUserAuthoringLevel(db, chatId);
  return recomputeUserCoauthorModeFromUserMessages(
    listEligibleUserCoauthorMessageContents(db, chatId, query),
    baseLevel
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
    baseLevel: readUserAuthoringLevel(db, chatId),
    currentUserInput,
  });
}

export function resolveEffectiveUserAuthoringForRegeneration(
  db: CoauthorDb,
  chatId: number,
  parentUserMessageId: number
): AppliedUserCoauthorDirective {
  const baseLevel = readUserAuthoringLevel(db, chatId);
  const persistentBefore = recomputeUserCoauthorModeFromEligibleMessages(db, chatId, {
    beforeMessageId: parentUserMessageId,
  });
  const parentVersion = readUserCoauthorSemanticsVersion(db, parentUserMessageId);
  if (parentVersion < CURRENT_USER_COAUTHOR_SEMANTICS_VERSION) {
    return applyUserCoauthorDirective(
      persistentBefore,
      EMPTY_USER_COAUTHOR_DIRECTIVE,
      baseLevel
    );
  }
  const row = db
    .prepare(`SELECT content FROM messages WHERE id=? AND chat_id=? AND role='user'`)
    .get(parentUserMessageId, chatId) as { content?: string } | undefined;
  return resolveEffectiveUserAuthoring({
    persistentMode: persistentBefore,
    baseLevel,
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
