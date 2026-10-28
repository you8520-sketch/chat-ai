import { canonicalRoomId, explorationCommandsFromMovementBody, type ExplorationMap } from "./explorationMap";
import type { ExplorationCommand } from "./explorationPublic";
import { parseTrpgBotAction, TRPG_BOT_INTENT_OPEN } from "./botActionParse";

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

function commandRoomIds(commands: readonly ExplorationCommand[]): string[] {
  return commands.filter((command) => command.op === "move").map((command) => command.roomId);
}

/** Parser output only; does not affect lock or movement pricing. */
export function proseIntentMoveRoomIds(map: ExplorationMap, rawProviderText: string): {
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

export function resolveCanonicalFromRoomId(map: ExplorationMap, locationLabel: string): string {
  const trimmed = locationLabel.trim();
  if (!trimmed) return "";
  return canonicalRoomId(map, trimmed) ?? trimmed;
}

export function logBotExplorationLockDiagnostic(entry: BotExplorationLockDiagnostic): void {
  console.info("[trpg-bot-exploration-lock]", entry);
}
