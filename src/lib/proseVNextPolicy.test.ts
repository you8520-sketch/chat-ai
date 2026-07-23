import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, it } from "node:test";

import {
  isProseVNextEnabledForUser,
  isProseVNextOn,
  isProseVNextRolloutEnabledForModel,
  PROSE_VNEXT_ENV,
} from "@/lib/proseVNextPolicy";

const ENV_KEYS = [
  PROSE_VNEXT_ENV.ENABLED,
  PROSE_VNEXT_ENV.USER_IDS,
  PROSE_VNEXT_ENV.MODEL_IDS,
  PROSE_VNEXT_ENV.ROLLOUT_ENABLED,
  PROSE_VNEXT_ENV.ROLLOUT_MODEL_IDS,
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

describe("isProseVNextRolloutEnabledForModel — fail-closed public rollout", () => {
  let envSnapshot: Record<string, string | undefined>;

  beforeEach(() => {
    envSnapshot = saveEnv();
    for (const key of ENV_KEYS) delete process.env[key];
  });

  afterEach(() => {
    restoreEnv(envSnapshot);
  });

  it("A: rollout env unset → every model LEGACY", () => {
    assert.equal(isProseVNextRolloutEnabledForModel("deepseek/deepseek-v4-pro"), false);
    assert.equal(isProseVNextRolloutEnabledForModel("tencent/hy3"), false);
    assert.equal(isProseVNextRolloutEnabledForModel("meta/muse-spark-1.1"), false);
  });

  it("B: ROLLOUT_ENABLED=1 but MODEL_IDS missing/empty → every model LEGACY", () => {
    process.env.PROSE_VNEXT_ROLLOUT_ENABLED = "1";
    assert.equal(isProseVNextRolloutEnabledForModel("deepseek/deepseek-v4-pro"), false);

    process.env.PROSE_VNEXT_ROLLOUT_MODEL_IDS = "";
    assert.equal(isProseVNextRolloutEnabledForModel("deepseek/deepseek-v4-pro"), false);

    process.env.PROSE_VNEXT_ROLLOUT_MODEL_IDS = " , ";
    assert.equal(isProseVNextRolloutEnabledForModel("deepseek/deepseek-v4-pro"), false);
  });

  it("C: qualified exact model listed → VNEXT", () => {
    process.env.PROSE_VNEXT_ROLLOUT_ENABLED = "1";
    process.env.PROSE_VNEXT_ROLLOUT_MODEL_IDS =
      "deepseek/deepseek-v4-pro,tencent/hy3";

    assert.equal(isProseVNextRolloutEnabledForModel("deepseek/deepseek-v4-pro"), true);
    assert.equal(isProseVNextRolloutEnabledForModel("DEEPSEEK/DEEPSEEK-V4-PRO"), true);
    assert.equal(isProseVNextRolloutEnabledForModel("tencent/hy3"), true);
  });

  it("D: non-qualified model → LEGACY", () => {
    process.env.PROSE_VNEXT_ROLLOUT_ENABLED = "1";
    process.env.PROSE_VNEXT_ROLLOUT_MODEL_IDS = "deepseek/deepseek-v4-pro";

    assert.equal(isProseVNextRolloutEnabledForModel("google/gemini-2.5-pro"), false);
    assert.equal(isProseVNextRolloutEnabledForModel("qwen/qwen3.7-max"), false);
  });

  it("E: Muse → LEGACY unless explicitly admin-canary tested", () => {
    process.env.PROSE_VNEXT_ROLLOUT_ENABLED = "1";
    process.env.PROSE_VNEXT_ROLLOUT_MODEL_IDS = "deepseek/deepseek-v4-pro,tencent/hy3";

    assert.equal(isProseVNextRolloutEnabledForModel("meta/muse-spark-1.1"), false);
  });

  it("F: partial/sub-string model ID must NOT accidentally match", () => {
    process.env.PROSE_VNEXT_ROLLOUT_ENABLED = "1";
    process.env.PROSE_VNEXT_ROLLOUT_MODEL_IDS = "deepseek/deepseek-v4-pro";

    assert.equal(
      isProseVNextRolloutEnabledForModel("foo-deepseek/deepseek-v4-pro-test"),
      false
    );
    assert.equal(isProseVNextRolloutEnabledForModel("deepseek/deepseek-v4-pro-extra"), false);
  });

  it("I: public enabled flag alone never exposes globally without model list", () => {
    process.env.PROSE_VNEXT_ROLLOUT_ENABLED = "1";
    assert.equal(isProseVNextRolloutEnabledForModel("deepseek/deepseek-v4-pro"), false);
  });
});

describe("isProseVNextOn — admin canary OR public rollout", () => {
  let envSnapshot: Record<string, string | undefined>;

  beforeEach(() => {
    envSnapshot = saveEnv();
    for (const key of ENV_KEYS) delete process.env[key];
  });

  afterEach(() => {
    restoreEnv(envSnapshot);
  });

  it("G: admin canary still works independently", () => {
    process.env.PROSE_VNEXT_ENABLED = "1";
    process.env.PROSE_VNEXT_USER_IDS = "1";

    assert.equal(isProseVNextOn(1, "meta/muse-spark-1.1"), true);
    assert.equal(isProseVNextOn(2, "meta/muse-spark-1.1"), false);
  });

  it("H: admin canary can enable a model not in public rollout for allowed admin only", () => {
    process.env.PROSE_VNEXT_ENABLED = "1";
    process.env.PROSE_VNEXT_USER_IDS = "1";
    process.env.PROSE_VNEXT_MODEL_IDS = "muse";
    process.env.PROSE_VNEXT_ROLLOUT_ENABLED = "1";
    process.env.PROSE_VNEXT_ROLLOUT_MODEL_IDS = "deepseek/deepseek-v4-pro";

    assert.equal(isProseVNextOn(1, "meta/muse-spark-1.1"), true);
    assert.equal(isProseVNextOn(2, "meta/muse-spark-1.1"), false);
    assert.equal(isProseVNextOn(2, "deepseek/deepseek-v4-pro"), true);
  });

  it("rollout ON for any user when model is listed; admin OFF", () => {
    process.env.PROSE_VNEXT_ROLLOUT_ENABLED = "1";
    process.env.PROSE_VNEXT_ROLLOUT_MODEL_IDS = "deepseek/deepseek-v4-pro";

    assert.equal(isProseVNextOn(null, "deepseek/deepseek-v4-pro"), true);
    assert.equal(isProseVNextOn(999, "deepseek/deepseek-v4-pro"), true);
    assert.equal(isProseVNextOn(999, "meta/muse-spark-1.1"), false);
  });
});
