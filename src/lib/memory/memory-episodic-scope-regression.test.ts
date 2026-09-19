/**
 * Deterministic episodic scope regression — main canon + durable preference only.
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
import { getDb } from "@/lib/db";
import {
  installIsolatedTestDatabase,
  uninstallIsolatedTestDatabase,
} from "@/lib/test/isolatedTestDatabase";
import {
  getEpisodicMemoryForPrompt,
  persistEpisodicMemoryFactsCore,
} from "@/lib/episodicMemoryFacts";
import { resolveOocSceneRenderIntent } from "@/lib/oocSceneRender";
import { buildPostTurnSharedInitialSystem } from "@/lib/postTurnSharedInitial/prompt";
import {
  parseSharedEpisodicSection,
  reconcileSharedEpisodicFactsForTurn,
  shouldRequestEpisodicInSharedInitial,
} from "./memory-episodic-shared";
import { resolveEpisodicEligibilityForSourceUserMessage } from "./memory-episodic-eligibility";
import { classifyMemoryTurnScope } from "./memory-summary-scope";
import { getOrCreateChatMemory } from "./memory-db";
import type { EpisodicExtractedFact } from "./memory-episodic-types";

const CHAT = 961100;
const USER = 961101;
const CHAR = 961102;

const VALID_FACT: EpisodicExtractedFact = {
  category: "preference",
  subject: "user",
  attribute: "evening_walk",
  value: "yes",
  importance: "important",
  fact_text: "사용자는 저녁 산책을 제안했다.",
  evidence_type: "explicit_user_statement",
};

const PREFERENCE_MSG =
  "(OOC: 앞으로는 항상 3인칭 서술로 답해줘)";
const BARE_IF_MSG = "IF 내가 그날 떠났다면 어떻게 됐을까?";
const BRANCH_CONTINUE_MSG = "그대로 계속 걸어간다.";
const PLAIN_OOC_MSG = "(OOC: 문체를 더 짧게 써줘)";
const MAIN_ADOPT_MSG = "이걸 본편으로 실제 있었던 일로 확정해줘";
const BRANCH_CLOSE_MSG = "본편으로 돌아가자. IF 종료.";
const NORMAL_MAIN_MSG = "오늘 저녁에 같이 산책할래?";

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

function seedBase() {
  cleanup();
  const db = getDb();
  db.prepare(`INSERT INTO users (id, email, nickname, pw_hash) VALUES (?,?,?,?)`).run(
    USER,
    `scope-${USER}@test.local`,
    "scope",
    "x"
  );
  db.prepare(`INSERT INTO characters (id, name) VALUES (?,?)`).run(CHAR, "ScopeChar");
  db.prepare(`INSERT INTO chats (id, user_id, character_id, mode) VALUES (?,?,?,'safe')`).run(
    CHAT,
    USER,
    CHAR
  );
  getOrCreateChatMemory(CHAT, USER, CHAR, "free");
  db.prepare(`INSERT INTO messages (chat_id, role, content, model) VALUES (?,?,?,?)`).run(
    CHAT,
    "assistant",
    "인사.",
    "greeting"
  );
}

function insertTurn(
  userText: string,
  assistantText = "assistant prose"
): { userId: number; assistantId: number; turn: number } {
  const db = getDb();
  const userId = db
    .prepare(
      `INSERT INTO messages (chat_id, role, content, model, generation_status) VALUES (?,?,?,'user','submitted')`
    )
    .run(CHAT, "user", userText).lastInsertRowid as number;
  const assistantId = db
    .prepare(
      `INSERT INTO messages (chat_id, role, content, model, generation_status, user_message_id) VALUES (?,?,?,?,'completed',?)`
    )
    .run(CHAT, "assistant", assistantText, "test", userId).lastInsertRowid as number;
  const turn = db
    .prepare(
      `SELECT COUNT(*) AS c FROM messages WHERE chat_id=? AND role='assistant' AND model!='greeting'`
    )
    .get(CHAT) as { c: number };
  return { userId, assistantId, turn: turn.c };
}

function episodicCount(sourceTurn?: number): number {
  const db = getDb();
  if (sourceTurn != null) {
    return (
      db
        .prepare(`SELECT COUNT(*) AS n FROM episodic_memory_facts WHERE chat_id=? AND source_turn=?`)
        .get(CHAT, sourceTurn) as { n: number }
    ).n;
  }
  return (
    db.prepare(`SELECT COUNT(*) AS n FROM episodic_memory_facts WHERE chat_id=?`).get(CHAT) as {
      n: number;
    }
  ).n;
}

function reconcile(opts: {
  userId: number;
  assistantId: number;
  userText: string;
  facts?: EpisodicExtractedFact[];
  isRegeneration?: boolean;
}) {
  const parsed = parseSharedEpisodicSection({
    extracted_facts: opts.facts ?? [VALID_FACT],
  });
  return reconcileSharedEpisodicFactsForTurn(getDb(), {
    chatId: CHAT,
    userId: USER,
    characterId: CHAR,
    assistantMessageId: opts.assistantId,
    sourceUserMessageId: opts.userId,
    sourceUserText: opts.userText,
    episodic: parsed,
    isRegeneration: opts.isRegeneration ?? false,
  });
}

before(() => installIsolatedTestDatabase());
after(() => uninstallIsolatedTestDatabase());

beforeEach(() => {
  process.env.MEMORY_FEATURE_ENABLED = "1";
  seedBase();
});

afterEach(() => cleanup());

describe("SCOPE episodic memory eligibility", () => {
  it("SCOPE-1 normal main RP — request true / persist true", () => {
    const { userId, assistantId } = insertTurn(NORMAL_MAIN_MSG);
    const db = getDb();
    const resolution = resolveEpisodicEligibilityForSourceUserMessage(db, {
      chatId: CHAT,
      sourceUserMessageId: userId,
      sourceUserText: NORMAL_MAIN_MSG,
    });
    assert.equal(resolution.scopeClass, "main_rp");
    assert.equal(resolution.eligible, true);
    assert.equal(
      shouldRequestEpisodicInSharedInitial({
        userMessage: NORMAL_MAIN_MSG,
        memoryFeatureEnabled: true,
        db,
        chatId: CHAT,
        sourceUserMessageId: userId,
      }),
      true
    );
    const result = reconcile({ userId, assistantId, userText: NORMAL_MAIN_MSG });
    assert.equal(result.skipped, false);
    assert.equal(result.inserted, 1);
    assert.equal(episodicCount(1), 1);
  });

  it("SCOPE-2 bare IF meaningful_noncanon — request false / insert 0", () => {
    assert.equal(resolveOocSceneRenderIntent(BARE_IF_MSG), false);
    assert.equal(classifyMemoryTurnScope(BARE_IF_MSG), "meaningful_noncanon");
    const { userId, assistantId } = insertTurn(BARE_IF_MSG);
    const db = getDb();
    const resolution = resolveEpisodicEligibilityForSourceUserMessage(db, {
      chatId: CHAT,
      sourceUserMessageId: userId,
      sourceUserText: BARE_IF_MSG,
    });
    assert.equal(resolution.scopeClass, "meaningful_noncanon");
    assert.equal(resolution.eligible, false);
    assert.equal(
      shouldRequestEpisodicInSharedInitial({
        userMessage: BARE_IF_MSG,
        memoryFeatureEnabled: true,
        db,
        chatId: CHAT,
        sourceUserMessageId: userId,
      }),
      false
    );
    const result = reconcile({ userId, assistantId, userText: BARE_IF_MSG });
    assert.equal(result.inserted, 0);
    assert.equal(episodicCount(1), 0);
  });

  it("SCOPE-3 branch continuation after IF — request false / insert 0", () => {
    insertTurn(BARE_IF_MSG);
    const { userId, assistantId } = insertTurn(BRANCH_CONTINUE_MSG);
    const db = getDb();
    const resolution = resolveEpisodicEligibilityForSourceUserMessage(db, {
      chatId: CHAT,
      sourceUserMessageId: userId,
      sourceUserText: BRANCH_CONTINUE_MSG,
    });
    assert.equal(resolution.previousWasNoncanonOrBranch, true);
    assert.equal(resolution.scopeClass, "branch_continue");
    assert.equal(resolution.eligible, false);
    assert.equal(
      shouldRequestEpisodicInSharedInitial({
        userMessage: BRANCH_CONTINUE_MSG,
        memoryFeatureEnabled: true,
        db,
        chatId: CHAT,
        sourceUserMessageId: userId,
      }),
      false
    );
    assert.equal(reconcile({ userId, assistantId, userText: BRANCH_CONTINUE_MSG }).inserted, 0);
    assert.equal(episodicCount(2), 0);
  });

  it("SCOPE-4 plain OOC — request false / insert 0", () => {
    const { userId, assistantId } = insertTurn(PLAIN_OOC_MSG);
    const db = getDb();
    assert.equal(
      resolveEpisodicEligibilityForSourceUserMessage(db, {
        chatId: CHAT,
        sourceUserMessageId: userId,
        sourceUserText: PLAIN_OOC_MSG,
      }).eligible,
      false
    );
    assert.equal(
      shouldRequestEpisodicInSharedInitial({
        userMessage: PLAIN_OOC_MSG,
        memoryFeatureEnabled: true,
        db,
        chatId: CHAT,
        sourceUserMessageId: userId,
      }),
      false
    );
    assert.equal(reconcile({ userId, assistantId, userText: PLAIN_OOC_MSG }).inserted, 0);
  });

  it("SCOPE-5 durable preference — eligible true", () => {
    const { userId, assistantId } = insertTurn(PREFERENCE_MSG);
    const db = getDb();
    const resolution = resolveEpisodicEligibilityForSourceUserMessage(db, {
      chatId: CHAT,
      sourceUserMessageId: userId,
      sourceUserText: PREFERENCE_MSG,
    });
    assert.equal(resolution.scopeClass, "preference");
    assert.equal(resolution.eligible, true);
    assert.equal(
      shouldRequestEpisodicInSharedInitial({
        userMessage: PREFERENCE_MSG,
        memoryFeatureEnabled: true,
        db,
        chatId: CHAT,
        sourceUserMessageId: userId,
      }),
      true
    );
    const preferenceFact: EpisodicExtractedFact = {
      category: "preference",
      subject: "user",
      attribute: "narration_style",
      value: "third_person",
      importance: "important",
      fact_text: "사용자는 앞으로 3인칭 서술을 요청했다.",
      evidence_type: "explicit_user_statement",
    };
    assert.equal(
      reconcile({ userId, assistantId, userText: PREFERENCE_MSG, facts: [preferenceFact] })
        .inserted,
      1
    );
  });

  it("SCOPE-6 main_adopt control turn insert 0; next main eligible", () => {
    insertTurn(BARE_IF_MSG);
    insertTurn(BRANCH_CONTINUE_MSG, "IF scene prose");
    const adopt = insertTurn(MAIN_ADOPT_MSG);
    const db = getDb();
    assert.equal(
      resolveEpisodicEligibilityForSourceUserMessage(db, {
        chatId: CHAT,
        sourceUserMessageId: adopt.userId,
        sourceUserText: MAIN_ADOPT_MSG,
      }).eligible,
      false
    );
    assert.equal(reconcile({ ...adopt, userText: MAIN_ADOPT_MSG }).inserted, 0);

    const nextMain = insertTurn(NORMAL_MAIN_MSG);
    assert.equal(
      resolveEpisodicEligibilityForSourceUserMessage(db, {
        chatId: CHAT,
        sourceUserMessageId: nextMain.userId,
        sourceUserText: NORMAL_MAIN_MSG,
      }).eligible,
      true
    );
    assert.equal(reconcile({ ...nextMain, userText: NORMAL_MAIN_MSG }).inserted, 1);
  });

  it("SCOPE-7 branch_close insert 0; next main eligible", () => {
    insertTurn(BARE_IF_MSG);
    insertTurn(BRANCH_CONTINUE_MSG);
    const close = insertTurn(BRANCH_CLOSE_MSG);
    const db = getDb();
    assert.equal(
      resolveEpisodicEligibilityForSourceUserMessage(db, {
        chatId: CHAT,
        sourceUserMessageId: close.userId,
        sourceUserText: BRANCH_CLOSE_MSG,
      }).eligible,
      false
    );
    assert.equal(reconcile({ ...close, userText: BRANCH_CLOSE_MSG }).inserted, 0);

    const nextMain = insertTurn(NORMAL_MAIN_MSG);
    assert.equal(
      resolveEpisodicEligibilityForSourceUserMessage(db, {
        chatId: CHAT,
        sourceUserMessageId: nextMain.userId,
        sourceUserText: NORMAL_MAIN_MSG,
      }).eligible,
      true
    );
    assert.equal(reconcile({ ...nextMain, userText: NORMAL_MAIN_MSG }).inserted, 1);
  });

  it("SCOPE-8 direct persistence bypass — ineligible source insert 0", () => {
    const { userId } = insertTurn(BARE_IF_MSG);
    const inserted = persistEpisodicMemoryFactsCore(getDb(), {
      chatId: CHAT,
      userId: USER,
      characterId: CHAR,
      sourceTurn: 1,
      sourceUserMessageId: userId,
      sourceUserText: BARE_IF_MSG,
      facts: [VALID_FACT],
      metadata: { extraction: "shared_initial_per_turn", assistant_message_id: 9999 },
    });
    assert.equal(inserted, 0);
    assert.equal(episodicCount(1), 0);
  });

  it("SCOPE-9 status ON/OFF parity — shared prompt omits episodic when ineligible", () => {
    const offPrompt = buildPostTurnSharedInitialSystem({
      mode: "relationship_only",
      charName: "c",
      personaName: "u",
      includeSuggestions: false,
      includeRelationship: true,
      includeEpisodic: false,
      relationshipRegenContext: null,
    });
    assert.equal(offPrompt.includes("episodic"), false);

    const onPrompt = buildPostTurnSharedInitialSystem({
      mode: "relationship_only",
      charName: "c",
      personaName: "u",
      includeSuggestions: false,
      includeRelationship: true,
      includeEpisodic: true,
      relationshipRegenContext: null,
    });
    assert.ok(onPrompt.includes("episodic"));

    const db = getDb();
    const { userId } = insertTurn(BARE_IF_MSG);
    assert.equal(
      shouldRequestEpisodicInSharedInitial({
        userMessage: BARE_IF_MSG,
        memoryFeatureEnabled: true,
        db,
        chatId: CHAT,
        sourceUserMessageId: userId,
      }),
      false
    );
  });

  it("SCOPE-10 noncanon regen stale cleanup — old facts removed", () => {
    const main = insertTurn(NORMAL_MAIN_MSG);
    reconcile({ ...main, userText: NORMAL_MAIN_MSG });
    assert.equal(episodicCount(main.turn), 1);

    getDb()
      .prepare(`UPDATE messages SET content=? WHERE id=?`)
      .run(BARE_IF_MSG, main.userId);
    const regen = reconcile({
      userId: main.userId,
      assistantId: main.assistantId,
      userText: BARE_IF_MSG,
      isRegeneration: true,
    });
    assert.equal(regen.replaced, true);
    assert.equal(episodicCount(main.turn), 0);
  });

  it("SCOPE-11 main canon regen replacement — unrelated facts preserved", () => {
    const t1 = insertTurn(NORMAL_MAIN_MSG);
    reconcile({ ...t1, userText: NORMAL_MAIN_MSG });
    const t2 = insertTurn("두 번째 본편 턴입니다.");
    const t2Fact: EpisodicExtractedFact = {
      category: "character",
      subject: "char",
      attribute: "mood",
      value: "calm",
      importance: "normal",
      fact_text: "캐릭터는 두 번째 턴에서 차분하게 대답했다.",
      evidence_type: "explicit_scene_event",
    };
    reconcile({ ...t2, userText: "두 번째 본편 턴입니다.", facts: [t2Fact] });
    assert.equal(episodicCount(), 2);

    const newFact: EpisodicExtractedFact = {
      category: "relationship",
      subject: "char_user",
      attribute: "evening_plan",
      value: "walk_together",
      importance: "important",
      fact_text: "캐릭터는 저녁 산책 제안에 긍정적으로 응했다.",
      evidence_type: "explicit_scene_event",
    };
    reconcile({
      userId: t1.userId,
      assistantId: t1.assistantId,
      userText: NORMAL_MAIN_MSG,
      facts: [newFact],
      isRegeneration: true,
    });
    assert.equal(episodicCount(), 2);
    const rows = getDb()
      .prepare(
        `SELECT source_turn, fact_text FROM episodic_memory_facts WHERE chat_id=? ORDER BY source_turn`
      )
      .all(CHAT) as { source_turn: number; fact_text: string }[];
    assert.equal(rows.length, 2);
    assert.ok(rows.some((r) => r.fact_text.includes("긍정")));
    assert.ok(rows.some((r) => r.source_turn === 2));
  });

  it("SCOPE-12 final Main RP episodic block excludes noncanon marker", () => {
    const main = insertTurn(NORMAL_MAIN_MSG);
    reconcile({ ...main, userText: NORMAL_MAIN_MSG });
    const ifTurn = insertTurn(BARE_IF_MSG);
    reconcile({ ...ifTurn, userText: BARE_IF_MSG });
    assert.equal(episodicCount(ifTurn.turn), 0);

    const recall = getEpisodicMemoryForPrompt(
      getDb(),
      {
        chatId: CHAT,
        characterId: CHAR,
        userId: USER,
        currentTurn: 6,
        currentUserMessage: "다음 본편 턴",
        recentChatText: "unrelated recent context",
      },
      {
        EPISODIC_MEMORY_RECALL_ENABLED: "1",
      } as NodeJS.ProcessEnv
    );
    assert.ok(recall.promptBlock.includes("산책"));
    assert.equal(recall.promptBlock.includes("IF"), false);
    assert.equal(recall.promptBlock.includes("떠났다면"), false);
  });
});
