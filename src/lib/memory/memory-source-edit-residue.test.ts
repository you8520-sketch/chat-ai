/**
 * Full-pipeline residue matrix for a material user-message edit.
 * Calls the same synchronous memory owner as PATCH /api/chat/message.
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
import { after, before, describe, it } from "node:test";
import { getDb } from "@/lib/db";
import {
  formatMemoryMetaForPrompt,
  type HonorificNames,
  type MemoryMeta,
} from "@/lib/chatMemory";
import {
  installIsolatedTestDatabase,
  uninstallIsolatedTestDatabase,
} from "@/lib/test/isolatedTestDatabase";
import { buildContext } from "@/services/contextBuilder";
import { applyRelationshipDeltaToChat, loadChatRelationshipMeta } from "./memory-relationship-meta";
import { getOrCreateChatMemory } from "./memory-db";
import { buildMediumTermMemoryBlock } from "./memory-medium-term";
import { reconcileSharedEpisodicFactsForTurn } from "./memory-episodic-shared";
import type { EpisodicExtractedFact } from "./memory-episodic-types";
import { getEpisodicMemoryForPrompt } from "@/lib/episodicMemoryFacts";
import {
  messagesToTurns,
  rawRecentTurnsToHistory,
  resolveProviderRawPoolExchangeCount,
} from "@/lib/hybridMemory";
import { buildMemoryContextForChat } from "./memory-manager";
import {
  __setSummarizeTurnBatchCallerForTests,
  processRollingSummaryBatch,
} from "./memory-rolling-summary";
import { persistValidatedSummaryBatch } from "./memory-summary-persist";
import { listMemoryRecordsForChat, rebuildLorebookFromRecords } from "./memory-turn-summary";
import { highestContiguousCompletedTurn } from "./memory-summary-integrity";
import {
  clearUserMessageEditDerivedResidueCore,
  reconcileDerivedMemoryAfterUserMessageEditCore,
  scheduleMemoryResealAfterSourceMessageEdit,
} from "./memory-reconcile";
import { resolveMemorySourceTurnIdentityCore } from "./memory-turn-loader";

const CHAT = 970221;
const USER = 970222;
const CHAR = 970223;
const NAMES: HonorificNames = { charName: "EditChar", userName: "edit" };

const OLD_MARKER = "OLD_MARKER_9";
const NEW_MARKER = "NEW_MARKER_7";
const CONTROL_MARKER = "CONTROL_MARKER_4";
const OLD_PROMISE = "청록항구에서 다시 만나기로 약속했다";
const CONTROL_PROMISE = "서재의 청동열쇠를 계속 보관한다";
const UNRELATED_PROMISE = "은하도서관 출입 권한을 유지한다";

const RECALL_ENV = {
  NODE_ENV: "development",
  EPISODIC_MEMORY_RECALL_ENABLED: "1",
  EPISODIC_MEMORY_MIN_AGE_TURNS: "5",
} as NodeJS.ProcessEnv;

const NEW_SUMMARY =
  `${NEW_MARKER} `.repeat(4) +
  "유저가 서재에서 다음 장면을 이어 가자고 고쳤다. 이전 항구 약속은 본문에서 빠졌다. 관계의 다음 행동만 남긴다.";

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

function userFact(marker: string, attribute: string): EpisodicExtractedFact {
  return {
    category: "preference",
    subject: "user",
    attribute,
    value: marker,
    importance: "important",
    fact_text: `사용자는 ${marker} 표시의 약속을 직접 말했다.`,
    evidence_type: "explicit_user_statement",
  };
}

function seedTranscript(): { turn1UserId: number; turn1AssistantId: number; turn2AssistantId: number } {
  cleanup();
  const db = getDb();
  db.prepare(`INSERT INTO users (id, email, nickname, pw_hash) VALUES (?,?,?,?)`).run(
    USER,
    `residue-${USER}@test.local`,
    "edit",
    "x"
  );
  db.prepare(`INSERT INTO characters (id, name) VALUES (?,?)`).run(CHAR, "EditChar");
  db.prepare(
    `INSERT INTO chats (id, user_id, character_id, mode, memory_capacity, memory_meta) VALUES (?,?,?,'safe',?,?)`
  ).run(CHAT, USER, CHAR, 10_000, "{}");
  getOrCreateChatMemory(CHAT, USER, CHAR, "free");
  db.prepare(`INSERT INTO messages (chat_id, role, content, model) VALUES (?,?,?,?)`).run(
    CHAT,
    "assistant",
    "인사.",
    "greeting"
  );

  let turn1UserId = 0;
  let turn1AssistantId = 0;
  let turn2AssistantId = 0;
  for (let turn = 1; turn <= 10; turn++) {
    const userText =
      turn === 1
        ? `${OLD_MARKER} ${OLD_PROMISE}`
        : turn === 2
          ? `${CONTROL_MARKER} 다른 사실은 유지된다`
          : turn === 8
            ? CONTROL_PROMISE
            : `유저 턴 ${turn} 평범한 대화`;
    const userId = Number(
      db.prepare(`INSERT INTO messages (chat_id, role, content, model) VALUES (?,?,?,?)`).run(
        CHAT,
        "user",
        userText,
        "user"
      ).lastInsertRowid
    );
    const assistantId = Number(
      db
        .prepare(
          `INSERT INTO messages (chat_id, role, content, model, user_message_id) VALUES (?,?,?,?,?)`
        )
        .run(CHAT, "assistant", `캐릭터 턴 ${turn} 응답이다.`, "test", userId).lastInsertRowid
    );
    if (turn === 1) {
      turn1UserId = userId;
      turn1AssistantId = assistantId;
    }
    if (turn === 2) turn2AssistantId = assistantId;
  }
  return { turn1UserId, turn1AssistantId, turn2AssistantId };
}

function persistTurnFact(assistantMessageId: number, userText: string, fact: EpisodicExtractedFact) {
  const result = reconcileSharedEpisodicFactsForTurn(getDb(), {
    chatId: CHAT,
    userId: USER,
    characterId: CHAR,
    assistantMessageId,
    sourceUserText: userText,
    episodic: { present: true, valid: true, facts: [fact] },
    isRegeneration: false,
    contentRoute: "safe",
  });
  assert.equal(result.skipped, false, "production per-turn episodic writer must persist");
  assert.equal(result.inserted, 1);
}

async function assemblePrompt(currentUserMessage: string) {
  const rows = getDb()
    .prepare(`SELECT role, content, model FROM messages WHERE chat_id=? ORDER BY id`)
    .all(CHAT) as { role: "user" | "assistant"; content: string; model?: string }[];
  const turns = messagesToTurns(rows);
  const completedTurns = 10;
  const summarized = highestContiguousCompletedTurn(listMemoryRecordsForChat(CHAT), completedTurns);
  const rawPool = resolveProviderRawPoolExchangeCount({
    memoryFeatureEnabled: true,
    completedTurns,
    summarizedTurnCount: summarized,
  });
  const raw = rawRecentTurnsToHistory(turns, rawPool, {
    summarizedTurnCount: summarized,
    memoryFeatureEnabled: true,
  });
  const injection = await buildMemoryContextForChat({
    chatId: CHAT,
    userId: USER,
    characterId: CHAR,
    tier: "free",
    memoryCapacity: 10_000,
    userMessage: currentUserMessage,
  });
  const medium = buildMediumTermMemoryBlock({ chatId: CHAT, blockCount: 15 });
  const episodic = getEpisodicMemoryForPrompt(
    getDb(),
    {
      chatId: CHAT,
      characterId: CHAR,
      userId: USER,
      currentTurn: completedTurns + 1,
      currentUserMessage,
      recentChatText: raw.map((message) => message.content).join("\n"),
      longTermMemoryText: injection.text,
      relationshipMemoryText: "",
      lorebookText: "",
      triggeredEventText: "",
      dynamicMemoryTotalMaxChars: 10_000,
    },
    RECALL_ENV
  );
  const relationship = formatMemoryMetaForPrompt(loadChatRelationshipMeta(CHAT, NAMES)) ?? "";
  const built = buildContext({
    charName: "EditChar",
    chunks: [],
    userNickname: "edit",
    shortTermHistory: raw,
    currentUserMessage,
    longTermMemory: injection.text,
    mediumTermMemoryBlock: injection.mediumTermText || medium.text,
    episodicMemoryBlock: episodic.promptBlock,
    memoryMeta: relationship,
    nsfw: true,
    provider: "openrouter",
    completedTurns,
    summarizedTurnCount: summarized,
  });
  return {
    systemPrompt: built.systemPrompt,
    episodicBlock: episodic.promptBlock,
    lorebook: rebuildLorebookFromRecords(CHAT),
    recentSummary: getOrCreateChatMemory(CHAT, USER, CHAR, "free").recent_summary,
    mediumText: medium.text,
    injectionMedium: injection.mediumTermText,
    relationship,
  };
}

/** PATCH /api/chat/message user-edit memory owner, after the content UPDATE. */
function applyProductionUserMaterialEdit(userMessageId: number, nextText: string) {
  const db = getDb();
  const previousUserText = (
    db.prepare(`SELECT content FROM messages WHERE id=?`).get(userMessageId) as { content: string }
  ).content;
  const preIdentity = resolveMemorySourceTurnIdentityCore(db, CHAT, userMessageId);
  assert.ok(preIdentity);
  db.transaction(() => {
    db.prepare(`UPDATE messages SET content=? WHERE id=?`).run(nextText, userMessageId);
    reconcileDerivedMemoryAfterUserMessageEditCore(db, {
      chatId: CHAT,
      userId: USER,
      characterId: CHAR,
      tier: "free",
      memoryCapacity: 10_000,
      memoryTurnNumber: preIdentity.memoryTurnNumber,
      sourceUserMessageId: preIdentity.sourceUserMessageId,
      sourceAssistantMessageId: preIdentity.sourceAssistantMessageId,
      previousUserText,
    });
  }).immediate();
  const summarized = (
    db.prepare(`SELECT summarized_turn_count FROM chat_memories WHERE chat_id=?`).get(CHAT) as {
      summarized_turn_count: number | null;
    }
  ).summarized_turn_count;
  scheduleMemoryResealAfterSourceMessageEdit({
    chatId: CHAT,
    userId: USER,
    characterId: CHAR,
    charName: "EditChar",
    tier: "free",
    memoryCapacity: 10_000,
    summarizedTurnCount: summarized,
  });
}

before(() => installIsolatedTestDatabase());
after(() => uninstallIsolatedTestDatabase());

describe("user material edit derived-memory residue", () => {
  it("drops obsolete per-turn episodic and durable promise text from the final Main RP prompt", async () => {
    const seeded = seedTranscript();
    const turn1Text = `${OLD_MARKER} ${OLD_PROMISE}`;
    persistTurnFact(seeded.turn1AssistantId, turn1Text, userFact(OLD_MARKER, "harbor_marker"));
    persistTurnFact(
      seeded.turn2AssistantId,
      `${CONTROL_MARKER} 다른 사실은 유지된다`,
      userFact(CONTROL_MARKER, "control_marker")
    );

    const summary =
      `${OLD_MARKER} `.repeat(3) +
      "초반 장면에서 유저가 청록 항구 약속을 말했다. 이후 대화는 평범한 인사로 이어졌다. 요약은 그 사실만 남긴다.";
    const sealed = persistValidatedSummaryBatch({
      chatId: CHAT,
      userId: USER,
      characterId: CHAR,
      tier: "free",
      turnStart: 1,
      turnEnd: 5,
      assistantMessageId: seeded.turn1AssistantId,
      summary,
      playableTurnCount: 10,
    });
    assert.equal(sealed.ok, true);

    const relationship = applyRelationshipDeltaToChat({
      chatId: CHAT,
      names: NAMES,
      delta: {
        promisesAdd: [
          { text: OLD_PROMISE },
          { text: CONTROL_PROMISE },
          { text: UNRELATED_PROMISE },
        ],
      },
      sourceUserMessageId: seeded.turn1UserId,
    });
    assert.equal(relationship.accepted, true);

    const episodicRowsBefore = getDb()
      .prepare(`SELECT fact_text FROM episodic_memory_facts WHERE chat_id=? ORDER BY source_turn`)
      .all(CHAT) as { fact_text: string }[];
    assert.equal(episodicRowsBefore.length, 2);
    assert.match(episodicRowsBefore[0]!.fact_text, new RegExp(OLD_MARKER));
    assert.match(episodicRowsBefore[1]!.fact_text, new RegExp(CONTROL_MARKER));

    const before = await assemblePrompt("예전 일을 이어서 이야기해 줘");
    assert.match(before.lorebook, new RegExp(OLD_MARKER));
    assert.match(before.recentSummary, new RegExp(OLD_MARKER));
    assert.match(before.mediumText, new RegExp(OLD_MARKER));
    assert.match(before.relationship, new RegExp(OLD_PROMISE));
    assert.match(before.relationship, new RegExp(CONTROL_PROMISE));
    assert.match(before.relationship, new RegExp(UNRELATED_PROMISE));
    assert.match(before.systemPrompt, new RegExp(OLD_MARKER));
    assert.match(before.systemPrompt, new RegExp(OLD_PROMISE));
    assert.match(before.systemPrompt, new RegExp(CONTROL_PROMISE));
    assert.match(before.systemPrompt, new RegExp(UNRELATED_PROMISE));

    __setSummarizeTurnBatchCallerForTests(async () => ({ text: NEW_SUMMARY }));
    try {
      applyProductionUserMaterialEdit(
        seeded.turn1UserId,
        `${NEW_MARKER} 서재에서 다음 장면을 이어 가자 약속은 없다`
      );
      await processRollingSummaryBatch({
        chatId: CHAT,
        userId: USER,
        characterId: CHAR,
        charName: "EditChar",
        tier: "free",
        memoryCapacity: 10_000,
      });
    } finally {
      __setSummarizeTurnBatchCallerForTests(null);
    }

    const after = await assemblePrompt("표시를 다시 떠올려 줘");
    const meta = loadChatRelationshipMeta(CHAT, NAMES) satisfies MemoryMeta;
    assert.equal(
      meta.promises.some((promise) => promise.text === OLD_PROMISE),
      false,
      "RESIDUE_PRESENT relationship durable"
    );
    assert.equal(
      meta.promises.some((promise) => promise.text === CONTROL_PROMISE),
      true
    );
    assert.equal(
      meta.promises.some((promise) => promise.text === UNRELATED_PROMISE),
      true
    );
    assert.doesNotMatch(after.lorebook, new RegExp(OLD_MARKER));
    assert.match(after.lorebook, new RegExp(NEW_MARKER));
    assert.doesNotMatch(after.recentSummary, new RegExp(OLD_MARKER));
    assert.match(after.recentSummary, new RegExp(NEW_MARKER));
    assert.doesNotMatch(after.mediumText, new RegExp(OLD_MARKER));
    assert.match(after.mediumText, new RegExp(NEW_MARKER));
    assert.doesNotMatch(after.episodicBlock, new RegExp(OLD_MARKER));
    assert.match(after.episodicBlock, new RegExp(CONTROL_MARKER));
    assert.doesNotMatch(after.relationship, new RegExp(OLD_PROMISE));
    assert.match(after.relationship, new RegExp(CONTROL_PROMISE));
    assert.match(after.relationship, new RegExp(UNRELATED_PROMISE));
    assert.doesNotMatch(after.systemPrompt, new RegExp(OLD_MARKER));
    assert.doesNotMatch(after.systemPrompt, new RegExp(OLD_PROMISE));
    assert.match(after.systemPrompt, new RegExp(NEW_MARKER));
    assert.match(after.systemPrompt, new RegExp(CONTROL_MARKER));
    assert.match(after.systemPrompt, new RegExp(CONTROL_PROMISE));
    assert.match(after.systemPrompt, new RegExp(UNRELATED_PROMISE));
  });

  it("cleans persisted user-edit residue even while the memory kill switch is off", () => {
    const seeded = seedTranscript();
    const oldText = `${OLD_MARKER} ${OLD_PROMISE}`;
    persistTurnFact(
      seeded.turn1AssistantId,
      oldText,
      userFact(OLD_MARKER, "kill_switch_marker")
    );
    persistTurnFact(
      seeded.turn2AssistantId,
      `${CONTROL_MARKER} 다른 사실은 유지된다`,
      userFact(CONTROL_MARKER, "kill_switch_control")
    );
    const relationship = applyRelationshipDeltaToChat({
      chatId: CHAT,
      names: NAMES,
      delta: {
        promisesAdd: [
          { text: OLD_PROMISE },
          { text: CONTROL_PROMISE },
          { text: UNRELATED_PROMISE },
        ],
      },
      sourceUserMessageId: seeded.turn1UserId,
    });
    assert.equal(relationship.accepted, true);

    const previousFlag = process.env.MEMORY_FEATURE_ENABLED;
    process.env.MEMORY_FEATURE_ENABLED = "0";
    try {
      const db = getDb();
      db.prepare("UPDATE messages SET content=? WHERE id=?").run(
        `${NEW_MARKER} 메모리 kill switch 중 원문을 수정했다`,
        seeded.turn1UserId
      );
      clearUserMessageEditDerivedResidueCore(db, {
        chatId: CHAT,
        sourceUserMessageId: seeded.turn1UserId,
        sourceTurn: 1,
        previousUserText: oldText,
      });
    } finally {
      if (previousFlag == null) delete process.env.MEMORY_FEATURE_ENABLED;
      else process.env.MEMORY_FEATURE_ENABLED = previousFlag;
    }

    const rows = getDb()
      .prepare(
        "SELECT fact_text FROM episodic_memory_facts WHERE chat_id=? ORDER BY source_turn"
      )
      .all(CHAT) as { fact_text: string }[];
    assert.equal(rows.some((row) => row.fact_text.includes(OLD_MARKER)), false);
    assert.equal(rows.some((row) => row.fact_text.includes(CONTROL_MARKER)), true);

    const meta = loadChatRelationshipMeta(CHAT, NAMES);
    assert.equal(meta.promises.some((promise) => promise.text === OLD_PROMISE), false);
    assert.equal(
      meta.promises.some((promise) => promise.text === CONTROL_PROMISE),
      true
    );
    assert.equal(
      meta.promises.some((promise) => promise.text === UNRELATED_PROMISE),
      true
    );
  });
});
