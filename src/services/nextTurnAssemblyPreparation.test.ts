import Module from "module";

const originalLoad = (Module as unknown as { _load: typeof Module._load })._load;
(Module as unknown as { _load: typeof Module._load })._load = function (
  request: string,
  parent: NodeModule,
  isMain: boolean
) {
  if (request === "server-only") return {};
  return originalLoad(request, parent, isMain);
} as typeof Module._load;

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { after, before, beforeEach, describe, it } from "node:test";
import {
  parseAllowedConsentModes,
  parseModelRouteState,
  resolveEffectiveConsentMode,
} from "@/lib/adultSceneRouting";
import { buildAdultContentPolicyBlock } from "@/lib/advancedProseNsfwGuidelines";
import type { User } from "@/lib/auth";
import { resolveCanonInjectionPolicy } from "@/lib/canonInjectionPolicy";
import { compileCanonPlanV1 } from "@/lib/canonPlan/compiler";
import { parseCanonPlanV1, serializeCanonPlanV1 } from "@/lib/canonPlan/serialize";
import {
  CHEAPER_INFERENCE_CLAUDE_OPUS_55_MODEL,
  CHEAPER_INFERENCE_DEEPSEEK_V41_FLASH_MODEL,
  CHEAPER_INFERENCE_GEMINI_31_PRO_PREVIEW_MODEL,
} from "@/lib/chatModels";
import { getDb } from "@/lib/db";
import { messagesToTurns } from "@/lib/hybridMemory";
import { hashPersonaSecretKey } from "@/lib/personaSecretItems";
import { insertChatPersonaSecretReveal } from "@/lib/personaSecretReveal";
import { billableOpenRouterOutputTokens } from "@/lib/points";
import {
  installIsolatedTestDatabase,
  uninstallIsolatedTestDatabase,
} from "@/lib/test/isolatedTestDatabase";
import {
  getOrCreateUserLorebookForChat,
  loadUserLorebookPromptBlockFromActivation,
  saveUserLorebookEntries,
} from "@/lib/userLorebook";
import { resolveSubscriptionMemoryCapability } from "@/lib/subscriptionMemoryCapability";
import { buildContext } from "@/services/contextBuilder";
import {
  assemblePersistedNextTurnInputs,
  fingerprintPersistedNextTurnSource,
  legacyPickerUntrimmedHistory,
  loadPersistedNextTurnSource,
  prepareNextTurnHistory,
  resolvePersistedActiveConsentMode,
  resolvePersistedNextTurnPromptSections,
} from "@/services/nextTurnAssemblyPreparation";
import {
  invalidateModelPickerInputSnapshot,
  matchesModelPickerSnapshotCache,
  rememberModelPickerInputSnapshot,
  resolveModelPickerAssembledInputSnapshots,
} from "@/services/modelPickerInputSnapshot";

const USER_ID = 771001;
const CHAR_ID = 771002;
const CHAT_ID = 771003;
const PERSONA_ID = 771004;

const CANON_ENV_KEYS = [
  "CANON_INJECTION_ENABLED",
  "CANON_INJECTION_FORCE_FULL_LEGACY",
  "CANON_INJECTION_KILL_SWITCH",
  "CANON_INJECTION_ROLLOUT_STAGE",
  "CANON_INJECTION_DEEPSEEK_MODE",
  "CANON_ARCHIVE_DEEPSEEK_SELECTIVE",
  "CANON_INJECTION_DEEPSEEK_CANARY",
  "CANON_INJECTION_DEEPSEEK_CANARY_PERCENT",
  "PERSONA_SECRET_BOUNDARY_ENABLED",
  "PERSONA_SECRET_DISCOVERY_ENABLED",
] as const;

const USER: User = {
  id: USER_ID,
  email: "prep@test.local",
  nickname: "여행자",
  is_adult: 1,
  nsfw_on: 0,
  points: 5000,
  sub_until: null,
  google_id: null,
  pref: null,
  sub_plan: null,
  sub_auto_renew: 0,
  notice_last_read_id: 0,
};

function assembledTokens(input: Parameters<typeof buildContext>[0]): number {
  const built = buildContext(input);
  const tokens = built.meta.promptAudit?.totalAssembledTokens ?? built.meta.estimatedInputTokens;
  assert.ok(typeof tokens === "number" && tokens > 0);
  return tokens!;
}

function seedRoom(opts?: { description?: string; speech?: string }) {
  const db = getDb();
  db.prepare("DELETE FROM lorebook_active_entries WHERE chat_id=?").run(CHAT_ID);
  db.prepare("DELETE FROM keyword_lorebooks WHERE chat_id=?").run(CHAT_ID);
  db.prepare("DELETE FROM messages WHERE chat_id=?").run(CHAT_ID);
  db.prepare("DELETE FROM chat_memories WHERE chat_id=?").run(CHAT_ID);
  db.prepare("DELETE FROM chats WHERE id=?").run(CHAT_ID);
  db.prepare("DELETE FROM characters WHERE id=?").run(CHAR_ID);
  db.prepare("DELETE FROM user_personas WHERE user_id=?").run(USER_ID);
  db.prepare("DELETE FROM users WHERE id=?").run(USER_ID);

  db.prepare(
    `INSERT INTO users (id, email, nickname, pw_hash, is_adult, points) VALUES (?,?,?,?,?,?)`
  ).run(USER_ID, USER.email, USER.nickname, "x", 1, 5000);
  db.prepare(
    `INSERT INTO characters (
      id, name, description, speech_profile, system_prompt, world,
      example_dialog, greeting, status_widget_json
    ) VALUES (?,?,?,?,?,?,?,?,?)`
  ).run(
    CHAR_ID,
    "솔",
    opts?.description ?? "등대지기. CHARACTER_DESC_BASE",
    JSON.stringify({ personality: opts?.speech ?? "낮고 짧은 말." }),
    "너는 솔이다. FIRST_TURN_SYSTEM_PROMPT",
    "등대 아래 항구. FIRST_TURN_WORLD",
    "안녕, 여행자.",
    "FIRST_TURN_GREETING 등대가 깜빡인다.",
    ""
  );
  db.prepare(
    `INSERT INTO chats (id, user_id, character_id, mode, user_note, adult_handoff_enabled)
     VALUES (?,?,?,'safe','FIRST_TURN_USER_NOTE 비 오는 밤',0)`
  ).run(CHAT_ID, USER_ID, CHAR_ID);
  db.prepare(
    `INSERT INTO messages (chat_id, role, content, model) VALUES (?,?,?,?)`
  ).run(CHAT_ID, "assistant", "FIRST_TURN_GREETING 등대가 깜빡인다.", "greeting");
}

function addPlayableTurns(count: number, long = false) {
  const db = getDb();
  const insert = db.prepare(
    `INSERT INTO messages (chat_id, role, content, model) VALUES (?,?,?,?)`
  );
  for (let i = 1; i <= count; i += 1) {
    insert.run(CHAT_ID, "user", `유저 턴 ${i} — 등대 문을 두드린다.`, CHEAPER_INFERENCE_DEEPSEEK_V41_FLASH_MODEL);
    const body = long
      ? `어시스턴트 턴 ${i} ${"파도가 암초를 친다. ".repeat(80)}`
      : `어시스턴트 턴 ${i} 짧게.`;
    insert.run(CHAT_ID, "assistant", body, CHEAPER_INFERENCE_DEEPSEEK_V41_FLASH_MODEL);
  }
}

describe("canonical next-turn assembly preparation", () => {
  before(() => installIsolatedTestDatabase());
  after(() => uninstallIsolatedTestDatabase());
  beforeEach(() => {
    invalidateModelPickerInputSnapshot(CHAT_ID);
    seedRoom();
  });

  it("A long-history legacy picker dump differs from production history policy", () => {
    addPlayableTurns(12, true);
    const source = loadPersistedNextTurnSource({ chatId: CHAT_ID, user: USER });
    assert.ok(source);
    const production = prepareNextTurnHistory({
      turns: source!.turns,
      modelId: CHEAPER_INFERENCE_DEEPSEEK_V41_FLASH_MODEL,
      provider: "openrouter",
      memoryFeatureOn: source!.memoryFeatureOn,
      completedTurnsForMemoryCoverage: source!.completedTurnsForMemoryCoverage,
      summarizedTurnCount: source!.summarizedTurnCount,
      personaDisplayName: source!.personaDisplayName,
      userNickname: USER.nickname,
    });
    const legacy = legacyPickerUntrimmedHistory(
      source!.turns,
      source!.personaDisplayName,
      USER.nickname
    );
    assert.notEqual(legacy.length, production.promptHistory.length);
    assert.ok(production.promptHistory.length > legacy.length);
    assert.ok(production.providerHistoryMinRealPlayableExchanges >= 4);
  });

  it("A/B two models share the same history policy and still differ after adapters", async () => {
    addPlayableTurns(12, true);
    const source = loadPersistedNextTurnSource({ chatId: CHAT_ID, user: USER });
    assert.ok(source);
    const sections = await resolvePersistedNextTurnPromptSections(source!);
    const deepseekHistory = prepareNextTurnHistory({
      turns: source!.turns,
      modelId: CHEAPER_INFERENCE_DEEPSEEK_V41_FLASH_MODEL,
      provider: "openrouter",
      memoryFeatureOn: source!.memoryFeatureOn,
      completedTurnsForMemoryCoverage: source!.completedTurnsForMemoryCoverage,
      summarizedTurnCount: source!.summarizedTurnCount,
      personaDisplayName: source!.personaDisplayName,
      userNickname: USER.nickname,
    });
    const geminiHistory = prepareNextTurnHistory({
      turns: source!.turns,
      modelId: CHEAPER_INFERENCE_GEMINI_31_PRO_PREVIEW_MODEL,
      provider: "openrouter",
      memoryFeatureOn: source!.memoryFeatureOn,
      completedTurnsForMemoryCoverage: source!.completedTurnsForMemoryCoverage,
      summarizedTurnCount: source!.summarizedTurnCount,
      personaDisplayName: source!.personaDisplayName,
      userNickname: USER.nickname,
    });
    assert.deepEqual(
      deepseekHistory.promptHistory.map((m) => m.content),
      geminiHistory.promptHistory.map((m) => m.content)
    );
    const deepseek = assembledTokens(
      await assemblePersistedNextTurnInputs({
        source: source!,
        sections,
        modelId: CHEAPER_INFERENCE_DEEPSEEK_V41_FLASH_MODEL,
      })
    );
    const gemini = assembledTokens(
      await assemblePersistedNextTurnInputs({
        source: source!,
        sections,
        modelId: CHEAPER_INFERENCE_GEMINI_31_PRO_PREVIEW_MODEL,
      })
    );
    assert.notEqual(deepseek, gemini);
  });

  it("C character description/speech delta is identical for production and picker owners", async () => {
    addPlayableTurns(2);
    const beforeSource = loadPersistedNextTurnSource({ chatId: CHAT_ID, user: USER });
    const beforeSections = await resolvePersistedNextTurnPromptSections(beforeSource!);
    const before = assembledTokens(
      await assemblePersistedNextTurnInputs({
        source: beforeSource!,
        sections: beforeSections,
        modelId: CHEAPER_INFERENCE_DEEPSEEK_V41_FLASH_MODEL,
      })
    );
    getDb()
      .prepare(`UPDATE characters SET description=?, world=?, system_prompt=? WHERE id=?`)
      .run(
        "CHANGED_DESC 성격이 바뀌었다.",
        "CHANGED_WORLD 안개가 항구를 삼켰다.",
        "CHANGED_SYSTEM 너는 안개 속의 솔이다.",
        CHAR_ID
      );
    const afterSource = loadPersistedNextTurnSource({ chatId: CHAT_ID, user: USER });
    const afterSections = await resolvePersistedNextTurnPromptSections(afterSource!);
    const afterInput = await assemblePersistedNextTurnInputs({
      source: afterSource!,
      sections: afterSections,
      modelId: CHEAPER_INFERENCE_DEEPSEEK_V41_FLASH_MODEL,
    });
    assert.equal(afterInput.characterPersonality, "CHANGED_DESC 성격이 바뀌었다.");
    assert.match(String(afterInput.world ?? ""), /CHANGED_WORLD/);
    assert.match(String(afterInput.systemPrompt ?? ""), /CHANGED_SYSTEM/);
    const afterBuilt = buildContext(afterInput);
    const after =
      afterBuilt.meta.promptAudit?.totalAssembledTokens ?? afterBuilt.meta.estimatedInputTokens;
    assert.ok(typeof after === "number" && after > 0);
    const afterBlob = `${afterBuilt.systemPrompt}\n${afterBuilt.history.map((m) => m.content).join("\n")}`;
    assert.match(afterBlob, /CHANGED_SYSTEM|CHANGED_WORLD|CHANGED_DESC/);
    assert.notEqual(before, after);
    assert.notEqual(
      fingerprintPersistedNextTurnSource(beforeSource!, beforeSections),
      fingerprintPersistedNextTurnSource(afterSource!, afterSections)
    );
    const picker = await resolveModelPickerAssembledInputSnapshots({
      chatId: CHAT_ID,
      user: USER,
    });
    assert.equal(picker?.[CHEAPER_INFERENCE_DEEPSEEK_V41_FLASH_MODEL], after);
  });

  it("D persisted user-lorebook ON/OFF delta is identical through the shared owner", async () => {
    addPlayableTurns(2);
    const offSource = loadPersistedNextTurnSource({ chatId: CHAT_ID, user: USER });
    const offSections = await resolvePersistedNextTurnPromptSections(offSource!);
    assert.equal((offSections.userLorebookBlock || "").includes("USER_LORE_등대"), false);
    const off = assembledTokens(
      await assemblePersistedNextTurnInputs({
        source: offSource!,
        sections: offSections,
        modelId: CHEAPER_INFERENCE_DEEPSEEK_V41_FLASH_MODEL,
      })
    );
    getOrCreateUserLorebookForChat(getDb(), CHAT_ID, USER_ID);
    saveUserLorebookEntries(getDb(), CHAT_ID, USER_ID, [
      { keywords: "등대", content: "USER_LORE_등대는 항상 켜져 있다. ".repeat(20), enabled: true },
    ]);
    const onSource = loadPersistedNextTurnSource({ chatId: CHAT_ID, user: USER });
    const onSections = await resolvePersistedNextTurnPromptSections(onSource!);
    assert.match(onSections.userLorebookBlock, /USER_LORE_등대/);
    const on = assembledTokens(
      await assemblePersistedNextTurnInputs({
        source: onSource!,
        sections: onSections,
        modelId: CHEAPER_INFERENCE_DEEPSEEK_V41_FLASH_MODEL,
      })
    );
    assert.notEqual(off, on);
    const picker = await resolveModelPickerAssembledInputSnapshots({
      chatId: CHAT_ID,
      user: USER,
    });
    assert.equal(picker?.[CHEAPER_INFERENCE_DEEPSEEK_V41_FLASH_MODEL], on);
  });

  it("E first-turn opening history is kept and F next-turn grows tokens", async () => {
    const firstSource = loadPersistedNextTurnSource({ chatId: CHAT_ID, user: USER });
    const firstSections = await resolvePersistedNextTurnPromptSections(firstSource!);
    const firstHistory = prepareNextTurnHistory({
      turns: firstSource!.turns,
      modelId: CHEAPER_INFERENCE_DEEPSEEK_V41_FLASH_MODEL,
      provider: "openrouter",
      memoryFeatureOn: firstSource!.memoryFeatureOn,
      completedTurnsForMemoryCoverage: firstSource!.completedTurnsForMemoryCoverage,
      summarizedTurnCount: firstSource!.summarizedTurnCount,
      personaDisplayName: firstSource!.personaDisplayName,
      userNickname: USER.nickname,
    });
    assert.ok(firstHistory.promptHistory.some((m) => m.content.includes("FIRST_TURN_GREETING")));
    const first = assembledTokens(
      await assemblePersistedNextTurnInputs({
        source: firstSource!,
        sections: firstSections,
        modelId: CHEAPER_INFERENCE_DEEPSEEK_V41_FLASH_MODEL,
      })
    );
    addPlayableTurns(1, true);
    const nextSource = loadPersistedNextTurnSource({ chatId: CHAT_ID, user: USER });
    const nextSections = await resolvePersistedNextTurnPromptSections(nextSource!);
    const next = assembledTokens(
      await assemblePersistedNextTurnInputs({
        source: nextSource!,
        sections: nextSections,
        modelId: CHEAPER_INFERENCE_DEEPSEEK_V41_FLASH_MODEL,
      })
    );
    assert.ok(next > first);
  });

  it("K character edit changes the source fingerprint and misses cache", async () => {
    addPlayableTurns(1);
    const source = loadPersistedNextTurnSource({ chatId: CHAT_ID, user: USER });
    const sections = await resolvePersistedNextTurnPromptSections(source!);
    const before = fingerprintPersistedNextTurnSource(source!, sections);
    rememberModelPickerInputSnapshot(CHAT_ID, {
      tokensByModel: { [CHEAPER_INFERENCE_DEEPSEEK_V41_FLASH_MODEL]: 1111 },
      sourceFingerprint: before,
    });
    getDb()
      .prepare("UPDATE characters SET description=? WHERE id=?")
      .run("STALE_CACHE_DESC 캐릭터 설명이 바뀜", CHAR_ID);
    const afterSource = loadPersistedNextTurnSource({ chatId: CHAT_ID, user: USER });
    const afterSections = await resolvePersistedNextTurnPromptSections(afterSource!);
    const after = fingerprintPersistedNextTurnSource(afterSource!, afterSections);
    assert.notEqual(before, after);
    assert.equal(
      matchesModelPickerSnapshotCache(
        { tokensByModel: { [CHEAPER_INFERENCE_DEEPSEEK_V41_FLASH_MODEL]: 1111 }, sourceFingerprint: before },
        { sourceFingerprint: after }
      ),
      false
    );
  });

  it("I/J estimate path does not write lorebook/memory/lease tables", async () => {
    addPlayableTurns(3);
    const lore = getOrCreateUserLorebookForChat(getDb(), CHAT_ID, USER_ID);
    saveUserLorebookEntries(getDb(), lore.id, USER_ID, [
      { keywords: "등대", content: "USER_LORE_등대는 항상 켜져 있다.", enabled: true },
    ]);
    const beforeActive = (
      getDb().prepare("SELECT COUNT(*) AS c FROM lorebook_active_entries").get() as { c: number }
    ).c;
    const beforeMemories = (
      getDb().prepare("SELECT COUNT(*) AS c FROM chat_memories").get() as { c: number }
    ).c;
    getDb().pragma("query_only = ON");
    try {
      const snapshots = await resolveModelPickerAssembledInputSnapshots({
        chatId: CHAT_ID,
        user: USER,
      });
      assert.ok((snapshots?.[CHEAPER_INFERENCE_DEEPSEEK_V41_FLASH_MODEL] ?? 0) > 0);
    } finally {
      getDb().pragma("query_only = OFF");
    }
    const afterActive = (
      getDb().prepare("SELECT COUNT(*) AS c FROM lorebook_active_entries").get() as { c: number }
    ).c;
    const afterMemories = (
      getDb().prepare("SELECT COUNT(*) AS c FROM chat_memories").get() as { c: number }
    ).c;
    assert.equal(afterActive, beforeActive);
    assert.equal(afterMemories, beforeMemories);
  });

  it("user lorebook persistActiveMatches=false keeps carryover readable without writes", () => {
    addPlayableTurns(1);
    const lore = getOrCreateUserLorebookForChat(getDb(), CHAT_ID, USER_ID);
    saveUserLorebookEntries(getDb(), lore.id, USER_ID, [
      { keywords: "항구", content: "USER_LORE_항구 안개", enabled: true },
    ]);
    const capability = resolveSubscriptionMemoryCapability(USER);
    loadUserLorebookPromptBlockFromActivation(getDb(), {
      chatId: CHAT_ID,
      userId: USER_ID,
      capability,
      activation: { currentUserText: "항구", recentRawText: "" },
      currentTurn: 2,
      persistActiveMatches: false,
    });
    const count = (
      getDb().prepare("SELECT COUNT(*) AS c FROM lorebook_active_entries WHERE chat_id=?").get(CHAT_ID) as {
        c: number;
      }
    ).c;
    assert.equal(count, 0);
  });

  it("H Published billable output owner includes Opus reasoning and strips Gemini reasoning", () => {
    assert.equal(
      billableOpenRouterOutputTokens(CHEAPER_INFERENCE_CLAUDE_OPUS_55_MODEL, 2500, 800),
      2500
    );
    assert.equal(
      billableOpenRouterOutputTokens(CHEAPER_INFERENCE_GEMINI_31_PRO_PREVIEW_MODEL, 2500, 800),
      1700
    );
  });

  it("CONSENT_PARITY persisted previous consent matches shared production input and picker tokens", async () => {
    addPlayableTurns(2);
    getDb()
      .prepare(
        `UPDATE characters SET adult_consent_modes_json=? WHERE id=?`
      )
      .run(JSON.stringify(["standard", "power_play", "cnc_opt_in"]), CHAR_ID);
    getDb()
      .prepare(`UPDATE chats SET adult_handoff_enabled=1, model_route_state_json=? WHERE id=?`)
      .run(JSON.stringify({ activeConsentMode: "cnc_opt_in" }), CHAT_ID);

    const expected = resolveEffectiveConsentMode({
      requested: undefined,
      previous: parseModelRouteState(
        JSON.stringify({ activeConsentMode: "cnc_opt_in" })
      ).activeConsentMode,
      currentInput: "",
      allowedConsentModes: parseAllowedConsentModes(
        JSON.stringify(["standard", "power_play", "cnc_opt_in"])
      ),
    });
    assert.equal(expected, "cnc_opt_in");
    assert.equal(
      resolvePersistedActiveConsentMode({
        modelRouteStateJson: JSON.stringify({ activeConsentMode: "cnc_opt_in" }),
        adultConsentModesJson: JSON.stringify(["standard", "power_play", "cnc_opt_in"]),
      }),
      expected
    );

    const onSource = loadPersistedNextTurnSource({ chatId: CHAT_ID, user: USER });
    const onSections = await resolvePersistedNextTurnPromptSections(onSource!);
    const onInput = await assemblePersistedNextTurnInputs({
      source: onSource!,
      sections: onSections,
      modelId: CHEAPER_INFERENCE_DEEPSEEK_V41_FLASH_MODEL,
    });
    assert.equal(onInput.activeConsentMode, expected);
    assert.equal(onInput.currentUserMessage, "");
    const onTokens = assembledTokens(onInput);
    const onPicker = await resolveModelPickerAssembledInputSnapshots({
      chatId: CHAT_ID,
      user: USER,
    });
    assert.equal(onPicker?.[CHEAPER_INFERENCE_DEEPSEEK_V41_FLASH_MODEL], onTokens);

    getDb()
      .prepare(`UPDATE chats SET model_route_state_json=? WHERE id=?`)
      .run(JSON.stringify({ activeConsentMode: "standard" }), CHAT_ID);
    const offSource = loadPersistedNextTurnSource({ chatId: CHAT_ID, user: USER });
    const offSections = await resolvePersistedNextTurnPromptSections(offSource!);
    const offInput = await assemblePersistedNextTurnInputs({
      source: offSource!,
      sections: offSections,
      modelId: CHEAPER_INFERENCE_DEEPSEEK_V41_FLASH_MODEL,
    });
    assert.equal(offInput.activeConsentMode, "standard");
    const offTokens = assembledTokens(offInput);
    const offPicker = await resolveModelPickerAssembledInputSnapshots({
      chatId: CHAT_ID,
      user: USER,
    });
    assert.equal(offPicker?.[CHEAPER_INFERENCE_DEEPSEEK_V41_FLASH_MODEL], offTokens);
    assert.notEqual(
      fingerprintPersistedNextTurnSource(onSource!, onSections),
      fingerprintPersistedNextTurnSource(offSource!, offSections)
    );
    if (buildAdultContentPolicyBlock("cnc_opt_in") !== buildAdultContentPolicyBlock("standard")) {
      assert.notEqual(onTokens, offTokens);
    }
  });

  it("CANON_PARITY persisted valid plan/policy matches production resolver without lazy compile", async () => {
    addPlayableTurns(2);
    const compiled = compileCanonPlanV1({
      creatorRawDescription: [
        "[Identity]",
        "CANON_SENTINEL_등대지기 솔은 항구의 유일한 파수꾼이다.",
        "",
        "[Secret]",
        "CANON_SECRET_안개 속에서만 진짜 이름을 말한다.",
      ].join("\n"),
      now: "2026-01-01T00:00:00.000Z",
    });
    assert.equal(compiled.ok, true);
    if (!compiled.ok) return;
    const planJson = serializeCanonPlanV1(compiled.plan);
    assert.ok(parseCanonPlanV1(planJson));
    getDb()
      .prepare(`UPDATE characters SET creator_canon_plan_json=? WHERE id=?`)
      .run(planJson, CHAR_ID);

    const envBefore = Object.fromEntries(CANON_ENV_KEYS.map((key) => [key, process.env[key]]));
    process.env.CANON_INJECTION_ENABLED = "1";
    process.env.CANON_INJECTION_ROLLOUT_STAGE = "D2";
    process.env.CANON_INJECTION_DEEPSEEK_MODE = "LAYERED";
    process.env.CANON_INJECTION_DEEPSEEK_CANARY = "1";
    process.env.CANON_INJECTION_DEEPSEEK_CANARY_PERCENT = "100";
    delete process.env.CANON_INJECTION_FORCE_FULL_LEGACY;
    delete process.env.CANON_INJECTION_KILL_SWITCH;

    try {
      const expectedPolicy = resolveCanonInjectionPolicy(
        CHEAPER_INFERENCE_DEEPSEEK_V41_FLASH_MODEL,
        { userId: USER_ID, chatId: CHAT_ID }
      );
      const source = loadPersistedNextTurnSource({ chatId: CHAT_ID, user: USER });
      const sections = await resolvePersistedNextTurnPromptSections(source!);
      assert.equal(source!.persistedCanonPlan?.sourceHash, compiled.plan.sourceHash);
      const sharedInput = await assemblePersistedNextTurnInputs({
        source: source!,
        sections,
        modelId: CHEAPER_INFERENCE_DEEPSEEK_V41_FLASH_MODEL,
      });
      assert.deepEqual(sharedInput.canonInjectionPolicy, expectedPolicy);
      assert.equal(sharedInput.canonPlan?.sourceHash, compiled.plan.sourceHash);
      const built = buildContext(sharedInput);
      const blob = `${built.systemPrompt}\n${(built.meta.trackedSections ?? [])
        .map((section) => section.text)
        .join("\n")}`;
      assert.match(blob, /CANON_SENTINEL_등대지기|CANON_SECRET_안개/);
      const tokens = assembledTokens(sharedInput);

      const beforeJson = (
        getDb()
          .prepare("SELECT creator_canon_plan_json AS json FROM characters WHERE id=?")
          .get(CHAR_ID) as { json: string }
      ).json;
      getDb().pragma("query_only = ON");
      try {
        const picker = await resolveModelPickerAssembledInputSnapshots({
          chatId: CHAT_ID,
          user: USER,
        });
        assert.equal(picker?.[CHEAPER_INFERENCE_DEEPSEEK_V41_FLASH_MODEL], tokens);
      } finally {
        getDb().pragma("query_only = OFF");
      }
      const afterJson = (
        getDb()
          .prepare("SELECT creator_canon_plan_json AS json FROM characters WHERE id=?")
          .get(CHAR_ID) as { json: string }
      ).json;
      assert.equal(afterJson, beforeJson);
      assert.doesNotMatch(
        fs.readFileSync(path.join(process.cwd(), "src/services/nextTurnAssemblyPreparation.ts"), "utf8"),
        /ensureCanonPlanOnAccess/
      );
    } finally {
      for (const key of CANON_ENV_KEYS) {
        if (envBefore[key] === undefined) delete process.env[key];
        else process.env[key] = envBefore[key];
      }
    }
  });

  it("PERSONA_KNOWN_FACT_PARITY persisted reveal block is shared by production input and picker", async () => {
    addPlayableTurns(2);
    const secretText = "렌은 등대 열쇠를 숨기고 있다.";
    const revealed = "PERSONA_KNOWN_FACT 렌은 등대 열쇠를 숨기고 있다.";
    getDb()
      .prepare(
        `INSERT INTO user_personas (id, user_id, name, gender, description, secret_description)
         VALUES (?,?,?,?,?,?)`
      )
      .run(PERSONA_ID, USER_ID, "렌", "female", "항구의 여행자", secretText);
    getDb().prepare("UPDATE chats SET selected_persona_id=? WHERE id=?").run(PERSONA_ID, CHAT_ID);
    assert.equal(
      insertChatPersonaSecretReveal({
        chatId: CHAT_ID,
        personaId: PERSONA_ID,
        secretKey: hashPersonaSecretKey(secretText),
        revealedFactText: revealed,
        revealedAtTurn: 1,
        source: "MANUAL_REVEAL",
      }),
      true
    );

    const envBefore = {
      boundary: process.env.PERSONA_SECRET_BOUNDARY_ENABLED,
      discovery: process.env.PERSONA_SECRET_DISCOVERY_ENABLED,
    };
    process.env.PERSONA_SECRET_BOUNDARY_ENABLED = "1";
    process.env.PERSONA_SECRET_DISCOVERY_ENABLED = "0";
    try {
      const source = loadPersistedNextTurnSource({ chatId: CHAT_ID, user: USER });
      const sections = await resolvePersistedNextTurnPromptSections(source!);
      assert.match(String(source!.revealedPersonaFactsBlock ?? ""), /PERSONA_KNOWN_FACT/);
      const sharedInput = await assemblePersistedNextTurnInputs({
        source: source!,
        sections,
        modelId: CHEAPER_INFERENCE_DEEPSEEK_V41_FLASH_MODEL,
      });
      assert.equal(sharedInput.revealedPersonaFactsBlock, source!.revealedPersonaFactsBlock);
      const built = buildContext(sharedInput);
      const blob = `${built.systemPrompt}\n${(built.meta.trackedSections ?? [])
        .map((section) => section.text)
        .join("\n")}`;
      assert.match(blob, /PERSONA_KNOWN_FACT/);
      const tokens = assembledTokens(sharedInput);
      const emptyFacts = assembledTokens({
        ...sharedInput,
        revealedPersonaFactsBlock: undefined,
      });
      assert.notEqual(tokens, emptyFacts);
      const picker = await resolveModelPickerAssembledInputSnapshots({
        chatId: CHAT_ID,
        user: USER,
      });
      assert.equal(picker?.[CHEAPER_INFERENCE_DEEPSEEK_V41_FLASH_MODEL], tokens);
      getDb().prepare("DELETE FROM chat_persona_secret_reveals WHERE chat_id=?").run(CHAT_ID);
      const afterSource = loadPersistedNextTurnSource({ chatId: CHAT_ID, user: USER });
      const afterSections = await resolvePersistedNextTurnPromptSections(afterSource!);
      assert.notEqual(
        fingerprintPersistedNextTurnSource(source!, sections),
        fingerprintPersistedNextTurnSource(afterSource!, afterSections)
      );
    } finally {
      if (envBefore.boundary === undefined) delete process.env.PERSONA_SECRET_BOUNDARY_ENABLED;
      else process.env.PERSONA_SECRET_BOUNDARY_ENABLED = envBefore.boundary;
      if (envBefore.discovery === undefined) delete process.env.PERSONA_SECRET_DISCOVERY_ENABLED;
      else process.env.PERSONA_SECRET_DISCOVERY_ENABLED = envBefore.discovery;
    }
  });

  it("REBASE REGRESSION keeps #1391 settlement and client presentation owners", () => {
    const route = fs.readFileSync(path.join(process.cwd(), "src/app/api/chat/route.ts"), "utf8");
    const client = fs.readFileSync(
      path.join(process.cwd(), "src/app/chat/[id]/ChatClient.tsx"),
      "utf8"
    );
    assert.match(route, /settledPoints: settlement\.settledPoints/);
    assert.match(route, /under_recovered/);
    assert.match(client, /settledPoints/);
    assert.match(client, /settlementView\?\.deduction/);
  });

  it("opening-only rooms still produce a first-turn snapshot", async () => {
    const turns = messagesToTurns(
      getDb()
        .prepare("SELECT role, content, model FROM messages WHERE chat_id=? ORDER BY id ASC")
        .all(CHAT_ID) as Array<{ role: "user" | "assistant"; content: string; model: string }>
    );
    assert.equal(turns.length, 1);
    const snapshots = await resolveModelPickerAssembledInputSnapshots({
      chatId: CHAT_ID,
      user: USER,
    });
    assert.ok((snapshots?.[CHEAPER_INFERENCE_DEEPSEEK_V41_FLASH_MODEL] ?? 0) > 200);
  });
});
