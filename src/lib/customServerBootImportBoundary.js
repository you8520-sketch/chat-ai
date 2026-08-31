/**
 * Custom-server boot import boundary.
 *
 * Production starts via `tsx server.js` without Node's `react-server` condition.
 * Next.js server modules use `import "server-only"`, which throws outside that
 * condition. The custom server process is always server-side, so neutralize the
 * marker before background dynamic imports (schedulers, derived-cache wakeup).
 *
 * Must be required from server.js before any TS module that transitively loads
 * `server-only` (directly or via `@/lib/db`).
 */
const Module = require("module");

let installed = false;

function installCustomServerBootImportBoundary() {
  if (installed) return;
  installed = true;

  const originalLoad = Module._load;
  Module._load = function customServerBootLoad(request, parent, isMain) {
    if (request === "server-only") return {};
    return originalLoad.call(this, request, parent, isMain);
  };
}

installCustomServerBootImportBoundary();

module.exports = {
  installCustomServerBootImportBoundary,
};
