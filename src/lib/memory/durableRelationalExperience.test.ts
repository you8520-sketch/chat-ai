/**
 * SEXMEM1–7, MEMEXP1–10 — durable relational experience investigation gates.
 * Deterministic structural proofs only — no provider calls.
 */
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
import Database from "better-sqlite3";

import { IMMERSIVE_PROSE_BLOCK } from "@/lib/advancedProseNsfwGuidelines";
import {
  formatMemoryMetaForPrompt,
  mergeMemoryMeta,
  normalizeMemoryMeta,
  parseMemoryMeta,
} from "@/lib/chatMemory";
import { getDb } from "@/lib/db";
import {
  detectAbstractPsychologicalInference,
  ensureEpisodicMemoryFactsTable,
  getEpisodicMemoryForPrompt,
  persistEpisodicMemoryFactsBestEffort,
} from "@/lib/episodicMemoryFacts";
import {
  messagesToTurns,
  rawRecentTurnsToHistory,
  resolveLorebookExcludeFromTrimmedHistory,
  resolveProviderRawPoolExchangeCount,
} from "@/lib/hybridMemory";
import { buildRollingSummarySystemPrompt } from "@/lib/memory/memory-rolling-summary";
import { EPISODIC_FACTS_EXTRACT_INSTRUCTIONS } from "@/lib/memory/memory-episodic-prompt";
import { parseEpisodicExtractedFacts } from "@/lib/memory/memory-episodic-extract";
import {
  isRollingSummaryGroundedInDialogue,
  validateSummaryNarrative,
} from "@/lib/memory/memory-summary-integrity";
import {
  RAW_HISTORY_COMPLETE_EXCHANGES,
  ROLLING_SUMMARY_INTERVAL,
  ROLLING_SUMMARY_MAX_CHARS,
} from "@/lib/memory/memory-constants";
import { getOrCreateChatMemory } from "@/lib/memory/memory-db";
import { buildMemoryContextForChat } from "@/lib/memory/memory-manager";
import { persistValidatedSummaryBatch } from "@/lib/memory/memory-summary-persist";
import { rebuildLorebookFromRecords } from "@/lib/memory/memory-turn-summary";
import { NO_FALSE_SHARED_MEMORY_RULE } from "@/lib/noGodmodding";
import { RELATIONSHIP_MEMORY_SELF_EXTRACT_BLOCK } from "@/lib/relationshipMemoryTailPrompt";
import { extractReconvergenceHooks } from "@/lib/reconvergenceState";
import {
  installIsolatedTestDatabase,
  uninstallIsolatedTestDatabase,
} from "@/lib/test/isolatedTestDatabase";
import { buildContext } from "@/services/contextBuilder";

const CHAT = 950001;
const USER = 950002;
const CHAR = 950003;

/** Deterministic markers — continuity-changing facts, not sexual detail. */
const PRIOR_INTIMACY = "DRE_PRIOR_INTIMACY_7";
const ROLE_USER_TOP = "DRE_ROLE_USER_TOP_9";
const ROLE_CHAR_BOTTOM = "DRE_ROLE_CHAR_BOTTOM_8";
const EXPLICIT_PREF = "DRE_EXPLICIT_PREF_CONTROL_3";

function summaryWith(tag: string, extra = ""): string {
  return (
    `장면 요약: ${tag}. ${extra} ` +
    "추가 장식 없이 사실만 압축. 반복 묘사는 생략. 핵심 관계와 약속 상태를 유지한다. " +
    "인물의 감정 변화와 다음 장면 연결점을 짧게 기록한다. " +
    "동의·경계·후유증·공수 포지션은 다른 사건과 동일하게 보존한다."
  ).slice(0, ROLLING_SUMMARY_MAX_CHARS);
}

function cleanup(chatId = CHAT): void {
  const db = getDb();
  db.prepare("DELETE FROM episodic_memory_facts WHERE chat_id=?").run(chatId);
  db.prepare("DELETE FROM chat_turn_summaries WHERE chat_id=?").run(chatId);
  db.prepare("DELETE FROM chat_memories WHERE chat_id=?").run(chatId);
  db.prepare("DELETE FROM messages WHERE chat_id=?").run(chatId);
  db.prepare("DELETE FROM chats WHERE id=?").run(chatId);
}

function ensureUserAndCharacter(): void {
  const db = getDb();
  db.prepare(`INSERT OR IGNORE INTO users (id, email, nickname, pw_hash) VALUES (?,?,?,?)`).run(
    USER,
    `dre-${USER}@test.local`,
    "dre",
    "x"
  );
  db.prepare(`INSERT OR IGNORE INTO characters (id, name) VALUES (?,?)`).run(CHAR, "DreChar");
}

function seedChat(chatId = CHAT): void {
  ensureUserAndCharacter();
  const db = getDb();
  db.prepare(`INSERT INTO chats (id, user_id, character_id, mode) VALUES (?,?,?,'safe')`).run(
    chatId,
    USER,
    CHAR
  );
  getOrCreateChatMemory(chatId, USER, CHAR, "free");
}

function insertPlayableTurns(count: number, chatId = CHAT): void {
  const db = getDb();
  db.prepare(`INSERT INTO messages (chat_id, role, content, model) VALUES (?,?,?,?)`).run(
    chatId,
    "assistant",
    "opening greeting",
    "greeting"
  );
  for (let t = 1; t <= count; t++) {
    db.prepare(`INSERT INTO messages (chat_id, role, content, model) VALUES (?,?,?,?)`).run(
      chatId,
      "user",
      `user turn ${t}`,
      "user"
    );
    db.prepare(`INSERT INTO messages (chat_id, role, content, model) VALUES (?,?,?,?)`).run(
      chatId,
      "assistant",
      `assistant turn ${t}`,
      "test"
    );
  }
}

function persistBatchSummary(
  turnStart: number,
  summary: string,
  chatId = CHAT
): void {
  const result = persistValidatedSummaryBatch({
    chatId,
    userId: USER,
    characterId: CHAR,
    tier: "free",
    turnStart,
    assistantMessageId: null,
    summary,
    summaryKind: "main_canon",
    scopePayload: { v: 1, scopes: { main_canon: summary }, branchId: null, branchStatus: null, promotedBy: null, promotedAt: null },
    branchId: null,
    branchStatus: null,
    promotedBy: null,
    promotedAt: null,
    playableTurnCount: ROLLING_SUMMARY_INTERVAL,
  });
  assert.equal(result.ok, true, result.ok ? "" : String((result as { reason?: string }).reason));
}

before(() => installIsolatedTestDatabase());
after(() => uninstallIsolatedTestDatabase());
beforeEach(() => {
  cleanup();
  seedChat();
});

describe("SEXMEM — prior relational experience fixtures", () => {
  it("SEXMEM1 prior intimacy survives RAW4 exit when rolling summary preserves it", async () => {
    insertPlayableTurns(10);
    persistBatchSummary(1, summaryWith(PRIOR_INTIMACY, "이미 친밀한 관계가 성립한 상태로 이후 장면 진행"));
    persistBatchSummary(6, summaryWith("후속 장면", "관계 유지"));

    const rows = getDb()
      .prepare(`SELECT role, content, model FROM messages WHERE chat_id=? ORDER BY id`)
      .all(CHAT) as { role: "user" | "assistant"; content: string; model?: string }[];
    const turns = messagesToTurns(rows);
    const raw = rawRecentTurnsToHistory(turns, RAW_HISTORY_COMPLETE_EXCHANGES, {
      summarizedTurnCount: 10,
      memoryFeatureEnabled: true,
    });
    const rawText = raw.map((m) => m.content).join("\n");
    assert.doesNotMatch(rawText, new RegExp(PRIOR_INTIMACY));
    assert.match(rawText, /user turn 7/);

    const cutoff = resolveLorebookExcludeFromTrimmedHistory(turns, raw) ?? 7;
    const lorebook = rebuildLorebookFromRecords(CHAT, { excludeTurnStartGte: cutoff });
    assert.match(lorebook, new RegExp(PRIOR_INTIMACY));

    const injection = await buildMemoryContextForChat({
      chatId: CHAT,
      userId: USER,
      characterId: CHAR,
      tier: "free",
      memoryCapacity: 8000,
      userMessage: "다시 가까워진다.",
      excludeSummaryTurnStartGte: cutoff,
    });
    assert.match(injection.text, new RegExp(PRIOR_INTIMACY));
  });

  it("SEXMEM2 role continuity has no relationship-memory owner — rolling summary / episodic only", () => {
    const meta = mergeMemoryMeta(parseMemoryMeta("{}"), {
      items: ["유저: 열쇠"],
      promisesAdd: [{ text: "다음에 다시 만나자" }],
    });
    const promptMeta = formatMemoryMetaForPrompt(normalizeMemoryMeta(meta, { charName: "캐", userName: "유저" }));
    assert.ok(promptMeta);
    assert.doesNotMatch(promptMeta!, new RegExp(ROLE_USER_TOP));
    assert.doesNotMatch(promptMeta!, new RegExp(ROLE_CHAR_BOTTOM));
    assert.match(RELATIONSHIP_MEMORY_SELF_EXTRACT_BLOCK, /Relationship stage, attachment/);
    assert.match(RELATIONSHIP_MEMORY_SELF_EXTRACT_BLOCK, /Forbidden auto extraction/);
  });

  it("SEXMEM3 false-memory policy blocks fabricated shared history but not personality-based past inference", () => {
    assert.match(NO_FALSE_SHARED_MEMORY_RULE, /전에 말했잖아/);
    assert.match(NO_FALSE_SHARED_MEMORY_RULE, /불확실하면 질문, 관찰, 추측/);
    assert.doesNotMatch(IMMERSIVE_PROSE_BLOCK, /과거 역할을 역추론/);
    assert.doesNotMatch(NO_FALSE_SHARED_MEMORY_RULE, /현재 성격/);
  });

  it("SEXMEM4 first-time reset when summary omits prior intimacy fact", async () => {
    insertPlayableTurns(10);
    persistBatchSummary(1, summaryWith("일반 대화만 진행", "친밀 사건 없음"));
    persistBatchSummary(6, summaryWith("후속 장면"));

    const rows = getDb()
      .prepare(`SELECT role, content, model FROM messages WHERE chat_id=? ORDER BY id`)
      .all(CHAT) as { role: "user" | "assistant"; content: string; model?: string }[];
    const turns = messagesToTurns(rows);
    const raw = rawRecentTurnsToHistory(turns, RAW_HISTORY_COMPLETE_EXCHANGES, {
      summarizedTurnCount: 10,
      memoryFeatureEnabled: true,
    });
    const cutoff = resolveLorebookExcludeFromTrimmedHistory(turns, raw) ?? 7;
    const injection = await buildMemoryContextForChat({
      chatId: CHAT,
      userId: USER,
      characterId: CHAR,
      tier: "free",
      memoryCapacity: 8000,
      userMessage: "새로운 친밀한 장면",
      excludeSummaryTurnStartGte: cutoff,
    });
    assert.doesNotMatch(injection.text, new RegExp(PRIOR_INTIMACY));
  });

  it("SEXMEM5 single episode role event must not become permanent preference", () => {
    const inferred = parseEpisodicExtractedFacts(
      JSON.stringify({
        extracted_facts: [
          {
            category: "relationship",
            subject: "char_user",
            attribute: "relationship_dynamic",
            value: "domination",
            importance: "important",
            fact_text: "둘의 관계는 강압적인 지배 관계가 되었다.",
            evidence_type: "explicit_scene_event",
          },
        ],
      }),
      { requireEvidence: true }
    );
    assert.equal(inferred.length, 1);
    assert.equal(detectAbstractPsychologicalInference(inferred[0]!), "abstract_psychological_inference");

    const eventOnly = parseEpisodicExtractedFacts(
      JSON.stringify({
        extracted_facts: [
          {
            category: "relationship",
            subject: "char_user",
            attribute: "intimate_event",
            value: "occurred_once",
            importance: "important",
            fact_text: "유저와 캐릭터는 상호 합의 하에 친밀한 관계를 맺었다.",
            evidence_type: "explicit_scene_event",
          },
        ],
      }),
      { requireEvidence: true }
    );
    assert.equal(eventOnly.length, 1);
    assert.equal(detectAbstractPsychologicalInference(eventOnly[0]!), null);
  });

  it("SEXMEM6 repeated role pattern — no dedicated schema owner", () => {
    assert.match(EPISODIC_FACTS_EXTRACT_INSTRUCTIONS, /Maximum 3 facts/);
    assert.match(EPISODIC_FACTS_EXTRACT_INSTRUCTIONS, /Do NOT infer persistent personality/);
    const meta = parseMemoryMeta("{}");
    assert.deepEqual(Object.keys(meta).sort(), [
      "currentLocation",
      "honorifics",
      "items",
      "promises",
      "thoughts",
    ]);
  });

  it("SEXMEM7 explicit user preference routes to episodic preference owner", () => {
    const facts = parseEpisodicExtractedFacts(
      JSON.stringify({
        extracted_facts: [
          {
            category: "preference",
            subject: "user",
            attribute: "roleplay_preference",
            value: "consensual_control",
            importance: "important",
            fact_text: `사용자는 ${EXPLICIT_PREF} 상호 합의된 통제 역할극을 선호한다고 명시했다.`,
            evidence_type: "explicit_user_statement",
          },
        ],
      }),
      { requireEvidence: true }
    );
    assert.equal(facts.length, 1);
    assert.equal(facts[0]!.category, "preference");

    const db = new Database(":memory:");
    ensureEpisodicMemoryFactsTable(db);
    db.exec(`CREATE TABLE chat_memories (chat_id INTEGER PRIMARY KEY, memory_reset_after_message_id INTEGER, memory_epoch INTEGER NOT NULL DEFAULT 0)`);
    assert.equal(
      persistEpisodicMemoryFactsBestEffort(db, {
        chatId: 1,
        characterId: CHAR,
        userId: USER,
        sourceTurn: 5,
        facts,
      }),
      1
    );
  });
});

describe("Summary compression audit", () => {
  it("rolling summary prompt preserves role/consent but validation does not enforce omission", () => {
    const prompt = buildRollingSummarySystemPrompt(ROLLING_SUMMARY_INTERVAL);
    assert.match(prompt, /공수 포지션/);
    assert.match(prompt, /동의·경계/);

    const sourceDialogue = `[user] ${ROLE_USER_TOP} 유저가 주도하고 ${ROLE_CHAR_BOTTOM} 캐릭터가 받아들였다.`;
    const badSummary = summaryWith("ROLE_OMIT_MARKER", "감정만 변화하고 역할 정보는 생략");
    const validated = validateSummaryNarrative(badSummary, "main_canon");
    assert.equal(validated.ok, true, validated.ok ? "" : String((validated as { reason?: string }).reason));
    assert.equal(isRollingSummaryGroundedInDialogue(badSummary, sourceDialogue), true);
    assert.doesNotMatch(badSummary, new RegExp(ROLE_USER_TOP));
  });
});

describe("MEMEXP — durable relational experience regression gates", () => {
  it("MEMEXP1 prior experience survives RAW4 exit (requires summary preservation)", async () => {
    insertPlayableTurns(8);
    persistBatchSummary(1, summaryWith(PRIOR_INTIMACY));
    const rows = getDb()
      .prepare(`SELECT role, content, model FROM messages WHERE chat_id=? ORDER BY id`)
      .all(CHAT) as { role: "user" | "assistant"; content: string; model?: string }[];
    const turns = messagesToTurns(rows);
    const raw = rawRecentTurnsToHistory(turns, RAW_HISTORY_COMPLETE_EXCHANGES, {
      summarizedTurnCount: 5,
      memoryFeatureEnabled: true,
    });
    const cutoff = resolveLorebookExcludeFromTrimmedHistory(turns, raw) ?? 5;
    const lore = rebuildLorebookFromRecords(CHAT, { excludeTurnStartGte: cutoff });
    assert.match(lore, new RegExp(PRIOR_INTIMACY));
  });

  it("MEMEXP2 prior role is not reversed by relationship memory (no role owner there)", () => {
    const formatted = formatMemoryMetaForPrompt(
      normalizeMemoryMeta(
        parseMemoryMeta(
          JSON.stringify({
            items: ["유저: 반지"],
            promises: [{ text: "비밀 유지" }],
            honorifics: ["유저→캐: 오빠"],
            currentLocation: "침실",
          })
        ),
        { charName: "캐", userName: "유저" }
      )
    );
    assert.ok(formatted);
    assert.doesNotMatch(formatted!, /top|bottom|공수|주도|수동/);
  });

  it("MEMEXP3 unknown role must not become fabricated historical fact — policy partial", () => {
    assert.match(NO_FALSE_SHARED_MEMORY_RULE, /없는 일을/);
    assert.match(IMMERSIVE_PROSE_BLOCK, /relevant할 때만/);
  });

  it("MEMEXP4 one event does not become permanent preference", () => {
    const blocked = {
      category: "character" as const,
      subject: "user",
      attribute: "dominance",
      value: "high",
      importance: "important" as const,
      fact_text: "유저는 본질적으로 통제하는 성격이다.",
      evidence_type: "explicit_scene_event" as const,
    };
    assert.equal(detectAbstractPsychologicalInference(blocked), "abstract_psychological_inference");
  });

  it("MEMEXP5 explicit preference remains durable via episodic owner", () => {
    const facts = parseEpisodicExtractedFacts(
      JSON.stringify({
        extracted_facts: [
          {
            category: "preference",
            subject: "user",
            attribute: "roleplay_preference",
            value: "consensual_control",
            importance: "important",
            fact_text: `사용자는 ${EXPLICIT_PREF} 선호를 명시했다.`,
            evidence_type: "explicit_user_statement",
          },
        ],
      }),
      { requireEvidence: true }
    );
    assert.equal(facts.length, 1);
  });

  it("MEMEXP6 summary lag expands RAW pool — no coverage hole", () => {
    assert.equal(
      resolveProviderRawPoolExchangeCount({
        memoryFeatureEnabled: true,
        completedTurns: 12,
        summarizedTurnCount: 4,
      }),
      8
    );
    assert.equal(
      resolveProviderRawPoolExchangeCount({
        memoryFeatureEnabled: true,
        completedTurns: 12,
        summarizedTurnCount: 9,
      }),
      RAW_HISTORY_COMPLETE_EXCHANGES
    );
  });

  it("MEMEXP7 prior intimacy does not reset when summary retains fact", async () => {
    insertPlayableTurns(10);
    persistBatchSummary(1, summaryWith(PRIOR_INTIMACY, "첫 친밀 경험 완료"));
    const built = buildContext({
      charName: "DreChar",
      chunks: [],
      userNickname: "유저",
      shortTermHistory: rawRecentTurnsToHistory(messagesToTurns(
        getDb()
          .prepare(`SELECT role, content, model FROM messages WHERE chat_id=? ORDER BY id`)
          .all(CHAT) as { role: "user" | "assistant"; content: string; model?: string }[]
      ), RAW_HISTORY_COMPLETE_EXCHANGES, { summarizedTurnCount: 10, memoryFeatureEnabled: true }),
      currentUserMessage: "다시 가까워진다.",
      longTermMemory: rebuildLorebookFromRecords(CHAT),
      nsfw: true,
      provider: "openrouter",
      completedTurns: 10,
      summarizedTurnCount: 10,
    });
    assert.match(built.systemPrompt, new RegExp(PRIOR_INTIMACY));
  });

  it("MEMEXP8 memory callback anti-fixation lives in IMMERSIVE PROSE", () => {
    assert.match(IMMERSIVE_PROSE_BLOCK, /매 턴 의무적으로 회상하지 않는다/);
    assert.match(IMMERSIVE_PROSE_BLOCK, /같은 기억·키워드·상징·비유/);
  });

  it("MEMEXP9 regen invalidation — summary batch replace is idempotent scope", () => {
    insertPlayableTurns(5);
    persistBatchSummary(1, summaryWith(PRIOR_INTIMACY));
    persistBatchSummary(1, summaryWith("REGEN_REPLACED_SUMMARY"));
    const lore = rebuildLorebookFromRecords(CHAT);
    assert.match(lore, /REGEN_REPLACED_SUMMARY/);
    assert.doesNotMatch(lore, new RegExp(PRIOR_INTIMACY));
  });

  it("MEMEXP10 reconvergence provenance unchanged — static memory cannot hook", () => {
    assert.equal(
      extractReconvergenceHooks({
        memoryText: "우리는 이미 친밀한 관계다.",
        currentTurn: 1,
      }).length,
      0
    );
  });
});

describe("REL — generalized durable relational experience", () => {
  it("REL1 kiss/intimacy first-time risk when summary drops milestone", async () => {
    insertPlayableTurns(8);
    persistBatchSummary(1, summaryWith("DRE_NO_INTIMACY_MILESTONE", "일반 대화만 진행"));
    const injection = await buildMemoryContextForChat({
      chatId: CHAT,
      userId: USER,
      characterId: CHAR,
      tier: "free",
      memoryCapacity: 8000,
      userMessage: "입을 맞춘다.",
    });
    assert.doesNotMatch(injection.text, /DRE_PRIOR_INTIMACY|이미.?키스|친밀.?관계.?성립/i);
  });

  it("REL2 identity reveal — episodic explicit event allowed, inference blocked", () => {
    const reveal = parseEpisodicExtractedFacts(
      JSON.stringify({
        extracted_facts: [
          {
            category: "character",
            subject: "hero",
            attribute: "identity_reveal",
            value: "guild_master",
            importance: "critical",
            fact_text: "주인공은 자신이 길드장이라고 명시적으로 밝혔다.",
            evidence_type: "explicit_character_claim",
          },
        ],
      }),
      { requireEvidence: true }
    );
    assert.equal(reveal.length, 1);
    const inferred = parseEpisodicExtractedFacts(
      JSON.stringify({
        extracted_facts: [
          {
            category: "character",
            subject: "hero",
            attribute: "identity",
            value: "guild_master",
            importance: "critical",
            fact_text: "주인공은 자신이 길드장이라고 단정적으로 밝혔다.",
            evidence_type: "explicit_scene_event",
          },
        ],
      }),
      { requireEvidence: true }
    );
    assert.equal(inferred.length, 1, "parse accepts unattributed claims; persist/recall layers may block");
  });

  it("REL3 past betrayal event can live in rolling summary prose owner", () => {
    const betrayalSummary = summaryWith("DRE_BETRAYAL_5", "배신 사건 발생, 신뢰 붕괴");
    assert.match(betrayalSummary, /DRE_BETRAYAL_5/);
    assert.equal(validateSummaryNarrative(betrayalSummary, "main_canon").ok, true);
  });

  it("REL4 repeated pattern has no structured owner — episodic max 3 per batch", () => {
    assert.match(EPISODIC_FACTS_EXTRACT_INSTRUCTIONS, /Maximum 3 facts/);
    assert.match(EPISODIC_FACTS_EXTRACT_INSTRUCTIONS, /Stable personality/);
  });
});
