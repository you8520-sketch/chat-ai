"use strict";

const GRACEFUL_TASKS_KEY = Symbol.for("playai.serverGracefulDrain.tasks");

function getTrackedTasks() {
  const root = globalThis;
  if (!(root[GRACEFUL_TASKS_KEY] instanceof Set)) {
    root[GRACEFUL_TASKS_KEY] = new Set();
  }
  return root[GRACEFUL_TASKS_KEY];
}

function trackGracefulTask(task) {
  const promise = Promise.resolve(task);
  const tasks = getTrackedTasks();
  tasks.add(promise);
  promise.then(
    () => tasks.delete(promise),
    () => tasks.delete(promise)
  );
  return promise;
}

function getTrackedGracefulTaskCount() {
  return getTrackedTasks().size;
}

async function waitForTrackedGracefulTasks() {
  const tasks = getTrackedTasks();
  while (tasks.size > 0) {
    const batch = Array.from(tasks);
    await Promise.allSettled(batch);
  }
}

function resolveGracefulShutdownForceMs(env = process.env) {
  const raw = Number(env.RAILWAY_DEPLOYMENT_DRAINING_SECONDS || "120");
  const drainingSeconds =
    Number.isFinite(raw) && raw >= 10 ? Math.floor(raw) : 120;
  return Math.max(5_000, (drainingSeconds - 5) * 1_000);
}

function installGracefulHttpDrain(server, opts = {}) {
  const processRef = opts.processRef || process;
  const logger = opts.logger || console;
  const setTimer = opts.setTimeoutFn || setTimeout;
  const clearTimer = opts.clearTimeoutFn || clearTimeout;
  let shutdownStarted = false;

  const begin = (signal) => {
    if (shutdownStarted) return;
    shutdownStarted = true;

    const forceExitMs = resolveGracefulShutdownForceMs(processRef.env || process.env);
    logger.log("[server] graceful shutdown started", {
      signal,
      forceExitMs,
      trackedTasks: getTrackedGracefulTaskCount(),
    });

    const forceTimer = setTimer(() => {
      logger.error("[server] graceful shutdown timed out; forcing exit", {
        signal,
        forceExitMs,
        trackedTasks: getTrackedGracefulTaskCount(),
      });
      processRef.exit(1);
    }, forceExitMs);
    if (forceTimer && typeof forceTimer.unref === "function") forceTimer.unref();

    server.close((err) => {
      if (err) {
        clearTimer(forceTimer);
        logger.error("[server] graceful shutdown close failed", err);
        processRef.exit(1);
        return;
      }

      void (async () => {
        const trackedAtHttpClose = getTrackedGracefulTaskCount();
        if (trackedAtHttpClose > 0) {
          logger.log("[server] waiting for detached tasks", {
            signal,
            trackedTasks: trackedAtHttpClose,
          });
        }
        await waitForTrackedGracefulTasks();
        clearTimer(forceTimer);
        logger.log("[server] graceful shutdown complete", {
          signal,
          trackedTasks: getTrackedGracefulTaskCount(),
        });
        processRef.exit(0);
      })();
    });
  };

  processRef.once("SIGTERM", () => begin("SIGTERM"));
  processRef.once("SIGINT", () => begin("SIGINT"));

  return { begin };
}

module.exports = {
  getTrackedGracefulTaskCount,
  installGracefulHttpDrain,
  resolveGracefulShutdownForceMs,
  trackGracefulTask,
  waitForTrackedGracefulTasks,
};
