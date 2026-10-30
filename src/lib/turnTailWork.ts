import "server-only";

/**
 * Post-SSE follow-up owner still running in this process.
 * The live measure waits on these promises. The array lives outside the chat
 * route module because Next.js rejects non-route exports from route files.
 * Promise identity is stable: callers must keep the same promise until it settles.
 */
const openTurnTailWork: Promise<void>[] = [];

export type TurnTailWorkMeta = {
  /** Chat whose next request must observe this tail's memory write. */
  chatId?: number | null;
  /** The tail persists durable relationship/episodic memory. */
  memoryCritical?: boolean;
};

const metaByWork = new Map<Promise<void>, TurnTailWorkMeta>();

/** Bounded wait so an immediate next turn cannot read pre-write memory. */
export const TURN_TAIL_MEMORY_WAIT_MS = 15_000;

export function listOpenTurnTailWork(): readonly Promise<void>[] {
  return openTurnTailWork;
}

export function trackTurnTailWork(work: Promise<void>, meta: TurnTailWorkMeta = {}): void {
  openTurnTailWork.push(work);
  metaByWork.set(work, meta);
  void work.finally(() => {
    const index = openTurnTailWork.indexOf(work);
    if (index >= 0) openTurnTailWork.splice(index, 1);
    metaByWork.delete(work);
  });
}

/**
 * Wait for the same chat's memory-critical post-turn tail before a new turn
 * loads memory. This is a bounded, per-chat wait on the existing turn-tail
 * owner; it is not a new global lock or queue. A timeout proceeds with the
 * stored projection rather than blocking the request indefinitely.
 */
export async function waitForTurnTailWork(
  chatId: number,
  opts: { timeoutMs?: number; memoryCriticalOnly?: boolean } = {}
): Promise<{ waited: boolean; timedOut: boolean }> {
  const timeoutMs = opts.timeoutMs ?? TURN_TAIL_MEMORY_WAIT_MS;
  const memoryCriticalOnly = opts.memoryCriticalOnly !== false;
  const pending = openTurnTailWork.filter((work) => {
    const meta = metaByWork.get(work);
    if (!meta || meta.chatId !== chatId) return false;
    return memoryCriticalOnly ? meta.memoryCritical === true : true;
  });
  if (pending.length === 0) return { waited: false, timedOut: false };

  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<"timeout">((resolve) => {
    timer = setTimeout(() => resolve("timeout"), Math.max(0, timeoutMs));
  });
  const settled = Promise.allSettled(pending).then(() => "settled" as const);
  const result = await Promise.race([settled, timeout]);
  if (timer) clearTimeout(timer);
  return { waited: true, timedOut: result === "timeout" };
}
