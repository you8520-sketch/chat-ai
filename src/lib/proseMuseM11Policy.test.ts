import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, it } from "node:test";

import {
  isMuseM11EnabledForUser,
  MUSE_SPARK_MODEL_ID,
  PROSE_MUSE_M11_ENV,
} from "@/lib/proseMuseM11Policy";

const MUSE = "meta/muse-spark-1.1";
const DEEPSEEK = "deepseek/deepseek-v4-pro";

const M11_KEYS = [
  PROSE_MUSE_M11_ENV.ENABLED,
  PROSE_MUSE_M11_ENV.USER_IDS,
  PROSE_MUSE_M11_ENV.MODEL_IDS,
] as const;

function saveEnv(): Record<string, string | undefined> {
  return Object.fromEntries(M11_KEYS.map((k) => [k, process.env[k]]));
}

function restoreEnv(snapshot: Record<string, string | undefined>): void {
  for (const key of M11_KEYS) {
    const value = snapshot[key];
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
}

describe("isMuseM11EnabledForUser", () => {
  let envSnapshot: Record<string, string | undefined>;

  beforeEach(() => {
    envSnapshot = saveEnv();
    for (const key of M11_KEYS) delete process.env[key];
  });

  afterEach(() => {
    restoreEnv(envSnapshot);
  });

  it("all unset → OFF", () => {
    assert.equal(isMuseM11EnabledForUser(1, MUSE), false);
  });

  it("enabled only, no USER_IDS → OFF", () => {
    process.env.PROSE_MUSE_M11_ENABLED = "1";
    assert.equal(isMuseM11EnabledForUser(1, MUSE), false);
  });

  it("enabled + USER_IDS but wrong user → OFF", () => {
    process.env.PROSE_MUSE_M11_ENABLED = "1";
    process.env.PROSE_MUSE_M11_USER_IDS = "1";
    assert.equal(isMuseM11EnabledForUser(2, MUSE), false);
  });

  it("enabled + USER_IDS + wrong model → OFF", () => {
    process.env.PROSE_MUSE_M11_ENABLED = "1";
    process.env.PROSE_MUSE_M11_USER_IDS = "1";
    assert.equal(isMuseM11EnabledForUser(1, DEEPSEEK), false);
  });

  it("enabled + USER_IDS + Muse model → ON", () => {
    process.env.PROSE_MUSE_M11_ENABLED = "1";
    process.env.PROSE_MUSE_M11_USER_IDS = "1";
    assert.equal(isMuseM11EnabledForUser(1, MUSE), true);
  });

  it("enabled + USER_IDS + Muse model + exact MODEL_IDS → ON", () => {
    process.env.PROSE_MUSE_M11_ENABLED = "1";
    process.env.PROSE_MUSE_M11_USER_IDS = "1";
    process.env.PROSE_MUSE_M11_MODEL_IDS = MUSE;
    assert.equal(isMuseM11EnabledForUser(1, MUSE), true);
  });

  it("enabled + USER_IDS + Muse model + wrong MODEL_IDS → OFF", () => {
    process.env.PROSE_MUSE_M11_ENABLED = "1";
    process.env.PROSE_MUSE_M11_USER_IDS = "1";
    process.env.PROSE_MUSE_M11_MODEL_IDS = "muse-spark";
    assert.equal(isMuseM11EnabledForUser(1, MUSE), false);
  });

  it("enabled + USER_IDS + Muse model + MODEL_IDS substring → OFF", () => {
    process.env.PROSE_MUSE_M11_ENABLED = "1";
    process.env.PROSE_MUSE_M11_USER_IDS = "1";
    process.env.PROSE_MUSE_M11_MODEL_IDS = "muse";
    assert.equal(isMuseM11EnabledForUser(1, MUSE), false);
  });

  it("enabled=true also counts as ON", () => {
    process.env.PROSE_MUSE_M11_ENABLED = "true";
    process.env.PROSE_MUSE_M11_USER_IDS = "1";
    assert.equal(isMuseM11EnabledForUser(1, MUSE), true);
  });

  it("enabled=0 → OFF", () => {
    process.env.PROSE_MUSE_M11_ENABLED = "0";
    process.env.PROSE_MUSE_M11_USER_IDS = "1";
    assert.equal(isMuseM11EnabledForUser(1, MUSE), false);
  });

  it("exports canonical Muse Spark model ID", () => {
    assert.equal(MUSE_SPARK_MODEL_ID, "meta/muse-spark-1.1");
  });
});
