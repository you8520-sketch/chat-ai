import "server-only";

import { getDb } from "@/lib/db";
import {
  drainDerivedCacheJobs,
  getDerivedCacheNextWakeDelayMs,
} from "@/lib/derivedCache/jobs";

let wakeTimer: ReturnType<typeof setTimeout> | null = null;
let scheduledWakeAtMs: number | null = null;
let drainPromise: Promise<number> | null = null;
let defaultMaxJobs = 3;

type DrainExecutor = (maxJobs: number) => Promise<number>;
let drainExecutor: DrainExecutor = drainDerivedCacheJobs;
let onWakeTimerFireForTests: (() => void) | null = null;

export function isDerivedCacheWorkerDisabled(): boolean {
  return process.env.DISABLE_DERIVED_CACHE_WORKER === "1";
}

function logSchedulerDrainFailure(err: unknown): void {
  console.warn(
    "[derivedCache] scheduler drain failed:",
    err instanceof Error ? err.message.slice(0, 160) : String(err).slice(0, 160)
  );
}

function releaseSchedulerAfterDrainFailure(): void {
  drainPromise = null;
  clearWakeTimer();
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
    invokeDrainCycleAsync(defaultMaxJobs);
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

async function executeDrainCycle(maxJobs: number): Promise<number> {
  try {
    return await drainExecutor(maxJobs);
  } catch (err) {
    logSchedulerDrainFailure(err);
    releaseSchedulerAfterDrainFailure();
    return 0;
  } finally {
    if (drainPromise !== null) {
      drainPromise = null;
      rescheduleFromQueue();
    }
  }
}

async function runDrainCycle(maxJobs = defaultMaxJobs): Promise<number> {
  if (isDerivedCacheWorkerDisabled()) return 0;

  if (drainPromise) {
    return drainPromise;
  }

  drainPromise = executeDrainCycle(maxJobs);
  return drainPromise;
}

/** Canonical fire-and-forget entry — one async error boundary for boot/request/timer wakes. */
function invokeDrainCycleAsync(maxJobs: number): void {
  void runDrainCycle(maxJobs).catch((err) => {
    logSchedulerDrainFailure(err);
    releaseSchedulerAfterDrainFailure();
  });
}

/** Request an earlier wake (enqueue / post-response). Coalesces overlapping drains. */
export function requestDerivedCacheWake(maxJobs = defaultMaxJobs): void {
  if (isDerivedCacheWorkerDisabled()) return;
  defaultMaxJobs = maxJobs;
  // Drop a later timer; a successful batch reschedules from queue afterward.
  if (scheduledWakeAtMs !== null && scheduledWakeAtMs > Date.now()) {
    clearWakeTimer();
  }
  invokeDrainCycleAsync(maxJobs);
}

/** Start durable queue wakeup after HTTP listen — non-blocking for server ready. */
export function startDerivedCacheWakeup(): void {
  if (isDerivedCacheWorkerDisabled()) {
    console.log("[server] derived cache worker disabled (DISABLE_DERIVED_CACHE_WORKER=1)");
    return;
  }
  console.log("[derivedCache] wakeup scheduler started");
  invokeDrainCycleAsync(defaultMaxJobs);
}

export function __testOnly_resetDerivedCacheWakeupState(): void {
  clearWakeTimer();
  drainPromise = null;
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

export function __testOnly_isDrainActive(): boolean {
  return drainPromise !== null;
}

export async function __testOnly_flushDerivedCacheWakeup(): Promise<number> {
  return runDrainCycle(defaultMaxJobs);
}

export async function __testOnly_awaitDerivedCacheDrainIdle(): Promise<void> {
  while (drainPromise) {
    await drainPromise;
  }
}
