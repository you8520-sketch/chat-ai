/**
 * DRE — durable relational experience investigation (production-path deterministic proofs).
 * SEXMEM*, MEMEXP*, DRE-PATH*, REL* — no provider HTTP.
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
import { after, afterEach, before, beforeEach, describe, it } from "node:test";
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
  summarizeEpisodicFactPersistCandidates,
} from "@/lib/episodicMemoryFacts";
import type { EpisodicExtractedFact } from "@/lib/memory/memory-episodic-types";
import {
  messagesToTurns,
  rawRecentTurnsToHistory,
  resolveLorebookExcludeFromTrimmedHistory,
  resolveProviderRawPoolExchangeCount,
} from "@/lib/hybridMemory";
import {
  __setEpisodicExtractCallerForTests,
  __resetEpisodicExtractCallCountForTests,
} from "@/lib/memory/memory-episodic-extract";
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
import { getOrCreateChatMemory, updateChatMemory } from "@/lib/memory/memory-db";
import { buildMemoryContextForChat } from "@/lib/memory/memory-manager";
import { reconcileMemoryAfterTurnDelete } from "@/lib/memory/memory-reconcile";
import { persistValidatedSummaryBatch } from "@/lib/memory/memory-summary-persist";
import {
  buildRollingSummarySystemPrompt,
  __setSummarizeTurnBatchCallerForTests,
  processRollingSummaryBatch,
  refreshRollingSummaryForRegeneratedAssistant,
} from "@/lib/memory/memory-rolling-summary";
import {
  listMemoryRecordsForChat,
  rebuildLorebookFromRecords,
} from "@/lib/memory/memory-turn-summary";
import { highestContiguousCompletedTurn } from "@/lib/memory/memory-summary-integrity";
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
const CHAR_NAME = "DreChar";

/** Trace markers embedded in real source dialogue — not summary-only injection. */
const PRIOR_INTIMACY = "DRE_PRIOR_INTIMACY_7";
const ROLE_USER_TOP = "DRE_ROLE_USER_TOP_9";
const ROLE_CHAR_BOTTOM = "DRE_ROLE_CHAR_BOTTOM_8";
const EXPLICIT_PREF = "DRE_EXPLICIT_PREF_CONTROL_3";
const HALLUC_REVERSE = "DRE_HALLUC_REVERSE_TOP";

const EPISODIC_RECALL_ENV = {
  NODE_ENV: "development",
  EPISODIC_MEMORY_RECALL_ENABLED: "1",
  EPISODIC_MEMORY_MIN_AGE_TURNS: "5",
} as NodeJS.ProcessEnv;

const SOURCE_INTIMACY_USER_LINE =
  `상호 합의하에 친밀한 관계를 맺자. ${PRIOR_INTIMACY} ` +
  `이번 장면에서는 내가 주도하고 네가 받아들이는 쪽으로 가자. ${ROLE_USER_TOP}`;

const SOURCE_INTIMACY_ASSISTANT_LINE =
  `알겠어. ${ROLE_CHAR_BOTTOM} 네가 주도하는 방향으로 받아들일게.`;

const SUMMARY_OMITS_CONTINUITY = summaryWith(
  "DRE_SUMMARY_OMIT_BATCH",
  "감정 변화와 대화 흐름만 기록하고 역할·친밀 사실은 생략"
);

function summaryWith(tag: string, extra = ""): string {
  return (
    `장면 요약: ${tag}. ${extra} ` +
    "추가 장식 없이 사실만 압축. 반복 묘사는 생략. 핵심 관계와 약속 상태를 유지한다. " +
    "인물의 감정 변화와 다음 장면 연결점을 짧게 기록한다. " +
    "동의·경계·후유증·공수 포지션은 다른 사건과 동일하게 보존한다."
  ).slice(0, ROLLING_SUMMARY_MAX_CHARS);
}

function roleEventFact(): EpisodicExtractedFact {
  return {
    category: "relationship",
    subject: "dre_char_user",
    attribute: "intimate_scene_role",
    value: "user_led_char_received",
    importance: "important",
    fact_text:
      `${ROLE_USER_TOP} 조건으로 유저가 주도하고 ${ROLE_CHAR_BOTTOM} 조건으로 캐릭터가 받아들인 친밀한 장면이 상호 합의 하에 있었다.`,
    evidence_type: "explicit_scene_event",
  };
}

function preferenceLockFact(): EpisodicExtractedFact {
  return {
    category: "relationship",
    subject: "dre_char_user",
    attribute: "relationship_dynamic",
    value: "domination",
    importance: "important",
    fact_text: "둘의 관계는 강압적인 지배 관계가 되었다.",
    evidence_type: "explicit_scene_event",
  };
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
  db.prepare(`INSERT OR IGNORE INTO characters (id, name) VALUES (?,?)`).run(CHAR, CHAR_NAME);
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

/** Insert playable turns; turn 3 carries real source intimacy + role facts. */
function insertPlayableTurnsWithSourceFact(totalCount: number): number[] {
  const db = getDb();
  db.prepare(`INSERT INTO messages (chat_id, role, content, model) VALUES (?,?,?,?)`).run(
    CHAT,
    "assistant",
    "opening greeting",
    "greeting"
  );
  const assistantIds: number[] = [];
  for (let t = 1; t <= totalCount; t++) {
    const userText =
      t === 3
        ? SOURCE_INTIMACY_USER_LINE
        : `user turn ${t}`;
    const assistantText =
      t === 3
        ? SOURCE_INTIMACY_ASSISTANT_LINE
        : `assistant turn ${t}`;
    db.prepare(`INSERT INTO messages (chat_id, role, content, model) VALUES (?,?,?,?)`).run(
      CHAT,
      "user",
      userText,
      "user"
    );
    const r = db
      .prepare(`INSERT INTO messages (chat_id, role, content, model) VALUES (?,?,?,?)`)
      .run(CHAT, "assistant", assistantText, "test");
    assistantIds.push(Number(r.lastInsertRowid));
  }
  updateChatMemory(CHAT, USER, CHAR, {
    message_count: totalCount,
    membership_tier: "free",
  });
  return assistantIds;
}

function loadMessageRows() {
  return getDb()
    .prepare(`SELECT role, content, model FROM messages WHERE chat_id=? ORDER BY id`)
    .all(CHAT) as { role: "user" | "assistant"; content: string; model?: string }[];
}

function summarizedTurnCount(): number {
  const rows = listMemoryRecordsForChat(CHAT);
  return highestContiguousCompletedTurn(rows, loadMessageRows().length);
}

async function runProductionSealBatch1(opts: {
  summaryText: string;
  episodicFacts: EpisodicExtractedFact[];
}): Promise<void> {
  __setSummarizeTurnBatchCallerForTests(async () => ({ text: opts.summaryText }));
  __setEpisodicExtractCallerForTests(async () => ({
    text: JSON.stringify({ extracted_facts: opts.episodicFacts }),
  }));
  const ok = await processRollingSummaryBatch({
    chatId: CHAT,
    userId: USER,
    characterId: CHAR,
    charName: CHAR_NAME,
    tier: "free",
    memoryCapacity: 8000,
  });
  assert.equal(ok, true, "processRollingSummaryBatch must seal turns 1–5");
}

async function assembleFinalMainRpContext(opts: {
  completedTurns: number;
  currentUserMessage: string;
}) {
  const rows = loadMessageRows();
  const turns = messagesToTurns(rows);
  const summarized = summarizedTurnCount();
  const rawPool = resolveProviderRawPoolExchangeCount({
    memoryFeatureEnabled: true,
    completedTurns: opts.completedTurns,
    summarizedTurnCount: summarized,
  });
  const raw = rawRecentTurnsToHistory(turns, rawPool, {
    summarizedTurnCount: summarized,
    memoryFeatureEnabled: true,
  });
  const cutoff = resolveLorebookExcludeFromTrimmedHistory(turns, raw) ?? summarized + 1;
  const injection = await buildMemoryContextForChat({
    chatId: CHAT,
    userId: USER,
    characterId: CHAR,
    tier: "free",
    memoryCapacity: 8000,
    userMessage: opts.currentUserMessage,
    excludeSummaryTurnStartGte: cutoff,
  });
  const relationshipMemoryForPrompt = formatMemoryMetaForPrompt(
    normalizeMemoryMeta(parseMemoryMeta("{}"), { charName: CHAR_NAME, userName: "유저" })
  );
  const db = getDb();
  const episodicMemory = getEpisodicMemoryForPrompt(
    db,
    {
      chatId: CHAT,
      characterId: CHAR,
      userId: USER,
      currentTurn: opts.completedTurns + 1,
      currentUserMessage: opts.currentUserMessage,
      recentChatText: raw.map((m) => m.content).join("\n"),
      longTermMemoryText: [injection.text, injection.archiveText].filter(Boolean).join("\n"),
      relationshipMemoryText: relationshipMemoryForPrompt ?? "",
      lorebookText: "",
      triggeredEventText: "",
    },
    EPISODIC_RECALL_ENV
  );
  const built = buildContext({
    charName: CHAR_NAME,
    chunks: [],
    userNickname: "유저",
    shortTermHistory: raw,
    currentUserMessage: opts.currentUserMessage,
    longTermMemory: injection.text,
    archiveMemory: injection.archiveText,
    episodicMemoryBlock: episodicMemory.promptBlock,
    memoryMeta: relationshipMemoryForPrompt ?? undefined,
    nsfw: true,
    provider: "openrouter",
    completedTurns: opts.completedTurns,
    summarizedTurnCount: summarized,
  });
  return {
    built,
    rawText: raw.map((m) => m.content).join("\n"),
    ltmText: injection.text,
    episodicBlock: episodicMemory.promptBlock,
    episodicFacts: episodicMemory.facts,
    cutoff,
    trackedSections: built.meta.trackedSections ?? [],
  };
}

function episodicRetrievedFactsSection(
  sections: { id: string; label: string }[]
): { id: string; label: string } | undefined {
  return sections.find((section) => section.id === "episodic-memory-retrieved-facts");
}

before(() => installIsolatedTestDatabase());
after(() => uninstallIsolatedTestDatabase());
beforeEach(() => {
  cleanup();
  seedChat();
});
afterEach(() => {
  __setSummarizeTurnBatchCallerForTests(null);
  __setEpisodicExtractCallerForTests(null);
  __resetEpisodicExtractCallCountForTests();
});

describe("DRE-PATH — production seal dual-path proof", () => {
  it("DRE-PATH-1 summary omission + episodic preserve → fact survives via [3a] after RAW4 exit", async () => {
    insertPlayableTurnsWithSourceFact(10);
    await runProductionSealBatch1({
      summaryText: SUMMARY_OMITS_CONTINUITY,
      episodicFacts: [roleEventFact()],
    });

    const ctx = await assembleFinalMainRpContext({
      completedTurns: 10,
      currentUserMessage: "다시 가까워진다.",
    });

    assert.doesNotMatch(ctx.rawText, new RegExp(ROLE_USER_TOP));
    assert.doesNotMatch(ctx.rawText, new RegExp(PRIOR_INTIMACY));
    assert.doesNotMatch(ctx.ltmText, new RegExp(ROLE_USER_TOP));
    assert.doesNotMatch(ctx.ltmText, new RegExp(PRIOR_INTIMACY));
    assert.match(ctx.episodicBlock, /\[EPISODIC MEMORY - RETRIEVED FACTS\]/);
    assert.match(ctx.episodicBlock, new RegExp(ROLE_USER_TOP));
    assert.match(ctx.built.systemPrompt, /\[EPISODIC MEMORY - RETRIEVED FACTS\]/);
    assert.match(ctx.built.systemPrompt, new RegExp(ROLE_USER_TOP));
    assert.equal(episodicRetrievedFactsSection(ctx.trackedSections)?.label, "[3a] Episodic memory retrieved facts");
    assert.equal(ctx.episodicFacts.length, 1);
  });

  it("DRE-PATH-2 summary omission + episodic omission → DURABLE LOSS CONDITION PROVEN", async () => {
    insertPlayableTurnsWithSourceFact(10);
    await runProductionSealBatch1({
      summaryText: SUMMARY_OMITS_CONTINUITY,
      episodicFacts: [],
    });

    const ctx = await assembleFinalMainRpContext({
      completedTurns: 10,
      currentUserMessage: "새로운 친밀한 장면",
    });

    assert.doesNotMatch(ctx.rawText, new RegExp(PRIOR_INTIMACY));
    assert.doesNotMatch(ctx.ltmText, new RegExp(PRIOR_INTIMACY));
    assert.doesNotMatch(ctx.ltmText, new RegExp(ROLE_USER_TOP));
    assert.equal(ctx.episodicFacts.length, 0);
    assert.equal(ctx.episodicBlock, "");
    assert.doesNotMatch(ctx.built.systemPrompt, new RegExp(PRIOR_INTIMACY));
    assert.doesNotMatch(ctx.built.systemPrompt, new RegExp(ROLE_USER_TOP));
  });

  it("DRE-PATH-4 role historical event persist/recall without preference lock-in", () => {
    const event = roleEventFact();
    const parsed = parseEpisodicExtractedFacts(
      JSON.stringify({ extracted_facts: [event] })
    );
    assert.equal(parsed.length, 1);
    assert.equal(detectAbstractPsychologicalInference(parsed[0]!), null);

    const persistSummary = summarizeEpisodicFactPersistCandidates([event], {
      batchUserSources: [{ turn: 3, messageId: null, text: SOURCE_INTIMACY_USER_LINE }],
    });
    assert.equal(persistSummary.insertableCount, 1);
    assert.equal(detectAbstractPsychologicalInference(preferenceLockFact()), "abstract_psychological_inference");
    assert.equal(
      summarizeEpisodicFactPersistCandidates([preferenceLockFact()]).insertableCount,
      0
    );

    const db = new Database(":memory:");
    ensureEpisodicMemoryFactsTable(db);
    db.exec(
      `CREATE TABLE chat_memories (chat_id INTEGER PRIMARY KEY, memory_reset_after_message_id INTEGER, memory_epoch INTEGER NOT NULL DEFAULT 0)`
    );
    assert.equal(
      persistEpisodicMemoryFactsBestEffort(db, {
        chatId: 1,
        characterId: CHAR,
        userId: USER,
        sourceTurn: 5,
        facts: [event],
        replaceSummarySealBatch: { batchStart: 1, batchEnd: 5 },
      }),
      1
    );
    const recall = getEpisodicMemoryForPrompt(
      db,
      {
        chatId: 1,
        characterId: CHAR,
        userId: USER,
        currentTurn: 11,
        currentUserMessage: "다시",
        recentChatText: "user turn 10",
        longTermMemoryText: SUMMARY_OMITS_CONTINUITY,
        relationshipMemoryText: "",
        lorebookText: "",
        triggeredEventText: "",
      },
      EPISODIC_RECALL_ENV
    );
    assert.equal(recall.facts.length, 1);
    assert.match(recall.promptBlock, new RegExp(ROLE_USER_TOP));
  });

  it("DRE-PATH-6 false history — summary can canonize assistant hallucination; episodic keeps attribution", async () => {
    const db = getDb();
    db.prepare("DELETE FROM messages WHERE chat_id=?").run(CHAT);
    db.prepare(`INSERT INTO messages (chat_id, role, content, model) VALUES (?,?,?,?)`).run(
      CHAT,
      "assistant",
      "opening",
      "greeting"
    );
    for (let t = 1; t <= 10; t++) {
      const userText = t === 3 ? SOURCE_INTIMACY_USER_LINE : `user ${t}`;
      const assistantText =
        t === 3
          ? `${HALLUC_REVERSE} 캐릭터가 주도하고 유저가 받아들였다.`
          : `assistant ${t}`;
      db.prepare(`INSERT INTO messages (chat_id, role, content, model) VALUES (?,?,?,?)`).run(
        CHAT,
        "user",
        userText,
        "user"
      );
      db.prepare(`INSERT INTO messages (chat_id, role, content, model) VALUES (?,?,?,?)`).run(
        CHAT,
        "assistant",
        assistantText,
        "test"
      );
    }
    updateChatMemory(CHAT, USER, CHAR, { message_count: 10, membership_tier: "free" });

    const summaryWithHalluc = summaryWith(
      "DRE_HALLUC_SUMMARY",
      `${HALLUC_REVERSE} 캐릭터가 주도했고 유저가 받아들였다`
    );
    const hallucClaim: EpisodicExtractedFact = {
      category: "character",
      subject: "dre_char",
      attribute: "scene_role_claim",
      value: "char_led",
      importance: "important",
      fact_text: "캐릭터는 자신이 주도하고 유저가 받아들였다고 말했다.",
      evidence_type: "explicit_character_claim",
    };
    const userEvent: EpisodicExtractedFact = roleEventFact();

    await runProductionSealBatch1({
      summaryText: summaryWithHalluc,
      episodicFacts: [hallucClaim, userEvent],
    });

    const lore = rebuildLorebookFromRecords(CHAT);
    assert.match(lore, new RegExp(HALLUC_REVERSE));

    const persistHalluc = summarizeEpisodicFactPersistCandidates([hallucClaim], {
      batchUserSources: [{ turn: 3, messageId: null, text: SOURCE_INTIMACY_USER_LINE }],
    });
    assert.equal(persistHalluc.insertableCount, 1, "attributed character claim passes persist filter");

    const ctx = await assembleFinalMainRpContext({
      completedTurns: 10,
      currentUserMessage: "이어서",
    });
    assert.match(ctx.episodicBlock, /\[EPISODIC MEMORY - RETRIEVED FACTS\]/);
    assert.match(ctx.episodicBlock, /말했다/);
    assert.match(ctx.episodicBlock, new RegExp(ROLE_USER_TOP));
    assert.match(ctx.built.systemPrompt, /\[EPISODIC MEMORY - RETRIEVED FACTS\]/);
    assert.match(ctx.ltmText, new RegExp(HALLUC_REVERSE), "rolling summary canonizes assistant hallucination in LTM");
    assert.equal(episodicRetrievedFactsSection(ctx.trackedSections)?.label, "[3a] Episodic memory retrieved facts");
  });

  it("DRE-PATH-7 regen replaces summary but leaves stale episodic until empty extract clears batch (production gap)", async () => {
    const assistantIds = insertPlayableTurnsWithSourceFact(10);
    await runProductionSealBatch1({
      summaryText: summaryWith(PRIOR_INTIMACY, "첫 친밀"),
      episodicFacts: [roleEventFact()],
    });
    assert.equal(
      (getDb().prepare("SELECT COUNT(*) AS n FROM episodic_memory_facts WHERE chat_id=?").get(CHAT) as { n: number }).n,
      1
    );

    getDb()
      .prepare(`UPDATE messages SET content=? WHERE id=?`)
      .run("assistant turn 3 revised — no intimacy", assistantIds[2]!);

    __setSummarizeTurnBatchCallerForTests(async () => ({
      text: summaryWith("DRE_REGEN_REPLACED", "친밀 사건 없음"),
    }));
    __setEpisodicExtractCallerForTests(async () => ({
      text: JSON.stringify({ extracted_facts: [] }),
    }));
    const ok = await refreshRollingSummaryForRegeneratedAssistant({
      chatId: CHAT,
      userId: USER,
      characterId: CHAR,
      charName: CHAR_NAME,
      tier: "free",
      memoryCapacity: 8000,
      assistantMessageId: assistantIds[2]!,
    });
    assert.equal(ok, true);

    const lore = rebuildLorebookFromRecords(CHAT);
    assert.match(lore, /DRE_REGEN_REPLACED/);
    assert.doesNotMatch(lore, new RegExp(PRIOR_INTIMACY));

    const episodicCount = (
      getDb().prepare("SELECT COUNT(*) AS n FROM episodic_memory_facts WHERE chat_id=?").get(CHAT) as { n: number }
    ).n;
    assert.equal(
      episodicCount,
      1,
      "production regen with empty episodic extract does not invalidate prior summary_seal_batch rows"
    );

    const ctx = await assembleFinalMainRpContext({
      completedTurns: 10,
      currentUserMessage: "이어서",
    });
    assert.match(ctx.episodicBlock, new RegExp(ROLE_USER_TOP), "stale role episodic still injects after regen");
    assert.doesNotMatch(ctx.ltmText, new RegExp(PRIOR_INTIMACY), "summary side was replaced");
  });

  it("DRE-PATH-7b delete last turn preserves earlier sealed memory (production reconcile)", async () => {
    insertPlayableTurnsWithSourceFact(10);
    await runProductionSealBatch1({
      summaryText: summaryWith(PRIOR_INTIMACY),
      episodicFacts: [roleEventFact()],
    });
    persistValidatedSummaryBatch({
      chatId: CHAT,
      userId: USER,
      characterId: CHAR,
      tier: "free",
      turnStart: 6,
      turnEnd: 10,
      assistantMessageId: null,
      summary: summaryWith("DRE_LATER_BATCH", "후속"),
      summaryKind: "main_canon",
      scopePayload: { v: 1, scopes: { main_canon: summaryWith("DRE_LATER_BATCH") } },
      playableTurnCount: 10,
    });

    const db = getDb();
    const lastUser = db
      .prepare(`SELECT id FROM messages WHERE chat_id=? AND role='user' ORDER BY id DESC LIMIT 1`)
      .get(CHAT) as { id: number };
    const lastAssistant = db
      .prepare(`SELECT id FROM messages WHERE chat_id=? AND role='assistant' AND model='test' ORDER BY id DESC LIMIT 1`)
      .get(CHAT) as { id: number };
    db.prepare(`DELETE FROM messages WHERE id IN (?,?)`).run(lastUser.id, lastAssistant.id);

    reconcileMemoryAfterTurnDelete({
      chatId: CHAT,
      userId: USER,
      characterId: CHAR,
      charName: CHAR_NAME,
      tier: "free",
      memoryCapacity: 8000,
      deletedUserMessageId: lastUser.id,
      deletedAssistantMessageId: lastAssistant.id,
      deletedPlayableTurn: 10,
    });

    const lore = rebuildLorebookFromRecords(CHAT);
    assert.match(lore, new RegExp(PRIOR_INTIMACY));
  });
});

describe("SEXMEM — structural owner fixtures", () => {
  it("SEXMEM1 prior intimacy survives RAW4 exit when rolling summary preserves it", async () => {
    insertPlayableTurnsWithSourceFact(10);
    persistValidatedSummaryBatch({
      chatId: CHAT,
      userId: USER,
      characterId: CHAR,
      tier: "free",
      turnStart: 1,
      turnEnd: 5,
      assistantMessageId: null,
      summary: summaryWith(PRIOR_INTIMACY, "source turn 3 had intimacy"),
      summaryKind: "main_canon",
      scopePayload: { v: 1, scopes: { main_canon: summaryWith(PRIOR_INTIMACY) } },
      playableTurnCount: 10,
    });

    const turns = messagesToTurns(loadMessageRows());
    const raw = rawRecentTurnsToHistory(turns, RAW_HISTORY_COMPLETE_EXCHANGES, {
      summarizedTurnCount: 5,
      memoryFeatureEnabled: true,
    });
    assert.doesNotMatch(raw.map((m) => m.content).join("\n"), new RegExp(PRIOR_INTIMACY));
    const cutoff = resolveLorebookExcludeFromTrimmedHistory(turns, raw) ?? 6;
    const injection = await buildMemoryContextForChat({
      chatId: CHAT,
      userId: USER,
      characterId: CHAR,
      tier: "free",
      memoryCapacity: 8000,
      userMessage: "다시",
      excludeSummaryTurnStartGte: cutoff,
    });
    assert.match(injection.text, new RegExp(PRIOR_INTIMACY));
  });

  it("SEXMEM2 role continuity has no relationship-memory owner", () => {
    const meta = mergeMemoryMeta(parseMemoryMeta("{}"), {
      items: ["유저: 열쇠"],
      promisesAdd: [{ text: "다음에 다시 만나자" }],
    });
    const promptMeta = formatMemoryMetaForPrompt(
      normalizeMemoryMeta(meta, { charName: CHAR_NAME, userName: "유저" })
    );
    assert.ok(promptMeta);
    assert.doesNotMatch(promptMeta!, new RegExp(ROLE_USER_TOP));
    assert.match(RELATIONSHIP_MEMORY_SELF_EXTRACT_BLOCK, /Forbidden auto extraction/);
  });

  it("SEXMEM3 false-memory policy partial — no personality-based past inference rule", () => {
    assert.match(NO_FALSE_SHARED_MEMORY_RULE, /없는 일을/);
    assert.doesNotMatch(NO_FALSE_SHARED_MEMORY_RULE, /현재 성격/);
  });

  it("SEXMEM4 marker-only summary without source fact is NOT end-to-end loss proof", async () => {
    insertPlayableTurns(10);
    persistValidatedSummaryBatch({
      chatId: CHAT,
      userId: USER,
      characterId: CHAR,
      tier: "free",
      turnStart: 1,
      turnEnd: 5,
      assistantMessageId: null,
      summary: summaryWith("일반 대화", "친밀 없음"),
      summaryKind: "main_canon",
      scopePayload: { v: 1, scopes: { main_canon: summaryWith("일반 대화") } },
      playableTurnCount: 10,
    });
    const injection = await buildMemoryContextForChat({
      chatId: CHAT,
      userId: USER,
      characterId: CHAR,
      tier: "free",
      memoryCapacity: 8000,
      userMessage: "새 장면",
    });
    assert.doesNotMatch(injection.text, new RegExp(PRIOR_INTIMACY));
    assert.doesNotMatch(loadMessageRows().map((r) => r.content).join("\n"), new RegExp(PRIOR_INTIMACY));
  });

  it("SEXMEM5–7 episodic epistemics unchanged", () => {
    assert.equal(detectAbstractPsychologicalInference(preferenceLockFact()), "abstract_psychological_inference");
    assert.match(EPISODIC_FACTS_EXTRACT_INSTRUCTIONS, /Maximum 3 facts/);
    const pref = parseEpisodicExtractedFacts(
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
    assert.equal(pref.length, 1);
  });
});

/** Generic playable turns without embedded source intimacy/role facts. */
function insertPlayableTurns(count: number): void {
  const db = getDb();
  db.prepare(`INSERT INTO messages (chat_id, role, content, model) VALUES (?,?,?,?)`).run(
    CHAT,
    "assistant",
    "opening greeting",
    "greeting"
  );
  for (let t = 1; t <= count; t++) {
    db.prepare(`INSERT INTO messages (chat_id, role, content, model) VALUES (?,?,?,?)`).run(
      CHAT,
      "user",
      `user turn ${t}`,
      "user"
    );
    db.prepare(`INSERT INTO messages (chat_id, role, content, model) VALUES (?,?,?,?)`).run(
      CHAT,
      "assistant",
      `assistant turn ${t}`,
      "test"
    );
  }
  updateChatMemory(CHAT, USER, CHAR, {
    message_count: count,
    membership_tier: "free",
  });
}

describe("Summary compression audit", () => {
  it("validation accepts summary that omits source role markers", () => {
    const sourceDialogue = `[user] ${ROLE_USER_TOP} ${PRIOR_INTIMACY}`;
    const badSummary = SUMMARY_OMITS_CONTINUITY;
    assert.equal(validateSummaryNarrative(badSummary, "main_canon").ok, true);
    assert.equal(isRollingSummaryGroundedInDialogue(badSummary, sourceDialogue), true);
    assert.doesNotMatch(badSummary, new RegExp(ROLE_USER_TOP));
  });

  it("rolling summary prompt lists intimacy/role preserve targets", () => {
    const prompt = buildRollingSummarySystemPrompt(ROLLING_SUMMARY_INTERVAL);
    assert.match(prompt, /공수 포지션/);
    assert.match(prompt, /동의·경계/);
  });
});

describe("MEMEXP — regression gates", () => {
  it("MEMEXP1 prior experience via summary after RAW4 exit", async () => {
    insertPlayableTurnsWithSourceFact(8);
    persistValidatedSummaryBatch({
      chatId: CHAT,
      userId: USER,
      characterId: CHAR,
      tier: "free",
      turnStart: 1,
      turnEnd: 5,
      assistantMessageId: null,
      summary: summaryWith(PRIOR_INTIMACY),
      summaryKind: "main_canon",
      scopePayload: { v: 1, scopes: { main_canon: summaryWith(PRIOR_INTIMACY) } },
      playableTurnCount: 8,
    });
    const turns = messagesToTurns(loadMessageRows());
    const raw = rawRecentTurnsToHistory(turns, RAW_HISTORY_COMPLETE_EXCHANGES, {
      summarizedTurnCount: 5,
      memoryFeatureEnabled: true,
    });
    const lore = rebuildLorebookFromRecords(CHAT, {
      excludeTurnStartGte: resolveLorebookExcludeFromTrimmedHistory(turns, raw) ?? 6,
    });
    assert.match(lore, new RegExp(PRIOR_INTIMACY));
  });

  it("MEMEXP2–6 structural gates", () => {
    assert.doesNotMatch(
      formatMemoryMetaForPrompt(parseMemoryMeta("{}")) ?? "",
      /top|bottom|공수/
    );
    assert.match(NO_FALSE_SHARED_MEMORY_RULE, /없는 일을/);
    assert.equal(detectAbstractPsychologicalInference(preferenceLockFact()), "abstract_psychological_inference");
    assert.equal(
      resolveProviderRawPoolExchangeCount({
        memoryFeatureEnabled: true,
        completedTurns: 12,
        summarizedTurnCount: 4,
      }),
      8
    );
  });

  it("MEMEXP8 anti-fixation in IMMERSIVE PROSE", () => {
    assert.match(IMMERSIVE_PROSE_BLOCK, /매 턴 의무적으로 회상하지 않는다/);
  });

  it("MEMEXP10 reconvergence provenance unchanged", () => {
    assert.equal(
      extractReconvergenceHooks({ memoryText: "우리는 친밀하다.", currentTurn: 1 }).length,
      0
    );
  });
});

describe("REL — generalized (not end-to-end loss without DRE-PATH-2)", () => {
  it("REL1 summary-only omission without source fact is insufficient loss proof", async () => {
    insertPlayableTurns(8);
    persistValidatedSummaryBatch({
      chatId: CHAT,
      userId: USER,
      characterId: CHAR,
      tier: "free",
      turnStart: 1,
      turnEnd: 5,
      assistantMessageId: null,
      summary: summaryWith("DRE_NO_INTIMACY_MILESTONE"),
      summaryKind: "main_canon",
      scopePayload: { v: 1, scopes: { main_canon: summaryWith("DRE_NO_INTIMACY_MILESTONE") } },
      playableTurnCount: 8,
    });
    const injection = await buildMemoryContextForChat({
      chatId: CHAT,
      userId: USER,
      characterId: CHAR,
      tier: "free",
      memoryCapacity: 8000,
      userMessage: "입을 맞춘다.",
    });
    assert.doesNotMatch(injection.text, new RegExp(PRIOR_INTIMACY));
  });

  it("REL3–4 structural", () => {
    assert.equal(validateSummaryNarrative(summaryWith("DRE_BETRAYAL_5"), "main_canon").ok, true);
    assert.match(EPISODIC_FACTS_EXTRACT_INSTRUCTIONS, /Stable personality/);
  });
});
