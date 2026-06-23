const FORK_MEMORY_BATCH_TURNS = 6;

type MessageRow = { id: number; role: string; model: string };

/** 분기 시점까지 완료된 대화 턴 수 (인사말 assistant 제외) */
export function countCompletedTurnsUpToMessageId(
  messages: MessageRow[],
  upToMessageId: number
): number {
  let count = 0;
  let pendingUser = false;

  for (const row of messages) {
    if (row.id > upToMessageId) break;
    if (row.role === "user") {
      pendingUser = true;
    } else if (row.role === "assistant" && row.model !== "greeting") {
      if (pendingUser) {
        count += 1;
        pendingUser = false;
      }
    }
  }

  return count;
}

export function forkSummarizedTurnCount(forkTurnCount: number): number {
  if (forkTurnCount <= 0) return 0;
  return Math.floor(forkTurnCount / FORK_MEMORY_BATCH_TURNS) * FORK_MEMORY_BATCH_TURNS;
}

export const FORK_MEMORY_TURN_INTERVAL = FORK_MEMORY_BATCH_TURNS;
