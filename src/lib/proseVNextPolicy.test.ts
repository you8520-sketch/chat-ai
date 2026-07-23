import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, it } from "node:test";

import {
  isProseVNextEnabledForUser,
  PROSE_VNEXT_ENV,
} from "@/lib/proseVNextPolicy";

const ENV_KEYS = [
  PROSE_VNEXT_ENV.ENABLED,
  PROSE_VNEXT_ENV.USER_IDS,
  PROSE_VNEXT_ENV.MODEL_IDS,
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

describe("isProseVNextEnabledForUser — fail-closed admin gate", () => {
  let envSnapshot: Record<string, string | undefined>;

  beforeEach(() => {
    envSnapshot = saveEnv();
    for (const key of ENV_KEYS) delete process.env[key];
  });

  afterEach(() => {
    restoreEnv(envSnapshot);
  });

  it("A: env unset → OFF", () => {
    assert.equal(isProseVNextEnabledForUser(1), false);
  });

  it("B: enabled=1 but USER_IDS absent → OFF", () => {
    process.env.PROSE_VNEXT_ENABLED = "1";
    assert.equal(isProseVNextEnabledForUser(1), false);
  });

  it("B: enabled=1 but USER_IDS empty/invalid → OFF", () => {
    process.env.PROSE_VNEXT_ENABLED = "1";
    process.env.PROSE_VNEXT_USER_IDS = "";
    assert.equal(isProseVNextEnabledForUser(1), false);

    process.env.PROSE_VNEXT_USER_IDS = "0,+1,-1,01,abc,1.9,1e2";
    assert.equal(isProseVNextEnabledForUser(1), false);
  });

  it("C: enabled=1 + exact admin user → ON", () => {
    process.env.PROSE_VNEXT_ENABLED = "1";
    process.env.PROSE_VNEXT_USER_IDS = "1";
    assert.equal(isProseVNextEnabledForUser(1), true);
  });

  it("C: enabled=true also accepted with allowlist", () => {
    process.env.PROSE_VNEXT_ENABLED = "true";
    process.env.PROSE_VNEXT_USER_IDS = "1, 7";
    assert.equal(isProseVNextEnabledForUser(1), true);
    assert.equal(isProseVNextEnabledForUser(7), true);
  });

  it("D: other user → OFF", () => {
    process.env.PROSE_VNEXT_ENABLED = "1";
    process.env.PROSE_VNEXT_USER_IDS = "1";
    assert.equal(isProseVNextEnabledForUser(2), false);
    assert.equal(isProseVNextEnabledForUser(null), false);
    assert.equal(isProseVNextEnabledForUser(undefined), false);
    assert.equal(isProseVNextEnabledForUser(0), false);
    assert.equal(isProseVNextEnabledForUser(-1), false);
  });

  it("enabled alone never exposes globally", () => {
    process.env.PROSE_VNEXT_ENABLED = "1";
    // no USER_IDS
    assert.equal(isProseVNextEnabledForUser(1), false);
    assert.equal(isProseVNextEnabledForUser(999), false);
  });

  it("optional MODEL_IDS further restricts but never bypasses user allowlist", () => {
    process.env.PROSE_VNEXT_ENABLED = "1";
    process.env.PROSE_VNEXT_USER_IDS = "1";
    process.env.PROSE_VNEXT_MODEL_IDS = "deepseek";

    assert.equal(isProseVNextEnabledForUser(1, "deepseek/deepseek-v4-pro"), true);
    assert.equal(isProseVNextEnabledForUser(1, "google/gemini-2.5-pro"), false);
    // non-allowlisted user + matching model still OFF
    assert.equal(isProseVNextEnabledForUser(2, "deepseek/deepseek-v4-pro"), false);
  });

  it("empty MODEL_IDS after parse → fail closed", () => {
    process.env.PROSE_VNEXT_ENABLED = "1";
    process.env.PROSE_VNEXT_USER_IDS = "1";
    process.env.PROSE_VNEXT_MODEL_IDS = " , ";
    assert.equal(isProseVNextEnabledForUser(1, "deepseek/deepseek-v4-pro"), false);
  });
});
