import Module from "module";
import { createHash } from "node:crypto";

const originalLoad = Module._load;
Module._load = function (request, parent, isMain) {
  if (request === "server-only") return {};
  return originalLoad.call(this, request, parent, isMain);
} as typeof Module._load;

import assert from "node:assert/strict";
import { afterEach, before, beforeEach, describe, it } from "node:test";
import Database from "better-sqlite3";

import { resolveCanonInjectionPolicy } from "@/lib/canonInjectionPolicy";
import { buildCanonPlanForSave } from "@/lib/canonPlan/compileForSave";
import {
  ensureCanonPlanOnAccess,
  resetLazyCompileInFlightForTests,
} from "@/lib/canonPlan/lazyCompile";
import { serializeCanonPlanV1 } from "@/lib/canonPlan/serialize";
import {
  computeCanonShadowTurnRecord,
  shouldRunCanonInjectionSideEffects,
} from "@/lib/canonPlan/shadowD0";
import { buildOpenRouterMessages } from "@/lib/openRouterAdult";
import type { OpenRouterChatMessage } from "@/lib/openRouterClient";
import {
  OPENROUTER_DEEPSEEK_V4_PRO_MODEL,
  OPENROUTER_GEMINI_25_PRO_MODEL,
  OPENROUTER_MUSE_SPARK_11_MODEL,
  OPENROUTER_QWEN_37_MAX_MODEL,
  OPENROUTER_TENCENT_HY3_MODEL,
} from "@/lib/chatModels";
import type { buildContext as BuildContextFn } from "@/services/contextBuilder";
import type { CharacterChunk } from "@/types";

const ENV_KEYS = [
  "CANON_INJECTION_ENABLED",
  "CANON_INJECTION_FORCE_FULL_LEGACY",
  "CANON_INJECTION_KILL_SWITCH",
  "CANON_INJECTION_ROLLOUT_STAGE",
] as const;

const FIXTURE_RAW = [
  "[이름]",
  "레온 · 28세 · 남성 · 귀족",
  "",
  "[성격]",
  "냉정하고 계산적이다.",
  "",
  "[세계관]",
  "마법 왕국.",
].join("\n");

const TEST_CHAR_ID = 9_900_001;

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

function createTestDb(): Database.Database {
  const db = new Database(":memory:");
  db.exec(`
    CREATE TABLE characters (
      id INTEGER PRIMARY KEY,
      name TEXT NOT NULL,
      system_prompt TEXT NOT NULL DEFAULT '',
      world TEXT NOT NULL DEFAULT '',
      creator_raw_description TEXT NOT NULL DEFAULT '',
      creator_canon_plan_json TEXT
    )
  `);
  return db;
}

function insertCharacter(
  db: Database.Database,
  opts: {
    raw: string;
    planJson?: string | null;
    world?: string;
    systemPrompt?: string;
  }
): void {
  db.prepare("DELETE FROM characters WHERE id = ?").run(TEST_CHAR_ID);
  db.prepare(
    `INSERT INTO characters (id, name, creator_raw_description, creator_canon_plan_json, world, system_prompt)
     VALUES (?, ?, ?, ?, ?, ?)`
  ).run(
    TEST_CHAR_ID,
    "레온",
    opts.raw,
    opts.planJson ?? null,
    opts.world ?? "마법 왕국",
    opts.systemPrompt ?? "[성격]\n냉정"
  );
}

function readPlanJson(db: Database.Database): string | null {
  const row = db
    .prepare("SELECT creator_canon_plan_json FROM characters WHERE id = ?")
    .get(TEST_CHAR_ID) as { creator_canon_plan_json?: string | null };
  return row?.creator_canon_plan_json?.trim() || null;
}

function normalizeOpenRouterMessages(messages: OpenRouterChatMessage[]): string {
  const normalized = messages.map((m) => {
    if (typeof m.content === "string") {
      return { role: m.role, content: m.content };
    }
    return {
      role: m.role,
      content: m.content.map((block) => ({
        type: block.type,
        text: block.text,
        cache_control: block.cache_control ?? null,
      })),
    };
  });
  return JSON.stringify(normalized);
}

function hashPayload(payload: string): string {
  return createHash("sha256").update(payload).digest("hex");
}

const criticalChunk: CharacterChunk = {
  id: "c-critical",
  characterId: "1",
  content: "[Identity]\nHero identity.",
  category: "identity",
  importance: "CRITICAL",
  tokenCount: 10,
  keywords: ["hero"],
};

let buildContext: typeof BuildContextFn;

describe("Canon injection B1 — lazy compile", () => {
  let envSnapshot: Record<string, string | undefined>;

  beforeEach(() => {
    envSnapshot = saveEnv();
    resetLazyCompileInFlightForTests();
  });

  afterEach(() => {
    restoreEnv(envSnapshot);
    resetLazyCompileInFlightForTests();
  });

  it("A: legacy NULL plan → lazy compile once → persist → reuse", () => {
    const db = createTestDb();
    insertCharacter(db, { raw: FIXTURE_RAW, planJson: null });

    const first = ensureCanonPlanOnAccess(db, TEST_CHAR_ID, {
      creator_raw_description: FIXTURE_RAW,
      creator_canon_plan_json: null,
      world: "마법 왕국",
      system_prompt: "[성격]\n냉정",
    });
    assert.equal(first.compiled, true);
    assert.equal(first.persisted, true);
    assert.ok(first.plan);
    const stored = readPlanJson(db);
    assert.ok(stored);

    const second = ensureCanonPlanOnAccess(db, TEST_CHAR_ID, {
      creator_raw_description: FIXTURE_RAW,
      creator_canon_plan_json: stored,
      world: "마법 왕국",
      system_prompt: "[성격]\n냉정",
    });
    assert.equal(second.reusedExisting, true);
    assert.equal(second.compiled, false);
    assert.equal(second.persisted, false);
    assert.equal(readPlanJson(db), stored);
    db.close();
  });

  it("B: source hash unchanged → no recompile", () => {
    const db = createTestDb();
    const save = buildCanonPlanForSave({ creatorRawDescription: FIXTURE_RAW });
    assert.ok(save.planJson);
    insertCharacter(db, { raw: FIXTURE_RAW, planJson: save.planJson });

    const result = ensureCanonPlanOnAccess(db, TEST_CHAR_ID, {
      creator_raw_description: FIXTURE_RAW,
      creator_canon_plan_json: save.planJson,
      world: "마법 왕국",
      system_prompt: "[성격]\n냉정",
    });
    assert.equal(result.compiled, false);
    assert.equal(result.persisted, false);
    assert.equal(result.compileSource, "existing");
    assert.equal(readPlanJson(db), save.planJson);
    db.close();
  });

  it("C: source changed → recompile", () => {
    const db = createTestDb();
    const save = buildCanonPlanForSave({ creatorRawDescription: FIXTURE_RAW });
    assert.ok(save.planJson);
    const updatedRaw = `${FIXTURE_RAW}\n\n[추가]\n새 설정`;
    insertCharacter(db, { raw: updatedRaw, planJson: save.planJson });

    const result = ensureCanonPlanOnAccess(db, TEST_CHAR_ID, {
      creator_raw_description: updatedRaw,
      creator_canon_plan_json: save.planJson,
      world: "마법 왕국",
      system_prompt: "[성격]\n냉정",
    });
    assert.equal(result.compiled, true);
    assert.equal(result.sourceHashStatus, "mismatch");
    assert.notEqual(readPlanJson(db), save.planJson);
    db.close();
  });

  it("D: recompile failure + old valid → old preserved", () => {
    const db = createTestDb();
    const save = buildCanonPlanForSave({ creatorRawDescription: FIXTURE_RAW });
    assert.ok(save.planJson);
    insertCharacter(db, { raw: FIXTURE_RAW, planJson: save.planJson });

    const result = ensureCanonPlanOnAccess(db, TEST_CHAR_ID, {
      creator_raw_description: "",
      creator_canon_plan_json: save.planJson,
      world: "마법 왕국",
      system_prompt: "[성격]\n냉정",
    });
    assert.equal(result.sourceHashStatus, "missing_raw");
    assert.equal(result.plan?.sourceHash, save.plan?.sourceHash);
    assert.equal(readPlanJson(db), save.planJson);
    db.close();
  });

  it("I: compile failure + no valid plan → technical fallback eligible", () => {
    const db = createTestDb();
    insertCharacter(db, { raw: "", planJson: null });

    const result = ensureCanonPlanOnAccess(db, TEST_CHAR_ID, {
      creator_raw_description: "",
      creator_canon_plan_json: null,
      world: "",
      system_prompt: "",
    });
    assert.equal(result.technicalFallbackEligible, true);
    assert.equal(result.plan, null);
    assert.equal(readPlanJson(db), null);
    db.close();
  });
});

describe("Canon injection B1 — D0 shadow + policy", () => {
  let envSnapshot: Record<string, string | undefined>;

  before(async () => {
    ({ buildContext } = await import("@/services/contextBuilder"));
  });

  beforeEach(() => {
    envSnapshot = saveEnv();
    for (const key of ENV_KEYS) delete process.env[key];
  });

  afterEach(() => {
    restoreEnv(envSnapshot);
  });

  it("F: ACTIVE=0 shadow does not change actual FULL request path inputs", () => {
    process.env.CANON_INJECTION_ENABLED = "1";
    process.env.CANON_INJECTION_ROLLOUT_STAGE = "D0";
    const policy = resolveCanonInjectionPolicy(OPENROUTER_DEEPSEEK_V4_PRO_MODEL);
    assert.equal(policy.shadowOnly, true);

    const save = buildCanonPlanForSave({ creatorRawDescription: FIXTURE_RAW });
    assert.ok(save.plan);
    const shadow = computeCanonShadowTurnRecord({
      policy,
      characterId: 1,
      charName: "레온",
      plan: save.plan,
      lazyResult: {
        plan: save.plan,
        compileSource: "existing",
        sourceHash: save.plan!.sourceHash,
        sourceHashStatus: "match",
        reusedExisting: true,
        compiled: false,
        persisted: false,
        technicalFallbackEligible: false,
      },
      fullLegacyCanonChars: 5000,
      userMessage: "무관한 대화",
      archiveText: "과거 기억 단락",
    });
    assert.equal(shadow.activeChunks, 0);
    assert.equal(shadow.activeChars, 0);
    assert.equal(shadow.metricKind, "SHADOW_PLANNED");
  });

  it("G: master kill switch → FULL_LEGACY + archive FULL_ALWAYS", () => {
    process.env.CANON_INJECTION_ENABLED = "1";
    process.env.CANON_INJECTION_FORCE_FULL_LEGACY = "1";
    const policy = resolveCanonInjectionPolicy(OPENROUTER_DEEPSEEK_V4_PRO_MODEL);
    assert.equal(policy.forceFullLegacy, true);
    assert.equal(policy.canonMode, "FULL_LEGACY");
    assert.equal(policy.archiveMode, "FULL_ALWAYS");
    assert.equal(shouldRunCanonInjectionSideEffects(policy), true);
  });

  it("H: Muse/Gemini/HY3 policy stays FULL_LEGACY", () => {
    process.env.CANON_INJECTION_ENABLED = "1";
    for (const modelId of [
      OPENROUTER_MUSE_SPARK_11_MODEL,
      OPENROUTER_GEMINI_25_PRO_MODEL,
      OPENROUTER_TENCENT_HY3_MODEL,
    ]) {
      const policy = resolveCanonInjectionPolicy(modelId);
      assert.equal(policy.canonMode, "FULL_LEGACY");
      assert.equal(policy.archiveMode, "FULL_ALWAYS");
    }
  });

  it("E: D0 shadow OFF vs ON → identical provider-bound payload", () => {
    const baseInput = {
      charName: "Hero",
      chunks: [criticalChunk],
      userNickname: "User",
      shortTermHistory: [{ role: "assistant" as const, content: "Hello there." }],
      currentUserMessage: "hello",
      nsfw: false,
      longTermMemory: "They met yesterday.",
      archiveMemory: "Old archive paragraph one.\n\nOld archive paragraph two.",
      memoryMeta: "Relationship: close.",
      modelId: OPENROUTER_DEEPSEEK_V4_PRO_MODEL,
      provider: "openrouter" as const,
      targetResponseChars: 3200,
    };

    const buildPayload = () => {
      const built = buildContext(baseInput);
      const messages = buildOpenRouterMessages(built.systemPrompt, built.history, {
        systemSplit: built.openRouterSystemSplit,
      });
      return hashPayload(normalizeOpenRouterMessages(messages));
    };

    delete process.env.CANON_INJECTION_ENABLED;
    const offHash = buildPayload();

    process.env.CANON_INJECTION_ENABLED = "1";
    process.env.CANON_INJECTION_ROLLOUT_STAGE = "D0";
    const onHash = buildPayload();

    assert.equal(offHash, onHash);
  });

  it("E (Qwen): env flags do not alter buildContext provider payload", () => {
    const baseInput = {
      charName: "Hero",
      chunks: [criticalChunk],
      userNickname: "User",
      shortTermHistory: [],
      currentUserMessage: "hello 엘라라",
      nsfw: true,
      longTermMemory: "Memory text.",
      archiveMemory: "Archive text.",
      modelId: OPENROUTER_QWEN_37_MAX_MODEL,
      provider: "openrouter" as const,
    };

    const buildPayload = () => {
      const built = buildContext(baseInput);
      return hashPayload(
        JSON.stringify({
          split: built.openRouterSystemSplit,
          history: built.history,
        })
      );
    };

    delete process.env.CANON_INJECTION_ENABLED;
    const offHash = buildPayload();
    process.env.CANON_INJECTION_ENABLED = "1";
    process.env.CANON_INJECTION_ROLLOUT_STAGE = "D0";
    const onHash = buildPayload();
    assert.equal(offHash, onHash);
  });
});

describe("Canon injection B1 — persisted JSON validity", () => {
  it("lazy persist stores parseable CanonPlanV1 only", () => {
    const db = createTestDb();
    insertCharacter(db, { raw: FIXTURE_RAW, planJson: null });
    const result = ensureCanonPlanOnAccess(db, TEST_CHAR_ID, {
      creator_raw_description: FIXTURE_RAW,
      creator_canon_plan_json: null,
      world: "마법 왕국",
      system_prompt: "[성격]\n냉정",
    });
    assert.equal(result.persisted, true);
    const json = readPlanJson(db);
    assert.ok(json);
    assert.doesNotThrow(() => {
      const roundtrip = serializeCanonPlanV1(result.plan!);
      assert.equal(roundtrip, json);
    });
    db.close();
  });
});
