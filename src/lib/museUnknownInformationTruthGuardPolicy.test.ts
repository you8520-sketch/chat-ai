import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, it } from "node:test";

import {
  isMuseUnknownInformationTruthGuardEnabledForUser,
  MUSE_SPARK_MODEL_ID,
  MUSE_UNKNOWN_INFO_TRUTH_GUARD_ENV,
} from "@/lib/museUnknownInformationTruthGuardPolicy";

const MUSE = MUSE_SPARK_MODEL_ID;
const DEEPSEEK = "deepseek/deepseek-v4-pro";
const GEMINI = "google/gemini-2.5-pro";

const ENV_KEYS = [
  MUSE_UNKNOWN_INFO_TRUTH_GUARD_ENV.ENABLED,
  MUSE_UNKNOWN_INFO_TRUTH_GUARD_ENV.USER_IDS,
  MUSE_UNKNOWN_INFO_TRUTH_GUARD_ENV.MODEL_IDS,
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

describe("isMuseUnknownInformationTruthGuardEnabledForUser — fail-closed admin gate", () => {
  let envSnapshot: Record<string, string | undefined>;

  beforeEach(() => {
    envSnapshot = saveEnv();
    for (const key of ENV_KEYS) delete process.env[key];
  });

  afterEach(() => {
    restoreEnv(envSnapshot);
  });

  it("ENABLED missing → OFF", () => {
    process.env.MUSE_UNKNOWN_INFO_TRUTH_GUARD_USER_IDS = "1";
    assert.equal(isMuseUnknownInformationTruthGuardEnabledForUser(1, MUSE), false);
  });

  it("ENABLED=0 → OFF", () => {
    process.env.MUSE_UNKNOWN_INFO_TRUTH_GUARD_ENABLED = "0";
    process.env.MUSE_UNKNOWN_INFO_TRUTH_GUARD_USER_IDS = "1";
    assert.equal(isMuseUnknownInformationTruthGuardEnabledForUser(1, MUSE), false);
  });

  it("ENABLED=1 + USER_IDS missing → OFF", () => {
    process.env.MUSE_UNKNOWN_INFO_TRUTH_GUARD_ENABLED = "1";
    assert.equal(isMuseUnknownInformationTruthGuardEnabledForUser(1, MUSE), false);
  });

  it("malformed user IDs only → OFF", () => {
    process.env.MUSE_UNKNOWN_INFO_TRUTH_GUARD_ENABLED = "1";
    process.env.MUSE_UNKNOWN_INFO_TRUTH_GUARD_USER_IDS = "0,-1,1.5,abc,";
    assert.equal(isMuseUnknownInformationTruthGuardEnabledForUser(1, MUSE), false);
  });

  it("wrong user → OFF", () => {
    process.env.MUSE_UNKNOWN_INFO_TRUTH_GUARD_ENABLED = "1";
    process.env.MUSE_UNKNOWN_INFO_TRUTH_GUARD_USER_IDS = "1";
    assert.equal(isMuseUnknownInformationTruthGuardEnabledForUser(2, MUSE), false);
  });

  it("null/0/negative user → OFF", () => {
    process.env.MUSE_UNKNOWN_INFO_TRUTH_GUARD_ENABLED = "1";
    process.env.MUSE_UNKNOWN_INFO_TRUTH_GUARD_USER_IDS = "1";
    assert.equal(isMuseUnknownInformationTruthGuardEnabledForUser(null, MUSE), false);
    assert.equal(isMuseUnknownInformationTruthGuardEnabledForUser(0, MUSE), false);
    assert.equal(isMuseUnknownInformationTruthGuardEnabledForUser(-1, MUSE), false);
  });

  it("non-Muse model → OFF", () => {
    process.env.MUSE_UNKNOWN_INFO_TRUTH_GUARD_ENABLED = "1";
    process.env.MUSE_UNKNOWN_INFO_TRUTH_GUARD_USER_IDS = "1";
    assert.equal(isMuseUnknownInformationTruthGuardEnabledForUser(1, DEEPSEEK), false);
    assert.equal(isMuseUnknownInformationTruthGuardEnabledForUser(1, GEMINI), false);
  });

  it("substring model → OFF", () => {
    process.env.MUSE_UNKNOWN_INFO_TRUTH_GUARD_ENABLED = "1";
    process.env.MUSE_UNKNOWN_INFO_TRUTH_GUARD_USER_IDS = "1";
    assert.equal(
      isMuseUnknownInformationTruthGuardEnabledForUser(1, `foo-${MUSE}-bar`),
      false
    );
    assert.equal(
      isMuseUnknownInformationTruthGuardEnabledForUser(1, "muse-spark-1.1"),
      false
    );
  });

  it("exact Muse + user allowlist → ON", () => {
    process.env.MUSE_UNKNOWN_INFO_TRUTH_GUARD_ENABLED = "1";
    process.env.MUSE_UNKNOWN_INFO_TRUTH_GUARD_USER_IDS = "1";
    assert.equal(isMuseUnknownInformationTruthGuardEnabledForUser(1, MUSE), true);
  });

  it("MODEL_IDS unset + exact Muse → ON", () => {
    process.env.MUSE_UNKNOWN_INFO_TRUTH_GUARD_ENABLED = "true";
    process.env.MUSE_UNKNOWN_INFO_TRUTH_GUARD_USER_IDS = "1";
    assert.equal(isMuseUnknownInformationTruthGuardEnabledForUser(1, MUSE), true);
  });

  it("MODEL_IDS empty → OFF", () => {
    process.env.MUSE_UNKNOWN_INFO_TRUTH_GUARD_ENABLED = "1";
    process.env.MUSE_UNKNOWN_INFO_TRUTH_GUARD_USER_IDS = "1";
    process.env.MUSE_UNKNOWN_INFO_TRUTH_GUARD_MODEL_IDS = " , ";
    assert.equal(isMuseUnknownInformationTruthGuardEnabledForUser(1, MUSE), false);
  });

  it("MODEL_IDS exact canonical → ON", () => {
    process.env.MUSE_UNKNOWN_INFO_TRUTH_GUARD_ENABLED = "1";
    process.env.MUSE_UNKNOWN_INFO_TRUTH_GUARD_USER_IDS = "1";
    process.env.MUSE_UNKNOWN_INFO_TRUTH_GUARD_MODEL_IDS = MUSE;
    assert.equal(isMuseUnknownInformationTruthGuardEnabledForUser(1, MUSE), true);
  });

  it("MODEL_IDS substring/alias only → OFF", () => {
    process.env.MUSE_UNKNOWN_INFO_TRUTH_GUARD_ENABLED = "1";
    process.env.MUSE_UNKNOWN_INFO_TRUTH_GUARD_USER_IDS = "1";
    process.env.MUSE_UNKNOWN_INFO_TRUTH_GUARD_MODEL_IDS = "muse";
    assert.equal(isMuseUnknownInformationTruthGuardEnabledForUser(1, MUSE), false);
    process.env.MUSE_UNKNOWN_INFO_TRUTH_GUARD_MODEL_IDS = "muse-spark";
    assert.equal(isMuseUnknownInformationTruthGuardEnabledForUser(1, MUSE), false);
    process.env.MUSE_UNKNOWN_INFO_TRUTH_GUARD_MODEL_IDS = "meta/muse-spark";
    assert.equal(isMuseUnknownInformationTruthGuardEnabledForUser(1, MUSE), false);
  });
});
