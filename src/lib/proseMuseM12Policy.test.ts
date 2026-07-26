import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, it } from "node:test";

import {
  isMuseM12EnabledForUser,
  MUSE_SPARK_MODEL_ID,
  PROSE_MUSE_M12_ENV,
} from "@/lib/proseMuseM12Policy";

const MUSE = "meta/muse-spark-1.1";
const DEEPSEEK = "deepseek/deepseek-v4-pro";

const M12_KEYS = [
  PROSE_MUSE_M12_ENV.ENABLED,
  PROSE_MUSE_M12_ENV.USER_IDS,
  PROSE_MUSE_M12_ENV.MODEL_IDS,
] as const;

function saveEnv(): Record<string, string | undefined> {
  return Object.fromEntries(M12_KEYS.map((k) => [k, process.env[k]]));
}

function restoreEnv(snapshot: Record<string, string | undefined>): void {
  for (const key of M12_KEYS) {
    const value = snapshot[key];
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
}

describe("isMuseM12EnabledForUser", () => {
  let envSnapshot: Record<string, string | undefined>;

  beforeEach(() => {
    envSnapshot = saveEnv();
    for (const key of M12_KEYS) delete process.env[key];
  });

  afterEach(() => {
    restoreEnv(envSnapshot);
  });

  it("enabled missing → OFF", () => {
    process.env.PROSE_MUSE_M12_USER_IDS = "1";
    assert.equal(isMuseM12EnabledForUser(1, MUSE), false);
  });

  it("enabled 0 → OFF", () => {
    process.env.PROSE_MUSE_M12_ENABLED = "0";
    process.env.PROSE_MUSE_M12_USER_IDS = "1";
    assert.equal(isMuseM12EnabledForUser(1, MUSE), false);
  });

  it("user allowlist missing → OFF", () => {
    process.env.PROSE_MUSE_M12_ENABLED = "1";
    assert.equal(isMuseM12EnabledForUser(1, MUSE), false);
  });

  it("wrong/malformed user → OFF", () => {
    process.env.PROSE_MUSE_M12_ENABLED = "1";
    process.env.PROSE_MUSE_M12_USER_IDS = "1";
    assert.equal(isMuseM12EnabledForUser(2, MUSE), false);
    assert.equal(isMuseM12EnabledForUser(null, MUSE), false);
    assert.equal(isMuseM12EnabledForUser(0, MUSE), false);
    assert.equal(isMuseM12EnabledForUser(1.5 as unknown as number, MUSE), false);
  });

  it("non-Muse → OFF", () => {
    process.env.PROSE_MUSE_M12_ENABLED = "1";
    process.env.PROSE_MUSE_M12_USER_IDS = "1";
    assert.equal(isMuseM12EnabledForUser(1, DEEPSEEK), false);
  });

  it("substring model → OFF", () => {
    process.env.PROSE_MUSE_M12_ENABLED = "1";
    process.env.PROSE_MUSE_M12_USER_IDS = "1";
    assert.equal(isMuseM12EnabledForUser(1, "muse-spark-1.1"), false);
    assert.equal(isMuseM12EnabledForUser(1, "meta/muse"), false);
  });

  it("exact Muse + allowed user → ON", () => {
    process.env.PROSE_MUSE_M12_ENABLED = "1";
    process.env.PROSE_MUSE_M12_USER_IDS = "1";
    assert.equal(isMuseM12EnabledForUser(1, MUSE), true);
  });

  it("MODEL_IDS unset → ON", () => {
    process.env.PROSE_MUSE_M12_ENABLED = "1";
    process.env.PROSE_MUSE_M12_USER_IDS = "1";
    assert.equal(isMuseM12EnabledForUser(1, MUSE), true);
  });

  it("MODEL_IDS empty → OFF", () => {
    process.env.PROSE_MUSE_M12_ENABLED = "1";
    process.env.PROSE_MUSE_M12_USER_IDS = "1";
    process.env.PROSE_MUSE_M12_MODEL_IDS = "";
    assert.equal(isMuseM12EnabledForUser(1, MUSE), false);
  });

  it("exact canonical MODEL_IDS → ON", () => {
    process.env.PROSE_MUSE_M12_ENABLED = "1";
    process.env.PROSE_MUSE_M12_USER_IDS = "1";
    process.env.PROSE_MUSE_M12_MODEL_IDS = MUSE;
    assert.equal(isMuseM12EnabledForUser(1, MUSE), true);
  });

  it("alias/substrings in MODEL_IDS → OFF", () => {
    process.env.PROSE_MUSE_M12_ENABLED = "1";
    process.env.PROSE_MUSE_M12_USER_IDS = "1";
    process.env.PROSE_MUSE_M12_MODEL_IDS = "muse";
    assert.equal(isMuseM12EnabledForUser(1, MUSE), false);
    process.env.PROSE_MUSE_M12_MODEL_IDS = "muse-spark";
    assert.equal(isMuseM12EnabledForUser(1, MUSE), false);
  });

  it("enabled=true also counts as ON", () => {
    process.env.PROSE_MUSE_M12_ENABLED = "true";
    process.env.PROSE_MUSE_M12_USER_IDS = "1";
    assert.equal(isMuseM12EnabledForUser(1, MUSE), true);
  });

  it("exports canonical Muse Spark model ID", () => {
    assert.equal(MUSE_SPARK_MODEL_ID, "meta/muse-spark-1.1");
  });
});
