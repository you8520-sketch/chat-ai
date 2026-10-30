import { TURN_TAIL_MEMORY_WAIT_MS, waitForTurnTailWork } from "@/lib/turnTailWork";

export type OwnedChatIdentity = { id: number };

/**
 * B61 next-turn barrier, scoped to a chat row that the caller already loaded
 * with its ownership predicate. A missing/foreign chat is passed as undefined
 * and never consumes the wait. After a wait the caller reloads the row, so the
 * prompt reads the post-write memory_meta rather than the pre-wait snapshot.
 *
 * This is a small composition of the existing turn-tail owner; it adds no
 * permission model, queue, lock, or schema.
 */
export async function waitForOwnedChatMemory<TChat extends OwnedChatIdentity>(
  chat: TChat | undefined,
  opts: {
    memoryEnabled: boolean;
    reload: () => TChat | undefined;
    timeoutMs?: number;
  }
): Promise<{ chat: TChat | undefined; waited: boolean; timedOut: boolean }> {
  if (!chat || !opts.memoryEnabled) {
    return { chat, waited: false, timedOut: false };
  }
  const result = await waitForTurnTailWork(chat.id, {
    timeoutMs: opts.timeoutMs ?? TURN_TAIL_MEMORY_WAIT_MS,
    memoryCriticalOnly: true,
  });
  return { chat: opts.reload(), waited: result.waited, timedOut: result.timedOut };
}
