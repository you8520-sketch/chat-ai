/**
 * Fail-fast when Railway production would otherwise boot Next in non-production mode.
 * Keep this as plain CJS so server.js can require it before next is loaded.
 */

/**
 * @param {NodeJS.ProcessEnv} [env]
 */
function assertRailwayProductionNodeEnv(env = process.env) {
  const isRailwayProduction = env.RAILWAY_ENVIRONMENT_NAME === "production";
  if (isRailwayProduction && env.NODE_ENV !== "production") {
    throw new Error("[boot] Railway production requires NODE_ENV=production");
  }
}

module.exports = {
  assertRailwayProductionNodeEnv,
};
