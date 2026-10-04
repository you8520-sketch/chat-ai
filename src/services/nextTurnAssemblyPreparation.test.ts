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
import { after, before, beforeEach, describe, it } from "node:test";
import type { User } from "@/lib/auth";
import {
  CHEAPER_INFERENCE_CLAUDE_OPUS_55_MODEL,
  CHEAPER_INFERENCE_DEEPSEEK_V41_FLASH_MODEL,
  CHEAPER_INFERENCE_GEMINI_31_PRO_PREVIEW_MODEL,
} from "@/lib/chatModels";
import { getDb } from "@/lib/db";
import { messagesToTurns } from "@/lib/hybridMemory";
import { billableOpenRouterOutputTokens } from "@/lib/points";
import { serializeStatusWidget, DEFAULT_STATUS_WIDGET } from "@/lib/statusWidget";
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

function seedRoom(opts?: { description?: string; speech?: string; widget?: boolean }) {
  const db = getDb();
  db.prepare("DELETE FROM lorebook_active_entries").run();
  db.prepare("DELETE FROM keyword_lorebooks").run();
  db.prepare("DELETE FROM messages").run();
  db.prepare("DELETE FROM chats").run();
  db.prepare("DELETE FROM characters").run();
  db.prepare("DELETE FROM users").run();
  db.prepare("DELETE FROM user_personas").run();
  db.prepare("DELETE FROM chat_memories").run();

  db.prepare(
    `INSERT INTO users (id, email, nickname, pw_hash, is_adult, points) VALUES (?,?,?,?,?,?)`
  ).run(USER_ID, USER.email, USER.nickname, "x", 1, 5000);
  db.prepare(
    `INSERT INTO characters (
      id, name, description, speech_personality, speech_traits, system_prompt, world,
      example_dialog, greeting, status_widget_json
    ) VALUES (?,?,?,?,?,?,?,?,?,?)`
  ).run(
    CHAR_ID,
    "솔",
    opts?.description ?? "등대지기. CHARACTER_DESC_BASE",
    opts?.speech ?? "낮고 짧은 말.",
    "과묵",
    "너는 솔이다. FIRST_TURN_SYSTEM_PROMPT",
    "등대 아래 항구. FIRST_TURN_WORLD",
    "안녕, 여행자.",
    "FIRST_TURN_GREETING 등대가 깜빡인다.",
    opts?.widget ? serializeStatusWidget(DEFAULT_STATUS_WIDGET) : ""
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
      .prepare(
        `UPDATE characters SET description=?, speech_personality=? WHERE id=?`
      )
      .run("CHANGED_DESC 성격이 바뀌었다.", "CHANGED_SPEECH 말이 거칠다.", CHAR_ID);
    const afterSource = loadPersistedNextTurnSource({ chatId: CHAT_ID, user: USER });
    const afterSections = await resolvePersistedNextTurnPromptSections(afterSource!);
    const after = assembledTokens(
      await assemblePersistedNextTurnInputs({
        source: afterSource!,
        sections: afterSections,
        modelId: CHEAPER_INFERENCE_DEEPSEEK_V41_FLASH_MODEL,
      })
    );
    assert.notEqual(before, after);
    assert.notEqual(
      fingerprintPersistedNextTurnSource(beforeSource!, beforeSections),
      fingerprintPersistedNextTurnSource(afterSource!, afterSections)
    );
    const picker = await resolveModelPickerAssembledInputSnapshots({
      chatId: CHAT_ID,
      user: USER,
      refresh: true,
    });
    assert.equal(picker?.[CHEAPER_INFERENCE_DEEPSEEK_V41_FLASH_MODEL], after);
  });

  it("D status-widget ON/OFF delta is identical through the shared owner", async () => {
    addPlayableTurns(2);
    const offSource = loadPersistedNextTurnSource({ chatId: CHAT_ID, user: USER });
    const offSections = await resolvePersistedNextTurnPromptSections(offSource!);
    assert.equal(offSections.statusWidgetActive, false);
    const off = assembledTokens(
      await assemblePersistedNextTurnInputs({
        source: offSource!,
        sections: offSections,
        modelId: CHEAPER_INFERENCE_DEEPSEEK_V41_FLASH_MODEL,
      })
    );
    getDb()
      .prepare("UPDATE characters SET status_widget_json=? WHERE id=?")
      .run(serializeStatusWidget(DEFAULT_STATUS_WIDGET), CHAR_ID);
    const onSource = loadPersistedNextTurnSource({ chatId: CHAT_ID, user: USER });
    const onSections = await resolvePersistedNextTurnPromptSections(onSource!);
    assert.equal(onSections.statusWidgetActive, true);
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
      refresh: true,
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
        refresh: true,
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
      refresh: true,
    });
    assert.ok((snapshots?.[CHEAPER_INFERENCE_DEEPSEEK_V41_FLASH_MODEL] ?? 0) > 200);
  });
});
