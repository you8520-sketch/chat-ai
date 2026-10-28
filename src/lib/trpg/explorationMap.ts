/**
 * Exploration graph engine. Pure: no database, no client import.
 * The client renders PublicExploration only. This module holds hidden events.
 *
 * Version 2 maps are compiled from the campaign's frozen `plan.adventure`.
 * Version 1 maps are the legacy seeded facility (현관홀/경보실/출구); their risk, alarm, and
 * exit-latch rules apply only when `state.version === 1`.
 */
import type { AdventureEventKind, AdventureEventTrigger, AdventurePlaceRole, TrpgAdventure } from "./adventure";
import { declaredMovementGoals, describeMovementGoal, parseMovementDeclaration } from "./movementDeclaration";
import {
  EXPLORATION_AP_PER_ROUND,
  EXPLORATION_COMMAND_LIMIT,
  type ExplorationCommand,
  type PublicExploration,
  type PublicExplorationDiscovery,
  type PublicExplorationMarker,
  explorationCommandCost,
} from "./explorationPublic";

export const EXPLORATION_ENTRANCE = "현관홀";
export const EXPLORATION_ALARM_ROOM = "경보실";
export const EXPLORATION_EXIT_ROOM = "출구";
/** Sheet fact after a priced departure. Not a room on the map. */
export const EXPLORATION_DEPARTED_LOCATION = "시설 밖";
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

type LegacyRoomRole = "start" | "fork" | "passage" | "search" | "reward" | "hazard" | "exit" | "loop";
export type ExplorationRoomRole = LegacyRoomRole | AdventurePlaceRole;

export type ExplorationRoom = {
  /** Stable key. Legacy v1 rooms use their Korean label as the key. */
  id: string;
  /** Display name, written to sheet location. Absent on legacy v1 rooms, where it equals `id`. */
  name?: string;
  /** Opaque id for the public map. */
  publicId: string;
  x: number;
  y: number;
  role: ExplorationRoomRole;
  /** Player-safe description from the adventure canon. */
  summary?: string;
};

/** Passable when neither hidden nor locked, or once its id is in `revealedEdgeIds`. */
export type ExplorationEdge = {
  id: string;
  from: string;
  to: string;
  hidden?: boolean;
  opensBy?: string;
};

export type ExplorationEvent = {
  id: string;
  roomId: string;
  trigger: AdventureEventTrigger;
  effect: AdventureEventKind;
  /** Secret until the event fires. */
  text: string;
  item?: string;
  requires?: string[];
  /** Legacy v1 only: exact world flag mirrored into the ledger. */
  flag?: string;
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
  /** 1 = legacy seeded facility map, 2 = compiled adventure canon. */
  version: 1 | 2;
  seed: string;
  startRoomId: string;
  map: ExplorationMap;
  revealedEventIds: string[];
  grantedEventIds: string[];
  revealedEdgeIds: string[];
  visitedRoomIds: string[];
  /** Legacy v1 only. */
  risk: number;
  /** Legacy v1 only. */
  alarmFlagged: boolean;
  apRoundNumber: number;
  apRemaining: Record<string, number>;
  pending: ExplorationPending[];
  appliedKeys: string[];
  /** Legacy v1: participants who left through the open exit. Not inferred from standing in 출구. */
  departedParticipantIds: number[];
};

export type ExplorationActorResult = {
  participantId: number;
  name: string;
  failed: boolean;
  /**
   * True when this settlement resolved an event: a search (including a failed one)
   * or an enter that fired. A plain move that fired nothing is not an event resolution.
   */
  eventResolved: boolean;
  /** The commands this settlement applied, in order. */
  commands: ExplorationCommand[];
  /** Room the commands started from. */
  fromRoomId: string;
  /** Display name of the room the actor ended in, when they moved. */
  location: string | null;
  items: string[];
  flags: string[];
  lines: string[];
};

const ROLES: Record<string, LegacyRoomRole> = {
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

/**
 * Legacy v1 events in their stored shape. Stored v1 campaigns keep these keys; the reader adds
 * the canonical fields beside them, so a rollback still finds what it wrote.
 */
function legacyEventsForMap(): Array<Record<string, unknown>> {
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

function str(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function normalizeLegacyEvent(raw: Record<string, unknown>): ExplorationEvent & Record<string, unknown> {
  const kind = str(raw.kind);
  const effect: AdventureEventKind = kind === "supply" ? "item" : "clue";
  const canonical: ExplorationEvent = {
    id: str(raw.id),
    roomId: str(raw.roomId),
    trigger: raw.search === "careful" ? "careful_search" : "search",
    effect,
    text: str(raw.clueText) || str(raw.clueFlag) || str(raw.passageFlag) || str(raw.itemName),
    ...(effect === "item" && str(raw.itemName) ? { item: str(raw.itemName) } : {}),
    ...(str(raw.clueFlag) || str(raw.passageFlag) ? { flag: str(raw.clueFlag) || str(raw.passageFlag) } : {}),
  };
  return { ...raw, ...canonical };
}

/** Reads stored maps of either version into the canonical shape. */
function normalizeMap(raw: ExplorationMap, version: 1 | 2): ExplorationMap {
  if (version === 2) return raw;
  const events = (raw.events as unknown as Array<Record<string, unknown>>).map((event) =>
    "effect" in event && "trigger" in event ? (event as unknown as ExplorationEvent) : normalizeLegacyEvent(event)
  );
  const opener = new Map<string, string>();
  for (const event of raw.events as unknown as Array<Record<string, unknown>>) {
    const reveal = str(event.revealEdgeId);
    if (reveal) opener.set(reveal, str(event.id));
  }
  const edges = raw.edges.map((edge) =>
    edge.hidden && !edge.opensBy && opener.has(edge.id) ? { ...edge, opensBy: opener.get(edge.id) } : edge
  );
  return { rooms: raw.rooms, edges, events };
}

export function roomName(map: ExplorationMap, roomId: string): string {
  const room = map.rooms.find((item) => item.id === roomId);
  return room?.name ?? room?.id ?? roomId;
}

function nameKey(label: string): string {
  return label.replace(/\s+/g, "").toLowerCase();
}

/** Resolves a public id, key, or display name to the room key. */
export function canonicalRoomId(map: ExplorationMap, token: string): string | null {
  const trimmed = token.trim();
  if (!trimmed) return null;
  const exact = map.rooms.find((room) => room.publicId === trimmed || room.id === trimmed || room.name === trimmed);
  if (exact) return exact.id;
  const wanted = nameKey(trimmed);
  return map.rooms.find((room) => nameKey(room.name ?? room.id) === wanted)?.id ?? null;
}

function edgePassable(edge: ExplorationEdge, revealed: ReadonlySet<string>): boolean {
  return (!edge.hidden && !edge.opensBy) || revealed.has(edge.id);
}

function edgeVisible(edge: ExplorationEdge, revealed: ReadonlySet<string>): boolean {
  return !edge.hidden || revealed.has(edge.id);
}

export function openEdges(map: ExplorationMap, revealedEdgeIds: readonly string[]): ExplorationEdge[] {
  const revealed = new Set(revealedEdgeIds);
  return map.edges.filter((edge) => edgePassable(edge, revealed));
}

export function roomDegree(map: ExplorationMap, roomId: string, includeHidden: boolean): number {
  return map.edges.filter((edge) => {
    if (edge.hidden && !includeHidden) return false;
    return edge.from === roomId || edge.to === roomId;
  }).length;
}

function startRoomOf(map: ExplorationMap): string | undefined {
  return (map.rooms.find((room) => room.role === "start") ?? map.rooms[0])?.id;
}

export function explorationRoomsReachable(map: ExplorationMap, includeHidden: boolean): boolean {
  const start = startRoomOf(map);
  if (!start) return false;
  const seen = new Set<string>([start]);
  const queue = [start];
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
 * Legacy v1: the exit latch opens only after the alarm. The clue is not required.
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

function assertLegacyPlayable(map: ExplorationMap): void {
  if (map.rooms.length < 7 || map.rooms.length > 9) throw new Error("탐험 지도 방 수가 범위를 벗어났습니다.");
  if (!explorationRoomsReachable(map, false)) throw new Error("탐험 지도가 연결되지 않았습니다.");
  if (!explorationMapHasCycle(map, false)) throw new Error("탐험 지도에 순환 경로가 없습니다.");
  const entrance = map.rooms.find((room) => room.role === "start");
  if (!entrance || roomDegree(map, entrance.id, false) < 2) throw new Error("시작 방에 갈림이 없습니다.");
  const forks = map.rooms.filter((room) => roomDegree(map, room.id, false) >= 3);
  if (forks.length < 2) throw new Error("탐험 지도의 갈림길이 부족합니다.");
  if (!explorationCanEscape(map)) throw new Error("탐험 지도에서 탈출할 수 없습니다.");
}

/** A one-room state carries a single-place adventure's events; it has no map to move on. */
export function explorationHasMap(map: ExplorationMap): boolean {
  return map.rooms.length >= 2;
}

export function legacyFacilityMap(map: ExplorationMap): boolean {
  const ids = new Set(map.rooms.map((room) => room.id));
  return ids.has(EXPLORATION_ENTRANCE) && ids.has(EXPLORATION_ALARM_ROOM) && ids.has(EXPLORATION_EXIT_ROOM);
}

const LEGACY_EXIT_PASSAGE = /방폭\s*게이트를\s*통과|외부\s*탈출로로\s*나/;

/**
 * Movement goals in free text, priced later by the same command owner as a map click.
 * A goal resolves by its head word, then by the whole phrase, then by the longest room name
 * the phrase contains, so multi-word adventure names still match. An outside boundary
 * (`센터 밖`) is not a move into the interior head. On the legacy facility map that
 * outside intent is a departure, priced only from the open exit.
 */
export function explorationCommandsFromMovementBody(map: ExplorationMap, body: string): ExplorationCommand[] {
  if (!explorationHasMap(map)) return [];
  const commands: ExplorationCommand[] = [];
  let departing = false;
  const byLength = [...map.rooms].sort((a, b) => nameKey(b.name ?? b.id).length - nameKey(a.name ?? a.id).length);
  const pushDepart = () => {
    if (departing || !legacyFacilityMap(map)) return;
    departing = true;
    commands.push({ op: "depart" });
  };
  for (const goal of declaredMovementGoals(body)) {
    const described = describeMovementGoal(goal);
    if (described.polarity === "outside") {
      const asRoom = canonicalRoomId(map, goal);
      if (asRoom) {
        commands.push({ op: "move", roomId: asRoom });
        continue;
      }
      const interior = described.place ? canonicalRoomId(map, described.place) : null;
      if (interior) continue;
      pushDepart();
      continue;
    }
    const place = described.place;
    const phrase = nameKey(goal);
    const contained = byLength.find((room) => {
      const key = nameKey(room.name ?? room.id);
      return key.length >= 2 && phrase.includes(key);
    });
    const roomId = (place ? canonicalRoomId(map, place) : null) ?? canonicalRoomId(map, goal) ?? contained?.id;
    if (roomId) commands.push({ op: "move", roomId });
    else if (place) commands.push({ op: "move", roomId: place });
  }
  if (!departing && legacyFacilityMap(map) && parseMovementDeclaration(body).live && LEGACY_EXIT_PASSAGE.test(body)) {
    pushDepart();
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
  assignPublicIds(rooms);
  const edges: ExplorationEdge[] = layout.links.map(([from, to]) => ({ id: edgeId(from, to), from, to }));
  edges.push({
    id: EXPLORATION_HIDDEN_EDGE,
    from: EXPLORATION_LOOP_ROOM,
    to: EXPLORATION_ENTRANCE,
    hidden: true,
  });
  const map = normalizeMap({ rooms, edges, events: legacyEventsForMap() as unknown as ExplorationEvent[] }, 1);
  assertLegacyPlayable(map);
  return map;
}

function assignPublicIds(rooms: ExplorationRoom[]): void {
  [...rooms]
    .sort((a, b) => a.y - b.y || a.x - b.x || a.id.localeCompare(b.id))
    .forEach((room, index) => {
      room.publicId = `r${index + 1}`;
    });
}

/**
 * Compiles a validated adventure (see `evaluateAdventure`) into a frozen map.
 * Columns are link distance from the start; rows are centered within each column.
 */
export function compileAdventureMap(adventure: TrpgAdventure): ExplorationMap {
  const depth = new Map<string, number>([[adventure.start, 0]]);
  const queue = [adventure.start];
  while (queue.length) {
    const current = queue.shift()!;
    for (const link of adventure.links) {
      const next = link.from === current ? link.to : link.to === current ? link.from : "";
      if (!next || depth.has(next)) continue;
      depth.set(next, (depth.get(current) ?? 0) + 1);
      queue.push(next);
    }
  }
  const deepest = Math.max(0, ...depth.values());
  const columns = new Map<number, string[]>();
  for (const place of adventure.places) {
    const column = depth.get(place.key) ?? deepest + 1;
    columns.set(column, [...(columns.get(column) ?? []), place.key]);
  }
  const tallest = Math.max(1, ...[...columns.values()].map((keys) => keys.length));
  const position = new Map<string, [number, number]>();
  for (const [column, keys] of columns) {
    const offset = (tallest - keys.length) / 2;
    keys.forEach((key, index) => position.set(key, [column, offset + index]));
  }
  const rooms: ExplorationRoom[] = adventure.places.map((place) => {
    const [x, y] = position.get(place.key) ?? [0, 0];
    return {
      id: place.key,
      name: place.name,
      publicId: "",
      x,
      y,
      role: place.role,
      ...(place.summary ? { summary: place.summary } : {}),
    };
  });
  assignPublicIds(rooms);
  const edges: ExplorationEdge[] = adventure.links.map((link) => ({
    id: edgeId(link.from, link.to),
    from: link.from,
    to: link.to,
    ...(link.hidden ? { hidden: true } : {}),
    ...(link.opensBy ? { opensBy: link.opensBy } : {}),
  }));
  const events: ExplorationEvent[] = adventure.events.map((event) => ({
    id: event.key,
    roomId: event.place,
    trigger: event.trigger,
    effect: event.kind,
    text: event.text,
    ...(event.item ? { item: event.item } : {}),
    ...(event.requires?.length ? { requires: [...event.requires] } : {}),
  }));
  return { rooms, edges, events };
}

function freshState(version: 1 | 2, seed: string, map: ExplorationMap, startRoomId: string): ExplorationState {
  return {
    version,
    seed,
    startRoomId,
    map,
    revealedEventIds: [],
    grantedEventIds: [],
    revealedEdgeIds: [],
    visitedRoomIds: [startRoomId],
    risk: 0,
    alarmFlagged: false,
    apRoundNumber: 0,
    apRemaining: {},
    pending: [],
    appliedKeys: [],
    departedParticipantIds: [],
  };
}

/** Legacy v1 facility map. Only reached for test plans with `exploration: true` and no adventure. */
export function emptyExplorationState(seed: string): ExplorationState {
  return freshState(1, seed, generateExplorationMap(seed), EXPLORATION_ENTRANCE);
}

export function adventureExplorationState(adventure: TrpgAdventure, seed: string): ExplorationState {
  return freshState(2, seed, compileAdventureMap(adventure), adventure.start);
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
  if ((row.version !== 1 && row.version !== 2) || typeof row.seed !== "string" || !row.map) return null;
  if (!Array.isArray(row.map.rooms) || !Array.isArray(row.map.edges) || !Array.isArray(row.map.events)) return null;
  const map = normalizeMap(row.map, row.version);
  const startRoomId =
    typeof row.startRoomId === "string" && map.rooms.some((room) => room.id === row.startRoomId)
      ? row.startRoomId
      : row.version === 1
        ? EXPLORATION_ENTRANCE
        : null;
  if (!startRoomId) return null;
  return {
    version: row.version,
    seed: row.seed,
    startRoomId,
    map,
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
    departedParticipantIds: Array.isArray(row.departedParticipantIds)
      ? row.departedParticipantIds.filter((id): id is number => Number.isInteger(id) && id > 0)
      : [],
  };
}

function isLegacy(state: ExplorationState): boolean {
  return state.version === 1;
}

/** v1 mirrors exact facility flags into the ledger; v2 discoveries live only in exploration state. */
export function explorationOwnsWorldFlags(state: ExplorationState): boolean {
  return isLegacy(state);
}

export function explorationStartName(state: ExplorationState): string {
  return roomName(state.map, state.startRoomId);
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
  let label = roomName(map, canonicalRoomId(map, fromRoomId) ?? fromRoomId);
  const lines: string[] = [];
  for (const command of commands) {
    if (command.op === "depart") {
      lines.push(`${EXPLORATION_DEPARTED_LOCATION}으로 나간다.`);
      label = EXPLORATION_DEPARTED_LOCATION;
      continue;
    }
    if (command.op === "move") {
      const dest = canonicalRoomId(map, command.roomId);
      label = dest ? roomName(map, dest) : command.roomId;
      lines.push(`${label}${goalParticle(label)} 이동한다.`);
      continue;
    }
    const particle = hasBatchim(label) ? "을" : "를";
    lines.push(command.depth === "careful" ? `${label}${particle} 정밀히 조사한다.` : `${label}${particle} 조사한다.`);
  }
  return lines.join(" ");
}

/** Display name of the room after the move commands that resolve on this map. */
export function roomNameAfterCommands(map: ExplorationMap, fromLabel: string, commands: readonly ExplorationCommand[]): string {
  let label = fromLabel;
  for (const command of commands) {
    if (command.op === "depart") {
      label = EXPLORATION_DEPARTED_LOCATION;
      continue;
    }
    if (command.op !== "move") continue;
    const dest = canonicalRoomId(map, command.roomId);
    if (dest) label = roomName(map, dest);
  }
  return label;
}

export function explorationRoomNames(map: ExplorationMap): string[] {
  return map.rooms.map((room) => room.name ?? room.id);
}

type MoveClass = "ok" | "locked" | "hidden" | "absent" | "unknown";

function moveClass(map: ExplorationMap, from: string, to: string, revealedEdgeIds: readonly string[]): MoveClass {
  if (!map.rooms.some((room) => room.id === from) || !map.rooms.some((room) => room.id === to)) return "unknown";
  const edges = map.edges.filter((edge) => (edge.from === from && edge.to === to) || (edge.to === from && edge.from === to));
  if (edges.length === 0) return "absent";
  const revealed = new Set(revealedEdgeIds);
  if (edges.some((edge) => edgePassable(edge, revealed))) return "ok";
  if (edges.some((edge) => edgeVisible(edge, revealed))) return "locked";
  return "hidden";
}

function legacyLatchShut(state: ExplorationState, dest: string): boolean {
  return isLegacy(state) && dest === EXPLORATION_EXIT_ROOM && !state.alarmFlagged;
}

export function priceExplorationCommands(opts: {
  state: ExplorationState;
  fromRoomId: string;
  commands: readonly ExplorationCommand[];
  apRemaining: number;
}): { spent: number } {
  const from = canonicalRoomId(opts.state.map, opts.fromRoomId);
  if (!from) throw new Error("현재 위치가 지도와 맞지 않습니다.");
  let roomId = from;
  let spent = 0;
  let leftFacility = false;
  for (const command of opts.commands) {
    const cost = explorationCommandCost(command);
    if (spent + cost > opts.apRemaining) throw new Error("행동력이 부족합니다.");
    if (leftFacility) throw new Error("연결되지 않은 곳으로는 이동할 수 없습니다.");
    if (command.op === "depart") {
      if (!isLegacy(opts.state) || !legacyFacilityMap(opts.state.map) || roomId !== EXPLORATION_EXIT_ROOM) {
        throw new Error("연결되지 않은 곳으로는 이동할 수 없습니다.");
      }
      if (!opts.state.alarmFlagged) throw new Error("출구 빗장은 경보가 울린 뒤에만 풀립니다.");
      leftFacility = true;
      spent += cost;
      continue;
    }
    if (command.op === "move") {
      const dest = canonicalRoomId(opts.state.map, command.roomId);
      const kind = dest ? moveClass(opts.state.map, roomId, dest, opts.state.revealedEdgeIds) : "unknown";
      if (kind === "hidden") throw new Error("아직 발견하지 못한 통로입니다.");
      if (kind === "locked") throw new Error("아직 열리지 않은 통로입니다.");
      if (kind !== "ok" || !dest) throw new Error("연결되지 않은 곳으로는 이동할 수 없습니다.");
      if (legacyLatchShut(opts.state, dest)) throw new Error("출구 빗장은 경보가 울린 뒤에만 풀립니다.");
      roomId = dest;
    }
    spent += cost;
  }
  return { spent };
}

/** Keeps each command that `priceExplorationCommands` accepts from the current room and AP. */
export function legalExplorationCommands(opts: {
  state: ExplorationState;
  fromRoomId: string;
  commands: readonly ExplorationCommand[];
  apRemaining: number;
}): ExplorationCommand[] {
  const kept: ExplorationCommand[] = [];
  for (const command of opts.commands) {
    try {
      priceExplorationCommands({
        state: opts.state,
        fromRoomId: opts.fromRoomId,
        commands: [...kept, command],
        apRemaining: opts.apRemaining,
      });
      kept.push(command);
    } catch {
      continue;
    }
  }
  return kept;
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

function pushUnique(list: string[], value: string): string[] {
  return list.includes(value) ? list : [...list, value];
}

type FireCause = { kind: "enter" } | { kind: "search"; depth: "normal" | "careful" };

function triggerMatches(event: ExplorationEvent, cause: FireCause): boolean {
  switch (event.trigger) {
    case "enter":
      return cause.kind === "enter";
    case "search":
      return cause.kind === "search";
    case "careful_search":
      return cause.kind === "search" && cause.depth === "careful";
    default: {
      const neverTrigger: never = event.trigger;
      return neverTrigger;
    }
  }
}

/**
 * Fires every not-yet-fired event in `roomId` that this cause triggers and whose prerequisites
 * have fired, repeating so a chain inside one room resolves in one action. Each event fires once.
 */
function fireRoomEvents(
  state: ExplorationState,
  roomId: string,
  cause: FireCause,
  actor: string,
  result: ExplorationActorResult
): { state: ExplorationState; fired: number } {
  let next = state;
  let fired = 0;
  const label = roomName(state.map, roomId);
  const verb = cause.kind === "enter" ? `entered ${label}` : `searched ${label} (${cause.depth})`;
  let progressed = true;
  while (progressed) {
    progressed = false;
    for (const event of next.map.events) {
      if (event.roomId !== roomId || next.revealedEventIds.includes(event.id)) continue;
      if (!triggerMatches(event, cause)) continue;
      if (!(event.requires ?? []).every((need) => next.revealedEventIds.includes(need))) continue;
      next = { ...next, revealedEventIds: pushUnique(next.revealedEventIds, event.id) };
      fired += 1;
      progressed = true;
      const opened = next.map.edges.filter((edge) => edge.opensBy === event.id);
      for (const edge of opened) next = { ...next, revealedEdgeIds: pushUnique(next.revealedEdgeIds, edge.id) };
      if (event.flag) result.flags.push(event.flag);
      result.lines.push(eventLine(next, event, actor, verb, opened));
      if (event.effect === "item" && event.item && !next.grantedEventIds.includes(event.id)) {
        next = { ...next, grantedEventIds: pushUnique(next.grantedEventIds, event.id) };
        result.items.push(event.item);
      }
    }
  }
  return { state: next, fired };
}

function eventLine(
  state: ExplorationState,
  event: ExplorationEvent,
  actor: string,
  verb: string,
  opened: readonly ExplorationEdge[]
): string {
  const ways = opened.map((edge) => `${roomName(state.map, edge.from)}–${roomName(state.map, edge.to)}`).join(", ");
  const openedText = ways ? ` It opened the way ${ways}. Do not invent another passage.` : "";
  switch (event.effect) {
    case "clue":
      return `${actor}: ${verb} and found this clue exactly once: "${event.text}". Do not invent another clue.${openedText}`;
    case "item":
      return `${actor}: ${verb} and received item "${event.item ?? ""}" exactly once${event.text && event.text !== event.item ? ` (${event.text})` : ""}. Do not grant it again.${openedText}`;
    case "hazard":
      return `${actor}: ${verb} and set off a danger exactly once: "${event.text}". The server applied no damage or condition; any harm comes only from the normal check and threat rules.${openedText}`;
    default: {
      const neverEffect: never = event.effect;
      return neverEffect;
    }
  }
}

export function settleExplorationActor(opts: {
  state: ExplorationState;
  pending: ExplorationPending;
  name: string;
  tier: string | null;
}): { state: ExplorationState; result: ExplorationActorResult } {
  const tierFailsSearch = tierFailed(opts.tier);
  const key = `${opts.pending.roundId}:${opts.pending.participantId}`;
  const result: ExplorationActorResult = {
    participantId: opts.pending.participantId,
    name: opts.name,
    failed: false,
    eventResolved: false,
    commands: [],
    fromRoomId: "",
    location: null,
    items: [],
    flags: [],
    lines: [],
  };
  if (opts.state.appliedKeys.includes(key)) {
    return {
      state: {
        ...opts.state,
        pending: opts.state.pending.filter((row) => `${row.roundId}:${row.participantId}` !== key),
      },
      result,
    };
  }
  const legacy = isLegacy(opts.state);
  let state: ExplorationState = {
    ...opts.state,
    appliedKeys: [...opts.state.appliedKeys, key],
    pending: opts.state.pending.filter((row) => `${row.roundId}:${row.participantId}` !== key),
  };
  const fromRoomId = canonicalRoomId(state.map, opts.pending.fromRoomId) ?? opts.pending.fromRoomId;
  result.commands = [...opts.pending.commands];
  result.fromRoomId = fromRoomId;
  let roomId = fromRoomId;
  const visited = [...state.visitedRoomIds];
  let riskDelta = 0;
  const moved: string[] = [];
  let searchFailed = false;
  let departed = false;
  for (const command of opts.pending.commands) {
    const here = roomId === EXPLORATION_DEPARTED_LOCATION ? EXPLORATION_DEPARTED_LOCATION : roomName(state.map, roomId);
    if (command.op === "depart") {
      if (!legacy || roomId !== EXPLORATION_EXIT_ROOM || !state.alarmFlagged) {
        result.lines.push(`${opts.name}: the prepared departure could not be applied. They stay in ${here}.`);
        break;
      }
      if (!state.departedParticipantIds.includes(opts.pending.participantId)) {
        state = {
          ...state,
          departedParticipantIds: [...state.departedParticipantIds, opts.pending.participantId],
        };
      }
      departed = true;
      roomId = EXPLORATION_DEPARTED_LOCATION;
      result.lines.push(
        `${opts.name}: left the facility from ${EXPLORATION_EXIT_ROOM}. They are outside. Standing in ${EXPLORATION_EXIT_ROOM} is a different fact.`
      );
      continue;
    }
    if (command.op === "search") result.eventResolved = true;
    if (command.op === "search" && tierFailsSearch) {
      searchFailed = true;
      if (legacy) {
        riskDelta += 1;
        result.lines.push(`${opts.name}: the search failed. They stay in ${here}. Nothing was found. Risk +1.`);
      } else {
        result.lines.push(`${opts.name}: the search failed. They stay in ${here}. Nothing was found.`);
      }
      break;
    }
    if (command.op === "move") {
      const dest = canonicalRoomId(state.map, command.roomId);
      const kind = dest ? moveClass(state.map, roomId, dest, state.revealedEdgeIds) : "unknown";
      if (kind !== "ok" || !dest) {
        result.lines.push(`${opts.name}: the prepared move could not be applied.`);
        break;
      }
      if (legacyLatchShut(state, dest)) {
        result.lines.push(`${opts.name}: the exit latch is still shut. They stay in ${here}.`);
        break;
      }
      roomId = dest;
      moved.push(roomName(state.map, roomId));
      if (!visited.includes(roomId)) visited.push(roomId);
      if (legacy) {
        riskDelta += 1;
        if (roomId === EXPLORATION_ALARM_ROOM) riskDelta += 2;
      } else {
        const entered = fireRoomEvents(state, roomId, { kind: "enter" }, opts.name, result);
        state = entered.state;
        if (entered.fired > 0) result.eventResolved = true;
      }
      continue;
    }
    if (legacy) riskDelta += command.depth === "normal" ? 1 : 0;
    const searched = fireRoomEvents(state, roomId, { kind: "search", depth: command.depth }, opts.name, result);
    state = searched.state;
    if (searched.fired === 0) {
      result.lines.push(`${opts.name}: searched ${here} (${command.depth}). The server had nothing new hidden there.`);
    }
  }
  result.failed = searchFailed;
  if (departed) result.location = EXPLORATION_DEPARTED_LOCATION;
  else if (moved.length) {
    result.location = roomName(state.map, roomId);
    result.lines.unshift(`${opts.name}: moved ${roomName(state.map, fromRoomId)} → ${moved.join(" → ")}.`);
  }
  state = { ...state, visitedRoomIds: visited };
  if (legacy) {
    state = raiseRisk(state, riskDelta, result.flags);
    if (riskDelta > 0) result.lines.push(`Risk +${riskDelta}. Risk is now ${state.risk}. Alarm: ${state.alarmFlagged ? "yes" : "no"}.`);
  }
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

/**
 * The one projection of what a party member at `roomToken` can know: where they are, which
 * ways lead out, which visible ways are still shut, and every discovery already fired.
 * GM input, companion briefs, the public map, and move pricing all read the same edges.
 */
export type ExplorationRoomFacts = {
  roomId: string;
  name: string;
  summary: string;
  exits: string[];
  lockedExits: string[];
};

export function explorationRoomFacts(state: ExplorationState, roomToken: string): ExplorationRoomFacts {
  const roomId = canonicalRoomId(state.map, roomToken) ?? roomToken;
  const revealed = new Set(state.revealedEdgeIds);
  const exits: string[] = [];
  const lockedExits: string[] = [];
  for (const edge of state.map.edges) {
    const other = edge.from === roomId ? edge.to : edge.to === roomId ? edge.from : "";
    if (!other || !edgeVisible(edge, revealed)) continue;
    const label = roomName(state.map, other);
    if (edgePassable(edge, revealed)) {
      if (!exits.includes(label)) exits.push(label);
    } else if (!lockedExits.includes(label)) {
      lockedExits.push(label);
    }
  }
  const room = state.map.rooms.find((item) => item.id === roomId);
  return {
    roomId,
    name: roomName(state.map, roomId),
    summary: room?.summary ?? "",
    exits,
    lockedExits: lockedExits.filter((label) => !exits.includes(label)),
  };
}

/** Open way names out of `roomToken`. */
export function visibleExplorationNeighbors(state: ExplorationState, roomToken: string): string[] {
  return explorationRoomFacts(state, roomToken).exits;
}

export type ExplorationDiscovery = { place: string; effect: AdventureEventKind; text: string; item?: string };

/** Fired events are public results; unfired event text never leaves this module. */
export function explorationDiscoveries(state: ExplorationState, onlyIds?: ReadonlySet<string>): ExplorationDiscovery[] {
  return state.revealedEventIds.flatMap((id) => {
    if (onlyIds && !onlyIds.has(id)) return [];
    const event = state.map.events.find((item) => item.id === id);
    if (!event) return [];
    return [
      {
        place: roomName(state.map, event.roomId),
        effect: event.effect,
        text: event.text,
        ...(event.item ? { item: event.item } : {}),
      },
    ];
  });
}

function discoveryText(discovery: ExplorationDiscovery): string {
  const item = discovery.item ? ` [item ${discovery.item}]` : "";
  return `${discovery.place}: "${discovery.text}"${item}`;
}

export const EXPLORATION_GM_HEADER =
  "[EXPLORATION — server positions and this-round results. These override earlier narration, saved flags, next-round context, and story threads. Narrate only these positions as fact. Event rewards named here are granted once by the server; do not add, remove, or repeat them. Do not invent another clue, secret passage, or a new human PC move, line, or decision. Words added beside an exploration command describe how they travel or search, not a trade or item change. An action with no exploration command keeps its own inventory.]";

/** v1 has no event-reward grant policy, so its inventory stays with the GM. */
const EXPLORATION_LEGACY_GM_HEADER =
  "[EXPLORATION — server positions and this-round results. These override earlier narration, saved flags, next-round context, and story threads. Narrate only these positions as fact. Do not invent another clue, secret passage, or a new human PC move, line, or decision. Inventory on this map stays yours.]";

/**
 * v2 command submissions store the server sentences, then the player's method note.
 * Returns null when this participant did not submit an exploration command.
 */
export function splitV2ExplorationMethod(
  state: ExplorationState | null,
  roundId: number,
  participantId: number,
  body: string
): { commandText: string; method: string } | null {
  if (!state || state.version !== 2) return null;
  const pending = state.pending.find(
    (row) => row.roundId === roundId && row.participantId === participantId && row.commands.length > 0
  );
  if (!pending) return null;
  const sentences = composeExplorationSentences(state.map, pending.fromRoomId, pending.commands)
    .replace(/\s+/g, " ")
    .trim();
  const text = body.replace(/\s+/g, " ").trim();
  if (!sentences || !text.startsWith(sentences)) return null;
  return { commandText: sentences, method: text.slice(sentences.length).trim() };
}

export type ExplorationSeatFact = {
  name: string;
  start: string;
  end: string;
  /** `explorationRoomFacts(end).exits`, the same list companions receive. */
  exits: readonly string[];
  lockedExits?: readonly string[];
  summary?: string;
};

export type ExplorationLegacyFacts = {
  alarm: boolean;
  risk: number;
  flags: readonly string[];
};

export function legacyPartyEscapeFact(state: ExplorationState, participantIds: readonly number[]): boolean {
  if (!isLegacy(state) || !legacyFacilityMap(state.map) || participantIds.length === 0) return false;
  const left = new Set(state.departedParticipantIds);
  return participantIds.every((id) => left.has(id));
}

export function formatExplorationGmBlock(opts: {
  opening: boolean;
  startName: string;
  seats: readonly ExplorationSeatFact[];
  resultLines: readonly string[];
  /** Discoveries fired in earlier rounds. This round's are in `resultLines`. */
  discoveries?: readonly ExplorationDiscovery[];
  legacy?: ExplorationLegacyFacts;
}): string {
  const fallback = opts.startName;
  const positions = opts.seats.map((seat) => {
    const start = seat.start.trim() || fallback;
    const end = seat.end.trim() || start;
    if (end === EXPLORATION_DEPARTED_LOCATION) {
      return `${seat.name} left the facility. They are outside, not in ${EXPLORATION_EXIT_ROOM}.`;
    }
    if (start === end) return `${seat.name} is in ${end}.`;
    return `${seat.name} started in ${start} and is now in ${end}.`;
  });
  const byRoom = new Map<string, ExplorationSeatFact>();
  for (const seat of opts.seats) {
    const room = seat.end.trim() || seat.start.trim() || fallback;
    if (room === EXPLORATION_DEPARTED_LOCATION) continue;
    if (!byRoom.has(room)) byRoom.set(room, seat);
  }
  const places = [...byRoom]
    .filter(([, seat]) => seat.summary?.trim())
    .map(([room, seat]) => `Place ${room}: ${seat.summary!.trim()}`);
  const exits = [...byRoom].map(([room, seat]) => `Open passages from ${room}: ${seat.exits.join(", ") || "(none)"}.`);
  const locked = [...byRoom]
    .filter(([, seat]) => seat.lockedExits?.length)
    .map(([room, seat]) => `Shut ways from ${room}: ${seat.lockedExits!.join(", ")}. They open only through a server event, never by narration.`);
  const discoveries = opts.discoveries?.length
    ? `Discoveries already recorded by the server: ${opts.discoveries.map(discoveryText).join("; ")}.`
    : "";
  const legacy = opts.legacy;
  return [
    opts.legacy ? EXPLORATION_LEGACY_GM_HEADER : EXPLORATION_GM_HEADER,
    legacy ? `Risk ${legacy.risk}. Alarm: ${legacy.alarm ? "yes" : "no"}.` : "",
    opts.opening ? `The party begins in ${opts.startName}.` : "",
    ...positions,
    ...places,
    ...exits,
    ...locked,
    discoveries,
    ...opts.resultLines,
    legacy ? explorationDepartureFact(legacy.alarm, opts.seats) : "",
    "Describe the rooms they occupy. Only the open passages listed here lead out. Do not walk anyone down a passage they did not take.",
    legacy?.flags.length ? `Server flags already include: ${legacy.flags.join("; ")}. Other world facts may still be recorded.` : "",
  ]
    .filter(Boolean)
    .join("\n");
}

function explorationDepartureFact(alarm: boolean, seats: readonly ExplorationSeatFact[]): string {
  const departed = seats.filter((seat) => (seat.end.trim() || seat.start.trim()) === EXPLORATION_DEPARTED_LOCATION);
  const inside = seats.filter((seat) => (seat.end.trim() || seat.start.trim()) !== EXPLORATION_DEPARTED_LOCATION);
  const atExit = inside.some((seat) => (seat.end.trim() || seat.start.trim()) === EXPLORATION_EXIT_ROOM);
  if (seats.length > 0 && inside.length === 0) {
    return `Every listed participant has left the facility. Party escape is a server fact. Do not place anyone back inside. Standing in ${EXPLORATION_EXIT_ROOM} is a different fact.`;
  }
  const leftNames = departed.map((seat) => seat.name).join(", ");
  const stillInside = inside.map((seat) => seat.name).join(", ");
  if (departed.length > 0) {
    return `Left the facility: ${leftNames}. Still inside: ${stillInside}. Party escape is not a server fact. Do not narrate the people still inside as outside.`;
  }
  return explorationLatchFact(alarm, atExit);
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
  startName: string;
  neighbors: readonly string[];
  lockedExits?: readonly string[];
  summary?: string;
  discoveries?: readonly ExplorationDiscovery[];
  ap: number;
  party: readonly { name: string; location: string }[];
  legacy?: { alarm: boolean };
}): string {
  const party = opts.party
    .map((seat) => `${seat.name} ${seat.location.trim() || opts.startName}`)
    .join("; ");
  const here = opts.roomId.trim() || opts.startName;
  return [
    "[EXPLORATION — your current map facts. Move only through listed passages.]",
    `You are in ${here}.`,
    opts.summary?.trim() ? `About ${here}: ${opts.summary.trim()}` : "",
    party ? `Party positions: ${party}.` : "",
    `Open passages: ${opts.neighbors.join(", ") || "(none)"}.`,
    opts.lockedExits?.length ? `Shut ways (cannot pass yet): ${opts.lockedExits.join(", ")}.` : "",
    opts.discoveries?.length ? `Party discoveries so far: ${opts.discoveries.map(discoveryText).join("; ")}.` : "",
    `Action points left this turn: ${opts.ap}. Move costs 1, search 1, careful search 2.`,
    opts.legacy
      ? opts.legacy.alarm
        ? `Alarm is on. The exit latch can open if you reach ${EXPLORATION_EXIT_ROOM} through listed passages.`
        : "Alarm is off. The exit latch is still shut."
      : "",
  ]
    .filter(Boolean)
    .join("\n");
}

const EXPLORATION_SERVER_FLAGS = new Set<string>([
  EXPLORATION_ALARM_FLAG,
  EXPLORATION_CLUE_FLAG,
  EXPLORATION_PASSAGE_FLAG,
]);

/** Legacy v1: exact exploration flags stay only when the server already recorded them or grants them this round. */
export function filterExplorationFlagsAdd(proposed: readonly string[], serverFlags: readonly string[]): string[] {
  const granted = new Set(serverFlags);
  return proposed.filter((flag) => !EXPLORATION_SERVER_FLAGS.has(flag) || granted.has(flag));
}

/** Legacy v1: GM cannot drop exact server-owned exploration flags. Other world facts still leave. */
export function filterExplorationFlagsRemove(proposed: readonly string[]): string[] {
  return proposed.filter((flag) => !EXPLORATION_SERVER_FLAGS.has(flag));
}

function markerFor(state: ExplorationState, event: ExplorationEvent): PublicExplorationMarker {
  if (state.map.edges.some((edge) => edge.opensBy === event.id)) return "passage";
  const effect = event.effect;
  switch (effect) {
    case "clue":
      return "clue";
    case "item":
      return "reward";
    case "hazard":
      return "hazard";
    default: {
      const neverEffect: never = effect;
      return neverEffect;
    }
  }
}

export function projectPublicExploration(opts: {
  state: ExplorationState;
  viewerParticipantId: number | null;
  viewerLocation: string;
  roundNumber: number;
}): PublicExploration {
  const { state } = opts;
  const revealed = new Set(state.revealedEdgeIds);
  const visited = new Set(state.visitedRoomIds);
  const visibleEdges = state.map.edges.filter((edge) => edgeVisible(edge, revealed));
  const known = new Set<string>(visited);
  for (const edge of visibleEdges) {
    if (visited.has(edge.from)) known.add(edge.to);
    if (visited.has(edge.to)) known.add(edge.from);
  }
  const viewerRoom = canonicalRoomId(state.map, opts.viewerLocation);
  const currentRoom = viewerRoom && visited.has(viewerRoom) ? state.map.rooms.find((room) => room.id === viewerRoom) : undefined;
  const revealedEvents = state.map.events.filter((event) => state.revealedEventIds.includes(event.id));
  const rooms = state.map.rooms
    .filter((room) => known.has(room.id))
    .map((room) => {
      const seen = visited.has(room.id);
      const markers: PublicExplorationMarker[] = [];
      if (seen && room.role === "hazard") markers.push("hazard");
      if (seen && (room.role === "exit" || room.role === "goal")) markers.push("exit");
      for (const event of revealedEvents) {
        if (event.roomId !== room.id) continue;
        const marker = markerFor(state, event);
        if (!markers.includes(marker)) markers.push(marker);
      }
      return {
        id: room.publicId,
        label: room.name ?? room.id,
        x: room.x,
        y: room.y,
        visited: seen,
        current: room.id === currentRoom?.id,
        markers,
        ...(seen && room.summary ? { summary: room.summary } : {}),
      };
    });
  const edges = visibleEdges
    .filter((edge) => known.has(edge.from) && known.has(edge.to))
    .map((edge) => {
      const from = state.map.rooms.find((room) => room.id === edge.from)?.publicId ?? edge.from;
      const to = state.map.rooms.find((room) => room.id === edge.to)?.publicId ?? edge.to;
      return edgePassable(edge, revealed) ? { from, to } : { from, to, locked: true };
    });
  const discoveries: PublicExplorationDiscovery[] = explorationDiscoveries(state).map((item) => ({
    place: item.place,
    kind: item.effect,
    text: item.text,
    ...(item.item ? { item: item.item } : {}),
  }));
  return {
    rooms,
    edges,
    ap: opts.viewerParticipantId == null ? EXPLORATION_AP_PER_ROUND : displayExplorationAp(state, opts.viewerParticipantId, opts.roundNumber),
    currentRoomId: currentRoom?.publicId ?? null,
    discoveries,
    ...(explorationHasMap(state.map) ? {} : { singlePlace: true as const }),
    ...(isLegacy(state) ? { legacy: { risk: state.risk, alarm: state.alarmFlagged } } : {}),
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
        fromRoomId: canonicalRoomId(opts.state.map, opts.fromRoomId) ?? opts.fromRoomId,
        commands: [...opts.commands],
        spent,
      },
    ],
  };
}
