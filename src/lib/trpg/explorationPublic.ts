/**
 * Client-safe exploration types and command costs.
 * Room secrets, seeds, and the generator live in explorationMap.ts and must not be imported here.
 */

export const EXPLORATION_AP_PER_ROUND = 3;
export const EXPLORATION_MOVE_COST = 1;
export const EXPLORATION_SEARCH_COST = 1;
export const EXPLORATION_CAREFUL_SEARCH_COST = 2;
export const EXPLORATION_COMMAND_LIMIT = 6;

export type ExplorationCommand =
  | { op: "move"; roomId: string }
  | { op: "search"; depth: "normal" | "careful" };

export type PublicExplorationMarker = "clue" | "reward" | "hazard" | "exit" | "passage";

export type PublicExplorationRoom = {
  id: string;
  /** Server label. Only visited rooms and rooms behind an open passage from them are projected. */
  label: string;
  x: number;
  y: number;
  visited: boolean;
  current: boolean;
  markers: PublicExplorationMarker[];
};

export type PublicExplorationEdge = {
  from: string;
  to: string;
};

/** Fogged projection. Unrevealed event text is never part of this object. */
export type PublicExploration = {
  rooms: PublicExplorationRoom[];
  edges: PublicExplorationEdge[];
  ap: number;
  risk: number;
  alarm: boolean;
  currentRoomId: string | null;
};

export function explorationCommandCost(command: ExplorationCommand): number {
  switch (command.op) {
    case "move":
      return EXPLORATION_MOVE_COST;
    case "search":
      return command.depth === "careful" ? EXPLORATION_CAREFUL_SEARCH_COST : EXPLORATION_SEARCH_COST;
    default: {
      const neverCommand: never = command;
      return neverCommand;
    }
  }
}

export function explorationQueueCost(commands: readonly ExplorationCommand[]): number {
  return commands.reduce((sum, command) => sum + explorationCommandCost(command), 0);
}

export function parseExplorationCommands(raw: unknown): ExplorationCommand[] {
  if (raw == null) return [];
  if (!Array.isArray(raw)) throw new Error("알 수 없는 탐험 명령입니다.");
  if (raw.length > EXPLORATION_COMMAND_LIMIT) throw new Error("한 번에 너무 많은 탐험 명령입니다.");
  return raw.map((item) => {
    if (!item || typeof item !== "object" || Array.isArray(item)) {
      throw new Error("알 수 없는 탐험 명령입니다.");
    }
    const row = item as { op?: unknown; roomId?: unknown; depth?: unknown };
    if (row.op === "move") {
      const roomId = typeof row.roomId === "string" ? row.roomId.trim() : "";
      if (!roomId || roomId.length > 40) throw new Error("알 수 없는 탐험 명령입니다.");
      return { op: "move", roomId };
    }
    if (row.op === "search") {
      if (row.depth !== "normal" && row.depth !== "careful") throw new Error("알 수 없는 탐험 명령입니다.");
      return { op: "search", depth: row.depth };
    }
    throw new Error("알 수 없는 탐험 명령입니다.");
  });
}
