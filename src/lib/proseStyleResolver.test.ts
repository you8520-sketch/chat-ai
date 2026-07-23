import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, it } from "node:test";

import { MUSE_PROSE_M1_STYLE_SECTION } from "@/lib/proseMuseM1";
import { PROSE_MUSE_M1_ENV } from "@/lib/proseMuseM1Policy";
import { PROSE_VNEXT_STYLE_SECTION } from "@/lib/proseVNext";
import {
  PROSE_VNEXT_ENV,
  isProseVNextEnabledForUser,
  isProseVNextRolloutEnabledForModel,
} from "@/lib/proseVNextPolicy";
import { resolveProseStyleSection } from "@/lib/proseStyleResolver";

const MUSE = "meta/muse-spark-1.1";
const DEEPSEEK = "deepseek/deepseek-v4-pro";
const HY3 = "tencent/hy3";

const M1_KEYS = [
  PROSE_MUSE_M1_ENV.ENABLED,
  PROSE_MUSE_M1_ENV.USER_IDS,
  PROSE_MUSE_M1_ENV.MODEL_IDS,
  PROSE_MUSE_M1_ENV.ROLLOUT_ENABLED,
  PROSE_MUSE_M1_ENV.ROLLOUT_MODEL_IDS,
] as const;

const VNEXT_KEYS = [
  PROSE_VNEXT_ENV.ENABLED,
  PROSE_VNEXT_ENV.USER_IDS,
  PROSE_VNEXT_ENV.MODEL_IDS,
  PROSE_VNEXT_ENV.ROLLOUT_ENABLED,
  PROSE_VNEXT_ENV.ROLLOUT_MODEL_IDS,
] as const;

const ALL_KEYS = [...M1_KEYS, ...VNEXT_KEYS] as const;

function saveEnv(): Record<string, string | undefined> {
  return Object.fromEntries(ALL_KEYS.map((k) => [k, process.env[k]]));
}

function restoreEnv(snapshot: Record<string, string | undefined>): void {
  for (const key of ALL_KEYS) {
    const value = snapshot[key];
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
}

describe("resolveProseStyleSection", () => {
  let envSnapshot: Record<string, string | undefined>;

  beforeEach(() => {
    envSnapshot = saveEnv();
    for (const key of ALL_KEYS) delete process.env[key];
  });

  afterEach(() => {
    restoreEnv(envSnapshot);
  });

  it("all unset → Muse Legacy", () => {
    assert.equal(resolveProseStyleSection(1, MUSE), undefined);
  });

  it("M1 admin ON for allowlisted user → M1 section", () => {
    process.env.PROSE_MUSE_M1_ENABLED = "1";
    process.env.PROSE_MUSE_M1_USER_IDS = "1";
    assert.equal(resolveProseStyleSection(1, MUSE), MUSE_PROSE_M1_STYLE_SECTION);
  });

  it("M1 admin ON but non-admin user → Legacy", () => {
    process.env.PROSE_MUSE_M1_ENABLED = "1";
    process.env.PROSE_MUSE_M1_USER_IDS = "1";
    assert.equal(resolveProseStyleSection(2, MUSE), undefined);
  });

  it("VNext public rollout ON for Muse in list → Legacy (Muse excluded)", () => {
    process.env.PROSE_VNEXT_ROLLOUT_ENABLED = "1";
    process.env.PROSE_VNEXT_ROLLOUT_MODEL_IDS = `${DEEPSEEK},${MUSE}`;
    assert.equal(isProseVNextRolloutEnabledForModel(MUSE), true);
    assert.equal(resolveProseStyleSection(999, MUSE), undefined);
  });

  it("explicit VNext admin canary on Muse → VNext for allowlisted user", () => {
    process.env.PROSE_VNEXT_ENABLED = "1";
    process.env.PROSE_VNEXT_USER_IDS = "1";
    process.env.PROSE_VNEXT_MODEL_IDS = "muse";
    assert.equal(resolveProseStyleSection(1, MUSE), PROSE_VNEXT_STYLE_SECTION);
  });

  it("M1 admin wins over VNext admin when both ON for Muse", () => {
    process.env.PROSE_MUSE_M1_ENABLED = "1";
    process.env.PROSE_MUSE_M1_USER_IDS = "1";
    process.env.PROSE_VNEXT_ENABLED = "1";
    process.env.PROSE_VNEXT_USER_IDS = "1";
    process.env.PROSE_VNEXT_MODEL_IDS = "muse";
    assert.equal(resolveProseStyleSection(1, MUSE), MUSE_PROSE_M1_STYLE_SECTION);
  });

  it("DeepSeek VNext rollout unchanged → VNext", () => {
    process.env.PROSE_VNEXT_ROLLOUT_ENABLED = "1";
    process.env.PROSE_VNEXT_ROLLOUT_MODEL_IDS = DEEPSEEK;
    assert.equal(resolveProseStyleSection(null, DEEPSEEK), PROSE_VNEXT_STYLE_SECTION);
  });

  it("HY3 VNext rollout unchanged → VNext", () => {
    process.env.PROSE_VNEXT_ROLLOUT_ENABLED = "1";
    process.env.PROSE_VNEXT_ROLLOUT_MODEL_IDS = HY3;
    assert.equal(resolveProseStyleSection(999, HY3), PROSE_VNEXT_STYLE_SECTION);
  });

  it("M1 admin does not affect DeepSeek → Legacy", () => {
    process.env.PROSE_MUSE_M1_ENABLED = "1";
    process.env.PROSE_MUSE_M1_USER_IDS = "1";
    assert.equal(resolveProseStyleSection(1, DEEPSEEK), undefined);
  });

  it("M1 rollout ON → M1 for any user on Muse", () => {
    process.env.PROSE_MUSE_M1_ROLLOUT_ENABLED = "1";
    process.env.PROSE_MUSE_M1_ROLLOUT_MODEL_IDS = MUSE;
    assert.equal(resolveProseStyleSection(null, MUSE), MUSE_PROSE_M1_STYLE_SECTION);
  });

  it("VNext admin helper unchanged for Muse when M1 off", () => {
    process.env.PROSE_VNEXT_ENABLED = "1";
    process.env.PROSE_VNEXT_USER_IDS = "1";
    assert.equal(isProseVNextEnabledForUser(1, MUSE), true);
  });
});
