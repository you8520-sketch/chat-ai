import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, it } from "node:test";

import { resolveCanonInjectionPolicy, isLayeredCanonPolicy, isSelectiveArchiveActive } from "@/lib/canonInjectionPolicy";
import {
  OPENROUTER_DEEPSEEK_V4_PRO_MODEL,
  OPENROUTER_GEMINI_25_PRO_MODEL,
  OPENROUTER_MUSE_SPARK_11_MODEL,
  OPENROUTER_TENCENT_HY3_MODEL,
} from "@/lib/chatModels";

const ENV_KEYS = [
  "CANON_INJECTION_ENABLED",
  "CANON_INJECTION_FORCE_FULL_LEGACY",
  "CANON_INJECTION_KILL_SWITCH",
  "CANON_INJECTION_ROLLOUT_STAGE",
  "CANON_INJECTION_DEEPSEEK_MODE",
  "CANON_ARCHIVE_DEEPSEEK_SELECTIVE",
  "CANON_INJECTION_DEEPSEEK_CANARY",
  "CANON_INJECTION_DEEPSEEK_CANARY_PERCENT",
  "CANON_INJECTION_DEEPSEEK_CANARY_USER_IDS",
] as const;

const TEST_COHORT_USER_ID = 4242;

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

describe("resolveCanonInjectionPolicy", () => {
  let envSnapshot: Record<string, string | undefined>;

  beforeEach(() => {
    envSnapshot = saveEnv();
    for (const key of ENV_KEYS) delete process.env[key];
  });

  afterEach(() => {
    restoreEnv(envSnapshot);
  });

  it("defaults DeepSeek to D0 shadow FULL_LEGACY with injection disabled", () => {
    const policy = resolveCanonInjectionPolicy(OPENROUTER_DEEPSEEK_V4_PRO_MODEL);
    assert.equal(policy.rolloutStage, "D0");
    assert.equal(policy.canonMode, "FULL_LEGACY");
    assert.equal(policy.shadowOnly, true);
    assert.equal(policy.injectionEnabled, false);
  });

  it("Muse/Gemini/HY3 default FULL_LEGACY", () => {
    for (const modelId of [
      OPENROUTER_MUSE_SPARK_11_MODEL,
      OPENROUTER_GEMINI_25_PRO_MODEL,
      OPENROUTER_TENCENT_HY3_MODEL,
    ]) {
      const policy = resolveCanonInjectionPolicy(modelId);
      assert.equal(policy.canonMode, "FULL_LEGACY");
      assert.equal(isLayeredCanonPolicy(policy), false);
    }
  });

  it("kill switch forces all models to FULL_LEGACY", () => {
    process.env.CANON_INJECTION_ENABLED = "1";
    process.env.CANON_INJECTION_ROLLOUT_STAGE = "D4";
    process.env.CANON_INJECTION_DEEPSEEK_MODE = "LAYERED";
    process.env.CANON_INJECTION_FORCE_FULL_LEGACY = "1";

    const policy = resolveCanonInjectionPolicy(OPENROUTER_DEEPSEEK_V4_PRO_MODEL);
    assert.equal(policy.forceFullLegacy, true);
    assert.equal(policy.canonMode, "FULL_LEGACY");
    assert.equal(isLayeredCanonPolicy(policy), false);
  });

  it("D1 keeps FULL_LEGACY canon + selective archive config but no side effects without cohort", () => {
    process.env.CANON_INJECTION_ENABLED = "1";
    process.env.CANON_INJECTION_ROLLOUT_STAGE = "D1";
    process.env.CANON_ARCHIVE_DEEPSEEK_SELECTIVE = "1";

    const policy = resolveCanonInjectionPolicy(OPENROUTER_DEEPSEEK_V4_PRO_MODEL);
    assert.equal(policy.canonMode, "FULL_LEGACY");
    assert.equal(policy.archiveMode, "SELECTIVE");
    assert.equal(policy.injectionEnabled, false);
    assert.equal(policy.canaryActualInjection, false);
  });

  it("D2 enables LAYERED canon + selective archive for DeepSeek canary", () => {
    process.env.CANON_INJECTION_ENABLED = "1";
    process.env.CANON_INJECTION_ROLLOUT_STAGE = "D2";
    process.env.CANON_ARCHIVE_DEEPSEEK_SELECTIVE = "1";

    const policy = resolveCanonInjectionPolicy(OPENROUTER_DEEPSEEK_V4_PRO_MODEL);
    assert.equal(policy.canonMode, "LAYERED");
    assert.equal(policy.archiveMode, "SELECTIVE");
    assert.equal(isLayeredCanonPolicy(policy), true);
  });

  it("does not default-on LAYERED before D3 on DeepSeek", () => {
    process.env.CANON_INJECTION_ENABLED = "1";
    process.env.CANON_INJECTION_ROLLOUT_STAGE = "D2";
    delete process.env.CANON_INJECTION_DEEPSEEK_MODE;

    const d2 = resolveCanonInjectionPolicy(OPENROUTER_DEEPSEEK_V4_PRO_MODEL);
    assert.equal(d2.canonMode, "LAYERED");

    process.env.CANON_INJECTION_ROLLOUT_STAGE = "D1";
    const d1 = resolveCanonInjectionPolicy(OPENROUTER_DEEPSEEK_V4_PRO_MODEL);
    assert.equal(d1.canonMode, "FULL_LEGACY");
  });

  it("D1.1: DeepSeek canary selective archive is active only for DeepSeek, not Muse/Gemini/HY3", () => {
    // D1.1 improved selective-archive retrieval is a COMMON capability, but the
    // ACTUAL injection rollout is MODEL-GATED. Even with the DeepSeek canary +
    // selective archive env fully enabled, Muse/Gemini/HY3 must remain on
    // FULL_ALWAYS archive so their actual provider payload is byte-identical to
    // HEAD (selectArchiveChunksSelective is never invoked in their path).
    process.env.CANON_INJECTION_ENABLED = "1";
    process.env.CANON_INJECTION_ROLLOUT_STAGE = "D1";
    process.env.CANON_ARCHIVE_DEEPSEEK_SELECTIVE = "1";
    process.env.CANON_INJECTION_DEEPSEEK_CANARY = "1";
    process.env.CANON_INJECTION_DEEPSEEK_CANARY_PERCENT = "100";

    const deepSeek = resolveCanonInjectionPolicy(OPENROUTER_DEEPSEEK_V4_PRO_MODEL, {
      userId: TEST_COHORT_USER_ID,
    });
    assert.equal(isSelectiveArchiveActive(deepSeek), true);
    assert.equal(deepSeek.actualArchiveMode, "SELECTIVE");
    assert.equal(deepSeek.shadowOnly, false);

    for (const modelId of [
      OPENROUTER_MUSE_SPARK_11_MODEL,
      OPENROUTER_GEMINI_25_PRO_MODEL,
      OPENROUTER_TENCENT_HY3_MODEL,
    ]) {
      const policy = resolveCanonInjectionPolicy(modelId);
      assert.equal(
        policy.actualArchiveMode,
        "FULL_ALWAYS",
        `${modelId} must stay FULL_ALWAYS (no selective archive actual injection)`
      );
      assert.equal(isSelectiveArchiveActive(policy), false);
      assert.equal(policy.actualCanonMode, "FULL_LEGACY");
    }
  });
});
