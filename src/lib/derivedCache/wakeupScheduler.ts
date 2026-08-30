import "server-only";

import { getDb } from "@/lib/db";
import {
  drainDerivedCacheJobs,
  getDerivedCacheNextWakeDelayMs,
} from "@/lib/derivedCache/jobs";

let wakeTimer: ReturnType<typeof setTimeout> | null = null;
let scheduledWakeAtMs: number | null = null;
let drainPromise: Promise<number> | null = null;
let needsFollowupDrain = false;
let defaultMaxJobs = 3;

type DrainExecutor = (maxJobs: number) => Promise<number>;
let drainExecutor: DrainExecutor = drainDerivedCacheJobs;
let onWakeTimerFireForTests: (() => void) | null = null;

export function isDerivedCacheWorkerDisabled(): boolean {
  return process.env.DISABLE_DERIVED_CACHE_WORKER === "1";
}

function clearWakeTimer(): void {
  if (wakeTimer !== null) {
    clearTimeout(wakeTimer);
    wakeTimer = null;
  }
  scheduledWakeAtMs = null;
}

function scheduleWakeAt(delayMs: number): void {
  if (isDerivedCacheWorkerDisabled()) return;

  const safeDelayMs = Math.max(0, delayMs);
  const targetAtMs = Date.now() + safeDelayMs;
  if (scheduledWakeAtMs !== null && scheduledWakeAtMs <= targetAtMs) {
    return;
  }

  clearWakeTimer();
  scheduledWakeAtMs = targetAtMs;
  wakeTimer = setTimeout(() => {
    wakeTimer = null;
    scheduledWakeAtMs = null;
    onWakeTimerFireForTests?.();
    void runDrainCycle(defaultMaxJobs);
  }, safeDelayMs);
  wakeTimer.unref?.();
}

function rescheduleFromQueue(): void {
  if (isDerivedCacheWorkerDisabled()) return;
  const delayMs = getDerivedCacheNextWakeDelayMs(getDb());
  if (delayMs === null) {
    clearWakeTimer();
    return;
  }
  scheduleWakeAt(delayMs);
}

async function runDrainCycle(maxJobs = defaultMaxJobs): Promise<number> {
  if (isDerivedCacheWorkerDisabled()) return 0;

  if (drainPromise) {
    needsFollowupDrain = true;
    return drainPromise;
  }

  drainPromise = (async () => {
    let totalProcessed = 0;
    try {
      do {
        needsFollowupDrain = false;
        const processed = await drainExecutor(maxJobs);
        totalProcessed += processed;
        if (processed >= maxJobs) {
          needsFollowupDrain = true;
        }
      } while (needsFollowupDrain);
      return totalProcessed;
    } finally {
      drainPromise = null;
      rescheduleFromQueue();
    }
  })();

  return drainPromise;
}

/** Request an earlier wake (enqueue / post-response). Coalesces overlapping drains. */
export function requestDerivedCacheWake(maxJobs = defaultMaxJobs): void {
  if (isDerivedCacheWorkerDisabled()) return;
  defaultMaxJobs = maxJobs;
  // Drop a later timer; runDrainCycle reschedules from queue after draining.
  if (scheduledWakeAtMs !== null && scheduledWakeAtMs > Date.now()) {
    clearWakeTimer();
  }
  void runDrainCycle(maxJobs);
}

/** Start durable queue wakeup after HTTP listen — non-blocking for server ready. */
export function startDerivedCacheWakeup(): void {
  if (isDerivedCacheWorkerDisabled()) {
    console.log("[server] derived cache worker disabled (DISABLE_DERIVED_CACHE_WORKER=1)");
    return;
  }
  console.log("[derivedCache] wakeup scheduler started");
  void runDrainCycle(defaultMaxJobs);
}

export function __testOnly_resetDerivedCacheWakeupState(): void {
  clearWakeTimer();
  drainPromise = null;
  needsFollowupDrain = false;
  defaultMaxJobs = 3;
  drainExecutor = drainDerivedCacheJobs;
  onWakeTimerFireForTests = null;
}

export function __testOnly_setOnWakeTimerFire(handler: (() => void) | null): void {
  onWakeTimerFireForTests = handler;
}

export function __testOnly_setDrainExecutor(executor: DrainExecutor): void {
  drainExecutor = executor;
}

export function __testOnly_getScheduledWakeDelayMs(): number | null {
  if (scheduledWakeAtMs === null) return null;
  return Math.max(0, scheduledWakeAtMs - Date.now());
}

export async function __testOnly_flushDerivedCacheWakeup(): Promise<number> {
  return runDrainCycle(defaultMaxJobs);
}

export async function __testOnly_awaitDerivedCacheDrainIdle(): Promise<void> {
  while (drainPromise) {
    await drainPromise;
  }
}
