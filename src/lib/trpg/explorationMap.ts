/**
 * Seeded exploration graph. Pure: no database, no client import.
 * The client renders PublicExploration only. This module holds hidden events.
 */
import { declaredMovementGoals, describeMovementGoal } from "./movementDeclaration";
import {
  EXPLORATION_AP_PER_ROUND,
  EXPLORATION_COMMAND_LIMIT,
  type ExplorationCommand,
  type PublicExploration,
  type PublicExplorationMarker,
  explorationCommandCost,
} from "./explorationPublic";

export const EXPLORATION_ENTRANCE = "현관홀";
export const EXPLORATION_ALARM_ROOM = "경보실";
export const EXPLORATION_EXIT_ROOM = "출구";
export const EXPLORATION_ARCHIVE_ROOM = "기록실";
export const EXPLORATION_STORE_ROOM = "보관실";
export const EXPLORATION_LOOP_ROOM = "순환로";
export const EXPLORATION_RISK_ALARM = 6;
export const EXPLORATION_ALARM_FLAG = "위험 고조";
export const EXPLORATION_CLUE_TEXT = "출구 빗장은 경보가 울린 뒤에만 풀린다";
export const EXPLORATION_CLUE_FLAG = "단서: 출구 빗장은 경보 후에만 풀린다";
export const EXPLORATION_ITEM_NAME = "비상 열쇠";
export const EXPLORATION_PASSAGE_FLAG = "숨은 통로: 순환로와 현관홀이 연결되었다";
export const EXPLORATION_HIDDEN_EDGE = "edge-hidden-loop";

const ROOM_IDS = [
  EXPLORATION_ENTRANCE,
  "중앙홀",
  "북쪽복도",
  "남쪽복도",
  EXPLORATION_ARCHIVE_ROOM,
  EXPLORATION_STORE_ROOM,
  EXPLORATION_ALARM_ROOM,
  EXPLORATION_EXIT_ROOM,
  EXPLORATION_LOOP_ROOM,
] as const;

export type ExplorationRoomRole = "start" | "fork" | "passage" | "search" | "reward" | "hazard" | "exit" | "loop";

export type ExplorationRoom = {
  /** Sheet location label. */
  id: string;
  /** Opaque id for the public map. Unvisited rooms are addressed by this, not by their label. */
  publicId: string;
  x: number;
  y: number;
  role: ExplorationRoomRole;
};

export type ExplorationEdge = {
  id: string;
  from: string;
  to: string;
  hidden?: boolean;
};

export type ExplorationEvent = {
  id: string;
  roomId: string;
  kind: "clue" | "supply" | "hidden";
  /** Minimum search depth. Careful search also resolves normal events. */
  search: "normal" | "careful";
  clueFlag?: string;
  clueText?: string;
  itemName?: string;
  revealEdgeId?: string;
  passageFlag?: string;
};

export type ExplorationMap = {
  rooms: ExplorationRoom[];
  edges: ExplorationEdge[];
  events: ExplorationEvent[];
};

export type ExplorationPending = {
  roundId: number;
  participantId: number;
  fromRoomId: string;
  commands: ExplorationCommand[];
  spent: number;
};

export type ExplorationState = {
  version: 1;
  seed: string;
  map: ExplorationMap;
  revealedEventIds: string[];
  grantedEventIds: string[];
  revealedEdgeIds: string[];
  visitedRoomIds: string[];
  risk: number;
  alarmFlagged: boolean;
  apRoundNumber: number;
  apRemaining: Record<string, number>;
  pending: ExplorationPending[];
  appliedKeys: string[];
};

export type ExplorationActorResult = {
  participantId: number;
  name: string;
  failed: boolean;
  location: string | null;
  items: string[];
  flags: string[];
  lines: string[];
};

const ROLES: Record<string, ExplorationRoomRole> = {
  [EXPLORATION_ENTRANCE]: "start",
  중앙홀: "fork",
  북쪽복도: "fork",
  남쪽복도: "passage",
  [EXPLORATION_ARCHIVE_ROOM]: "search",
  [EXPLORATION_STORE_ROOM]: "reward",
  [EXPLORATION_ALARM_ROOM]: "hazard",
  [EXPLORATION_EXIT_ROOM]: "exit",
  [EXPLORATION_LOOP_ROOM]: "loop",
};

const LAYOUTS: ReadonlyArray<{
  positions: Record<string, [number, number]>;
  links: ReadonlyArray<readonly [string, string]>;
}> = [
  {
    positions: {
      현관홀: [0, 2],
      중앙홀: [1, 2],
      북쪽복도: [2, 2],
      기록실: [3, 2],
      남쪽복도: [0, 1],
      보관실: [2, 1],
      경보실: [1, 0],
      출구: [2, 0],
      순환로: [3, 0],
    },
    links: [
      ["현관홀", "중앙홀"],
      ["현관홀", "남쪽복도"],
      ["중앙홀", "북쪽복도"],
      ["중앙홀", "남쪽복도"],
      ["북쪽복도", "기록실"],
      ["북쪽복도", "보관실"],
      ["남쪽복도", "경보실"],
      ["경보실", "출구"],
      ["보관실", "출구"],
      ["출구", "순환로"],
    ],
  },
  {
    positions: {
      현관홀: [0, 0],
      남쪽복도: [1, 0],
      중앙홀: [2, 0],
      북쪽복도: [3, 0],
      보관실: [3, 1],
      경보실: [2, 1],
      출구: [1, 1],
      기록실: [2, 2],
      순환로: [0, 2],
    },
    links: [
      ["현관홀", "남쪽복도"],
      ["현관홀", "중앙홀"],
      ["남쪽복도", "중앙홀"],
      ["중앙홀", "북쪽복도"],
      ["중앙홀", "기록실"],
      ["북쪽복도", "보관실"],
      ["북쪽복도", "경보실"],
      ["경보실", "출구"],
      ["기록실", "순환로"],
      ["순환로", "출구"],
      ["보관실", "중앙홀"],
    ],
  },
  {
    positions: {
      현관홀: [0, 1],
      중앙홀: [1, 1],
      북쪽복도: [2, 1],
      남쪽복도: [3, 1],
      보관실: [3, 0],
      출구: [2, 0],
      경보실: [2, 2],
      기록실: [1, 2],
      순환로: [0, 2],
    },
    links: [
      ["현관홀", "중앙홀"],
      ["현관홀", "기록실"],
      ["중앙홀", "북쪽복도"],
      ["중앙홀", "기록실"],
      ["북쪽복도", "남쪽복도"],
      ["북쪽복도", "경보실"],
      ["남쪽복도", "보관실"],
      ["남쪽복도", "출구"],
      ["보관실", "출구"],
      ["기록실", "순환로"],
      ["순환로", "경보실"],
    ],
  },
];

function fnv1a(text: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i += 1) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

export function explorationLayoutIndex(seed: string): number {
  return fnv1a(seed) % LAYOUTS.length;
}

function edgeId(from: string, to: string): string {
  return from < to ? `edge-${from}-${to}` : `edge-${to}-${from}`;
}

function eventsForMap(): ExplorationEvent[] {
  return [
    {
      id: "event-clue",
      roomId: EXPLORATION_ARCHIVE_ROOM,
      kind: "clue",
      search: "normal",
      clueText: EXPLORATION_CLUE_TEXT,
      clueFlag: EXPLORATION_CLUE_FLAG,
    },
    {
      id: "event-supply",
      roomId: EXPLORATION_STORE_ROOM,
      kind: "supply",
      search: "normal",
      itemName: EXPLORATION_ITEM_NAME,
    },
    {
      id: "event-hidden",
      roomId: EXPLORATION_LOOP_ROOM,
      kind: "hidden",
      search: "careful",
      revealEdgeId: EXPLORATION_HIDDEN_EDGE,
      passageFlag: EXPLORATION_PASSAGE_FLAG,
      clueText: "벽 뒤에서 현관홀로 이어지는 통로가 열렸다",
    },
  ];
}

export function openEdges(map: ExplorationMap, revealedEdgeIds: readonly string[]): ExplorationEdge[] {
  const revealed = new Set(revealedEdgeIds);
  return map.edges.filter((edge) => !edge.hidden || revealed.has(edge.id));
}

export function roomDegree(map: ExplorationMap, roomId: string, includeHidden: boolean): number {
  return map.edges.filter((edge) => {
    if (edge.hidden && !includeHidden) return false;
    return edge.from === roomId || edge.to === roomId;
  }).length;
}

export function explorationRoomsReachable(map: ExplorationMap, includeHidden: boolean): boolean {
  const start = map.rooms.find((room) => room.role === "start") ?? map.rooms[0];
  if (!start) return false;
  const seen = new Set<string>([start.id]);
  const queue = [start.id];
  const revealed = includeHidden ? map.edges.map((edge) => edge.id) : [];
  const edges = openEdges(map, revealed);
  while (queue.length) {
    const current = queue.shift()!;
    for (const edge of edges) {
      const next = edge.from === current ? edge.to : edge.to === current ? edge.from : "";
      if (!next || seen.has(next)) continue;
      seen.add(next);
      queue.push(next);
    }
  }
  return seen.size === map.rooms.length;
}

export function explorationMapHasCycle(map: ExplorationMap, includeHidden: boolean): boolean {
  const revealed = includeHidden ? map.edges.map((edge) => edge.id) : [];
  const edges = openEdges(map, revealed);
  const neighbors = new Map<string, string[]>();
  for (const room of map.rooms) neighbors.set(room.id, []);
  for (const edge of edges) {
    neighbors.get(edge.from)?.push(edge.to);
    neighbors.get(edge.to)?.push(edge.from);
  }
  const seen = new Set<string>();
  const visit = (roomId: string, parent: string): boolean => {
    seen.add(roomId);
    for (const next of neighbors.get(roomId) ?? []) {
      if (next === parent) continue;
      if (seen.has(next) || visit(next, roomId)) return true;
    }
    return false;
  };
  for (const room of map.rooms) {
    if (!seen.has(room.id) && visit(room.id, "")) return true;
  }
  return false;
}

function openNeighbors(map: ExplorationMap, roomId: string): string[] {
  const next: string[] = [];
  for (const edge of openEdges(map, [])) {
    if (edge.from === roomId) next.push(edge.to);
    else if (edge.to === roomId) next.push(edge.from);
  }
  return next;
}

/**
 * The exit latch opens only after the alarm. The clue is not required.
 * Alarm can be raised by ordinary moves and searches, so a connected map
 * is not escapable unless that sequence can still reach the exit.
 */
export function explorationCanEscape(map: ExplorationMap): boolean {
  const seen = new Set<string>();
  const queue: Array<{ room: string; risk: number; alarm: boolean }> = [
    { room: EXPLORATION_ENTRANCE, risk: 0, alarm: false },
  ];
  while (queue.length) {
    const node = queue.shift()!;
    const key = `${node.room}:${node.risk}:${node.alarm ? 1 : 0}`;
    if (seen.has(key)) continue;
    seen.add(key);
    if (node.room === EXPLORATION_EXIT_ROOM && node.alarm) return true;
    if (!node.alarm) {
      const risk = Math.min(EXPLORATION_RISK_ALARM, node.risk + 1);
      queue.push({ room: node.room, risk, alarm: risk >= EXPLORATION_RISK_ALARM });
    }
    for (const next of openNeighbors(map, node.room)) {
      if (next === EXPLORATION_EXIT_ROOM && !node.alarm) continue;
      let risk = Math.min(EXPLORATION_RISK_ALARM, node.risk + 1);
      if (next === EXPLORATION_ALARM_ROOM) risk = Math.min(EXPLORATION_RISK_ALARM, risk + 2);
      queue.push({ room: next, risk, alarm: node.alarm || risk >= EXPLORATION_RISK_ALARM });
    }
  }
  return false;
}

function assertPlayable(map: ExplorationMap): void {
  if (map.rooms.length < 7 || map.rooms.length > 9) throw new Error("탐험 지도 방 수가 범위를 벗어났습니다.");
  if (!explorationRoomsReachable(map, false)) throw new Error("탐험 지도가 연결되지 않았습니다.");
  if (!explorationMapHasCycle(map, false)) throw new Error("탐험 지도에 순환 경로가 없습니다.");
  const entrance = map.rooms.find((room) => room.role === "start");
  if (!entrance || roomDegree(map, entrance.id, false) < 2) throw new Error("시작 방에 갈림이 없습니다.");
  const forks = map.rooms.filter((room) => roomDegree(map, room.id, false) >= 3);
  if (forks.length < 2) throw new Error("탐험 지도의 갈림길이 부족합니다.");
  if (!explorationCanEscape(map)) throw new Error("탐험 지도에서 탈출할 수 없습니다.");
}

/** Movement goals in free text, priced later by the same command owner as a map click. */
export function explorationCommandsFromMovementBody(map: ExplorationMap, body: string): ExplorationCommand[] {
  const commands: ExplorationCommand[] = [];
  for (const goal of declaredMovementGoals(body)) {
    const place = describeMovementGoal(goal).place;
    if (!place) continue;
    commands.push({ op: "move", roomId: canonicalRoomId(map, place) ?? place });
  }
  if (commands.length > EXPLORATION_COMMAND_LIMIT) throw new Error("한 번에 너무 많은 탐험 명령입니다.");
  return commands;
}

export function generateExplorationMap(seed: string): ExplorationMap {
  const layout = LAYOUTS[explorationLayoutIndex(seed)]!;
  const rooms: ExplorationRoom[] = ROOM_IDS.map((id) => {
    const position = layout.positions[id];
    if (!position) throw new Error("탐험 지도 좌표가 없습니다.");
    return { id, publicId: "", x: position[0], y: position[1], role: ROLES[id] ?? "passage" };
  });
  [...rooms]
    .sort((a, b) => a.y - b.y || a.x - b.x || a.id.localeCompare(b.id))
    .forEach((room, index) => {
      room.publicId = `r${index + 1}`;
    });
  const edges: ExplorationEdge[] = layout.links.map(([from, to]) => ({ id: edgeId(from, to), from, to }));
  edges.push({
    id: EXPLORATION_HIDDEN_EDGE,
    from: EXPLORATION_LOOP_ROOM,
    to: EXPLORATION_ENTRANCE,
    hidden: true,
  });
  const map = { rooms, edges, events: eventsForMap() };
  assertPlayable(map);
  return map;
}

export function emptyExplorationState(seed: string): ExplorationState {
  const map = generateExplorationMap(seed);
  return {
    version: 1,
    seed,
    map,
    revealedEventIds: [],
    grantedEventIds: [],
    revealedEdgeIds: [],
    visitedRoomIds: [EXPLORATION_ENTRANCE],
    risk: 0,
    alarmFlagged: false,
    apRoundNumber: 0,
    apRemaining: {},
    pending: [],
    appliedKeys: [],
  };
}

export function parseExplorationState(raw: unknown): ExplorationState | null {
  let value: unknown = raw;
  if (typeof raw === "string") {
    const text = raw.trim();
    if (!text) return null;
    try {
      value = JSON.parse(text) as unknown;
    } catch {
      return null;
    }
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const row = value as Partial<ExplorationState>;
  if (row.version !== 1 || typeof row.seed !== "string" || !row.map) return null;
  if (!Array.isArray(row.map.rooms) || !Array.isArray(row.map.edges) || !Array.isArray(row.map.events)) return null;
  return {
    version: 1,
    seed: row.seed,
    map: row.map,
    revealedEventIds: Array.isArray(row.revealedEventIds) ? row.revealedEventIds.filter((id) => typeof id === "string") : [],
    grantedEventIds: Array.isArray(row.grantedEventIds) ? row.grantedEventIds.filter((id) => typeof id === "string") : [],
    revealedEdgeIds: Array.isArray(row.revealedEdgeIds) ? row.revealedEdgeIds.filter((id) => typeof id === "string") : [],
    visitedRoomIds: Array.isArray(row.visitedRoomIds) ? row.visitedRoomIds.filter((id) => typeof id === "string") : [],
    risk: Number.isFinite(row.risk) ? Math.max(0, Math.floor(Number(row.risk))) : 0,
    alarmFlagged: row.alarmFlagged === true,
    apRoundNumber: Number.isFinite(row.apRoundNumber) ? Math.floor(Number(row.apRoundNumber)) : 0,
    apRemaining:
      row.apRemaining && typeof row.apRemaining === "object" && !Array.isArray(row.apRemaining)
        ? Object.fromEntries(
            Object.entries(row.apRemaining).flatMap(([key, amount]) =>
              Number.isFinite(amount) ? [[key, Math.max(0, Math.floor(Number(amount)))]] : []
            )
          )
        : {},
    pending: Array.isArray(row.pending) ? row.pending.filter((item) => item && typeof item === "object") : [],
    appliedKeys: Array.isArray(row.appliedKeys) ? row.appliedKeys.filter((id) => typeof id === "string") : [],
  };
}

/** Round recovery lives here: a new round number refills AP without a read-side write. */
export function displayExplorationAp(state: ExplorationState, participantId: number, roundNumber: number): number {
  if (state.apRoundNumber !== roundNumber) return EXPLORATION_AP_PER_ROUND;
  const stored = state.apRemaining[String(participantId)];
  return typeof stored === "number" ? stored : EXPLORATION_AP_PER_ROUND;
}

function hasBatchim(label: string): boolean {
  const last = label.charCodeAt(label.length - 1);
  if (last < 0xac00 || last > 0xd7a3) return false;
  return (last - 0xac00) % 28 !== 0;
}

function goalParticle(label: string): "로" | "으로" {
  const last = label.charCodeAt(label.length - 1);
  const jong = last >= 0xac00 && last <= 0xd7a3 ? (last - 0xac00) % 28 : 0;
  return jong === 0 || jong === 8 ? "로" : "으로";
}

export function composeExplorationSentences(map: ExplorationMap, fromRoomId: string, commands: readonly ExplorationCommand[]): string {
  let roomId = fromRoomId;
  const lines: string[] = [];
  for (const command of commands) {
    if (command.op === "move") {
      const label = canonicalRoomId(map, command.roomId) ?? command.roomId;
      lines.push(`${label}${goalParticle(label)} 이동한다.`);
      roomId = label;
      continue;
    }
    const label = roomId;
    const particle = hasBatchim(label) ? "을" : "를";
    lines.push(command.depth === "careful" ? `${label}${particle} 정밀히 조사한다.` : `${label}${particle} 조사한다.`);
  }
  return lines.join(" ");
}

function canonicalRoomId(map: ExplorationMap, token: string): string | null {
  const room = map.rooms.find((item) => item.publicId === token || item.id === token);
  return room?.id ?? null;
}

function publicIdFor(map: ExplorationMap, roomId: string): string {
  return map.rooms.find((room) => room.id === roomId)?.publicId ?? roomId;
}

function moveClass(
  map: ExplorationMap,
  from: string,
  to: string,
  revealedEdgeIds: readonly string[]
): "ok" | "hidden" | "absent" | "unknown" {
  if (!map.rooms.some((room) => room.id === from) || !map.rooms.some((room) => room.id === to)) return "unknown";
  const edges = map.edges.filter((edge) => (edge.from === from && edge.to === to) || (edge.to === from && edge.from === to));
  if (edges.length === 0) return "absent";
  const revealed = new Set(revealedEdgeIds);
  if (edges.some((edge) => !edge.hidden || revealed.has(edge.id))) return "ok";
  return "hidden";
}

export function priceExplorationCommands(opts: {
  state: ExplorationState;
  fromRoomId: string;
  commands: readonly ExplorationCommand[];
  apRemaining: number;
}): { spent: number } {
  if (!opts.state.map.rooms.some((room) => room.id === opts.fromRoomId)) {
    throw new Error("현재 위치가 지도와 맞지 않습니다.");
  }
  let roomId = opts.fromRoomId;
  let spent = 0;
  for (const command of opts.commands) {
    const cost = explorationCommandCost(command);
    if (spent + cost > opts.apRemaining) throw new Error("행동력이 부족합니다.");
    if (command.op === "move") {
      const dest = canonicalRoomId(opts.state.map, command.roomId);
      const kind = dest ? moveClass(opts.state.map, roomId, dest, opts.state.revealedEdgeIds) : "unknown";
      if (kind === "hidden") throw new Error("아직 발견하지 못한 통로입니다.");
      if (kind !== "ok" || !dest) throw new Error("연결되지 않은 곳으로는 이동할 수 없습니다.");
      if (dest === EXPLORATION_EXIT_ROOM && !opts.state.alarmFlagged) {
        throw new Error("출구 빗장은 경보가 울린 뒤에만 풀립니다.");
      }
      roomId = dest;
    }
    spent += cost;
  }
  return { spent };
}

function tierFailed(tier: string | null | undefined): boolean {
  switch (tier) {
    case "CRITICAL_FAILURE":
    case "SEVERE_FAILURE":
    case "FAILURE":
      return true;
    default:
      return false;
  }
}

function searchFinds(event: ExplorationEvent, depth: "normal" | "careful"): boolean {
  if (depth === "careful") return true;
  return event.search === "normal";
}

function pushUnique(list: string[], value: string): string[] {
  return list.includes(value) ? list : [...list, value];
}

export function settleExplorationActor(opts: {
  state: ExplorationState;
  pending: ExplorationPending;
  name: string;
  tier: string | null;
}): { state: ExplorationState; result: ExplorationActorResult } {
  const tierFailsSearch = tierFailed(opts.tier);
  const key = `${opts.pending.roundId}:${opts.pending.participantId}`;
  if (opts.state.appliedKeys.includes(key)) {
    return {
      state: {
        ...opts.state,
        pending: opts.state.pending.filter((row) => `${row.roundId}:${row.participantId}` !== key),
      },
      result: {
        participantId: opts.pending.participantId,
        name: opts.name,
        failed: false,
        location: null,
        items: [],
        flags: [],
        lines: [],
      },
    };
  }
  let state: ExplorationState = {
    ...opts.state,
    appliedKeys: [...opts.state.appliedKeys, key],
    pending: opts.state.pending.filter((row) => `${row.roundId}:${row.participantId}` !== key),
  };
  const result: ExplorationActorResult = {
    participantId: opts.pending.participantId,
    name: opts.name,
    failed: false,
    location: null,
    items: [],
    flags: [],
    lines: [],
  };
  let roomId = opts.pending.fromRoomId;
  const visited = [...state.visitedRoomIds];
  let riskDelta = 0;
  const moved: string[] = [];
  let searchFailed = false;
  for (const command of opts.pending.commands) {
    if (command.op === "search" && tierFailsSearch) {
      searchFailed = true;
      riskDelta += 1;
      result.lines.push(
        `${opts.name}: the search failed. They stay in ${roomId}. Nothing was found. Risk +1.`
      );
      break;
    }
    if (command.op === "move") {
      const dest = canonicalRoomId(state.map, command.roomId);
      const kind = dest ? moveClass(state.map, roomId, dest, state.revealedEdgeIds) : "unknown";
      if (kind !== "ok" || !dest) {
        result.lines.push(`${opts.name}: the prepared move could not be applied.`);
        break;
      }
      if (dest === EXPLORATION_EXIT_ROOM && !state.alarmFlagged) {
        result.lines.push(`${opts.name}: the exit latch is still shut. They stay in ${roomId}.`);
        break;
      }
      roomId = dest;
      moved.push(roomId);
      if (!visited.includes(roomId)) visited.push(roomId);
      riskDelta += 1;
      if (roomId === EXPLORATION_ALARM_ROOM) riskDelta += 2;
      continue;
    }
    riskDelta += command.depth === "normal" ? 1 : 0;
    for (const event of state.map.events) {
      if (event.roomId !== roomId || !searchFinds(event, command.depth)) continue;
      if (state.revealedEventIds.includes(event.id)) continue;
      state = {
        ...state,
        revealedEventIds: pushUnique(state.revealedEventIds, event.id),
      };
      if (event.kind === "clue" && event.clueFlag) {
        result.flags.push(event.clueFlag);
        result.lines.push(
          `${opts.name}: searched ${roomId} (${command.depth}) and found this clue exactly once: "${event.clueText ?? event.clueFlag}". Do not invent another clue.`
        );
      } else if (event.kind === "supply" && event.itemName && !state.grantedEventIds.includes(event.id)) {
        state = { ...state, grantedEventIds: pushUnique(state.grantedEventIds, event.id) };
        result.items.push(event.itemName);
        result.lines.push(
          `${opts.name}: searched ${roomId} (${command.depth}) and received item "${event.itemName}" exactly once. Do not grant it again.`
        );
      } else if (event.kind === "hidden" && event.revealEdgeId) {
        state = { ...state, revealedEdgeIds: pushUnique(state.revealedEdgeIds, event.revealEdgeId) };
        if (event.passageFlag) result.flags.push(event.passageFlag);
        result.lines.push(
          `${opts.name}: careful search of ${roomId} opened one hidden passage (${event.clueText ?? event.passageFlag}). Do not invent another passage.`
        );
      }
    }
    if (!result.lines.some((line) => line.startsWith(`${opts.name}: searched ${roomId}`))) {
      result.lines.push(`${opts.name}: searched ${roomId} (${command.depth}). The server had nothing new hidden there.`);
    }
  }
  result.failed = searchFailed;
  if (moved.length) {
    result.location = roomId;
    result.lines.unshift(`${opts.name}: moved ${opts.pending.fromRoomId} → ${moved.join(" → ")}.`);
  }
  state = { ...state, visitedRoomIds: visited };
  state = raiseRisk(state, riskDelta, result.flags);
  if (riskDelta > 0) result.lines.push(`Risk +${riskDelta}. Risk is now ${state.risk}. Alarm: ${state.alarmFlagged ? "yes" : "no"}.`);
  return { state, result };
}

function raiseRisk(state: ExplorationState, delta: number, flags: string[]): ExplorationState {
  if (delta <= 0) return state;
  const risk = Math.min(99, state.risk + delta);
  if (risk >= EXPLORATION_RISK_ALARM && !state.alarmFlagged) {
    flags.push(EXPLORATION_ALARM_FLAG);
    return { ...state, risk, alarmFlagged: true };
  }
  return { ...state, risk };
}

export const EXPLORATION_GM_HEADER =
  "[EXPLORATION — server positions and this-round results. These override earlier narration. Narrate only these positions as fact. Do not invent another clue, item, secret passage, or a new human PC move, line, or decision.]";

export type ExplorationSeatFact = {
  name: string;
  start: string;
  end: string;
};

export function visibleExplorationNeighbors(state: ExplorationState, roomId: string): string[] {
  const next: string[] = [];
  for (const edge of openEdges(state.map, state.revealedEdgeIds)) {
    if (edge.from === roomId) next.push(edge.to);
    else if (edge.to === roomId) next.push(edge.from);
  }
  return next;
}

export function formatExplorationGmBlock(opts: {
  opening: boolean;
  seats: readonly ExplorationSeatFact[];
  resultLines: readonly string[];
  alarm: boolean;
  risk: number;
  flags: readonly string[];
}): string {
  const positions = opts.seats.map((seat) => {
    const start = seat.start.trim() || EXPLORATION_ENTRANCE;
    const end = seat.end.trim() || start;
    if (start === end) return `${seat.name} is in ${end}. They did not move this round.`;
    return `${seat.name} started in ${start} and is now in ${end}.`;
  });
  const atExit = opts.seats.some((seat) => (seat.end.trim() || seat.start.trim()) === EXPLORATION_EXIT_ROOM);
  return [
    EXPLORATION_GM_HEADER,
    `Risk ${opts.risk}. Alarm: ${opts.alarm ? "yes" : "no"}.`,
    opts.opening ? `The party begins in ${EXPLORATION_ENTRANCE}. At least two passages leave this room.` : "",
    ...positions,
    ...opts.resultLines,
    explorationLatchFact(opts.alarm, atExit),
    "Describe the rooms they occupy. Visible passages may be atmosphere. Do not walk anyone down a passage they did not take.",
    opts.flags.length
      ? `Server flags already include: ${opts.flags.join("; ")}. Only the server confirms ${EXPLORATION_ALARM_FLAG}, ${EXPLORATION_CLUE_FLAG}, and ${EXPLORATION_PASSAGE_FLAG}. Other world facts may still be recorded.`
      : `No exploration flags yet. Only the server confirms ${EXPLORATION_ALARM_FLAG}, ${EXPLORATION_CLUE_FLAG}, and ${EXPLORATION_PASSAGE_FLAG}. Other world facts may still be recorded.`,
  ]
    .filter(Boolean)
    .join("\n");
}

function explorationLatchFact(alarm: boolean, atExit: boolean): string {
  if (alarm && atExit) {
    return `Alarm is already on. The exit latch condition is already met. Only the people listed in ${EXPLORATION_EXIT_ROOM} are there.`;
  }
  if (alarm) {
    return `Alarm is already on. The exit latch condition is already met. Nobody has reached ${EXPLORATION_EXIT_ROOM}. Escape is not a fact.`;
  }
  if (atExit) {
    return `Alarm is off. The exit latch is still shut. A listed seat in ${EXPLORATION_EXIT_ROOM} is not an opened escape.`;
  }
  return `Alarm is off. The exit latch is still shut. Nobody has reached ${EXPLORATION_EXIT_ROOM}.`;
}

export function formatExplorationBotBrief(opts: {
  roomId: string;
  neighbors: readonly string[];
  ap: number;
  alarm: boolean;
  party: readonly { name: string; location: string }[];
}): string {
  const party = opts.party
    .map((seat) => `${seat.name} ${seat.location.trim() || EXPLORATION_ENTRANCE}`)
    .join("; ");
  return [
    "[EXPLORATION — your current map facts. Move only through listed passages.]",
    `You are in ${opts.roomId.trim() || EXPLORATION_ENTRANCE}.`,
    party ? `Party positions: ${party}.` : "",
    `Open passages: ${opts.neighbors.join(", ") || "(none)"}.`,
    `Action points left this turn: ${opts.ap}. Move costs 1, search 1, careful search 2.`,
    opts.alarm
      ? `Alarm is on. The exit latch can open if you reach ${EXPLORATION_EXIT_ROOM} through listed passages.`
      : "Alarm is off. The exit latch is still shut.",
  ]
    .filter(Boolean)
    .join("\n");
}

const EXPLORATION_SERVER_FLAGS = new Set<string>([
  EXPLORATION_ALARM_FLAG,
  EXPLORATION_CLUE_FLAG,
  EXPLORATION_PASSAGE_FLAG,
]);

/** Exact exploration flags stay only when the server already recorded them or grants them this round. */
export function filterExplorationFlagsAdd(proposed: readonly string[], serverFlags: readonly string[]): string[] {
  const granted = new Set(serverFlags);
  return proposed.filter((flag) => !EXPLORATION_SERVER_FLAGS.has(flag) || granted.has(flag));
}

export function projectPublicExploration(opts: {
  state: ExplorationState;
  viewerParticipantId: number | null;
  viewerLocation: string;
  roundNumber: number;
}): PublicExploration {
  const revealed = new Set(opts.state.revealedEdgeIds);
  const visited = new Set(opts.state.visitedRoomIds);
  const visibleEdges = opts.state.map.edges.filter((edge) => !edge.hidden || revealed.has(edge.id));
  const known = new Set<string>(visited);
  for (const edge of visibleEdges) {
    if (visited.has(edge.from)) known.add(edge.to);
    if (visited.has(edge.to)) known.add(edge.from);
  }
  const currentRoomId =
    known.has(opts.viewerLocation) && visited.has(opts.viewerLocation) ? publicIdFor(opts.state.map, opts.viewerLocation) : null;
  const revealedEvents = opts.state.map.events.filter((event) => opts.state.revealedEventIds.includes(event.id));
  const rooms = opts.state.map.rooms
    .filter((room) => known.has(room.id))
    .map((room) => {
      const seen = visited.has(room.id);
      const markers: PublicExplorationMarker[] = [];
      if (seen && room.role === "hazard") markers.push("hazard");
      if (seen && room.role === "exit") markers.push("exit");
      if (revealedEvents.some((event) => event.roomId === room.id && event.kind === "clue")) markers.push("clue");
      if (revealedEvents.some((event) => event.roomId === room.id && event.kind === "supply")) markers.push("reward");
      if (revealedEvents.some((event) => event.roomId === room.id && event.kind === "hidden")) markers.push("passage");
      return {
        id: room.publicId,
        label: seen ? room.id : "?",
        x: room.x,
        y: room.y,
        visited: seen,
        current: room.publicId === currentRoomId,
        markers,
      };
    });
  const edges = visibleEdges
    .filter((edge) => known.has(edge.from) && known.has(edge.to))
    .map((edge) => ({ from: publicIdFor(opts.state.map, edge.from), to: publicIdFor(opts.state.map, edge.to) }));
  return {
    rooms,
    edges,
    ap: opts.viewerParticipantId == null ? EXPLORATION_AP_PER_ROUND : displayExplorationAp(opts.state, opts.viewerParticipantId, opts.roundNumber),
    risk: opts.state.risk,
    alarm: opts.state.alarmFlagged,
    currentRoomId,
  };
}

export function spendExplorationAp(opts: {
  state: ExplorationState;
  participantId: number;
  roundNumber: number;
  roundId: number;
  fromRoomId: string;
  commands: readonly ExplorationCommand[];
}): ExplorationState {
  const apRemaining = displayExplorationAp(opts.state, opts.participantId, opts.roundNumber);
  const { spent } = priceExplorationCommands({
    state: opts.state,
    fromRoomId: opts.fromRoomId,
    commands: opts.commands,
    apRemaining,
  });
  const key = `${opts.roundId}:${opts.participantId}`;
  if (opts.state.appliedKeys.includes(key) || opts.state.pending.some((row) => `${row.roundId}:${row.participantId}` === key)) {
    throw new Error("이미 제출했습니다.");
  }
  const base = opts.state.apRoundNumber === opts.roundNumber ? opts.state.apRemaining : {};
  return {
    ...opts.state,
    apRoundNumber: opts.roundNumber,
    apRemaining: { ...base, [String(opts.participantId)]: apRemaining - spent },
    pending: [
      ...opts.state.pending,
      {
        roundId: opts.roundId,
        participantId: opts.participantId,
        fromRoomId: opts.fromRoomId,
        commands: [...opts.commands],
        spent,
      },
    ],
  };
}
