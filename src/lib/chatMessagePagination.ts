/** 채팅 UI — 최초 표시 턴 수 */
export const CHAT_INITIAL_VISIBLE_TURNS = 15;
/** “이전 글 보기” — 한 번에 불러올 턴 수 */
export const CHAT_LOAD_MORE_TURNS = 25;

export type ChatMessageLike = {
  id?: number;
  role: "user" | "assistant";
  content: string;
  model?: string;
};

export type TurnPartition = {
  /** 첫 완료 턴 이전 (인사말 등) */
  preamble: ChatMessageLike[];
  turns: { user: ChatMessageLike; assistant: ChatMessageLike }[];
  /** 마지막 user만 있고 assistant 미완료 */
  trailing: ChatMessageLike[];
};

export function partitionChatMessages(rows: ChatMessageLike[]): TurnPartition {
  const preamble: ChatMessageLike[] = [];
  const turns: TurnPartition["turns"] = [];
  const trailing: ChatMessageLike[] = [];
  let pendingUser: ChatMessageLike | null = null;

  for (const row of rows) {
    if (row.role === "user") {
      pendingUser = row;
    } else if (row.role === "assistant") {
      if (row.model === "greeting") {
        if (pendingUser) {
          preamble.push(pendingUser);
          pendingUser = null;
        }
        preamble.push(row);
        continue;
      }
      if (pendingUser) {
        turns.push({ user: pendingUser, assistant: row });
        pendingUser = null;
      } else {
        preamble.push(row);
      }
    }
  }
  if (pendingUser) trailing.push(pendingUser);
  return { preamble, turns, trailing };
}

export function flattenTurnPartition(part: TurnPartition): ChatMessageLike[] {
  const out: ChatMessageLike[] = [...part.preamble];
  for (const t of part.turns) {
    out.push(t.user, t.assistant);
  }
  out.push(...part.trailing);
  return out;
}

/** 최근 N턴만 UI에 표시 (그 이전은 “이전 글 보기”) */
export function takeRecentTurns(
  rows: ChatMessageLike[],
  turnLimit = CHAT_INITIAL_VISIBLE_TURNS
): {
  messages: ChatMessageLike[];
  hasMoreOlder: boolean;
  totalTurns: number;
  hiddenTurnCount: number;
} {
  const { preamble, turns, trailing } = partitionChatMessages(rows);
  const totalTurns = turns.length;

  if (totalTurns <= turnLimit) {
    return {
      messages: flattenTurnPartition({ preamble, turns, trailing }),
      hasMoreOlder: false,
      totalTurns,
      hiddenTurnCount: 0,
    };
  }

  const recentTurns = turns.slice(-turnLimit);
  const messages = [
    ...recentTurns.flatMap((t) => [t.user, t.assistant]),
    ...trailing,
  ];
  const hiddenTurnCount = totalTurns - turnLimit;

  return {
    messages,
    hasMoreOlder: true,
    totalTurns,
    hiddenTurnCount,
  };
}

/** 북마크 등 특정 메시지 주변 턴만 표시 (이후 전체 대화를 한꺼번에 로드하지 않음) */
export function takeRecentTurnsIncludingMessage(
  rows: ChatMessageLike[],
  messageId: number,
  opts?: {
    turnsBefore?: number;
    turnsAfter?: number;
  }
): ReturnType<typeof takeRecentTurns> {
  const turnsBefore = opts?.turnsBefore ?? 3;
  const turnsAfter = opts?.turnsAfter ?? CHAT_INITIAL_VISIBLE_TURNS;
  const { preamble, turns, trailing } = partitionChatMessages(rows);
  const totalTurns = turns.length;

  const inPreamble = preamble.some((m) => m.id === messageId);
  const inTrailing = trailing.some((m) => m.id === messageId);
  let turnIdx = -1;
  for (let i = 0; i < turns.length; i++) {
    if (turns[i].user.id === messageId || turns[i].assistant.id === messageId) {
      turnIdx = i;
      break;
    }
  }

  if (inPreamble) {
    const sliceTurns = turns.slice(0, Math.min(turnsAfter, turns.length));
    const reachedEnd = sliceTurns.length >= turns.length;
    return {
      messages: flattenTurnPartition({
        preamble,
        turns: sliceTurns,
        trailing: reachedEnd ? trailing : [],
      }),
      hasMoreOlder: false,
      totalTurns,
      hiddenTurnCount: 0,
    };
  }

  if (turnIdx >= 0) {
    const start = Math.max(0, turnIdx - turnsBefore);
    const end = Math.min(turns.length, turnIdx + turnsAfter + 1);
    const sliceTurns = turns.slice(start, end);
    const includePreamble = start === 0;
    const includeTrailing = end >= turns.length;
    const messages = [
      ...(includePreamble ? preamble : []),
      ...sliceTurns.flatMap((t) => [t.user, t.assistant]),
      ...(includeTrailing ? trailing : []),
    ];
    return {
      messages,
      hasMoreOlder: start > 0,
      totalTurns,
      hiddenTurnCount: start,
    };
  }

  if (inTrailing) {
    const start = Math.max(0, turns.length - turnsBefore);
    const sliceTurns = turns.slice(start);
    return {
      messages: flattenTurnPartition({ preamble: [], turns: sliceTurns, trailing }),
      hasMoreOlder: start > 0,
      totalTurns,
      hiddenTurnCount: start,
    };
  }

  return takeRecentTurns(rows);
}

/** beforeMessageId 이전 구간에서 최대 turnLimit턴을 역방향으로 한 배치 로드 */
export function takeOlderTurnsBefore(
  rows: ChatMessageLike[],
  beforeMessageId: number,
  turnLimit = CHAT_LOAD_MORE_TURNS
): {
  messages: ChatMessageLike[];
  hasMoreOlder: boolean;
} {
  const cutIndex = rows.findIndex((m) => m.id === beforeMessageId);
  const beforeRows = cutIndex > 0 ? rows.slice(0, cutIndex) : [];
  if (beforeRows.length === 0) {
    return { messages: [], hasMoreOlder: false };
  }

  const { preamble, turns } = partitionChatMessages(beforeRows);
  if (turns.length === 0) {
    return { messages: [...preamble], hasMoreOlder: false };
  }

  const hasMoreTurns = turns.length > turnLimit;
  const batchTurns = hasMoreTurns ? turns.slice(-turnLimit) : turns;
  const includePreamble = !hasMoreTurns;

  const messages = [
    ...(includePreamble ? preamble : []),
    ...batchTurns.flatMap((t) => [t.user, t.assistant]),
  ];

  return {
    messages,
    hasMoreOlder: hasMoreTurns,
  };
}

/** 서버 initialMessages 동기화 시 prepend된 이전 글 유지 */
export function mergeMessagesKeepingOlderPrefix<T extends ChatMessageLike>(
  prev: T[],
  serverRecent: T[],
  opts?: { keepTailWithoutId?: boolean }
): T[] {
  const oldestServerId = serverRecent.reduce(
    (min, m) => (m.id != null && m.id > 0 ? Math.min(min, m.id) : min),
    Infinity
  );
  if (!Number.isFinite(oldestServerId)) {
    return serverRecent;
  }

  const prefix = prev.filter((m) => m.id != null && m.id < oldestServerId);
  if (!opts?.keepTailWithoutId) {
    return [...prefix, ...serverRecent];
  }

  const tail = prev.filter((m) => m.id == null || m.id >= oldestServerId);
  const serverIds = new Set(serverRecent.map((m) => m.id).filter((id): id is number => id != null));
  const streamingOnly = tail.filter((m) => m.id == null || !serverIds.has(m.id));
  return [...prefix, ...serverRecent, ...streamingOnly];
}
