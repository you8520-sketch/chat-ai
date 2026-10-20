import "server-only";

/**
 * Post-SSE follow-up owner still running in this process.
 * The live measure waits on these promises. The array lives outside the chat
 * route module because Next.js rejects non-route exports from route files.
 * Promise identity is stable: callers must keep the same promise until it settles.
 */
const openTurnTailWork: Promise<void>[] = [];

export function listOpenTurnTailWork(): readonly Promise<void>[] {
  return openTurnTailWork;
}

export function trackTurnTailWork(work: Promise<void>): void {
  openTurnTailWork.push(work);
  void work.finally(() => {
    const index = openTurnTailWork.indexOf(work);
    if (index >= 0) openTurnTailWork.splice(index, 1);
  });
}
