/**
 * Chat-scoped user co-authoring state.
 *
 * The server owns ON/OFF. Canonical USER messages (leading OOC only) are the
 * recompute source. Assistant / RAW / memory / lorebook are never authority.
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
  postDelegationBoundary: boolean;
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

export function shouldInjectPostDelegationBoundary(input: {
  previousUserInput?: string | null;
  currentDirective: UserCoauthorDirective;
  currentMode: UserCoauthorMode;
}): boolean {
  if (input.currentMode !== "OFF") return false;
  const current = input.currentDirective;
  const currentSuppresses =
    current.duration !== "none" &&
    (current.dialogue === "deny" || current.majorActions === "deny") &&
    current.dialogue !== "grant" &&
    current.majorActions !== "grant";
  if (currentSuppresses) return true;
  const previous = resolveUserCoauthorDirective({
    currentUserInput: input.previousUserInput ?? "",
  });
  return (
    previous.duration === "turn" &&
    (previous.dialogue === "grant" || previous.majorActions === "grant")
  );
}

export function applyUserCoauthorDirective(
  persistentMode: UserCoauthorMode,
  directive: UserCoauthorDirective,
  previousUserInput?: string | null
): AppliedUserCoauthorDirective {
  const persistentBefore = parseUserCoauthorMode(persistentMode);
  if (directive.duration === "none") {
    const current = booleansFromUserCoauthorMode(persistentBefore);
    const postDelegationBoundary = shouldInjectPostDelegationBoundary({
      previousUserInput,
      currentDirective: directive,
      currentMode: persistentBefore,
    });
    const active = isUserCoauthorModeActive(persistentBefore);
    return {
      persistentBefore,
      persistentAfter: persistentBefore,
      currentMode: persistentBefore,
      current,
      duration: active ? "persistent" : null,
      directive,
      postDelegationBoundary,
      delegation: active
        ? {
            active: true,
            allowDialogue: current.allowDialogue,
            allowMajorActions: current.allowMajorActions,
            source: "explicit_ooc",
            duration: "persistent",
            postDelegationBoundary,
          }
        : {
            ...INACTIVE_CURRENT_TURN_AUTHORING_DELEGATION,
            postDelegationBoundary,
          },
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
  const postDelegationBoundary = shouldInjectPostDelegationBoundary({
    previousUserInput,
    currentDirective: directive,
    currentMode,
  });
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
    postDelegationBoundary,
    delegation: active
      ? {
          active: true,
          allowDialogue: nextFlags.allowDialogue,
          allowMajorActions: nextFlags.allowMajorActions,
          source: "explicit_ooc",
          duration,
          postDelegationBoundary,
        }
      : {
          ...INACTIVE_CURRENT_TURN_AUTHORING_DELEGATION,
          postDelegationBoundary,
        },
  };
}

export function resolveEffectiveUserAuthoring(input: {
  persistentMode?: UserCoauthorMode | null;
  currentUserInput?: string | null;
  previousUserInput?: string | null;
}): AppliedUserCoauthorDirective {
  return applyUserCoauthorDirective(
    parseUserCoauthorMode(input.persistentMode),
    resolveUserCoauthorDirective({ currentUserInput: input.currentUserInput }),
    input.previousUserInput
  );
}

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

export function ensureUserCoauthorModeColumn(db: CoauthorDb): void {
  if (!tableExists(db, "chats")) return;
  const cols = db.prepare(`PRAGMA table_info(chats)`).all() as Array<{ name: string }>;
  if (cols.some((col) => col.name === USER_COAUTHOR_MODE_COLUMN)) return;
  db.exec(
    `ALTER TABLE chats ADD COLUMN ${USER_COAUTHOR_MODE_COLUMN} TEXT NOT NULL DEFAULT 'OFF'`
  );
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

export function listCanonicalUserMessageContents(
  db: CoauthorDb,
  chatId: number
): string[] {
  if (!tableExists(db, "messages")) return [];
  const rows = db
    .prepare(
      `SELECT content FROM messages WHERE chat_id=? AND role='user' ORDER BY id ASC`
    )
    .all(chatId) as Array<{ content?: string }>;
  return rows.map((row) => String(row.content ?? ""));
}

export function recomputeAndPersistUserCoauthorMode(
  db: CoauthorDb,
  chatId: number
): UserCoauthorMode {
  const mode = recomputeUserCoauthorModeFromUserMessages(
    listCanonicalUserMessageContents(db, chatId)
  );
  persistUserCoauthorMode(db, chatId, mode);
  return mode;
}

export function resolveEffectiveUserAuthoringFromHistory(input: {
  historyUserContents: Array<string | null | undefined>;
  currentUserInput?: string | null;
}): AppliedUserCoauthorDirective {
  const previousUserInput =
    input.historyUserContents.length > 0
      ? input.historyUserContents[input.historyUserContents.length - 1]
      : null;
  return resolveEffectiveUserAuthoring({
    persistentMode: recomputeUserCoauthorModeFromUserMessages(input.historyUserContents),
    currentUserInput: input.currentUserInput,
    previousUserInput,
  });
}

export { EMPTY_USER_COAUTHOR_DIRECTIVE };
