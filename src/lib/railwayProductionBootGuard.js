/**
 * Fail-fast when Railway production would otherwise boot Next in non-production mode.
 * Keep this as plain CJS so server.js can require it before next is loaded.
 */

/**
 * Railway-injected deploy context. Same predicate as
 * `isRailwayProductionApplyEnvironment` (official-supply apply gate).
 * Not NODE_ENV, paid keys, ports, or key labels.
 * @param {NodeJS.ProcessEnv} [env]
 */
function isRailwayProductionEnvironment(env = process.env) {
  return env.RAILWAY_ENVIRONMENT_NAME === "production";
}

/**
 * @param {NodeJS.ProcessEnv} [env]
 */
function assertRailwayProductionNodeEnv(env = process.env) {
  if (isRailwayProductionEnvironment(env) && env.NODE_ENV !== "production") {
    throw new Error("[boot] Railway production requires NODE_ENV=production");
  }
}

module.exports = {
  isRailwayProductionEnvironment,
  assertRailwayProductionNodeEnv,
};
