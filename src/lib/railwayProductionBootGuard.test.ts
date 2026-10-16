import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { assertRailwayProductionNodeEnv, isRailwayProductionEnvironment } = require(
  "./railwayProductionBootGuard.js"
) as {
  assertRailwayProductionNodeEnv: (env?: NodeJS.ProcessEnv) => void;
  isRailwayProductionEnvironment: (env?: NodeJS.ProcessEnv) => boolean;
};

describe("railwayProductionBootGuard", () => {
  it("allows Railway production when NODE_ENV=production", () => {
    assert.doesNotThrow(() =>
      assertRailwayProductionNodeEnv({
        RAILWAY_ENVIRONMENT_NAME: "production",
        NODE_ENV: "production",
      })
    );
  });

  it("fails fast when Railway production has empty NODE_ENV", () => {
    assert.throws(
      () =>
        assertRailwayProductionNodeEnv({
          RAILWAY_ENVIRONMENT_NAME: "production",
          NODE_ENV: "",
        }),
      /Railway production requires NODE_ENV=production/
    );
  });

  it("fails fast when Railway production has NODE_ENV=development", () => {
    assert.throws(
      () =>
        assertRailwayProductionNodeEnv({
          RAILWAY_ENVIRONMENT_NAME: "production",
          NODE_ENV: "development",
        }),
      /Railway production requires NODE_ENV=production/
    );
  });

  it("isRailwayProductionEnvironment is only RAILWAY_ENVIRONMENT_NAME=production", () => {
    assert.equal(isRailwayProductionEnvironment({ RAILWAY_ENVIRONMENT_NAME: "production" }), true);
    assert.equal(isRailwayProductionEnvironment({ RAILWAY_ENVIRONMENT_NAME: "staging" }), false);
    assert.equal(isRailwayProductionEnvironment({ NODE_ENV: "production" }), false);
    assert.equal(isRailwayProductionEnvironment({}), false);
  });

  it("does not enforce outside Railway production", () => {
    assert.doesNotThrow(() =>
      assertRailwayProductionNodeEnv({
        RAILWAY_ENVIRONMENT_NAME: "staging",
        NODE_ENV: "development",
      })
    );
    assert.doesNotThrow(() =>
      assertRailwayProductionNodeEnv({
        NODE_ENV: undefined,
      })
    );
  });
});
