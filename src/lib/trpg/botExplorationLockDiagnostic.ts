import { canonicalRoomId, explorationCommandsFromMovementBody, type ExplorationMap } from "./explorationMap";
import type { ExplorationCommand } from "./explorationPublic";
import { parseTrpgBotAction, TRPG_BOT_INTENT_OPEN } from "./botActionParse";

/** Fixed log token when a parsed destination is not on the exploration map (never echo free text). */
export const BOT_EXPLORATION_LOG_UNKNOWN_ROOM = "unknown-room";

export const TRPG_BOT_EXPLORATION_LOCK_LOG_PREFIX = "[trpg-bot-exploration-lock] ";

export type BotExplorationLockOutcome = "move-locked" | "stay-fallback" | "original-locked";

export type BotExplorationLockDiagnostic = {
  campaignId: number;
  roundId: number;
  participantId: number;
  fromRoomId: string;
  declaredRoomIds: string[];
  proseMoveRoomIds: string[];
  intentMoveRoomIds: string[];
  firstRejectCode: string | null;
  legalRoomIds: string[];
  fallbackBranch: string;
  outcome: BotExplorationLockOutcome;
  retryRejectCode: string | null;
  diagnosticFailureCode: string | null;
};

export function formatBotExplorationLockLogLine(entry: BotExplorationLockDiagnostic): string {
  return `${TRPG_BOT_EXPLORATION_LOCK_LOG_PREFIX}${JSON.stringify(entry)}`;
}

export function parseBotExplorationLockLogLine(line: string): BotExplorationLockDiagnostic {
  if (!line.startsWith(TRPG_BOT_EXPLORATION_LOCK_LOG_PREFIX)) {
    throw new Error("invalid bot exploration lock log line");
  }
  return JSON.parse(line.slice(TRPG_BOT_EXPLORATION_LOCK_LOG_PREFIX.length)) as BotExplorationLockDiagnostic;
}

export type BotExplorationLockDiagnosticCore = {
  campaignId: number;
  roundId: number;
  participantId: number;
  fromLocationLabel: string;
  declaredRoomIdsRaw: string[];
  legalRoomIdsRaw: string[];
  firstRejectCode: string | null;
  fallbackBranch: string;
  outcome: BotExplorationLockOutcome;
  retryRejectCode: string | null;
};

function commandRoomIds(commands: readonly ExplorationCommand[]): string[] {
  return commands.filter((command) => command.op === "move").map((command) => command.roomId);
}

/** Parser output only; does not affect lock or movement pricing. */
function readProseIntentMoveRoomIds(map: ExplorationMap, rawProviderText: string): {
  proseMoveRoomIds: string[];
  intentMoveRoomIds: string[];
} {
  const parsed = parseTrpgBotAction(rawProviderText);
  const proseMoveRoomIds = commandRoomIds(explorationCommandsFromMovementBody(map, parsed.prose));
  const intentBody = parsed.intent.trim()
    ? `${TRPG_BOT_INTENT_OPEN}\n${parsed.intent.trim()}`
    : "";
  const intentMoveRoomIds = intentBody ? commandRoomIds(explorationCommandsFromMovementBody(map, intentBody)) : [];
  return { proseMoveRoomIds, intentMoveRoomIds };
}

export const botExplorationProseIntentAudit = {
  readMoveRoomIds: readProseIntentMoveRoomIds,
};

export function explorationRejectCode(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error ?? "");
  if (!message) return "unknown";
  if (message.includes("행동력")) return "ap_insufficient";
  if (message.includes("연결되지 않은")) return "disconnected";
  if (message.includes("아직 발견하지 못한")) return "passage_hidden";
  if (message.includes("아직 열리지 않은")) return "passage_locked";
  if (message.includes("빗장")) return "exit_latch";
  if (message.includes("지도와 맞지")) return "location_mismatch";
  if (message.includes("탐험 지도가 없습니다")) return "no_map";
  if (message.includes("탐험 명령")) return "command_limit";
  if (message.includes("너무 깁")) return "body_too_long";
  if (message.includes("이미 제출")) return "already_submitted";
  if (message.includes("통로")) return "passage";
  return "other";
}

export function logSafeRoomId(map: ExplorationMap, token: string): string {
  const trimmed = token.trim();
  if (!trimmed) return "";
  const resolved = canonicalRoomId(map, trimmed);
  if (resolved) return resolved;
  if (map.rooms.some((room) => room.id === trimmed)) return trimmed;
  return BOT_EXPLORATION_LOG_UNKNOWN_ROOM;
}

export function logSafeRoomIds(map: ExplorationMap, roomIds: readonly string[]): string[] {
  return roomIds.map((roomId) => logSafeRoomId(map, roomId));
}

export function logSafeFromRoomId(map: ExplorationMap, locationLabel: string): string {
  const trimmed = locationLabel.trim();
  if (!trimmed) return "";
  const resolved = canonicalRoomId(map, trimmed);
  if (resolved) return resolved;
  if (map.rooms.some((room) => room.id === trimmed)) return trimmed;
  return BOT_EXPLORATION_LOG_UNKNOWN_ROOM;
}

function sanitizeDiagnosticEntry(
  map: ExplorationMap,
  core: BotExplorationLockDiagnosticCore,
  proseMoveRoomIdsRaw: string[],
  intentMoveRoomIdsRaw: string[],
  diagnosticFailureCode: string | null
): BotExplorationLockDiagnostic {
  return {
    campaignId: core.campaignId,
    roundId: core.roundId,
    participantId: core.participantId,
    fromRoomId: logSafeFromRoomId(map, core.fromLocationLabel),
    declaredRoomIds: logSafeRoomIds(map, core.declaredRoomIdsRaw),
    proseMoveRoomIds: logSafeRoomIds(map, proseMoveRoomIdsRaw),
    intentMoveRoomIds: logSafeRoomIds(map, intentMoveRoomIdsRaw),
    firstRejectCode: core.firstRejectCode,
    legalRoomIds: logSafeRoomIds(map, core.legalRoomIdsRaw),
    fallbackBranch: core.fallbackBranch,
    outcome: core.outcome,
    retryRejectCode: core.retryRejectCode,
    diagnosticFailureCode,
  };
}

function writeBotExplorationLockDiagnostic(entry: BotExplorationLockDiagnostic): void {
  console.info(formatBotExplorationLockLogLine(entry));
}

function tryWriteBotExplorationLockDiagnostic(entry: BotExplorationLockDiagnostic): void {
  try {
    writeBotExplorationLockDiagnostic(entry);
  } catch {
    // Logging must never fail the round.
  }
}

/** One log per bot turn; never throws; never logs raw provider text or unknown destination strings. */
export function emitBotExplorationLockDiagnosticSafe(
  map: ExplorationMap,
  rawProviderText: string,
  core: BotExplorationLockDiagnosticCore
): void {
  try {
    const { proseMoveRoomIds, intentMoveRoomIds } = botExplorationProseIntentAudit.readMoveRoomIds(
      map,
      rawProviderText
    );
    const entry = sanitizeDiagnosticEntry(map, core, proseMoveRoomIds, intentMoveRoomIds, null);
    try {
      writeBotExplorationLockDiagnostic(entry);
    } catch {
      tryWriteBotExplorationLockDiagnostic(sanitizeDiagnosticEntry(map, core, [], [], "emit_failed"));
    }
  } catch {
    tryWriteBotExplorationLockDiagnostic(sanitizeDiagnosticEntry(map, core, [], [], "audit_parse_failed"));
  }
}
