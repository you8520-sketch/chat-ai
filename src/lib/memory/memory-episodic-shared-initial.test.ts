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
import { readFileSync } from "node:fs";
import { getDb } from "@/lib/db";
import {
  installIsolatedTestDatabase,
  uninstallIsolatedTestDatabase,
} from "@/lib/test/isolatedTestDatabase";
import {
  detectRelationshipLedgerOwnedFact,
  getEpisodicMemoryForPrompt,
} from "@/lib/episodicMemoryFacts";
import { DEFAULT_STATUS_WIDGET } from "@/lib/statusWidget/defaultTemplate";
import { extractStatusWidgetValuesForTurn } from "@/lib/statusWidget/extract";
import type { ResolvedStatusWidgetTurn, StatusWidget } from "@/lib/statusWidget/types";
import { collectWidgetJsonKeys } from "@/lib/statusWidget/prompt";
import { buildPostTurnSharedInitialSystem } from "@/lib/postTurnSharedInitial/prompt";
import { parsePostTurnSharedInitialResponse } from "@/lib/postTurnSharedInitial/parse";
import { runPostTurnRelationshipOnlyInitial } from "@/lib/postTurnSharedInitial/run";
import { POST_TURN_SHARED_INITIAL_REQUEST_KIND } from "@/lib/postTurnSharedInitial/types";
import { EPISODIC_FACTS_EXTRACT_INSTRUCTIONS } from "./memory-episodic-prompt";
import {
  __getEpisodicExtractCallCountForTests,
  __resetEpisodicExtractCallCountForTests,
} from "./memory-episodic-extract";
import {
  parseSharedEpisodicSection,
  reconcileSharedEpisodicFactsForTurn,
  shouldRequestEpisodicInSharedInitial,
  SHARED_EPISODIC_EXTRACTION,
} from "./memory-episodic-shared";
import { getOrCreateChatMemory } from "./memory-db";
import { RAW_HISTORY_COMPLETE_EXCHANGES } from "./memory-constants";
import { resolveEpisodicMemoryMinAgeTurns } from "@/lib/episodicMemoryFacts";
import type { EpisodicExtractedFact } from "./memory-episodic-types";

const CHAT = 900101;
const USER = 900102;
const CHAR = 900103;

const VALID_FACT: EpisodicExtractedFact = {
  category: "preference",
  subject: "user",
  attribute: "favorite_drink",
  value: "syrup_coffee",
  importance: "important",
  fact_text: "사용자는 커피에 시럽을 두 번 넣어 마신다.",
  evidence_type: "explicit_user_statement",
};

const PROMISE_FACT: EpisodicExtractedFact = {
  category: "relationship",
  subject: "char_user",
  attribute: "promise",
  value: "meet_tomorrow",
  importance: "important",
  fact_text: "캐릭터는 내일 다시 만나자고 약속했다.",
  evidence_type: "explicit_scene_event",
};

const WIDGET: StatusWidget = {
  ...DEFAULT_STATUS_WIDGET,
  fields: [{ id: "place", label: "장소", instruction: "현재 장소" }],
};

function characterResolved(): ResolvedStatusWidgetTurn {
  return {
    active: true,
    requestedMode: "character_only",
    mode: "character_only",
    displayMode: "creator",
    stackOrder: "character_first",
    characterWidget: WIDGET,
    userWidget: null,
    needsCharacterValues: true,
    needsUserValues: false,
  };
}

function sharedStatusWidgetPayload() {
  const character_values: Record<string, string> = {};
  for (const key of collectWidgetJsonKeys(WIDGET)) character_values[key] = "복도";
  return { statusWidget: { character_values } };
}

function episodicPayload(facts: EpisodicExtractedFact[] = [VALID_FACT]) {
  return { episodic: { extracted_facts: facts } };
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

function seedTurn(assistantId: number, userId: number) {
  const db = getDb();
  db.prepare(`INSERT INTO messages (id, chat_id, role, content) VALUES (?,?,?,?)`).run(
    userId,
    CHAT,
    "user",
    "user message"
  );
  db.prepare(
    `INSERT INTO messages (id, chat_id, role, content, user_message_id, generation_status, model)
     VALUES (?, ?, 'assistant', ?, ?, 'canonical', 'test-model')`
  ).run(assistantId, CHAT, "assistant prose", userId);
}

before(() => installIsolatedTestDatabase());
after(() => uninstallIsolatedTestDatabase());

before(() => {
  cleanup();
  const db = getDb();
  db.prepare(`INSERT INTO users (id, email, nickname, pw_hash) VALUES (?,?,?,?)`).run(
    USER,
    `sh-${USER}@test.local`,
    "sh",
    "x"
  );
  db.prepare(`INSERT INTO characters (id, name) VALUES (?,?)`).run(CHAR, "ShChar");
  db.prepare(`INSERT INTO chats (id, user_id, character_id, mode) VALUES (?,?,?,'safe')`).run(
    CHAT,
    USER,
    CHAR
  );
  getOrCreateChatMemory(CHAT, USER, CHAR, "free");
  seedTurn(1001, 1000);
});

after(() => cleanup());

describe("shared initial episodic consumer", () => {
  it("S3 memory OFF → shouldRequestEpisodicInSharedInitial false", () => {
    assert.equal(
      shouldRequestEpisodicInSharedInitial({
        userMessage: "hello",
        memoryFeatureEnabled: false,
      }),
      false
    );
  });

  it("S4 valid episodic [] is semantic empty not failure", () => {
    const parsed = parseSharedEpisodicSection({ extracted_facts: [] });
    assert.equal(parsed.present, true);
    assert.equal(parsed.valid, true);
    assert.deepEqual(parsed.facts, []);
  });

  it("S5 episodic invalid does not break relationship parse", () => {
    const text = JSON.stringify({
      relationship: {
        items: ["렌: 검"],
        itemsRemove: [],
        promisesAdd: [],
        promisesRemove: [],
      },
      episodic: { extracted_facts: [{ bad: true }] },
    });
    const parsed = parsePostTurnSharedInitialResponse(text, {
      mode: "relationship_only",
      charName: "c",
      personaName: "u",
      userMessage: "m",
      assistantProse: "a",
      primaryModelId: "gpt-5.6-luna",
      includeSuggestions: false,
      includeRelationship: true,
      includeEpisodic: true,
      relationshipRegenContext: null,
    });
    assert.equal(parsed.relationship.valid, true);
    assert.equal(parsed.episodic.valid, false);
  });

  it("S6 relationship-owned promise in episodic is rejected at persist", () => {
    assert.ok(detectRelationshipLedgerOwnedFact(PROMISE_FACT));
    const result = reconcileSharedEpisodicFactsForTurn(getDb(), {
      chatId: CHAT,
      userId: USER,
      characterId: CHAR,
      assistantMessageId: 1001,
      sourceUserMessageId: 1000,
      sourceUserText: "user message",
      episodic: parseSharedEpisodicSection({ extracted_facts: [PROMISE_FACT] }),
      isRegeneration: false,
    });
    assert.equal(result.inserted, 0);
    const count = getDb()
      .prepare("SELECT COUNT(*) AS c FROM episodic_memory_facts WHERE chat_id=?")
      .get(CHAT) as { c: number };
    assert.equal(count.c, 0);
  });

  it("S7 explicit durable event persists with shared extraction metadata", () => {
    const result = reconcileSharedEpisodicFactsForTurn(getDb(), {
      chatId: CHAT,
      userId: USER,
      characterId: CHAR,
      assistantMessageId: 1001,
      sourceUserMessageId: 1000,
      sourceUserText: "커피에 시럽을 두 번 넣어.",
      episodic: parseSharedEpisodicSection({ extracted_facts: [VALID_FACT] }),
      isRegeneration: false,
    });
    assert.equal(result.inserted, 1);
    const row = getDb()
      .prepare(
        "SELECT metadata FROM episodic_memory_facts WHERE chat_id=? AND source_turn=1 LIMIT 1"
      )
      .get(CHAT) as { metadata: string };
    const meta = JSON.parse(row.metadata) as { extraction?: string };
    assert.equal(meta.extraction, SHARED_EPISODIC_EXTRACTION);
  });

  it("S8 regen old A → new B replaces facts", () => {
    getDb().prepare("DELETE FROM episodic_memory_facts WHERE chat_id=?").run(CHAT);
    reconcileSharedEpisodicFactsForTurn(getDb(), {
      chatId: CHAT,
      userId: USER,
      characterId: CHAR,
      assistantMessageId: 1001,
      sourceUserMessageId: 1000,
      sourceUserText: "old",
      episodic: parseSharedEpisodicSection({ extracted_facts: [VALID_FACT] }),
      isRegeneration: true,
    });
    const factB: EpisodicExtractedFact = {
      category: "character",
      subject: "char",
      attribute: "action",
      value: "nodded",
      importance: "normal",
      fact_text: "캐릭터는 고개를 끄덕였다.",
      evidence_type: "explicit_scene_event",
    };
    reconcileSharedEpisodicFactsForTurn(getDb(), {
      chatId: CHAT,
      userId: USER,
      characterId: CHAR,
      assistantMessageId: 1001,
      sourceUserMessageId: 1000,
      sourceUserText: "user message",
      episodic: parseSharedEpisodicSection({ extracted_facts: [factB] }),
      isRegeneration: true,
    });
    const rows = getDb()
      .prepare("SELECT fact_text FROM episodic_memory_facts WHERE chat_id=? AND source_turn=1")
      .all(CHAT) as { fact_text: string }[];
    assert.equal(rows.length, 1);
    assert.equal(rows[0]!.fact_text, "캐릭터는 고개를 끄덕였다.");
  });

  it("S9 regen valid empty removes old facts", () => {
    getDb().prepare("DELETE FROM episodic_memory_facts WHERE chat_id=?").run(CHAT);
    reconcileSharedEpisodicFactsForTurn(getDb(), {
      chatId: CHAT,
      userId: USER,
      characterId: CHAR,
      assistantMessageId: 1001,
      sourceUserMessageId: 1000,
      sourceUserText: "old",
      episodic: parseSharedEpisodicSection({ extracted_facts: [VALID_FACT] }),
      isRegeneration: true,
    });
    reconcileSharedEpisodicFactsForTurn(getDb(), {
      chatId: CHAT,
      userId: USER,
      characterId: CHAR,
      assistantMessageId: 1001,
      sourceUserMessageId: 1000,
      sourceUserText: "new",
      episodic: parseSharedEpisodicSection({ extracted_facts: [] }),
      isRegeneration: true,
    });
    const count = getDb()
      .prepare("SELECT COUNT(*) AS c FROM episodic_memory_facts WHERE chat_id=? AND source_turn=1")
      .get(CHAT) as { c: number };
    assert.equal(count.c, 0);
  });

  it("S10 regen episodic failure removes old facts (wrong memory > missing)", () => {
    getDb().prepare("DELETE FROM episodic_memory_facts WHERE chat_id=?").run(CHAT);
    reconcileSharedEpisodicFactsForTurn(getDb(), {
      chatId: CHAT,
      userId: USER,
      characterId: CHAR,
      assistantMessageId: 1001,
      sourceUserMessageId: 1000,
      sourceUserText: "old",
      episodic: parseSharedEpisodicSection({ extracted_facts: [VALID_FACT] }),
      isRegeneration: true,
    });
    reconcileSharedEpisodicFactsForTurn(getDb(), {
      chatId: CHAT,
      userId: USER,
      characterId: CHAR,
      assistantMessageId: 1001,
      sourceUserMessageId: 1000,
      sourceUserText: "new",
      episodic: { present: true, valid: false, facts: [] },
      isRegeneration: true,
    });
    const count = getDb()
      .prepare("SELECT COUNT(*) AS c FROM episodic_memory_facts WHERE chat_id=? AND source_turn=1")
      .get(CHAT) as { c: number };
    assert.equal(count.c, 0);
  });

  it("S13 RAW4/min-age-5 boundary preserved", () => {
    assert.equal(RAW_HISTORY_COMPLETE_EXCHANGES, 4);
    assert.equal(resolveEpisodicMemoryMinAgeTurns(), 5);
    getDb().prepare("DELETE FROM episodic_memory_facts WHERE chat_id=?").run(CHAT);
    reconcileSharedEpisodicFactsForTurn(getDb(), {
      chatId: CHAT,
      userId: USER,
      characterId: CHAR,
      assistantMessageId: 1001,
      sourceUserMessageId: 1000,
      sourceUserText: "커피에 시럽을 두 번 넣어.",
      episodic: parseSharedEpisodicSection({ extracted_facts: [VALID_FACT] }),
      isRegeneration: false,
    });
    const db = getDb();
    const blocked = getEpisodicMemoryForPrompt(
      db,
      {
        chatId: CHAT,
        characterId: CHAR,
        userId: USER,
        currentTurn: 2,
        currentUserMessage: "next",
        recentChatText: "커피에 시럽을 두 번 넣어.",
      },
      { EPISODIC_MEMORY_RECALL_ENABLED: "1" }
    );
    assert.equal(
      blocked.facts.length,
      0,
      "turn-1 fact blocked while overlapping RAW window"
    );
    const eligible = getEpisodicMemoryForPrompt(
      db,
      {
        chatId: CHAT,
        characterId: CHAR,
        userId: USER,
        currentTurn: 6,
        currentUserMessage: "later",
        recentChatText: "unrelated recent",
      },
      { EPISODIC_MEMORY_RECALL_ENABLED: "1" }
    );
    assert.equal(eligible.facts.length, 1);
  });

  it("S15 rolling summary path does not call background-episodic-extract", () => {
    const rolling = readFileSync(
      new URL("./memory-rolling-summary.ts", import.meta.url),
      "utf8"
    );
    assert.match(rolling, /EPISODIC_SEAL_BATCH_EXTRACT_ENABLED = false/);
    __resetEpisodicExtractCallCountForTests();
    assert.equal(__getEpisodicExtractCallCountForTests(), 0);
  });

  it("S16 status ON + memory ON → exactly one shared initial call with episodic", async () => {
    const calls: string[] = [];
    await extractStatusWidgetValuesForTurn({
      charName: "ShChar",
      personaName: "유저",
      userMessage: "커피에 시럽을 두 번 넣어.",
      assistantProse: "알겠어.",
      resolved: characterResolved(),
      shareRelationshipDelta: true,
      shareEpisodic: true,
      coalesceSuggestedReplies: { enabled: false },
      caller: async (_s, _h, opts) => {
        calls.push(opts.requestKind);
        return {
          text: JSON.stringify({
            ...sharedStatusWidgetPayload(),
            relationship: {
              items: [],
              itemsRemove: [],
              promisesAdd: [],
              promisesRemove: [],
            },
            episodic: { extracted_facts: [VALID_FACT] },
          }),
          usage: { inputTokens: 1, outputTokens: 1, estimated: true },
        };
      },
    });
    assert.deepEqual(calls, [POST_TURN_SHARED_INITIAL_REQUEST_KIND]);
  });

  it("S2 status OFF deferred shared includes episodic", async () => {
    const calls: string[] = [];
    await runPostTurnRelationshipOnlyInitial(
      {
        charName: "ShChar",
        personaName: "유저",
        userMessage: "커피에 시럽을 두 번 넣어.",
        assistantProse: "알겠어.",
        primaryModelId: "gpt-5.6-luna",
        includeRelationship: true,
        includeEpisodic: true,
      },
      async (_s, _h, opts) => {
        calls.push(opts.requestKind);
        return {
          text: JSON.stringify({
            relationship: {
              items: [],
              itemsRemove: [],
              promisesAdd: [],
              promisesRemove: [],
            },
            episodic: { extracted_facts: [VALID_FACT] },
          }),
          usage: { inputTokens: 1, outputTokens: 1, estimated: true },
        };
      }
    );
    assert.deepEqual(calls, [POST_TURN_SHARED_INITIAL_REQUEST_KIND]);
  });

  it("prompt inventory: episodic rules appear once; status scoped separately", () => {
    const userWidget: StatusWidget = {
      ...DEFAULT_STATUS_WIDGET,
      fields: [{ id: "note", label: "메모", instruction: "메모" }],
    };
    const system = buildPostTurnSharedInitialSystem({
      mode: "dual",
      charName: "c",
      personaName: "u",
      userMessage: "m",
      assistantProse: "a",
      characterWidget: WIDGET,
      userWidget,
      primaryModelId: "gpt-5.6-luna",
      includeSuggestions: false,
      includeRelationship: true,
      includeEpisodic: true,
      relationshipRegenContext: null,
    });
    const matches = system.match(/Structured facts for long-term episodic memory/g) ?? [];
    assert.equal(matches.length, 1);
    assert.match(system, /statusWidget section — current-turn UI snapshot only/);
    assert.doesNotMatch(system, /Return exactly one JSON object with this shape:[\s\S]*extracted_facts/);
    assert.ok(system.includes(EPISODIC_FACTS_EXTRACT_INSTRUCTIONS.slice(0, 40)));
  });

  it("prompt inventory: regen episodic grounded in NEW canonical assistant", () => {
    const system = buildPostTurnSharedInitialSystem({
      mode: "relationship_only",
      charName: "c",
      personaName: "u",
      userMessage: "m",
      assistantProse: "new canonical",
      primaryModelId: "gpt-5.6-luna",
      includeSuggestions: false,
      includeRelationship: true,
      includeEpisodic: true,
      relationshipRegenContext: { previousAssistantMessage: "rejected draft" },
    });
    assert.match(system, /NEW canonical assistant/);
    assert.match(system, /Do NOT copy facts from the rejected assistant draft/);
  });

  it("route wires episodic through scheduleMemoryUpdate not direct INSERT", () => {
    const route = readFileSync(new URL("../../app/api/chat/route.ts", import.meta.url), "utf8");
    const manager = readFileSync(new URL("./memory-manager.ts", import.meta.url), "utf8");
    assert.doesNotMatch(route, /INSERT INTO episodic_memory_facts/);
    assert.match(route, /sharedInitialEpisodic/);
    assert.match(route, /episodicSharedAttempted/);
    assert.match(manager, /reconcileSharedEpisodicFactsForTurn/);
  });
});
