/**
 * Single owner for the custom HTTP server process lifecycle.
 *
 * This module deliberately depends only on Node's HTTP server and response
 * objects. In particular, readiness must remain outside the Next, database,
 * authentication, scheduler, billing, and provider module graphs.
 */

const READY_PATH = "/readyz";
const RUNNING = "RUNNING";
const DRAINING = "DRAINING";

// The longest currently bounded request is a TRPG GM turn: two 180s provider
// attempts plus its one-second transient-5xx retry delay.
const DEFAULT_DRAIN_DEADLINE_MS = 361_000;

function responseText(res, statusCode, text, method) {
  const body = `${text}\n`;
  res.writeHead(statusCode, {
    "content-type": "text/plain; charset=utf-8",
    "content-length": Buffer.byteLength(body),
    connection: statusCode === 503 ? "close" : "keep-alive",
  });
  res.end(method === "HEAD" ? undefined : body);
}

/**
 * @param {{
 *   server: import("node:http").Server,
 *   drainDeadlineMs?: number,
 *   processRef?: NodeJS.Process,
 *   exit?: (code: number) => void,
 *   log?: Pick<Console, "info" | "warn" | "error">,
 * }} options
 */
function createServerLifecycle(options) {
  const server = options.server;
  const drainDeadlineMs = options.drainDeadlineMs ?? DEFAULT_DRAIN_DEADLINE_MS;
  const processRef = options.processRef ?? process;
  const exit = options.exit ?? ((code) => processRef.exit(code));
  const log = options.log ?? console;

  let state = RUNNING;
  let activeRequests = 0;
  let shutdownPromise = null;
  let drainTimer = null;
  let exited = false;
  let resolveShutdown = null;

  function finishExit(code) {
    if (exited) return;
    exited = true;
    if (drainTimer) clearTimeout(drainTimer);
    resolveShutdown?.(code);
    exit(code);
  }

  function finishCleanDrain() {
    if (state !== DRAINING || activeRequests !== 0 || exited) return;
    // close() has already stopped accepts. Reap any keep-alive socket before
    // exiting rather than allowing an idle connection to consume the deadline.
    server.closeIdleConnections?.();
    log.info("[shutdown] active HTTP work drained; exiting cleanly");
    finishExit(0);
  }

  function markRequestActive(res) {
    activeRequests += 1;
    let settled = false;
    const settle = () => {
      if (settled) return;
      settled = true;
      activeRequests = Math.max(0, activeRequests - 1);
      finishCleanDrain();
    };
    res.once("finish", settle);
    res.once("close", settle);
  }

  function isReadyPath(req) {
    const rawUrl = req.url ?? "/";
    return new URL(rawUrl, "http://localhost").pathname === READY_PATH;
  }

  function handleReadiness(req, res) {
    if (!isReadyPath(req)) return false;
    if (req.method !== "GET" && req.method !== "HEAD") {
      res.writeHead(405, { allow: "GET, HEAD", connection: "close" });
      res.end();
      return true;
    }
    responseText(res, state === RUNNING ? 200 : 503, state === RUNNING ? "ready" : "draining", req.method);
    return true;
  }

  function rejectDrainingRequest(res) {
    responseText(res, 503, "draining", "GET");
  }

  function beginShutdown(signal) {
    if (shutdownPromise) return shutdownPromise;

    state = DRAINING;
    log.info(`[shutdown] ${signal} received; entering draining state (activeRequests=${activeRequests})`);

    shutdownPromise = new Promise((resolve) => {
      resolveShutdown = resolve;
      drainTimer = setTimeout(() => {
        log.error(
          `[shutdown] drain deadline exceeded after ${drainDeadlineMs}ms; forcing remaining connections closed (activeRequests=${activeRequests})`
        );
        server.closeAllConnections?.();
        finishExit(1);
      }, drainDeadlineMs);

      try {
        server.close(() => {
          log.info(`[shutdown] HTTP server close callback (activeRequests=${activeRequests})`);
          finishCleanDrain();
        });
        // Node 22's close() already reaps idle connections; this explicit call
        // keeps the lifecycle intent clear and is harmless on supported Node.
        server.closeIdleConnections?.();
      } catch (error) {
        log.error("[shutdown] HTTP server close failed:", error);
        finishExit(1);
      }
      finishCleanDrain();
    });

    return shutdownPromise;
  }

  function installSignalHandlers() {
    const onSignal = (signal) => {
      void beginShutdown(signal);
    };
    processRef.on("SIGTERM", () => onSignal("SIGTERM"));
    processRef.on("SIGINT", () => onSignal("SIGINT"));
  }

  return {
    handleReadiness,
    rejectDrainingRequest,
    markRequestActive,
    beginShutdown,
    installSignalHandlers,
    isRunning: () => state === RUNNING,
    state: () => state,
    activeRequestCount: () => activeRequests,
  };
}

module.exports = {
  DEFAULT_DRAIN_DEADLINE_MS,
  DRAINING,
  READY_PATH,
  RUNNING,
  createServerLifecycle,
};
