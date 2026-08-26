import { isCanonAdoptedScene } from "@/lib/oocSceneRender";

type MessageRow = { id: number; role: string; model: string; usage?: unknown };

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
      } else if (isCanonAdoptedScene(row.usage)) {
        count += 1;
      }
    }
  }

  return count;
}

export function countMemoryEligibleCompletedTurnsUpToMessageId(
  messages: MessageRow[],
  upToMessageId: number,
  resetAfterMessageId: number | null
): number {
  if (resetAfterMessageId == null) {
    return countCompletedTurnsUpToMessageId(messages, upToMessageId);
  }
  let count = 0;
  let pendingUserId: number | null = null;
  for (const row of messages) {
    if (row.id > upToMessageId) break;
    if (row.role === "user") {
      pendingUserId = row.id;
    } else if (row.role === "assistant" && row.model !== "greeting") {
      if (pendingUserId != null) {
        if (pendingUserId > resetAfterMessageId) count += 1;
        pendingUserId = null;
      } else if (
        isCanonAdoptedScene(row.usage) &&
        row.id > resetAfterMessageId
      ) {
        count += 1;
      }
    }
  }
  return count;
}
