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
import { mkdirSync, writeFileSync } from "node:fs";
import { after, before, describe, it } from "node:test";
import { AI_LEARNING_LIMIT } from "@/lib/characterFormLimits";
import { formatMemoryMetaForPrompt } from "@/lib/chatMemory";
import { MAIN_RP_USER_SELECTABLE_OPTIONS } from "@/lib/chatModels";
import { getDb } from "@/lib/db";
import { getEpisodicMemoryForPrompt } from "@/lib/episodicMemoryFacts";
import {
  messagesToTurns,
  rawRecentTurnsToHistory,
  resolveLorebookExcludeFromTrimmedHistory,
  resolveProviderRawPoolExchangeCount,
} from "@/lib/hybridMemory";
import { splitAndNormalizeRelationshipMemoryTail } from "@/lib/relationshipMemoryTail";
import {
  installIsolatedTestDatabase,
  uninstallIsolatedTestDatabase,
} from "@/lib/test/isolatedTestDatabase";
import { buildContext } from "@/services/contextBuilder";
import {
  ARCHIVE_CAPACITY_FIXED,
  MEMORY_CAPACITY_FIXED,
} from "./memory-capacity-shared";
import {
  MEMORY_POLICY_ID,
  RAW_HISTORY_COMPLETE_EXCHANGES,
  ROLLING_SUMMARY_INTERVAL,
  ROLLING_SUMMARY_MAX_CHARS,
} from "./memory-constants";
import { getOrCreateChatMemory, updateChatMemory } from "./memory-db";
import { resolveGlobalCurrentMemory } from "./memory-lorebook-resolve";
import { buildMemoryContextForChat } from "./memory-manager";
import {
  applyRelationshipDeltaToChat,
  loadChatRelationshipMeta,
} from "./memory-relationship-meta";
import {
  __getLastSummarizeTurnBatchError,
  __setSummarizeTurnBatchCallerForTests,
  processRollingSummaryBatch,
  refreshRollingSummaryForRegeneratedAssistant,
} from "./memory-rolling-summary";
import { highestContiguousCompletedTurn } from "./memory-summary-integrity";
import { listMemoryRecordsForChat } from "./memory-turn-summary";

/**
 * 50 completed Main RP turns, then the next user message.
 * Facts sit on batch-start turns so an extractive summary keeps them at the prefix.
 * Ages are counted from the incoming turn (51), after batches 1–10 have sealed.
 */
const CHAT = 910501;
const USER = 910502;
const CHAR = 910503;
const CHAR_NAME = "카엘";
const USER_NAME = "렌";
const COMPLETED_TURNS = 50;
const NAMES = { charName: CHAR_NAME, userName: USER_NAME };

const PROMISE = "겨울이 오기 전에 셋째 요새의 봉인 조각을 모은다";
const OLD_REL = "카엘은 리안을 아직 서기로만 대한다";
const NEW_REL = "카엘은 리안을 신뢰하며 이름을 부른다";

const MARK_PROMISE_50 = "MARK_PROMISE_50";
const MARK_NPC_30 = "MARK_NPC_30";
const MARK_WORLD_20 = "MARK_WORLD_20";
const MARK_REL_10 = "MARK_REL_10";
const MARK_NOW_5 = "MARK_NOW_5";
const MARK_CORE_10K = "MARK_CORE_10K";

const FACTS = [
  {
    id: "promise_50",
    turn: 1,
    ageTurns: 50,
    marker: MARK_PROMISE_50,
    user: `${MARK_PROMISE_50} ${PROMISE}고 약속했다.`,
  },
  {
    id: "npc_30",
    turn: 21,
    ageTurns: 30,
    marker: MARK_NPC_30,
    user: `${MARK_NPC_30} 리안은 아직 서기이다. ${OLD_REL}.`,
  },
  {
    id: "world_20",
    turn: 31,
    ageTurns: 20,
    marker: MARK_WORLD_20,
    user: `${MARK_WORLD_20} 원로원 문서가 기사단 예산을 삭감했다.`,
  },
  {
    id: "rel_10",
    turn: 41,
    ageTurns: 10,
    marker: MARK_REL_10,
    user: `${MARK_REL_10} 관계는 경계에서 신뢰로 바뀌었다. ${NEW_REL}.`,
  },
  {
    id: "now_5",
    turn: 46,
    ageTurns: 5,
    marker: MARK_NOW_5,
    user: `${MARK_NOW_5} 셋째 요새의 깨끗한 붕대가 열아홉 장으로 줄었다.`,
  },
] as const;

const CORE_SETTING = `${MARK_CORE_10K} 카엘은 셋째 요새의 기사다. 리안은 요새 서기다. 핵심 설정은 만 자 상한 안에 있다.`;

const INCOMING_USER = "봉인 조각을 지금 어디에 두었는지 확인한다.";

const EPISODIC_RECALL_ENV = {
  NODE_ENV: "development",
  EPISODIC_MEMORY_RECALL_ENABLED: "1",
  EPISODIC_MEMORY_MIN_AGE_TURNS: "5",
} as NodeJS.ProcessEnv;

type PlayableRow = {
  turn: number;
  userId: number;
  assistantId: number;
  user: string;
  assistant: string;
};

let summarizerCalls = 0;

function fillerUser(turn: number): string {
  return `장면${String(turn).padStart(2, "0")} 골목 등잔이 흔들리고 발소리가 멀어진다.`;
}

function userTextForTurn(turn: number): string {
  return FACTS.find((fact) => fact.turn === turn)?.user ?? fillerUser(turn);
}

function assistantTextForTurn(turn: number): string {
  const prose = `${CHAR_NAME}이 장면${String(turn).padStart(2, "0")}을 짧게 받아 적었다.`;
  if (turn === 1) {
    return `${prose}\n${JSON.stringify({ promisesAdd: [{ text: PROMISE }] })}`;
  }
  if (turn === 21) {
    return `${prose}\n${JSON.stringify({ promisesAdd: [{ text: OLD_REL }] })}`;
  }
  if (turn === 41) {
    return `${prose}\n${JSON.stringify({
      promisesRemove: [OLD_REL],
      promisesAdd: [{ text: NEW_REL }],
    })}`;
  }
  return prose;
}

/** Copies `유저:` lines from the batch dialogue the real summarizer receives. */
function extractiveFakeSummary(userContent: string): string {
  const lines = [...userContent.matchAll(/^유저:\s*(.+)$/gm)].map((match) => match[1]!.trim());
  if (lines.length === 0) {
    throw new Error("extractive fake found no 유저 lines");
  }
  let text = lines.join(" ");
  if (text.length < 80) text = `${text} ${text}`.trim();
  return text;
}

function cleanup() {
  const db = getDb();
  db.prepare("DELETE FROM episodic_memory_facts WHERE chat_id=?").run(CHAT);
  db.prepare("DELETE FROM chat_turn_summaries WHERE chat_id=?").run(CHAT);
  db.prepare("DELETE FROM chat_memories WHERE chat_id=?").run(CHAT);
  db.prepare("DELETE FROM messages WHERE chat_id=?").run(CHAT);
  db.prepare("DELETE FROM chats WHERE id=?").run(CHAT);
  db.prepare("DELETE FROM users WHERE id=?").run(USER);
  db.prepare("DELETE FROM characters WHERE id=?").run(CHAR);
}

function seedChat(): PlayableRow[] {
  cleanup();
  const db = getDb();
  db.prepare(`INSERT INTO users (id, email, nickname, pw_hash) VALUES (?,?,?,?)`).run(
    USER,
    `life-${USER}@test.local`,
    USER_NAME,
    "x"
  );
  db.prepare(`INSERT INTO characters (id, name) VALUES (?,?)`).run(CHAR, CHAR_NAME);
  db.prepare(`INSERT INTO chats (id, user_id, character_id, mode) VALUES (?,?,?,'safe')`).run(
    CHAT,
    USER,
    CHAR
  );
  getOrCreateChatMemory(CHAT, USER, CHAR, "pro");

  db.prepare(`INSERT INTO messages (chat_id, role, content, model) VALUES (?,?,?,?)`).run(
    CHAT,
    "assistant",
    "인사.",
    "greeting"
  );

  const rows: PlayableRow[] = [];
  for (let turn = 1; turn <= COMPLETED_TURNS; turn++) {
    const user = userTextForTurn(turn);
    const assistant = assistantTextForTurn(turn);
    const userId = Number(
      db.prepare(`INSERT INTO messages (chat_id, role, content, model) VALUES (?,?,?,?)`).run(
        CHAT,
        "user",
        user,
        "user"
      ).lastInsertRowid
    );
    const assistantId = Number(
      db.prepare(
        `INSERT INTO messages (chat_id, role, content, model, user_message_id) VALUES (?,?,?,?,?)`
      ).run(CHAT, "assistant", assistant, "test", userId).lastInsertRowid
    );
    rows.push({ turn, userId, assistantId, user, assistant });
  }
  updateChatMemory(CHAT, USER, CHAR, { message_count: COMPLETED_TURNS, membership_tier: "pro" });
  return rows;
}

function freezeFrontier(): void {
  getDb()
    .prepare(
      `INSERT INTO messages (chat_id, role, content, model, generation_status) VALUES (?,?,?,'user','submitted')`
    )
    .run(CHAT, "user", INCOMING_USER);
}

function applyRelationshipTails(rows: PlayableRow[]): void {
  for (const row of rows) {
    if (row.turn !== 1 && row.turn !== 21 && row.turn !== 41) continue;
    const split = splitAndNormalizeRelationshipMemoryTail(row.assistant, row.user, NAMES);
    assert.equal(split.parseOk, true, `relationship tail parse failed on turn ${row.turn}`);
    const applied = applyRelationshipDeltaToChat({
      chatId: CHAT,
      names: NAMES,
      delta: split.delta,
      sourceUserMessageId: row.userId,
      assistantMessageId: row.assistantId,
    });
    assert.equal(applied.accepted, true, `relationship delta rejected on turn ${row.turn}`);
  }
}

before(() => installIsolatedTestDatabase());
after(() => {
  __setSummarizeTurnBatchCallerForTests(null);
  cleanup();
  uninstallIsolatedTestDatabase();
});

describe("50-turn memory lifecycle (provider-free)", () => {
  it("seals, stores, and reinjects facts after raw history drops them", async () => {
    assert.equal(AI_LEARNING_LIMIT, 10000);
    assert.equal(MEMORY_CAPACITY_FIXED, 10000);
    assert.equal(ARCHIVE_CAPACITY_FIXED, 3000);
    assert.equal(MEMORY_POLICY_ID, "summary5_raw4");
    assert.equal(ROLLING_SUMMARY_INTERVAL, 5);
    assert.equal(RAW_HISTORY_COMPLETE_EXCHANGES, 4);
    assert.equal(ROLLING_SUMMARY_MAX_CHARS, 600);
    assert.ok(CORE_SETTING.length < AI_LEARNING_LIMIT);
    assert.deepEqual(
      MAIN_RP_USER_SELECTABLE_OPTIONS.map((option) => option.id),
      [
        "deepseek-v4.1-flash",
        "gemini-3.8-flash",
        "gpt-6.1-sol",
        "claude-opus-5.5",
      ]
    );

    const rows = seedChat();
    applyRelationshipTails(rows);
    freezeFrontier();

    summarizerCalls = 0;
    __setSummarizeTurnBatchCallerForTests(async (_system, history) => {
      summarizerCalls += 1;
      const userContent = history.map((message) => message.content).join("\n");
      return { text: extractiveFakeSummary(userContent) };
    });

    let sealedRounds = 0;
    for (let round = 0; round < 12; round++) {
      const sealed = await processRollingSummaryBatch({
        chatId: CHAT,
        userId: USER,
        characterId: CHAR,
        charName: CHAR_NAME,
        tier: "pro",
        memoryCapacity: MEMORY_CAPACITY_FIXED,
      });
      if (!sealed) break;
      sealedRounds += 1;
    }

    const records = listMemoryRecordsForChat(CHAT).filter((record) => !record.inactive);
    const messageRows = getDb()
      .prepare(`SELECT role, content, model FROM messages WHERE chat_id=? ORDER BY id`)
      .all(CHAT) as { role: "user" | "assistant"; content: string; model?: string }[];
    const summarized = highestContiguousCompletedTurn(records, COMPLETED_TURNS);
    assert.equal(
      sealedRounds,
      10,
      `expected 10 seals, got ${sealedRounds}; lastError=${__getLastSummarizeTurnBatchError()}`
    );
    assert.equal(summarizerCalls, 10);
    assert.equal(records.length, 10);
    assert.equal(summarized, COMPLETED_TURNS);

    const turns = messagesToTurns(messageRows);
    const rawPool = resolveProviderRawPoolExchangeCount({
      memoryFeatureEnabled: true,
      completedTurns: COMPLETED_TURNS,
      summarizedTurnCount: summarized,
    });
    const rawHistory = rawRecentTurnsToHistory(turns, rawPool, {
      summarizedTurnCount: summarized,
      memoryFeatureEnabled: true,
    });
    const excludeTurnStartGte = resolveLorebookExcludeFromTrimmedHistory(turns, rawHistory);
    assert.equal(rawPool, RAW_HISTORY_COMPLETE_EXCHANGES);
    assert.equal(excludeTurnStartGte, 47);

    const resolved = resolveGlobalCurrentMemory(CHAT, MEMORY_CAPACITY_FIXED, {
      excludeTurnStartGte,
    });
    const injection = await buildMemoryContextForChat({
      chatId: CHAT,
      userId: USER,
      characterId: CHAR,
      tier: "pro",
      memoryCapacity: MEMORY_CAPACITY_FIXED,
      userMessage: INCOMING_USER,
      excludeSummaryTurnStartGte: excludeTurnStartGte,
      modelId: "deepseek-v4.1-flash",
      provider: "cheaperinference",
    });
    const reconnect = await buildMemoryContextForChat({
      chatId: CHAT,
      userId: USER,
      characterId: CHAR,
      tier: "pro",
      memoryCapacity: MEMORY_CAPACITY_FIXED,
      userMessage: INCOMING_USER,
      excludeSummaryTurnStartGte: excludeTurnStartGte,
      modelId: "deepseek-v4.1-flash",
      provider: "cheaperinference",
    });
    assert.equal(reconnect.text, injection.text);
    assert.equal(reconnect.mediumTermText, injection.mediumTermText);
    assert.equal(reconnect.archiveText, injection.archiveText);

    const relationship = formatMemoryMetaForPrompt(loadChatRelationshipMeta(CHAT, NAMES));
    const ledger = getDb()
      .prepare(`SELECT memory_meta FROM chats WHERE id=?`)
      .get(CHAT) as { memory_meta: string };
    const ledgerPromises = (
      JSON.parse(ledger.memory_meta) as { promises?: { text: string }[] }
    ).promises?.map((promise) => promise.text) ?? [];

    const episodicRows = (
      getDb()
        .prepare(`SELECT COUNT(*) AS n FROM episodic_memory_facts WHERE chat_id=?`)
        .get(CHAT) as { n: number }
    ).n;
    const episodic = getEpisodicMemoryForPrompt(
      getDb(),
      {
        chatId: CHAT,
        characterId: CHAR,
        userId: USER,
        currentTurn: COMPLETED_TURNS + 1,
        currentUserMessage: INCOMING_USER,
        recentChatText: rawHistory.map((message) => message.content).join("\n"),
        longTermMemoryText: injection.text,
        relationshipMemoryText: relationship ?? "",
        lorebookText: "",
        triggeredEventText: "",
        dynamicMemoryTotalMaxChars: 10_000,
      },
      EPISODIC_RECALL_ENV
    );

    const rawJoined = rawHistory.map((message) => message.content).join("\n");
    const provenance = FACTS.map((fact) => {
      const record = records.find((row) => row.summary.includes(fact.marker));
      return {
        id: fact.id,
        sourceTurn: fact.turn,
        ageTurnsBeforeIncoming: fact.ageTurns,
        rawHistory: rawJoined.includes(fact.marker),
        summaryBatch: record
          ? { turnStart: record.turnStart, turnEnd: record.turnEnd, kind: record.summaryKind }
          : null,
        globalExact: injection.text.includes(fact.marker),
        mediumTerm: injection.mediumTermText.includes(fact.marker),
        archive: injection.archiveText.includes(fact.marker),
        episodicPrompt: episodic.promptBlock.includes(fact.marker),
        relationshipMemo: (relationship ?? "").includes(fact.marker),
      };
    });

    for (const fact of provenance) {
      assert.equal(fact.rawHistory, false, `${fact.id} still in raw history`);
      assert.ok(fact.summaryBatch, `${fact.id} missing from sealed summary`);
      assert.equal(fact.globalExact, true, `${fact.id} missing from global memory`);
      assert.equal(fact.mediumTerm, false, `${fact.id} unexpectedly in medium-term`);
      assert.equal(fact.archive, false, `${fact.id} unexpectedly in archive`);
      assert.equal(fact.episodicPrompt, false, `${fact.id} unexpectedly in episodic prompt`);
    }
    assert.equal(provenance[0]!.summaryBatch!.turnStart, 1);
    assert.equal(provenance[1]!.summaryBatch!.turnStart, 21);
    assert.equal(provenance[2]!.summaryBatch!.turnStart, 31);
    assert.equal(provenance[3]!.summaryBatch!.turnStart, 41);
    assert.equal(provenance[4]!.summaryBatch!.turnStart, 46);

    assert.equal(resolved.projectionKind, "exact");
    assert.equal(resolved.overBudget, false);
    assert.equal(injection.mediumTermText, "");
    assert.equal(injection.archiveText, "");
    assert.equal(injection.limit, MEMORY_CAPACITY_FIXED + ARCHIVE_CAPACITY_FIXED);
    assert.ok(injection.recentChars <= MEMORY_CAPACITY_FIXED);
    assert.equal(episodicRows, 0);
    assert.equal(episodic.promptBlock, "");
    assert.equal(episodic.facts.length, 0);
    assert.deepEqual(ledgerPromises, [PROMISE, NEW_REL]);
    assert.equal(injection.text.includes(OLD_REL), true);
    assert.equal(injection.text.includes(NEW_REL), true);
    assert.equal((relationship ?? "").includes(OLD_REL), false);
    assert.equal((relationship ?? "").includes(NEW_REL), true);
    assert.equal((relationship ?? "").includes(PROMISE), true);

    const chunks = [
      {
        id: "core-10k",
        characterId: String(CHAR),
        content: CORE_SETTING,
        category: "identity" as const,
        importance: "CRITICAL" as const,
        tokenCount: CORE_SETTING.length,
        keywords: ["카엘", "리안"],
      },
    ];

    const assemblies = MAIN_RP_USER_SELECTABLE_OPTIONS.map((model) => {
      const built = buildContext({
        charName: CHAR_NAME,
        chunks,
        userNickname: USER_NAME,
        longTermMemory: injection.text,
        mediumTermMemoryBlock: injection.mediumTermText,
        archiveMemory: injection.archiveText,
        episodicMemoryBlock: episodic.promptBlock,
        memoryMeta: relationship,
        shortTermHistory: rawHistory,
        currentUserMessage: INCOMING_USER,
        nsfw: false,
        provider: model.provider,
        modelId: model.id,
        completedTurns: COMPLETED_TURNS,
        summarizedTurnCount: summarized,
        chatId: CHAT,
        userId: USER,
      });
      const sections = built.meta.trackedSections ?? [];
      const sectionText = (id: string) => sections.find((section) => section.id === id)?.text ?? "";
      const historyJoined = built.history.map((message) => message.content).join("\n");
      return {
        modelId: model.id,
        projectionKind: resolved.projectionKind,
        truncatedMemory: built.meta.truncatedMemory,
        core: sectionText("character-core-identity"),
        current: sectionText("current-memory"),
        relationship: sectionText("relationship-meta"),
        medium: sectionText("medium-term-memory"),
        episodic: sectionText("episodic-memory-retrieved-facts"),
        archive: sectionText("archive-memory"),
        historyJoined,
        systemHasCore: built.systemPrompt.includes(MARK_CORE_10K),
      };
    });

    for (const assembly of assemblies) {
      assert.equal(assembly.truncatedMemory, false, assembly.modelId);
      assert.equal(assembly.systemHasCore, true, assembly.modelId);
      assert.equal(assembly.core.includes(MARK_CORE_10K), true, assembly.modelId);
      assert.equal(assembly.core.includes(MARK_PROMISE_50), false, assembly.modelId);
      assert.equal(assembly.current.includes(MARK_CORE_10K), false, assembly.modelId);
      for (const fact of FACTS) {
        assert.equal(assembly.current.includes(fact.marker), true, `${assembly.modelId} ${fact.id}`);
        assert.equal(assembly.historyJoined.includes(fact.marker), false, `${assembly.modelId} ${fact.id}`);
      }
      assert.equal(assembly.current.includes(OLD_REL), true, assembly.modelId);
      assert.equal(assembly.current.includes(NEW_REL), true, assembly.modelId);
      assert.equal(assembly.relationship.includes(NEW_REL), true, assembly.modelId);
      assert.equal(assembly.relationship.includes(PROMISE), true, assembly.modelId);
      assert.equal(assembly.relationship.includes(OLD_REL), false, assembly.modelId);
      assert.equal(assembly.medium, "");
      assert.equal(assembly.episodic, "");
      assert.equal(assembly.archive, "");
    }

    const continued = buildContext({
      charName: CHAR_NAME,
      chunks,
      userNickname: USER_NAME,
      longTermMemory: injection.text,
      mediumTermMemoryBlock: injection.mediumTermText,
      archiveMemory: injection.archiveText,
      memoryMeta: relationship,
      shortTermHistory: rawHistory,
      currentUserMessage: INCOMING_USER,
      nsfw: false,
      provider: "cheaperinference",
      modelId: "deepseek-v4.1-flash",
      completedTurns: COMPLETED_TURNS,
      summarizedTurnCount: summarized,
      isContinue: true,
      chatId: CHAT,
      userId: USER,
    });
    const regeneratedPrompt = buildContext({
      charName: CHAR_NAME,
      chunks,
      userNickname: USER_NAME,
      longTermMemory: injection.text,
      mediumTermMemoryBlock: injection.mediumTermText,
      archiveMemory: injection.archiveText,
      memoryMeta: relationship,
      shortTermHistory: rawHistory,
      currentUserMessage: INCOMING_USER,
      nsfw: false,
      provider: "cheaperinference",
      modelId: "deepseek-v4.1-flash",
      completedTurns: COMPLETED_TURNS,
      summarizedTurnCount: summarized,
      regenerate: true,
      chatId: CHAT,
      userId: USER,
    });
    for (const fact of FACTS) {
      assert.equal(continued.systemPrompt.includes(fact.marker), true, `continue ${fact.id}`);
      assert.equal(regeneratedPrompt.systemPrompt.includes(fact.marker), true, `regen prompt ${fact.id}`);
    }

    const turn1 = rows[0]!;
    const refreshed = await refreshRollingSummaryForRegeneratedAssistant({
      chatId: CHAT,
      userId: USER,
      characterId: CHAR,
      charName: CHAR_NAME,
      tier: "pro",
      memoryCapacity: MEMORY_CAPACITY_FIXED,
      assistantMessageId: turn1.assistantId,
    });
    assert.equal(refreshed, true, __getLastSummarizeTurnBatchError() ?? "regen refresh failed");
    assert.equal(summarizerCalls, 11);
    const afterRegen = listMemoryRecordsForChat(CHAT).find((record) => record.turnStart === 1);
    assert.equal(afterRegen?.summary.includes(MARK_PROMISE_50), true);
    const afterRegenInjection = await buildMemoryContextForChat({
      chatId: CHAT,
      userId: USER,
      characterId: CHAR,
      tier: "pro",
      memoryCapacity: MEMORY_CAPACITY_FIXED,
      userMessage: INCOMING_USER,
      excludeSummaryTurnStartGte: excludeTurnStartGte,
      modelId: "deepseek-v4.1-flash",
      provider: "cheaperinference",
    });
    assert.equal(afterRegenInjection.text.includes(MARK_PROMISE_50), true);
    assert.equal(afterRegenInjection.text.includes(MARK_NOW_5), true);

    const report = {
      scope: {
        summarizerTransport: "extractive_fake_grounded",
        providerSummaryModel: "NOT_TESTED",
        providerRecall: "NOT_TESTED",
        semanticEpisodic: "NOT_TESTED",
        sharedPostTurnEpisodicWriter: "NOT_INVOKED",
        productionSealAutoExtract: false,
      },
      owners: {
        seal: "processRollingSummaryBatch",
        global: "resolveGlobalCurrentMemory",
        medium: "buildMediumTermMemoryBlockForProjection",
        archive: "chat_memories.archive_summary",
        episodicRecall: "getEpisodicMemoryForPrompt",
        relationship: "applyRelationshipDeltaToChat",
        rawPool: "resolveProviderRawPoolExchangeCount",
        assembly: "buildContext",
      },
      projectionKind: resolved.projectionKind,
      rawPool,
      excludeTurnStartGte,
      summarizedTurnCount: summarized,
      summarizerCalls,
      recentChars: injection.recentChars,
      limit: injection.limit,
      ledgerPromises,
      globalKeepsOldAndNewRelationship: true,
      ledgerDropsOldRelationshipByExactRemove: true,
      provenance,
      models: assemblies.map((assembly) => assembly.modelId),
    };
    console.log(`MEMORY_50TURN_LIFECYCLE ${JSON.stringify(report)}`);
    try {
      mkdirSync("/opt/cursor/artifacts", { recursive: true });
      writeFileSync(
        "/opt/cursor/artifacts/memory_50turn_lifecycle.json",
        `${JSON.stringify(report, null, 2)}\n`,
        "utf8"
      );
    } catch {
      // CI has no artifact dir; the assertion log is the record.
    }
  });
});
