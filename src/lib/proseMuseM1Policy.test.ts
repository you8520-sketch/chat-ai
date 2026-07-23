import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, it } from "node:test";

import {
  isMuseM1EnabledForUser,
  isMuseM1RolloutEnabledForModel,
  isMuseSparkModel,
  MUSE_SPARK_MODEL_ID,
  PROSE_MUSE_M1_ENV,
} from "@/lib/proseMuseM1Policy";

const MUSE = MUSE_SPARK_MODEL_ID;
const DEEPSEEK = "deepseek/deepseek-v4-pro";

const ENV_KEYS = [
  PROSE_MUSE_M1_ENV.ENABLED,
  PROSE_MUSE_M1_ENV.USER_IDS,
  PROSE_MUSE_M1_ENV.MODEL_IDS,
  PROSE_MUSE_M1_ENV.ROLLOUT_ENABLED,
  PROSE_MUSE_M1_ENV.ROLLOUT_MODEL_IDS,
] as const;

function saveEnv(): Record<string, string | undefined> {
  return Object.fromEntries(ENV_KEYS.map((k) => [k, process.env[k]]));
}

function restoreEnv(snapshot: Record<string, string | undefined>): void {
  for (const key of ENV_KEYS) {
    const value = snapshot[key];
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
}

describe("isMuseSparkModel", () => {
  it("matches exact canonical Muse Spark ID", () => {
    assert.equal(isMuseSparkModel(MUSE), true);
    assert.equal(isMuseSparkModel("META/MUSE-SPARK-1.1"), true);
    assert.equal(isMuseSparkModel(DEEPSEEK), false);
    assert.equal(isMuseSparkModel("foo-meta/muse-spark-1.1-bar"), false);
  });
});

describe("isMuseM1EnabledForUser — fail-closed admin gate", () => {
  let envSnapshot: Record<string, string | undefined>;

  beforeEach(() => {
    envSnapshot = saveEnv();
    for (const key of ENV_KEYS) delete process.env[key];
  });

  afterEach(() => {
    restoreEnv(envSnapshot);
  });

  it("all unset → OFF", () => {
    assert.equal(isMuseM1EnabledForUser(1, MUSE), false);
  });

  it("ENABLED=1 without USER_IDS → fail closed", () => {
    process.env.PROSE_MUSE_M1_ENABLED = "1";
    assert.equal(isMuseM1EnabledForUser(1, MUSE), false);
  });

  it("explicit admin + Muse model → ON", () => {
    process.env.PROSE_MUSE_M1_ENABLED = "1";
    process.env.PROSE_MUSE_M1_USER_IDS = "1";
    assert.equal(isMuseM1EnabledForUser(1, MUSE), true);
  });

  it("non-admin → OFF", () => {
    process.env.PROSE_MUSE_M1_ENABLED = "1";
    process.env.PROSE_MUSE_M1_USER_IDS = "1";
    assert.equal(isMuseM1EnabledForUser(2, MUSE), false);
  });

  it("admin + non-Muse model → OFF", () => {
    process.env.PROSE_MUSE_M1_ENABLED = "1";
    process.env.PROSE_MUSE_M1_USER_IDS = "1";
    assert.equal(isMuseM1EnabledForUser(1, DEEPSEEK), false);
  });

  it("empty MODEL_IDS after parse → fail closed", () => {
    process.env.PROSE_MUSE_M1_ENABLED = "1";
    process.env.PROSE_MUSE_M1_USER_IDS = "1";
    process.env.PROSE_MUSE_M1_MODEL_IDS = " , ";
    assert.equal(isMuseM1EnabledForUser(1, MUSE), false);
  });
});

describe("isMuseM1RolloutEnabledForModel — fail-closed public rollout", () => {
  let envSnapshot: Record<string, string | undefined>;

  beforeEach(() => {
    envSnapshot = saveEnv();
    for (const key of ENV_KEYS) delete process.env[key];
  });

  afterEach(() => {
    restoreEnv(envSnapshot);
  });

  it("ROLLOUT_ENABLED without model list → OFF", () => {
    process.env.PROSE_MUSE_M1_ROLLOUT_ENABLED = "1";
    assert.equal(isMuseM1RolloutEnabledForModel(MUSE), false);
  });

  it("exact Muse ID listed → ON for any caller context", () => {
    process.env.PROSE_MUSE_M1_ROLLOUT_ENABLED = "1";
    process.env.PROSE_MUSE_M1_ROLLOUT_MODEL_IDS = MUSE;
    assert.equal(isMuseM1RolloutEnabledForModel(MUSE), true);
    assert.equal(isMuseM1RolloutEnabledForModel(DEEPSEEK), false);
  });

  it("partial model ID must not match", () => {
    process.env.PROSE_MUSE_M1_ROLLOUT_ENABLED = "1";
    process.env.PROSE_MUSE_M1_ROLLOUT_MODEL_IDS = MUSE;
    assert.equal(isMuseM1RolloutEnabledForModel(`foo-${MUSE}-bar`), false);
  });
});
