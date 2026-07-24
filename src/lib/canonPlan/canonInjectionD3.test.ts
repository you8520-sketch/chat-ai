// D3 ACCEPTANCE — deterministic payload gates (0 API). Consolidates STEP 5:
//   (1) knowledge boundary: player + scenario_meta dormant sentinels -> BOTH absent from LAYERED ACTIVE prompt
//   (2) dormant provenance: dormant sentinel in archive -> not in context; no LTM/episodic/lorebook/history bypass
//   (3) kill-switch: KILL_SWITCH=1 -> FULL_LEGACY canon + FULL_ALWAYS archive + ACTIVE OFF + Momentum OFF (exact rollback)
//   (4) other-model isolation: Muse/Gemini/HY3 -> FULL_LEGACY + FULL_ALWAYS (no LAYERED)
// No live calls. No frozen component modified.
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

function deepSeekPolicy() {
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

const SENTINEL_PLAYER = "SENTINEL_PLAYER_SECRET 회귀설정_호감도80고백";
const SENTINEL_SCENARIO_META = "SENTINEL_SCENARIO_META 루프재시작_3일차조건";
const SENTINEL_CORE = "SENTINEL_CORE 레온 28세 귀족 냉정계산적";
const SENTINEL_DORMANT_WORLD = "SENTINEL_DORMANT_WORLD 회색안개수위";

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
      id: "dorm-player",
      text: SENTINEL_PLAYER,
      salience: "dormant",
      bucket: "player",
      visibility: "CONDITIONAL",
      order: 1,
      sectionTitle: "[Secret]",
      provenance: { sectionIndex: 1, paragraphIndex: 0, source: "public_canon" },
    },
    {
      id: "dorm-scenario",
      text: SENTINEL_SCENARIO_META,
      salience: "dormant",
      bucket: "scenario_meta",
      visibility: "CONDITIONAL",
      order: 2,
      sectionTitle: "[Scenario]",
      provenance: { sectionIndex: 2, paragraphIndex: 0, source: "public_canon" },
    },
    {
      id: "dorm-world",
      text: SENTINEL_DORMANT_WORLD,
      salience: "dormant",
      bucket: "world",
      visibility: "PUBLIC",
      order: 3,
      sectionTitle: "[세계관 — 회색 안개]",
      provenance: { sectionIndex: 3, paragraphIndex: 0, source: "public_canon" },
    },
  ];
  return {
    version: 2,
    sourceHash: "test-hash-fixed-d3",
    compilerVersion: CANON_COMPILER_VERSION,
    chunks,
    coreIds: ["core-1"],
    provenance: { sourceLength: 120, compiledAt: "2026-01-01T00:00:00.000Z", publicCanonLineCount: 6, chunkCount: 4 },
    retrieval: { activeBudgetChars: 2000, archiveBudgetChars: 2000 },
  };
}

let buildContext: typeof BuildContextFn;

const baseChunk: CharacterChunk = {
  id: "c-1",
  characterId: "1",
  content: `${SENTINEL_CORE}\n\n${SENTINEL_PLAYER}\n\n${SENTINEL_SCENARIO_META}\n\n${SENTINEL_DORMANT_WORLD}`,
  category: "identity",
  importance: "CRITICAL",
  tokenCount: 40,
  keywords: ["레온"],
};

function buildPayload(opts: {
  policy: ReturnType<typeof resolveCanonInjectionPolicy>;
  plan: CanonPlanV1 | null;
  userMessage?: string;
  archiveMemory?: string;
  longTermMemory?: string;
}): { systemPrompt: string; hash: string } {
  const built = buildContext({
    charName: "레온",
    chunks: [baseChunk],
    userNickname: "User",
    shortTermHistory: [],
    currentUserMessage: opts.userMessage ?? "안녕",
    nsfw: false,
    longTermMemory: opts.longTermMemory ?? "",
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
    hash: createHash("sha256").update(payload).digest("hex"),
  };
}

function setD2Canary() {
  process.env.CANON_INJECTION_ENABLED = "1";
  process.env.CANON_INJECTION_ROLLOUT_STAGE = "D2";
  process.env.CANON_ARCHIVE_DEEPSEEK_SELECTIVE = "1";
  process.env.CANON_INJECTION_DEEPSEEK_CANARY = "1";
  process.env.CANON_INJECTION_DEEPSEEK_CANARY_PERCENT = "100";
  process.env.MEMORY_FEATURE_ENABLED = "1";
}

describe("D3 payload — 1. knowledge boundary (player + scenario_meta absent from ACTIVE)", () => {
  let env: Record<string, string | undefined>;
  before(async () => {
    ({ buildContext } = await import("@/services/contextBuilder"));
  });
  beforeEach(() => {
    env = saveEnv();
    for (const k of ENV_KEYS) delete process.env[k];
    setD2Canary();
  });
  afterEach(() => restoreEnv(env));

  it("player-bucket dormant sentinel is NOT surfaced by ACTIVE even when cue matches", () => {
    const policy = deepSeekPolicy();
    assert.equal(policy.actualCanonMode, "LAYERED");
    const r = buildPayload({ policy, plan: makeTestPlan(), userMessage: "회귀 비밀에 대해 말해줘" });
    assert.ok(r.systemPrompt.includes(SENTINEL_CORE), "CORE present");
    assert.ok(!r.systemPrompt.includes(SENTINEL_PLAYER), "player-bucket dormant sentinel must NOT surface (B1)");
  });

  it("scenario_meta-bucket dormant sentinel is NOT surfaced by ACTIVE even when cue matches", () => {
    const policy = deepSeekPolicy();
    const r = buildPayload({ policy, plan: makeTestPlan(), userMessage: "루프 재시작 조건에 대해 말해줘" });
    assert.ok(r.systemPrompt.includes(SENTINEL_CORE), "CORE present");
    assert.ok(!r.systemPrompt.includes(SENTINEL_SCENARIO_META), "scenario_meta-bucket dormant sentinel must NOT surface (B1)");
  });

  it("BOTH player + scenario_meta sentinels absent from LAYERED ACTIVE provider prompt (HARD GATE)", () => {
    const policy = deepSeekPolicy();
    const r = buildPayload({
      policy,
      plan: makeTestPlan(),
      userMessage: "회귀 비밀 루프 재시작 조건 둘 다 말해줘",
    });
    assert.ok(r.systemPrompt.includes(SENTINEL_CORE), "CORE present");
    assert.ok(!r.systemPrompt.includes(SENTINEL_PLAYER), "player sentinel absent (B1)");
    assert.ok(!r.systemPrompt.includes(SENTINEL_SCENARIO_META), "scenario_meta sentinel absent (B1)");
  });
});

describe("D3 payload — 2. dormant provenance (sentinel suppressed; no bypass re-injection)", () => {
  let env: Record<string, string | undefined>;
  before(async () => {
    ({ buildContext } = await import("@/services/contextBuilder"));
  });
  beforeEach(() => {
    env = saveEnv();
    for (const k of ENV_KEYS) delete process.env[k];
    setD2Canary();
  });
  afterEach(() => restoreEnv(env));

  it("dormant sentinel in archive -> NOT in context under D2 selective archive", () => {
    const policy = deepSeekPolicy();
    assert.equal(policy.actualArchiveMode, "SELECTIVE");
    const archive = `${SENTINEL_DORMANT_WORLD} 안개 수위 기록.\n\n무관 단락: 날씨 맑음.`;
    const r = buildPayload({ policy, plan: makeTestPlan(), userMessage: "완전히 무관한 인사 안녕", archiveMemory: archive });
    assert.ok(!r.systemPrompt.includes(SENTINEL_DORMANT_WORLD), "dormant world sentinel must NOT be in context (selective archive + ACTIVE=0)");
    assert.ok(!r.systemPrompt.includes("날씨 맑음"), "irrelevant archive paragraph excluded");
  });

  it("no LTM/episodic/lorebook/history bypass re-injection of dormant sentinel", () => {
    const policy = deepSeekPolicy();
    // LTM passed empty; no episodic/lorebook channel in this path; history empty. The dormant
    // sentinel lives only in archive (suppressed by selective archive) and dormant canon
    // (suppressed by LAYERED). It must not re-enter via any other source.
    const archive = `${SENTINEL_DORMANT_WORLD} 안개 수위 기록.`;
    const r = buildPayload({
      policy,
      plan: makeTestPlan(),
      userMessage: "안녕",
      archiveMemory: archive,
      longTermMemory: "",
    });
    assert.ok(!r.systemPrompt.includes(SENTINEL_DORMANT_WORLD), "no memory-origin reactivation of dormant sentinel");
    assert.ok(!r.systemPrompt.includes(SENTINEL_PLAYER), "player sentinel still absent");
    assert.ok(!r.systemPrompt.includes(SENTINEL_SCENARIO_META), "scenario_meta sentinel still absent");
  });
});

describe("D3 payload — 3. kill-switch (exact rollback)", () => {
  let env: Record<string, string | undefined>;
  before(async () => {
    ({ buildContext } = await import("@/services/contextBuilder"));
  });
  beforeEach(() => {
    env = saveEnv();
    for (const k of ENV_KEYS) delete process.env[k];
    setD2Canary();
  });
  afterEach(() => restoreEnv(env));

  it("KILL_SWITCH=1 -> FULL_LEGACY canon + FULL_ALWAYS archive + ACTIVE OFF + Momentum OFF", () => {
    process.env.CANON_INJECTION_KILL_SWITCH = "1";
    const policy = deepSeekPolicy();
    assert.equal(policy.forceFullLegacy, true);
    assert.equal(policy.actualCanonMode, "FULL_LEGACY");
    assert.equal(policy.actualArchiveMode, "FULL_ALWAYS");
    const archive = `${SENTINEL_DORMANT_WORLD} 기록.\n\n단락B 무관.`;
    const r = buildPayload({ policy, plan: makeTestPlan(), userMessage: "회귀 안개 비밀", archiveMemory: archive });
    // FULL_LEGACY restores dormant canon (sentinel present) and whole archive (단락B present).
    assert.ok(r.systemPrompt.includes(SENTINEL_DORMANT_WORLD), "FULL canon restored under kill switch");
    assert.ok(r.systemPrompt.includes("단락B"), "FULL_ALWAYS archive restored under kill switch");
    assert.ok(!r.systemPrompt.includes("character-active-canon"), "no ACTIVE section under kill switch");
  });
});

describe("D3 payload — 4. other-model isolation (Muse/Gemini/HY3 FULL_LEGACY)", () => {
  let env: Record<string, string | undefined>;
  before(async () => {
    ({ buildContext } = await import("@/services/contextBuilder"));
  });
  beforeEach(() => {
    env = saveEnv();
    for (const k of ENV_KEYS) delete process.env[k];
    setD2Canary();
  });
  afterEach(() => restoreEnv(env));

  it("Muse/Gemini/HY3 stay FULL_LEGACY + FULL_ALWAYS (no LAYERED, no ACTIVE)", () => {
    for (const m of [OPENROUTER_MUSE_SPARK_11_MODEL, OPENROUTER_GEMINI_25_PRO_MODEL, OPENROUTER_TENCENT_HY3_MODEL]) {
      const policy = resolveCanonInjectionPolicy(m);
      assert.equal(policy.actualCanonMode, "FULL_LEGACY", `${m}: canon FULL_LEGACY`);
      assert.equal(policy.actualArchiveMode, "FULL_ALWAYS", `${m}: archive FULL_ALWAYS`);
    }
  });

  it("DeepSeek canary ON -> LAYERED + SELECTIVE (contrast: only DeepSeek takes the candidate)", () => {
    const policy = deepSeekPolicy();
    assert.equal(policy.actualCanonMode, "LAYERED");
    assert.equal(policy.actualArchiveMode, "SELECTIVE");
  });
});

