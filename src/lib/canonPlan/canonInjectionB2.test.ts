import Module from "module";
import { createHash } from "node:crypto";

const originalLoad = Module._load;
Module._load = function (request, parent, isMain) {
  if (request === "server-only") return {};
  return originalLoad.call(this, request, parent, isMain);
} as typeof Module._load;

import assert from "node:assert/strict";
import { afterEach, before, beforeEach, describe, it } from "node:test";
import { resolveCanonInjectionPolicy } from "@/lib/canonInjectionPolicy";
import { buildCanonPlanForSave } from "@/lib/canonPlan/compileForSave";
import { CANON_COMPILER_VERSION, type CanonPlanV1, type CanonPlanChunk } from "@/lib/canonPlan/types";
import {
  OPENROUTER_DEEPSEEK_V4_PRO_MODEL,
  OPENROUTER_GEMINI_25_PRO_MODEL,
  OPENROUTER_MUSE_SPARK_11_MODEL,
  OPENROUTER_TENCENT_HY3_MODEL,
} from "@/lib/chatModels";
import type { buildContext as BuildContextFn } from "@/services/contextBuilder";
import type { CharacterChunk } from "@/types";

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
  "MEMORY_FEATURE_ENABLED",
] as const;

const TEST_COHORT_USER_ID = 4242;

function enableFullDeepSeekCohort(): void {
  process.env.CANON_INJECTION_DEEPSEEK_CANARY = "1";
  process.env.CANON_INJECTION_DEEPSEEK_CANARY_PERCENT = "100";
}

function resolveDeepSeekTestPolicy() {
  return resolveCanonInjectionPolicy(OPENROUTER_DEEPSEEK_V4_PRO_MODEL, {
    userId: TEST_COHORT_USER_ID,
  });
}

function saveEnv(): Record<string, string | undefined> {
  return Object.fromEntries(ENV_KEYS.map((k) => [k, process.env[k]]));
}
function restoreEnv(s: Record<string, string | undefined>): void {
  for (const k of ENV_KEYS) {
    if (s[k] === undefined) delete process.env[k];
    else process.env[k] = s[k];
  }
}

const SENTINEL_DORMANT = "SENTINEL_DORMANT_SECRET 회귀설정_호감도80고백";
const SENTINEL_CORE = "SENTINEL_CORE 레온 28세 귀족 냉정계산적";

function makeTestPlan(): CanonPlanV1 {
  const chunks: CanonPlanChunk[] = [
    {
      id: "core-1",
      text: SENTINEL_CORE,
      salience: "core",
      bucket: "character",
      visibility: "PUBLIC",
      order: 0,
      sectionTitle: "[Identity]",
      provenance: { sectionIndex: 0, paragraphIndex: 0, source: "public_canon" },
    },
    {
      id: "dorm-1",
      text: SENTINEL_DORMANT,
      salience: "dormant",
      bucket: "player",
      visibility: "CONDITIONAL",
      order: 1,
      sectionTitle: "[Secret]",
      provenance: { sectionIndex: 1, paragraphIndex: 0, source: "public_canon" },
    },
  ];
  return {
    version: 2,
    sourceHash: "test-hash-fixed",
    compilerVersion: CANON_COMPILER_VERSION,
    chunks,
    coreIds: ["core-1"],
    provenance: { sourceLength: 100, compiledAt: "2026-01-01T00:00:00.000Z", publicCanonLineCount: 4, chunkCount: 2 },
    retrieval: { activeBudgetChars: 2000, archiveBudgetChars: 2000 },
  };
}

let buildContext: typeof BuildContextFn;

const baseChunk: CharacterChunk = {
  id: "c-1",
  characterId: "1",
  content: `${SENTINEL_CORE}\n\n${SENTINEL_DORMANT}`,
  category: "identity",
  importance: "CRITICAL",
  tokenCount: 30,
  keywords: ["레온"],
};

function buildPayload(opts: {
  policy: ReturnType<typeof resolveCanonInjectionPolicy>;
  plan: CanonPlanV1 | null;
  userMessage?: string;
  archiveMemory?: string;
}): { systemPrompt: string; split: string; hash: string } {
  const built = buildContext({
    charName: "레온",
    chunks: [baseChunk],
    userNickname: "User",
    shortTermHistory: [],
    currentUserMessage: opts.userMessage ?? "안녕",
    nsfw: false,
    longTermMemory: "",
    archiveMemory: opts.archiveMemory ?? "",
    modelId: OPENROUTER_DEEPSEEK_V4_PRO_MODEL,
    provider: "openrouter",
    canonInjectionPolicy: opts.policy,
    canonPlan: opts.plan,
  });
  const payload = JSON.stringify({
    system: built.systemPrompt,
    split: built.openRouterSystemSplit,
    history: built.history,
  });
  return {
    systemPrompt: built.systemPrompt,
    split: built.openRouterSystemSplit?.dynamicBlock ?? "",
    hash: createHash("sha256").update(payload).digest("hex"),
  };
}

describe("Canon injection B2 — D1 archive", () => {
  let env: Record<string, string | undefined>;
  before(async () => {
    ({ buildContext } = await import("@/services/contextBuilder"));
  });
  beforeEach(() => {
    env = saveEnv();
    for (const k of ENV_KEYS) delete process.env[k];
    process.env.MEMORY_FEATURE_ENABLED = "1";
  });
  afterEach(() => restoreEnv(env));

  it("D1 canary ON → archive selective (paragraph-level, <= whole blob)", () => {
    process.env.CANON_INJECTION_ENABLED = "1";
    process.env.CANON_INJECTION_ROLLOUT_STAGE = "D1";
    process.env.CANON_ARCHIVE_DEEPSEEK_SELECTIVE = "1";
    enableFullDeepSeekCohort();
    const policy = resolveDeepSeekTestPolicy();
    assert.equal(policy.actualArchiveMode, "SELECTIVE");
    assert.equal(policy.shadowOnly, false);

    const archive = "레온은 과거에 마법 대가를 치른 적이 있다.\n\n무관한 단락: 날씨가 맑았다.";
    const r = buildPayload({ policy, plan: makeTestPlan(), userMessage: "레온은 과거에 마법 대가를 어떻게 치렀나", archiveMemory: archive });
    assert.match(r.systemPrompt, /과거 기억/);
    assert.ok(r.systemPrompt.includes("마법 대가를 치른"), "relevant archive paragraph must be injected");
    assert.ok(!r.systemPrompt.includes("날씨가 맑았다"), "irrelevant archive paragraph must not be injected");
  });

  it("D1 canary OFF → archive whole blob (CONTROL)", () => {
    process.env.CANON_INJECTION_ENABLED = "1";
    process.env.CANON_INJECTION_ROLLOUT_STAGE = "D1";
    process.env.CANON_ARCHIVE_DEEPSEEK_SELECTIVE = "1";
    const policy = resolveCanonInjectionPolicy(OPENROUTER_DEEPSEEK_V4_PRO_MODEL);
    assert.equal(policy.shadowOnly, true);
    assert.equal(policy.actualArchiveMode, "FULL_ALWAYS");

    const archive = "레온은 과거에 마법 대가를 치른 적이 있다.\n\n무관한 단락: 날씨가 맑았다.";
    const r = buildPayload({ policy, plan: makeTestPlan(), userMessage: "안녕", archiveMemory: archive });
    assert.ok(r.systemPrompt.includes("날씨가 맑았다"), "whole blob must be injected when canary off");
  });

  it("D1 selected=0 → no archive injection (no whole fallback)", () => {
    process.env.CANON_INJECTION_ENABLED = "1";
    process.env.CANON_INJECTION_ROLLOUT_STAGE = "D1";
    process.env.CANON_ARCHIVE_DEEPSEEK_SELECTIVE = "1";
    enableFullDeepSeekCohort();
    const policy = resolveDeepSeekTestPolicy();
    const archive = "완전히 무관한 단락이다. 날씨 이야기.";
    const r = buildPayload({ policy, plan: makeTestPlan(), userMessage: "안녕", archiveMemory: archive });
    assert.ok(!r.systemPrompt.includes("과거 기억"), "no archive block when selected=0");
  });

  it("kill switch → whole blob archive", () => {
    process.env.CANON_INJECTION_ENABLED = "1";
    process.env.CANON_INJECTION_ROLLOUT_STAGE = "D2";
    process.env.CANON_ARCHIVE_DEEPSEEK_SELECTIVE = "1";
    process.env.CANON_INJECTION_DEEPSEEK_CANARY = "1";
    process.env.CANON_INJECTION_FORCE_FULL_LEGACY = "1";
    const policy = resolveCanonInjectionPolicy(OPENROUTER_DEEPSEEK_V4_PRO_MODEL);
    assert.equal(policy.forceFullLegacy, true);
    assert.equal(policy.actualArchiveMode, "FULL_ALWAYS");
    const archive = "단락A.\n\n단락B 무관.";
    const r = buildPayload({ policy, plan: makeTestPlan(), userMessage: "안녕", archiveMemory: archive });
    assert.ok(r.systemPrompt.includes("단락B"), "kill switch → whole blob");
  });

  it("Muse/Gemini/HY3 → whole blob archive unchanged", () => {
    process.env.CANON_INJECTION_ENABLED = "1";
    process.env.CANON_INJECTION_ROLLOUT_STAGE = "D2";
    process.env.CANON_INJECTION_DEEPSEEK_CANARY = "1";
    for (const m of [OPENROUTER_MUSE_SPARK_11_MODEL, OPENROUTER_GEMINI_25_PRO_MODEL, OPENROUTER_TENCENT_HY3_MODEL]) {
      const policy = resolveCanonInjectionPolicy(m);
      assert.equal(policy.actualArchiveMode, "FULL_ALWAYS");
      assert.equal(policy.actualCanonMode, "FULL_LEGACY");
    }
  });

  it("CONTROL vs D1-canary-OFF → identical payload", () => {
    const archive = "레온은 마법 대가를 치른 적이 있다.\n\n무관: 날씨 맑음.";
    process.env.CANON_INJECTION_ENABLED = "1";
    process.env.CANON_INJECTION_ROLLOUT_STAGE = "D1";
    process.env.CANON_ARCHIVE_DEEPSEEK_SELECTIVE = "1";
    const offPolicy = resolveCanonInjectionPolicy(OPENROUTER_DEEPSEEK_V4_PRO_MODEL);
    const off = buildPayload({ policy: offPolicy, plan: makeTestPlan(), userMessage: "안녕", archiveMemory: archive });

    delete process.env.CANON_INJECTION_ENABLED;
    delete process.env.CANON_INJECTION_ROLLOUT_STAGE;
    delete process.env.CANON_ARCHIVE_DEEPSEEK_SELECTIVE;
    const controlPolicy = resolveCanonInjectionPolicy(OPENROUTER_DEEPSEEK_V4_PRO_MODEL);
    const control = buildPayload({ policy: controlPolicy, plan: null, userMessage: "안녕", archiveMemory: archive });
    assert.equal(off.hash, control.hash);
  });
});

describe("Canon injection B2 — D2 canon layering", () => {
  let env: Record<string, string | undefined>;
  before(async () => {
    ({ buildContext } = await import("@/services/contextBuilder"));
  });
  beforeEach(() => {
    env = saveEnv();
    for (const k of ENV_KEYS) delete process.env[k];
  });
  afterEach(() => restoreEnv(env));

  it("D2 canary ON → CORE replaces FULL canon; dormant sentinel absent (provenance)", () => {
    process.env.CANON_INJECTION_ENABLED = "1";
    process.env.CANON_INJECTION_ROLLOUT_STAGE = "D2";
    process.env.CANON_ARCHIVE_DEEPSEEK_SELECTIVE = "1";
    enableFullDeepSeekCohort();
    const policy = resolveDeepSeekTestPolicy();
    assert.equal(policy.actualCanonMode, "LAYERED");
    assert.equal(policy.shadowOnly, false);

    const r = buildPayload({ policy, plan: makeTestPlan(), userMessage: "안녕" });
    assert.ok(r.systemPrompt.includes(SENTINEL_CORE), "CORE chunk must be present");
    assert.ok(!r.systemPrompt.includes(SENTINEL_DORMANT), "dormant sentinel must be absent from entire payload");
  });

  it("D2 canary OFF → FULL canon (sentinel present, CONTROL)", () => {
    process.env.CANON_INJECTION_ENABLED = "1";
    process.env.CANON_INJECTION_ROLLOUT_STAGE = "D2";
    process.env.CANON_ARCHIVE_DEEPSEEK_SELECTIVE = "1";
    const policy = resolveCanonInjectionPolicy(OPENROUTER_DEEPSEEK_V4_PRO_MODEL);
    assert.equal(policy.shadowOnly, true);
    assert.equal(policy.actualCanonMode, "FULL_LEGACY");

    const r = buildPayload({ policy, plan: makeTestPlan(), userMessage: "안녕" });
    assert.ok(r.systemPrompt.includes(SENTINEL_DORMANT), "FULL canon includes dormant sentinel");
  });

  it("D2 ACTIVE=0 with irrelevant cue → no active section, no fallback", () => {
    process.env.CANON_INJECTION_ENABLED = "1";
    process.env.CANON_INJECTION_ROLLOUT_STAGE = "D2";
    process.env.CANON_ARCHIVE_DEEPSEEK_SELECTIVE = "1";
    enableFullDeepSeekCohort();
    const policy = resolveDeepSeekTestPolicy();
    const r = buildPayload({ policy, plan: makeTestPlan(), userMessage: "완전히 무관한 인사 안녕" });
    assert.ok(!r.systemPrompt.includes("character-active-canon"), "no ACTIVE section when 0 relevant");
    assert.ok(r.systemPrompt.includes(SENTINEL_CORE), "CORE still present");
  });

  it("D2 CORE deterministic across turns (same plan → same CORE prefix)", () => {
    process.env.CANON_INJECTION_ENABLED = "1";
    process.env.CANON_INJECTION_ROLLOUT_STAGE = "D2";
    process.env.CANON_ARCHIVE_DEEPSEEK_SELECTIVE = "1";
    enableFullDeepSeekCohort();
    const policy = resolveDeepSeekTestPolicy();
    const plan = makeTestPlan();
    const a = buildPayload({ policy, plan, userMessage: "첫 대화 안녕" });
    const b = buildPayload({ policy, plan, userMessage: "두 번째 대화 요리" });
    const aCore = a.systemPrompt.slice(0, a.systemPrompt.indexOf("SENTINEL_CORE") + 40);
    const bCore = b.systemPrompt.slice(0, b.systemPrompt.indexOf("SENTINEL_CORE") + 40);
    assert.equal(aCore, bCore, "CORE prefix must not change across turns");
  });

  it("kill switch → FULL canon + no ACTIVE", () => {
    process.env.CANON_INJECTION_ENABLED = "1";
    process.env.CANON_INJECTION_ROLLOUT_STAGE = "D2";
    process.env.CANON_ARCHIVE_DEEPSEEK_SELECTIVE = "1";
    process.env.CANON_INJECTION_DEEPSEEK_CANARY = "1";
    process.env.CANON_INJECTION_FORCE_FULL_LEGACY = "1";
    const policy = resolveCanonInjectionPolicy(OPENROUTER_DEEPSEEK_V4_PRO_MODEL);
    assert.equal(policy.actualCanonMode, "FULL_LEGACY");
    const r = buildPayload({ policy, plan: makeTestPlan(), userMessage: "레온 회귀 비밀" });
    assert.ok(r.systemPrompt.includes(SENTINEL_DORMANT), "FULL canon restored");
    assert.ok(!r.systemPrompt.includes("character-active-canon"), "no ACTIVE under kill switch");
  });

  it("Muse/Gemini/HY3 → FULL canon unchanged (no LAYERED)", () => {
    process.env.CANON_INJECTION_ENABLED = "1";
    process.env.CANON_INJECTION_ROLLOUT_STAGE = "D2";
    process.env.CANON_INJECTION_DEEPSEEK_CANARY = "1";
    for (const m of [OPENROUTER_MUSE_SPARK_11_MODEL, OPENROUTER_GEMINI_25_PRO_MODEL, OPENROUTER_TENCENT_HY3_MODEL]) {
      const policy = resolveCanonInjectionPolicy(m);
      assert.equal(policy.actualCanonMode, "FULL_LEGACY");
    }
  });

  it("CONTROL vs D2-canary-OFF → identical payload", () => {
    process.env.CANON_INJECTION_ENABLED = "1";
    process.env.CANON_INJECTION_ROLLOUT_STAGE = "D2";
    process.env.CANON_ARCHIVE_DEEPSEEK_SELECTIVE = "1";
    const offPolicy = resolveCanonInjectionPolicy(OPENROUTER_DEEPSEEK_V4_PRO_MODEL);
    const off = buildPayload({ policy: offPolicy, plan: makeTestPlan(), userMessage: "안녕" });

    delete process.env.CANON_INJECTION_ENABLED;
    delete process.env.CANON_INJECTION_ROLLOUT_STAGE;
    delete process.env.CANON_ARCHIVE_DEEPSEEK_SELECTIVE;
    const controlPolicy = resolveCanonInjectionPolicy(OPENROUTER_DEEPSEEK_V4_PRO_MODEL);
    const control = buildPayload({ policy: controlPolicy, plan: null, userMessage: "안녕" });
    assert.equal(off.hash, control.hash);
  });
});

describe("Canon injection B2 — D2 ACTIVE selector contract", () => {
  let env: Record<string, string | undefined>;
  before(async () => {
    ({ buildContext } = await import("@/services/contextBuilder"));
  });
  beforeEach(() => {
    env = saveEnv();
    for (const k of ENV_KEYS) delete process.env[k];
  });
  afterEach(() => restoreEnv(env));

  it("B1: player-bucket dormant sentinel is NOT surfaced by ACTIVE even when cue matches (knowledge boundary)", () => {
    process.env.CANON_INJECTION_ENABLED = "1";
    process.env.CANON_INJECTION_ROLLOUT_STAGE = "D2";
    process.env.CANON_ARCHIVE_DEEPSEEK_SELECTIVE = "1";
    enableFullDeepSeekCohort();
    const policy = resolveDeepSeekTestPolicy();
    // The dormant sentinel is in the `player` bucket (a user-only secret). The cue
    // lexically matches it ("회귀"), but B1 excludes player-bucket chunks from ACTIVE
    // eligibility -> the sentinel must NOT appear in the LAYERED payload. CORE still does.
    const r = buildPayload({ policy, plan: makeTestPlan(), userMessage: "회귀 비밀에 대해 말해줘" });
    assert.ok(r.systemPrompt.includes(SENTINEL_CORE), "CORE chunk must be present");
    assert.ok(!r.systemPrompt.includes(SENTINEL_DORMANT), "player-bucket dormant sentinel must NOT be surfaced by ACTIVE (B1)");
  });
});
