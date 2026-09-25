"use strict";

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
    });

    const forceTimer = setTimer(() => {
      logger.error("[server] graceful shutdown timed out; forcing exit", {
        signal,
        forceExitMs,
      });
      processRef.exit(1);
    }, forceExitMs);
    if (forceTimer && typeof forceTimer.unref === "function") forceTimer.unref();

    server.close((err) => {
      clearTimer(forceTimer);
      if (err) {
        logger.error("[server] graceful shutdown close failed", err);
        processRef.exit(1);
        return;
      }
      logger.log("[server] graceful shutdown complete", { signal });
      processRef.exit(0);
    });
  };

  processRef.once("SIGTERM", () => begin("SIGTERM"));
  processRef.once("SIGINT", () => begin("SIGINT"));

  return { begin };
}

module.exports = {
  installGracefulHttpDrain,
  resolveGracefulShutdownForceMs,
};
