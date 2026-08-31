/**
 * Scoped custom-server background import boundary and export interop.
 *
 * Production starts via `tsx server.js` (CommonJS) without Node's `react-server`
 * condition. Background dynamic imports may transitively load `import "server-only"`.
 * TypeScript modules loaded via dynamic import() from CJS often expose exports on
 * `moduleNamespace.default` rather than as direct named properties.
 */
const Module = require("module");

/** @type {typeof Module._load | null} */
let originalModuleLoad = null;
/** @type {typeof Module._load | null} */
let neutralizerModuleLoad = null;
let boundaryDepth = 0;

function activateCustomServerBootImportBoundary() {
  if (boundaryDepth === 0) {
    originalModuleLoad = Module._load;
    neutralizerModuleLoad = function customServerBootLoad(request, parent, isMain) {
      if (request === "server-only") return {};
      return originalModuleLoad.call(this, request, parent, isMain);
    };
    Module._load = neutralizerModuleLoad;
  }
  boundaryDepth += 1;
}

function deactivateCustomServerBootImportBoundary() {
  if (boundaryDepth <= 0) return;
  boundaryDepth -= 1;
  if (boundaryDepth === 0 && originalModuleLoad !== null) {
    Module._load = originalModuleLoad;
    originalModuleLoad = null;
    neutralizerModuleLoad = null;
  }
}

/**
 * Run a background boot import under temporary server-only compatibility.
 * @template T
 * @param {() => T | Promise<T>} fn
 * @returns {Promise<T>}
 */
async function withCustomServerBootImportBoundary(fn) {
  activateCustomServerBootImportBoundary();
  try {
    return await fn();
  } finally {
    deactivateCustomServerBootImportBoundary();
  }
}

/**
 * Resolve a named export from a custom-server dynamic import namespace.
 * Prefers direct named exports; falls back to default-wrapped exports.
 * @param {unknown} moduleNamespace
 * @param {string} exportName
 * @returns {unknown}
 */
function resolveCustomServerImportedExport(moduleNamespace, exportName) {
  if (moduleNamespace == null || typeof moduleNamespace !== "object") return undefined;
  const record = /** @type {Record<string, unknown>} */ (moduleNamespace);
  const direct = record[exportName];
  if (direct !== undefined && direct !== null) {
    return direct;
  }
  const wrapped = record.default;
  if (wrapped != null && typeof wrapped === "object") {
    return /** @type {Record<string, unknown>} */ (wrapped)[exportName];
  }
  return undefined;
}

/**
 * Resolve and require a boot function export; throws a sanitized TypeError if absent.
 * @param {unknown} moduleNamespace
 * @param {string} exportName
 * @param {string} moduleId
 * @returns {(...args: unknown[]) => unknown}
 */
function requireCustomServerBootFunction(moduleNamespace, exportName, moduleId) {
  const resolved = resolveCustomServerImportedExport(moduleNamespace, exportName);
  if (typeof resolved !== "function") {
    throw new TypeError(
      `[boot] ${moduleId}: export "${exportName}" is not a function (got ${typeof resolved})`
    );
  }
  return resolved;
}

function isCustomServerBootImportBoundaryActive() {
  return boundaryDepth > 0;
}

function getCustomServerBootImportBoundaryDepth() {
  return boundaryDepth;
}

module.exports = {
  withCustomServerBootImportBoundary,
  resolveCustomServerImportedExport,
  requireCustomServerBootFunction,
  isCustomServerBootImportBoundaryActive,
  getCustomServerBootImportBoundaryDepth,
};
