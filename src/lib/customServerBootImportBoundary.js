/**
 * Scoped custom-server background import boundary.
 *
 * Production starts via `tsx server.js` without Node's `react-server` condition.
 * Background dynamic imports may transitively load `import "server-only"`, which
 * throws outside that condition. This helper temporarily neutralizes the marker
 * only while an explicit background import is loading, then restores Module._load.
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

function isCustomServerBootImportBoundaryActive() {
  return boundaryDepth > 0;
}

function getCustomServerBootImportBoundaryDepth() {
  return boundaryDepth;
}

module.exports = {
  withCustomServerBootImportBoundary,
  isCustomServerBootImportBoundaryActive,
  getCustomServerBootImportBoundaryDepth,
};
