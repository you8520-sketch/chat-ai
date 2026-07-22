import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, it } from "node:test";

import {
  computeDeepSeekCohortBucket,
  measureSyntheticCohortEligibleRatio,
  parseDeepSeekCanaryPercent,
  resolveDeepSeekCohortEligibility,
  resolveDeepSeekCohortKey,
} from "@/lib/canonInjectionCohort";
import {
  isLayeredCanonActive,
  isSelectiveArchiveActive,
  resolveCanonInjectionPolicy,
} from "@/lib/canonInjectionPolicy";
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

const TEST_USER_A = 1001;
const TEST_USER_B = 1002;
const TEST_CHAT_A = 9001;

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

function deepSeekPolicy(userId = TEST_USER_A, chatId?: number) {
  return resolveCanonInjectionPolicy(OPENROUTER_DEEPSEEK_V4_PRO_MODEL, {
    userId,
    chatId,
  });
}

describe("canonInjectionCohort — percent parsing fail-safe", () => {
  let envSnapshot: Record<string, string | undefined>;

  beforeEach(() => {
    envSnapshot = saveEnv();
    for (const key of ENV_KEYS) delete process.env[key];
  });

  afterEach(() => restoreEnv(envSnapshot));

  it("I: unset/invalid/NaN/negative/>100 → 0%", () => {
    assert.equal(parseDeepSeekCanaryPercent(), 0);
    process.env.CANON_INJECTION_DEEPSEEK_CANARY_PERCENT = "abc";
    assert.equal(parseDeepSeekCanaryPercent(), 0);
    process.env.CANON_INJECTION_DEEPSEEK_CANARY_PERCENT = "-5";
    assert.equal(parseDeepSeekCanaryPercent(), 0);
    process.env.CANON_INJECTION_DEEPSEEK_CANARY_PERCENT = "150";
    assert.equal(parseDeepSeekCanaryPercent(), 0);
    process.env.CANON_INJECTION_DEEPSEEK_CANARY_PERCENT = "0";
    assert.equal(parseDeepSeekCanaryPercent(), 0);
  });
});

describe("canonInjectionCohort — deterministic bucket", () => {
  it("same cohortKey + namespace → same bucket", () => {
    const a = computeDeepSeekCohortBucket("user:4242");
    const b = computeDeepSeekCohortBucket("user:4242");
    assert.equal(a, b);
    assert.ok(a >= 0 && a <= 9999);
  });

  it("H: different users → different buckets (usually)", () => {
    const a = computeDeepSeekCohortBucket("user:1");
    const b = computeDeepSeekCohortBucket("user:2");
    assert.notEqual(a, b);
  });
});

describe("resolveCanonInjectionPolicy — cohort gating contract", () => {
  let envSnapshot: Record<string, string | undefined>;

  beforeEach(() => {
    envSnapshot = saveEnv();
    for (const key of ENV_KEYS) delete process.env[key];
    process.env.CANON_INJECTION_ENABLED = "1";
    process.env.CANON_ARCHIVE_DEEPSEEK_SELECTIVE = "1";
  });

  afterEach(() => restoreEnv(envSnapshot));

  it("A: master canary OFF + percent100 → actual OFF", () => {
    process.env.CANON_INJECTION_ROLLOUT_STAGE = "D1";
    process.env.CANON_INJECTION_DEEPSEEK_CANARY_PERCENT = "100";
    const policy = deepSeekPolicy();
    assert.equal(policy.masterCanaryEnabled, false);
    assert.equal(policy.canaryActualInjection, false);
    assert.equal(policy.shadowOnly, true);
  });

  it("B: master ON + percent0 → actual OFF", () => {
    process.env.CANON_INJECTION_ROLLOUT_STAGE = "D1";
    process.env.CANON_INJECTION_DEEPSEEK_CANARY = "1";
    process.env.CANON_INJECTION_DEEPSEEK_CANARY_PERCENT = "0";
    const policy = deepSeekPolicy();
    assert.equal(policy.canaryActualInjection, false);
    assert.equal(policy.injectionEnabled, false);
  });

  it("C: master ON + percent100 + D1 → all DeepSeek cohort eligible", () => {
    process.env.CANON_INJECTION_ROLLOUT_STAGE = "D1";
    process.env.CANON_INJECTION_DEEPSEEK_CANARY = "1";
    process.env.CANON_INJECTION_DEEPSEEK_CANARY_PERCENT = "100";
    const policy = deepSeekPolicy();
    assert.equal(policy.canaryActualInjection, true);
    assert.equal(isSelectiveArchiveActive(policy), true);
    assert.equal(policy.actualCanonMode, "FULL_LEGACY");
  });

  it("D: master ON + percent100 + D2 → all DeepSeek cohort eligible", () => {
    process.env.CANON_INJECTION_ROLLOUT_STAGE = "D2";
    process.env.CANON_INJECTION_DEEPSEEK_CANARY = "1";
    process.env.CANON_INJECTION_DEEPSEEK_CANARY_PERCENT = "100";
    const policy = deepSeekPolicy();
    assert.equal(policy.canaryActualInjection, true);
    assert.equal(isLayeredCanonActive(policy), true);
    assert.equal(policy.actualArchiveMode, "SELECTIVE");
  });

  it("E: master ON + percent5 → deterministic bucket gating", () => {
    process.env.CANON_INJECTION_ROLLOUT_STAGE = "D1";
    process.env.CANON_INJECTION_DEEPSEEK_CANARY = "1";
    process.env.CANON_INJECTION_DEEPSEEK_CANARY_PERCENT = "5";

    let eligibleCount = 0;
    for (let userId = 1; userId <= 200; userId++) {
      const policy = deepSeekPolicy(userId);
      if (policy.cohortEligible) eligibleCount++;
      assert.equal(
        policy.cohortEligible,
        policy.canaryActualInjection,
        "cohortEligible must match canaryActualInjection on D1+"
      );
    }
    assert.ok(eligibleCount > 0 && eligibleCount < 200, "5% should gate some but not all");
  });

  it("F: same user repeated 100 times → same result", () => {
    process.env.CANON_INJECTION_ROLLOUT_STAGE = "D2";
    process.env.CANON_INJECTION_DEEPSEEK_CANARY = "1";
    process.env.CANON_INJECTION_DEEPSEEK_CANARY_PERCENT = "25";
    const first = deepSeekPolicy(TEST_USER_A);
    for (let i = 0; i < 100; i++) {
      const policy = deepSeekPolicy(TEST_USER_A);
      assert.equal(policy.cohortEligible, first.cohortEligible);
      assert.equal(policy.cohortBucket, first.cohortBucket);
      assert.equal(policy.canaryActualInjection, first.canaryActualInjection);
    }
  });

  it("G: same user different chats → same result (user-sticky)", () => {
    process.env.CANON_INJECTION_ROLLOUT_STAGE = "D1";
    process.env.CANON_INJECTION_DEEPSEEK_CANARY = "1";
    process.env.CANON_INJECTION_DEEPSEEK_CANARY_PERCENT = "17";
    const chat1 = deepSeekPolicy(TEST_USER_A, 111);
    const chat2 = deepSeekPolicy(TEST_USER_A, 222);
    assert.equal(chat1.cohortEligible, chat2.cohortEligible);
    assert.equal(chat1.cohortBucket, chat2.cohortBucket);
    assert.equal(resolveDeepSeekCohortKey({ userId: TEST_USER_A, chatId: 999 }).keyKind, "user");
  });

  it("J/K/L: Muse/Gemini/HY3 unchanged FULL_LEGACY", () => {
    process.env.CANON_INJECTION_ROLLOUT_STAGE = "D2";
    process.env.CANON_INJECTION_DEEPSEEK_CANARY = "1";
    process.env.CANON_INJECTION_DEEPSEEK_CANARY_PERCENT = "100";
    for (const modelId of [
      OPENROUTER_MUSE_SPARK_11_MODEL,
      OPENROUTER_GEMINI_25_PRO_MODEL,
      OPENROUTER_TENCENT_HY3_MODEL,
    ]) {
      const policy = resolveCanonInjectionPolicy(modelId, { userId: TEST_USER_A });
      assert.equal(policy.actualCanonMode, "FULL_LEGACY");
      assert.equal(policy.actualArchiveMode, "FULL_ALWAYS");
      assert.equal(policy.canaryActualInjection, false);
    }
  });

  it("M: kill switch ON → exact legacy regardless percent", () => {
    process.env.CANON_INJECTION_ROLLOUT_STAGE = "D2";
    process.env.CANON_INJECTION_DEEPSEEK_CANARY = "1";
    process.env.CANON_INJECTION_DEEPSEEK_CANARY_PERCENT = "100";
    process.env.CANON_INJECTION_KILL_SWITCH = "1";
    const policy = deepSeekPolicy();
    assert.equal(policy.forceFullLegacy, true);
    assert.equal(policy.canaryActualInjection, false);
    assert.equal(policy.actualCanonMode, "FULL_LEGACY");
    assert.equal(policy.actualArchiveMode, "FULL_ALWAYS");
    assert.equal(policy.injectionEnabled, false);
  });

  it("N: D0 → actual OFF regardless percent", () => {
    process.env.CANON_INJECTION_DEEPSEEK_CANARY = "1";
    process.env.CANON_INJECTION_DEEPSEEK_CANARY_PERCENT = "100";
    const policy = deepSeekPolicy();
    assert.equal(policy.rolloutStage, "D0");
    assert.equal(policy.canaryActualInjection, false);
    assert.equal(policy.shadowOnly, true);
    assert.equal(policy.injectionEnabled, true, "D0 shadow side effects when master on");
  });

  it("O: non-eligible DeepSeek on D1 → legacy payload modes + no side effects", () => {
    process.env.CANON_INJECTION_ROLLOUT_STAGE = "D1";
    process.env.CANON_INJECTION_DEEPSEEK_CANARY = "1";
    process.env.CANON_INJECTION_DEEPSEEK_CANARY_PERCENT = "0";
    const policy = deepSeekPolicy();
    assert.equal(policy.canaryActualInjection, false);
    assert.equal(policy.actualCanonMode, "FULL_LEGACY");
    assert.equal(policy.actualArchiveMode, "FULL_ALWAYS");
    assert.equal(policy.injectionEnabled, false);
  });

  it("explicit allowlist bypasses percent bucket", () => {
    process.env.CANON_INJECTION_ROLLOUT_STAGE = "D1";
    process.env.CANON_INJECTION_DEEPSEEK_CANARY = "1";
    process.env.CANON_INJECTION_DEEPSEEK_CANARY_PERCENT = "0";
    process.env.CANON_INJECTION_DEEPSEEK_CANARY_USER_IDS = String(TEST_USER_A);
    const policy = deepSeekPolicy(TEST_USER_A);
    assert.equal(policy.cohortEligible, true);
    assert.equal(policy.cohortEligibilityReason, "EXPLICIT_ALLOWLIST");
    assert.equal(policy.canaryActualInjection, true);
  });

  it("backward-safe: CANARY=1 without PERCENT unset → 0% actual (no auto global canary)", () => {
    process.env.CANON_INJECTION_ROLLOUT_STAGE = "D2";
    process.env.CANON_INJECTION_DEEPSEEK_CANARY = "1";
    delete process.env.CANON_INJECTION_DEEPSEEK_CANARY_PERCENT;
    const policy = deepSeekPolicy();
    assert.equal(policy.canaryPercent, 0);
    assert.equal(policy.canaryActualInjection, false);
  });

  it("chatId fallback when userId missing", () => {
    process.env.CANON_INJECTION_ROLLOUT_STAGE = "D1";
    process.env.CANON_INJECTION_DEEPSEEK_CANARY = "1";
    process.env.CANON_INJECTION_DEEPSEEK_CANARY_PERCENT = "100";
    const policy = resolveCanonInjectionPolicy(OPENROUTER_DEEPSEEK_V4_PRO_MODEL, {
      chatId: TEST_CHAT_A,
    });
    assert.equal(policy.canaryActualInjection, true);
    assert.equal(resolveDeepSeekCohortKey({ chatId: TEST_CHAT_A }).keyKind, "chat");
  });
});

describe("canonInjectionCohort — distribution sanity (synthetic only)", () => {
  const sampleSize = 10_000;

  for (const percent of [1, 5, 25, 50, 100]) {
    it(`distribution ~${percent}% over ${sampleSize} synthetic keys`, () => {
      const { ratio } = measureSyntheticCohortEligibleRatio(percent, sampleSize);
      const expected = percent / 100;
      const tolerance = percent === 1 ? 0.004 : 0.02;
      assert.ok(
        Math.abs(ratio - expected) <= tolerance,
        `expected ~${expected}, got ${ratio}`
      );
    });
  }
});

describe("canonInjectionCohort — priority order", () => {
  let envSnapshot: Record<string, string | undefined>;

  beforeEach(() => {
    envSnapshot = saveEnv();
    for (const key of ENV_KEYS) delete process.env[key];
    process.env.CANON_INJECTION_ENABLED = "1";
    process.env.CANON_INJECTION_ROLLOUT_STAGE = "D2";
    process.env.CANON_INJECTION_DEEPSEEK_CANARY = "1";
    process.env.CANON_INJECTION_DEEPSEEK_CANARY_PERCENT = "100";
  });

  afterEach(() => restoreEnv(envSnapshot));

  it("master OFF beats percent100", () => {
    delete process.env.CANON_INJECTION_DEEPSEEK_CANARY;
    const policy = deepSeekPolicy();
    assert.equal(policy.canaryActualInjection, false);
  });

  it("percent0 beats master ON", () => {
    process.env.CANON_INJECTION_DEEPSEEK_CANARY_PERCENT = "0";
    const policy = deepSeekPolicy();
    assert.equal(policy.canaryActualInjection, false);
  });
});

describe("resolveCanonInjectionPolicy — master canon flag required for actual injection", () => {
  let envSnapshot: Record<string, string | undefined>;

  beforeEach(() => {
    envSnapshot = saveEnv();
    for (const key of ENV_KEYS) delete process.env[key];
    process.env.CANON_INJECTION_DEEPSEEK_CANARY = "1";
    process.env.CANON_INJECTION_DEEPSEEK_CANARY_PERCENT = "100";
    process.env.CANON_ARCHIVE_DEEPSEEK_SELECTIVE = "1";
    delete process.env.CANON_INJECTION_ENABLED;
  });

  afterEach(() => restoreEnv(envSnapshot));

  it("D2: master canon OFF + canary ON + percent100 + eligible user → no actual injection", () => {
    process.env.CANON_INJECTION_ROLLOUT_STAGE = "D2";
    const policy = deepSeekPolicy();
    assert.equal(policy.injectionEnabled, false);
    assert.equal(policy.canaryActualInjection, false);
    assert.equal(policy.shadowOnly, true);
    assert.equal(policy.actualCanonMode, "FULL_LEGACY");
    assert.equal(policy.actualArchiveMode, "FULL_ALWAYS");
    assert.equal(isLayeredCanonActive(policy), false);
    assert.equal(isSelectiveArchiveActive(policy), false);
  });

  it("D1: master canon OFF + canary ON + percent100 + eligible user → no selective actual", () => {
    process.env.CANON_INJECTION_ROLLOUT_STAGE = "D1";
    const policy = deepSeekPolicy();
    assert.equal(policy.injectionEnabled, false);
    assert.equal(policy.canaryActualInjection, false);
    assert.equal(policy.shadowOnly, true);
    assert.equal(policy.actualCanonMode, "FULL_LEGACY");
    assert.equal(policy.actualArchiveMode, "FULL_ALWAYS");
    assert.equal(isSelectiveArchiveActive(policy), false);
  });

  it("allowlist cohortEligible=true but master canon OFF → actual legacy", () => {
    process.env.CANON_INJECTION_ROLLOUT_STAGE = "D2";
    process.env.CANON_INJECTION_DEEPSEEK_CANARY_PERCENT = "0";
    process.env.CANON_INJECTION_DEEPSEEK_CANARY_USER_IDS = String(TEST_USER_A);
    const policy = deepSeekPolicy(TEST_USER_A);
    assert.equal(policy.cohortEligible, true);
    assert.equal(policy.cohortEligibilityReason, "EXPLICIT_ALLOWLIST");
    assert.equal(policy.canaryActualInjection, false);
    assert.equal(policy.injectionEnabled, false);
    assert.equal(policy.actualCanonMode, "FULL_LEGACY");
    assert.equal(policy.actualArchiveMode, "FULL_ALWAYS");
  });
});
