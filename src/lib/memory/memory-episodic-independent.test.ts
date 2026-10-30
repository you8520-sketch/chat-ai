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
import { readFileSync } from "node:fs";
import { after, afterEach, before, beforeEach, describe, it } from "node:test";
import { getDb } from "@/lib/db";
import {
  installIsolatedTestDatabase,
  uninstallIsolatedTestDatabase,
} from "@/lib/test/isolatedTestDatabase";
import {
  REN_WOLFGANG_ASSISTANT_TEXT,
  REN_WOLFGANG_QUOTES,
  REN_WOLFGANG_USER_TEXT,
} from "@/lib/test/renWolfgangSafeFixture";
import {
  resolveActiveAssistantGenerationScope,
  type AssistantGenerationScope,
} from "@/lib/assistantGenerationScope";
import { deleteEpisodicMemoryFactsByAssistantMessageIds, deleteSharedEpisodicFactsForEditedUserSource } from "@/lib/episodicMemoryFacts";
import { countPostTurnSharedInitialPhysicalRows } from "@/lib/asyncTurnCoverage";
import {
  listProviderCostEventsForAssistantGeneration,
  startProviderCostAttempt,
  buildPlatformAsyncTurnLedgerContext,
} from "@/lib/providerCostLedger";
import { bootstrapStreamingTurn } from "@/lib/streamingPersistence";
import { buildPostTurnSharedInitialSystem } from "@/lib/postTurnSharedInitial/prompt";
import { runPostTurnRelationshipOnlyInitial } from "@/lib/postTurnSharedInitial/run";
import {
  POST_TURN_EPISODIC_REQUEST_KIND,
  POST_TURN_SHARED_INITIAL_REQUEST_KIND,
} from "@/lib/postTurnSharedInitial/types";
import type { StatusWidgetExtractCaller } from "@/lib/statusWidget/extract";
import { loadChatRelationshipMeta } from "./memory-relationship-meta";
import { getOrCreateChatMemory } from "./memory-db";
import { initializeForkMemoryBoundaryCore } from "./memory-source-boundary";
import { scheduleMemoryUpdate } from "./memory-manager";
import {
  startIndependentEpisodicExtraction,
  type IndependentEpisodicOutcome,
} from "./memory-episodic-independent";
import { SHARED_EPISODIC_EXTRACTION } from "./memory-episodic-shared";

const USER = 934101;
const CHAR = 934103;
const CHAT_BASE = 934200;
const NAMES = { charName: "볼프강", userName: "렌" };

let chatCounter = 0;

type Turn = { chatId: number; userMessageId: number; assistantMessageId: number };

const REFUSAL_FACT = {
  category: "relationship",
  subject: "ren",
  attribute: "statement_forwarding_consent",
  value: "refused_inspector_forwarding",
  importance: "important",
  fact_text: "렌은 자신의 진술을 황실 감찰관에게 전달하는 데 동의하지 않았다.",
  evidence_type: "explicit_user_statement",
  evidence: { source_role: "user", source_quote: REN_WOLFGANG_QUOTES.userRefusal },
  corrects: "",
};

const REVIEW_FIRST_FACT = {
  category: "relationship",
  subject: "ren",
  attribute: "record_review_order",
  value: "review_records_before_choosing_recipient",
  importance: "important",
  fact_text: "렌은 기록을 먼저 직접 확인한 뒤 전달 대상을 정하겠다고 했다.",
  evidence_type: "explicit_user_statement",
  evidence: { source_role: "user", source_quote: REN_WOLFGANG_QUOTES.userReviewFirst },
  corrects: "",
};

const FORWARD_BAN_FACT = {
  category: "rule",
  subject: "wolfgang",
  attribute: "forwarding_ban_order",
  value: "ordered_soldier_not_to_forward_statement",
  importance: "important",
  fact_text: "볼프강은 병사에게 렌의 진술을 감찰관에게 전달하지 말라고 명령했다.",
  evidence_type: "explicit_scene_event",
  evidence: { source_role: "assistant", source_quote: REN_WOLFGANG_QUOTES.wolfgangForwardBan },
  corrects: "",
};

const FABRICATED_QUOTE_FACT = {
  ...REFUSAL_FACT,
  attribute: "fabricated_quote",
  value: "invented_statement",
  evidence: { source_role: "user", source_quote: "나는 절대로 감찰관을 만나지 않겠다고 맹세했다." },
};

type FakeProvider = {
  caller: StatusWidgetExtractCaller;
  calls: { system: string; user: string; requestKind: string }[];
};

function fakeProvider(
  respond: (call: number) => string | Promise<string> | Error
): FakeProvider {
  const calls: FakeProvider["calls"] = [];
  const caller: StatusWidgetExtractCaller = async (system, history, opts) => {
    calls.push({
      system,
      user: history.map((message) => message.content).join("\n"),
      requestKind: opts.requestKind,
    });
    const next = await respond(calls.length);
    if (next instanceof Error) throw next;
    return { text: next, usage: { inputTokens: 10, outputTokens: 10, estimated: true } };
  };
  return { caller, calls };
}

function episodicJson(facts: unknown[]): string {
  return JSON.stringify({ episodic: { extracted_facts: facts } });
}

function seedTurn(): Turn {
  const db = getDb();
  chatCounter += 1;
  const chatId = CHAT_BASE + chatCounter;
  const userMessageId = chatId * 10 + 1;
  const assistantMessageId = chatId * 10 + 2;
  db.prepare(`INSERT INTO chats (id, user_id, character_id, mode, memory_meta) VALUES (?,?,?,'safe','{}')`).run(
    chatId,
    USER,
    CHAR
  );
  getOrCreateChatMemory(chatId, USER, CHAR, "free");
  db.prepare(`INSERT INTO messages (id, chat_id, role, content) VALUES (?,?,?,?)`).run(
    userMessageId,
    chatId,
    "user",
    REN_WOLFGANG_USER_TEXT
  );
  db.prepare(
    `INSERT INTO messages (id, chat_id, role, content, user_message_id, generation_status, model, alternates, active_variant)
     VALUES (?, ?, 'assistant', ?, ?, 'completed', 'test-model', '[]', 0)`
  ).run(assistantMessageId, chatId, REN_WOLFGANG_ASSISTANT_TEXT, userMessageId);
  return { chatId, userMessageId, assistantMessageId };
}

/** Appends a finalized regeneration variant (sequence 1) and makes it the active generation. */
function finalizeRegenVariant(turn: Turn, requestId: string) {
  const db = getDb();
  const variant = (sequence: number, request: string | null) => ({
    content: REN_WOLFGANG_ASSISTANT_TEXT,
    model: "test-model",
    usage: null,
    created_at: "",
    generationSequence: sequence,
    requestId: request,
  });
  db.prepare(
    `UPDATE messages SET alternates=?, active_variant=1, generation_status='completed', request_id=? WHERE id=?`
  ).run(JSON.stringify([variant(0, null), variant(1, requestId)]), requestId, turn.assistantMessageId);
}

function currentScope(turn: Turn): AssistantGenerationScope {
  const scope = resolveActiveAssistantGenerationScope(turn.assistantMessageId);
  assert.ok(scope, "assistant generation scope");
  return scope;
}

function factRows(chatId: number) {
  return getDb()
    .prepare(
      `SELECT id, source_turn, fact_text, metadata FROM episodic_memory_facts WHERE chat_id=? ORDER BY id`
    )
    .all(chatId) as { id: number; source_turn: number; fact_text: string; metadata: string }[];
}

function extraction(turn: Turn, provider: FakeProvider, overrides: Partial<Parameters<typeof startIndependentEpisodicExtraction>[0]> = {}) {
  return startIndependentEpisodicExtraction(
    {
      eligible: true,
      chatId: turn.chatId,
      assistantMessageId: turn.assistantMessageId,
      sourceUserMessageId: turn.userMessageId,
      generationScope: currentScope(turn),
      charName: NAMES.charName,
      personaName: NAMES.userName,
      userMessage: REN_WOLFGANG_USER_TEXT,
      assistantProse: REN_WOLFGANG_ASSISTANT_TEXT,
      correctionCandidates: [],
      ...overrides,
    },
    { caller: provider.caller }
  );
}

type CommitOverrides = {
  isRegenerate?: boolean;
  generationScope?: AssistantGenerationScope;
  relationshipSharedParsed?: boolean;
  relationshipSharedDelta?: { items?: string[] };
};

async function commit(
  turn: Turn,
  episodicExtraction: Promise<IndependentEpisodicOutcome> | undefined,
  overrides: CommitOverrides = {}
) {
  await scheduleMemoryUpdate({
    chatId: turn.chatId,
    userId: USER,
    characterId: CHAR,
    relationshipNames: NAMES as never,
    tier: "free",
    memoryCapacity: 10000,
    userMessage: REN_WOLFGANG_USER_TEXT,
    assistantMessage: REN_WOLFGANG_ASSISTANT_TEXT,
    assistantMessageId: turn.assistantMessageId,
    sourceUserMessageId: turn.userMessageId,
    route: "safe",
    relationshipSharedAttempted: true,
    relationshipSharedParsed: overrides.relationshipSharedParsed ?? false,
    relationshipSharedDelta: overrides.relationshipSharedDelta as never,
    isRegenerate: overrides.isRegenerate,
    previousAssistantMessage: overrides.isRegenerate ? "rejected previous draft" : undefined,
    generationScope: overrides.generationScope ?? currentScope(turn),
    episodicExtraction,
  });
}

function seedStoredFact(turn: Turn, scope: AssistantGenerationScope, factText: string) {
  getDb()
    .prepare(
      `INSERT INTO episodic_memory_facts
        (chat_id, character_id, user_id, source_turn, source_user_message_id, category, subject, attribute, value, importance, fact_text, metadata)
       VALUES (?, ?, ?, 1, ?, 'relationship', 'ren', 'seeded', 'seeded_value', 'important', ?, ?)`
    )
    .run(
      turn.chatId,
      CHAR,
      USER,
      turn.userMessageId,
      factText,
      JSON.stringify({
        extraction: SHARED_EPISODIC_EXTRACTION,
        assistant_message_id: turn.assistantMessageId,
        generation_sequence: scope.generationSequence,
        request_id: "seeded-request",
      })
    );
}

before(() => installIsolatedTestDatabase());
after(() => uninstallIsolatedTestDatabase());

let prevMemoryFeature: string | undefined;

beforeEach(() => {
  const db = getDb();
  db.prepare(`INSERT OR IGNORE INTO users (id, email, nickname, pw_hash) VALUES (?,?,?,?)`).run(
    USER,
    `indep-${USER}@test.local`,
    "indep",
    "x"
  );
  db.prepare(`INSERT OR IGNORE INTO characters (id, name) VALUES (?,?)`).run(CHAR, "볼프강");
  prevMemoryFeature = process.env.MEMORY_FEATURE_ENABLED;
  process.env.MEMORY_FEATURE_ENABLED = "1";
});

afterEach(() => {
  if (prevMemoryFeature === undefined) delete process.env.MEMORY_FEATURE_ENABLED;
  else process.env.MEMORY_FEATURE_ENABLED = prevMemoryFeature;
});

describe("B34 independent episodic — normal turn", () => {
  it("stores the two USER events and Wolfgang's forwarding ban from one episodic-only call", async () => {
    const turn = seedTurn();
    const provider = fakeProvider(() => episodicJson([REFUSAL_FACT, REVIEW_FIRST_FACT, FORWARD_BAN_FACT]));
    await commit(turn, extraction(turn, provider));

    assert.equal(provider.calls.length, 1);
    assert.equal(provider.calls[0]!.requestKind, POST_TURN_EPISODIC_REQUEST_KIND);
    const rows = factRows(turn.chatId);
    assert.equal(rows.length, 3);
    const texts = rows.map((row) => row.fact_text).join("\n");
    assert.match(texts, /동의하지 않았다/);
    assert.match(texts, /먼저 직접 확인/);
    assert.match(texts, /전달하지 말라고 명령/);
    for (const row of rows) {
      const metadata = JSON.parse(row.metadata) as Record<string, unknown>;
      assert.equal(metadata.extraction, SHARED_EPISODIC_EXTRACTION);
      assert.equal(metadata.assistant_message_id, turn.assistantMessageId);
    }
  });

  it("the independent call requests only the episodic section (no widget/suggestions/relationship)", async () => {
    const turn = seedTurn();
    const provider = fakeProvider(() => episodicJson([]));
    await extraction(turn, provider);
    const { system, user } = provider.calls[0]!;
    assert.match(system, /EPISODIC section/);
    assert.doesNotMatch(system, /statusWidget/);
    assert.doesNotMatch(system, /suggestedReplies/);
    assert.doesNotMatch(system, /promisesAdd/);
    assert.ok(user.includes(REN_WOLFGANG_USER_TEXT));
    assert.ok(user.includes(REN_WOLFGANG_ASSISTANT_TEXT));
  });

  it("Shared Initial status-OFF runner no longer carries episodic unless explicitly requested", async () => {
    const provider = fakeProvider(() => JSON.stringify({ relationship: { items: [], itemsRemove: [], promisesAdd: [], promisesRemove: [] } }));
    await runPostTurnRelationshipOnlyInitial(
      {
        charName: "c",
        personaName: "u",
        userMessage: "m",
        assistantProse: "a",
        primaryModelId: "gpt-6-luna",
        includeSuggestions: false,
        includeRelationship: true,
        activePromises: [],
      },
      provider.caller
    );
    assert.doesNotMatch(provider.calls[0]!.system, /EPISODIC section/);
    assert.equal(provider.calls[0]!.requestKind, POST_TURN_SHARED_INITIAL_REQUEST_KIND);
    const widgetSystem = buildPostTurnSharedInitialSystem({
      mode: "character",
      charName: "c",
      personaName: "u",
      userMessage: "m",
      assistantProse: "a",
      primaryModelId: "gpt-6-luna",
      includeSuggestions: true,
      includeRelationship: true,
      includeEpisodic: false,
      relationshipRegenContext: null,
      activePromises: [],
    });
    assert.doesNotMatch(widgetSystem, /EPISODIC section/);
  });

  it("route no longer asks Shared Initial for episodic and starts the independent call after done", () => {
    const route = readFileSync(new URL("../../app/api/chat/route.ts", import.meta.url), "utf8");
    assert.doesNotMatch(route, /shareEpisodic/);
    assert.doesNotMatch(route, /includeEpisodic/);
    assert.doesNotMatch(route, /widgetSharedEpisodic/);
    const doneAt = route.indexOf('type: "done"');
    const startAt = route.indexOf("startIndependentEpisodicExtraction({");
    const tailAt = route.indexOf("const turnTail = (async () => {");
    assert.ok(doneAt > 0 && tailAt > doneAt, "tail follows SSE done");
    assert.ok(startAt > tailAt, "independent episodic starts inside the post-done tail");
    assert.match(route, /episodicExtraction,/);
  });
});

describe("B34 independent episodic — failure isolation", () => {
  it("shared success + episodic failure: relationship delta commits, no facts, no throw", async () => {
    const turn = seedTurn();
    const provider = fakeProvider(() => new Error("provider timeout"));
    await commit(turn, extraction(turn, provider), {
      relationshipSharedParsed: true,
      relationshipSharedDelta: { items: ["렌: 서약서 거절"] },
    });
    assert.equal(factRows(turn.chatId).length, 0);
    const meta = loadChatRelationshipMeta(turn.chatId, NAMES as never);
    assert.ok(meta.items.some((item) => item.includes("서약서 거절")));
  });

  it("shared failure + episodic success: facts are stored independently", async () => {
    const turn = seedTurn();
    const provider = fakeProvider(() => episodicJson([REFUSAL_FACT]));
    await commit(turn, extraction(turn, provider), { relationshipSharedParsed: false });
    assert.equal(factRows(turn.chatId).length, 1);
  });

  it("both fail: nothing stored, nothing deleted", async () => {
    const turn = seedTurn();
    seedStoredFact(turn, currentScope(turn), "이전 턴 사실");
    const provider = fakeProvider(() => new Error("503"));
    await commit(turn, extraction(turn, provider), { relationshipSharedParsed: false });
    assert.deepEqual(
      factRows(turn.chatId).map((row) => row.fact_text),
      ["이전 턴 사실"]
    );
  });

  it("valid empty array is a no-op for a normal turn", async () => {
    const turn = seedTurn();
    const provider = fakeProvider(() => episodicJson([]));
    await commit(turn, extraction(turn, provider));
    assert.equal(factRows(turn.chatId).length, 0);
    assert.equal(provider.calls.length, 1);
  });

  it("malformed JSON is a section failure: no facts, no throw", async () => {
    const turn = seedTurn();
    const provider = fakeProvider(() => "{not json");
    const outcome = await extraction(turn, provider);
    assert.equal(outcome.status, "extracted");
    await commit(turn, Promise.resolve(outcome));
    assert.equal(factRows(turn.chatId).length, 0);
  });

  it("fabricated source quote is rejected by evidence verification (valid facts still stored)", async () => {
    const turn = seedTurn();
    const provider = fakeProvider(() => episodicJson([FABRICATED_QUOTE_FACT, REFUSAL_FACT]));
    await commit(turn, extraction(turn, provider));
    const rows = factRows(turn.chatId);
    assert.equal(rows.length, 1);
    assert.match(rows[0]!.fact_text, /동의하지 않았다/);
  });

  it("not eligible turn makes no provider call", async () => {
    const turn = seedTurn();
    const provider = fakeProvider(() => episodicJson([REFUSAL_FACT]));
    const outcome = await extraction(turn, provider, { eligible: false });
    assert.deepEqual(outcome, { status: "not_requested" });
    assert.equal(provider.calls.length, 0);
    await commit(turn, Promise.resolve(outcome));
    assert.equal(factRows(turn.chatId).length, 0);
  });

  it("memory feature OFF: no provider call and no write", async () => {
    process.env.MEMORY_FEATURE_ENABLED = "0";
    const turn = seedTurn();
    const provider = fakeProvider(() => episodicJson([REFUSAL_FACT]));
    const outcome = await extraction(turn, provider);
    assert.deepEqual(outcome, { status: "rejected", reason: "memory_gated" });
    assert.equal(provider.calls.length, 0);
    assert.equal(factRows(turn.chatId).length, 0);
  });

  it("source before the memory reset boundary (fork) makes no provider call", async () => {
    const turn = seedTurn();
    initializeForkMemoryBoundaryCore(getDb(), {
      chatId: turn.chatId,
      userId: USER,
      characterId: CHAR,
      tier: "free",
      resetAfterMessageId: turn.userMessageId + 1,
    });
    const provider = fakeProvider(() => episodicJson([REFUSAL_FACT]));
    const outcome = await extraction(turn, provider);
    assert.deepEqual(outcome, { status: "rejected", reason: "memory_gated" });
    assert.equal(provider.calls.length, 0);
  });

  it("memory epoch bumped while the call is in flight: late result is not written", async () => {
    const turn = seedTurn();
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const provider = fakeProvider(async () => {
      await gate;
      return episodicJson([REFUSAL_FACT]);
    });
    const pending = extraction(turn, provider);
    getDb().prepare(`UPDATE chat_memories SET memory_epoch = memory_epoch + 1 WHERE chat_id=?`).run(turn.chatId);
    release();
    await commit(turn, pending);
    assert.equal(factRows(turn.chatId).length, 0);
  });
});

describe("B34 independent episodic — idempotency (paid call vs stored result)", () => {
  it("a second invocation for the same generation makes no second provider call", async () => {
    const turn = seedTurn();
    const scope = currentScope(turn);
    const provider = fakeProvider(() => {
      // callBackgroundMemory records the physical attempt when it starts.
      startProviderCostAttempt({
        ...buildPlatformAsyncTurnLedgerContext({
          chatId: turn.chatId,
          assistantMessageId: turn.assistantMessageId,
          generationSequence: scope.generationSequence,
          generationRequestId: scope.generationRequestId,
          family: "post_turn_shared_initial",
          jobAttemptOrdinal: 1,
          requestKind: POST_TURN_EPISODIC_REQUEST_KIND,
        }),
        persistInTests: true,
      });
      return episodicJson([REFUSAL_FACT]);
    });
    const first = await extraction(turn, provider);
    const second = await extraction(turn, provider);
    assert.equal(first.status, "extracted");
    assert.deepEqual(second, { status: "rejected", reason: "duplicate_attempt" });
    assert.equal(provider.calls.length, 1, "exactly one paid provider call");
  });

  it("concurrent invocations for one generation start one provider call", async () => {
    const turn = seedTurn();
    const scope = currentScope(turn);
    const provider = fakeProvider(async () => {
      startProviderCostAttempt({
        ...buildPlatformAsyncTurnLedgerContext({
          chatId: turn.chatId,
          assistantMessageId: turn.assistantMessageId,
          generationSequence: scope.generationSequence,
          generationRequestId: scope.generationRequestId,
          family: "post_turn_shared_initial",
          jobAttemptOrdinal: 1,
          requestKind: POST_TURN_EPISODIC_REQUEST_KIND,
        }),
        persistInTests: true,
      });
      await new Promise((resolve) => setTimeout(resolve, 10));
      return episodicJson([REFUSAL_FACT]);
    });
    const [a, b] = await Promise.all([extraction(turn, provider), extraction(turn, provider)]);
    assert.equal(provider.calls.length, 1);
    assert.deepEqual(
      [a.status, b.status].sort(),
      ["extracted", "rejected"]
    );
  });

  it("a failed (unsettled) attempt is not retried for the same generation", async () => {
    const turn = seedTurn();
    const scope = currentScope(turn);
    startProviderCostAttempt({
      ...buildPlatformAsyncTurnLedgerContext({
        chatId: turn.chatId,
        assistantMessageId: turn.assistantMessageId,
        generationSequence: scope.generationSequence,
        generationRequestId: scope.generationRequestId,
        family: "post_turn_shared_initial",
        jobAttemptOrdinal: 1,
        requestKind: POST_TURN_EPISODIC_REQUEST_KIND,
      }),
      persistInTests: true,
    });
    const provider = fakeProvider(() => episodicJson([REFUSAL_FACT]));
    const outcome = await extraction(turn, provider);
    assert.deepEqual(outcome, { status: "rejected", reason: "duplicate_attempt" });
    assert.equal(provider.calls.length, 0);
  });

  it("a Shared Initial ledger row does not block the independent call (distinct identity)", async () => {
    const turn = seedTurn();
    const scope = currentScope(turn);
    startProviderCostAttempt({
      ...buildPlatformAsyncTurnLedgerContext({
        chatId: turn.chatId,
        assistantMessageId: turn.assistantMessageId,
        generationSequence: scope.generationSequence,
        generationRequestId: scope.generationRequestId,
        family: "post_turn_shared_initial",
        jobAttemptOrdinal: 1,
        requestKind: POST_TURN_SHARED_INITIAL_REQUEST_KIND,
      }),
      persistInTests: true,
    });
    const provider = fakeProvider(() => episodicJson([REFUSAL_FACT]));
    const outcome = await extraction(turn, provider);
    assert.equal(outcome.status, "extracted");
    assert.equal(provider.calls.length, 1);
  });

  it("re-delivering the same stored result does not duplicate rows", async () => {
    const turn = seedTurn();
    const scope: AssistantGenerationScope = { ...currentScope(turn), generationRequestId: "req-redelivered" };
    const provider = fakeProvider(() => episodicJson([REFUSAL_FACT, REVIEW_FIRST_FACT]));
    const outcome = await extraction(turn, provider, { generationScope: scope });
    await commit(turn, Promise.resolve(outcome), { generationScope: scope });
    await commit(turn, Promise.resolve(outcome), { generationScope: scope });
    assert.equal(factRows(turn.chatId).length, 2);
  });

  it("parallel completion of two identical results stores one set", async () => {
    const turn = seedTurn();
    const scope: AssistantGenerationScope = { ...currentScope(turn), generationRequestId: "req-parallel" };
    const outcome: IndependentEpisodicOutcome = await extraction(
      turn,
      fakeProvider(() => episodicJson([REFUSAL_FACT])),
      { generationScope: scope }
    );
    await Promise.all([
      commit(turn, Promise.resolve(outcome), { generationScope: scope }),
      commit(turn, Promise.resolve(outcome), { generationScope: scope }),
    ]);
    assert.equal(factRows(turn.chatId).length, 1);
  });
});

describe("B34 independent episodic — generation / regeneration safety", () => {
  it("regeneration replaces the previous variant's facts only after its own result arrives", async () => {
    const turn = seedTurn();
    const gen0 = currentScope(turn);
    seedStoredFact(turn, gen0, "gen0 사실");
    finalizeRegenVariant(turn, "regen-1");
    const gen1 = currentScope(turn);
    assert.equal(gen1.generationSequence, 1);

    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const provider = fakeProvider(async () => {
      await gate;
      return episodicJson([REVIEW_FIRST_FACT]);
    });
    const pending = extraction(turn, provider);
    const committing = commit(turn, pending, { isRegenerate: true, generationScope: gen1 });
    await new Promise((resolve) => setTimeout(resolve, 20));
    assert.deepEqual(
      factRows(turn.chatId).map((row) => row.fact_text),
      ["gen0 사실"],
      "old facts must survive until the independent result arrives"
    );
    release();
    await committing;
    const rows = factRows(turn.chatId);
    assert.equal(rows.length, 1);
    assert.match(rows[0]!.fact_text, /먼저 직접 확인/);
    assert.equal((JSON.parse(rows[0]!.metadata) as { generation_sequence: number }).generation_sequence, 1);
  });

  it("regeneration with a valid empty array replaces (clears) the previous variant's facts", async () => {
    const turn = seedTurn();
    seedStoredFact(turn, currentScope(turn), "gen0 사실");
    finalizeRegenVariant(turn, "regen-empty");
    const provider = fakeProvider(() => episodicJson([]));
    await commit(turn, extraction(turn, provider), { isRegenerate: true });
    assert.equal(factRows(turn.chatId).length, 0);
  });

  it("regeneration with provider failure keeps the former section-failure semantics (clears replaced variant)", async () => {
    const turn = seedTurn();
    seedStoredFact(turn, currentScope(turn), "gen0 사실");
    finalizeRegenVariant(turn, "regen-fail");
    const provider = fakeProvider(() => new Error("timeout"));
    await commit(turn, extraction(turn, provider), { isRegenerate: true });
    assert.equal(factRows(turn.chatId).length, 0);
  });

  it("stale generation at call time: no provider call, nothing deleted", async () => {
    const turn = seedTurn();
    const gen0 = currentScope(turn);
    seedStoredFact(turn, gen0, "gen0 사실");
    bootstrapStreamingTurn(getDb(), {
      chatId: turn.chatId,
      requestId: "regen-inflight",
      userContent: REN_WOLFGANG_USER_TEXT,
      skipUserInsert: true,
      existingUserMessageId: turn.userMessageId,
      regenerateAssistantId: turn.assistantMessageId,
    });
    const provider = fakeProvider(() => episodicJson([REFUSAL_FACT]));
    const outcome = await extraction(turn, provider, { generationScope: gen0 });
    assert.deepEqual(outcome, { status: "rejected", reason: "stale_generation" });
    assert.equal(provider.calls.length, 0);
    await commit(turn, Promise.resolve(outcome), { isRegenerate: true, generationScope: gen0 });
    assert.deepEqual(
      factRows(turn.chatId).map((row) => row.fact_text),
      ["gen0 사실"]
    );
  });

  it("late gen0 result arriving after gen1 committed cannot overwrite or delete gen1 facts", async () => {
    const turn = seedTurn();
    const gen0 = currentScope(turn);
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const slowGen0 = fakeProvider(async () => {
      await gate;
      return episodicJson([REFUSAL_FACT, REVIEW_FIRST_FACT]);
    });
    const lateGen0 = extraction(turn, slowGen0, { generationScope: gen0 });

    finalizeRegenVariant(turn, "regen-late");
    const gen1 = currentScope(turn);
    const gen1Provider = fakeProvider(() => episodicJson([FORWARD_BAN_FACT]));
    await commit(turn, extraction(turn, gen1Provider, { generationScope: gen1 }), {
      isRegenerate: true,
      generationScope: gen1,
    });
    const afterGen1 = factRows(turn.chatId).map((row) => row.fact_text);
    assert.equal(afterGen1.length, 1);
    assert.match(afterGen1[0]!, /전달하지 말라고 명령/);

    release();
    // Late gen0 arrival — both as a normal commit and as a (mis)labelled regeneration commit.
    await commit(turn, lateGen0, { generationScope: gen0 });
    await commit(turn, lateGen0, { isRegenerate: true, generationScope: gen0 });
    assert.deepEqual(
      factRows(turn.chatId).map((row) => row.fact_text),
      afterGen1
    );
  });

  it("message edit / delete clear independent-extraction rows through the existing owners", async () => {
    const turn = seedTurn();
    const provider = fakeProvider(() => episodicJson([REFUSAL_FACT, FORWARD_BAN_FACT]));
    await commit(turn, extraction(turn, provider));
    assert.equal(factRows(turn.chatId).length, 2);
    assert.equal(
      deleteSharedEpisodicFactsForEditedUserSource(getDb(), {
        chatId: turn.chatId,
        sourceUserMessageId: turn.userMessageId,
      }),
      2
    );

    const other = seedTurn();
    await commit(other, extraction(other, fakeProvider(() => episodicJson([REFUSAL_FACT]))));
    assert.equal(factRows(other.chatId).length, 1);
    assert.equal(
      deleteEpisodicMemoryFactsByAssistantMessageIds(getDb(), other.chatId, [other.assistantMessageId]),
      1
    );
  });

  it("legacy rows (both extraction tiers) coexist; a new normal turn adds without touching them", async () => {
    const turn = seedTurn();
    const db = getDb();
    for (const [extraction, text] of [
      ["summary_seal_batch", "레거시 배치 사실"],
      [SHARED_EPISODIC_EXTRACTION, "레거시 per-turn 사실"],
    ] as const) {
      db.prepare(
        `INSERT INTO episodic_memory_facts
          (chat_id, character_id, user_id, source_turn, source_user_message_id, category, subject, attribute, value, importance, fact_text, metadata)
         VALUES (?, ?, ?, 99, ?, 'relationship', 'ren', ?, 'legacy_value', 'important', ?, ?)`
      ).run(turn.chatId, CHAR, USER, turn.userMessageId, `legacy_${extraction}`, text, JSON.stringify({ extraction }));
    }
    await commit(turn, extraction(turn, fakeProvider(() => episodicJson([REFUSAL_FACT]))));
    const texts = factRows(turn.chatId).map((row) => row.fact_text);
    assert.ok(texts.includes("레거시 배치 사실"));
    assert.ok(texts.includes("레거시 per-turn 사실"));
    assert.equal(texts.length, 3);
  });
});

describe("B34 independent episodic — ledger identity and accounting", () => {
  it("one physical call = one platform-funded ledger row with a distinct request kind (wire proof)", async () => {
    const turn = seedTurn();
    const scope = currentScope(turn);
    const previousFetch = globalThis.fetch;
    const previousKey = process.env.CHEAPER_INFERENCE_API_KEY;
    const previousTestContext = process.env.NODE_TEST_CONTEXT;
    process.env.CHEAPER_INFERENCE_API_KEY = "test-key";
    const bodies: Record<string, unknown>[] = [];
    globalThis.fetch = (async (_input, init) => {
      bodies.push(JSON.parse(String(init?.body)) as Record<string, unknown>);
      return new Response(
        JSON.stringify({
          id: "req-b34-ledger-1",
          choices: [{ message: { content: episodicJson([REFUSAL_FACT]) }, finish_reason: "stop" }],
          usage: { prompt_tokens: 1200, completion_tokens: 80 },
        }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      );
    }) as typeof fetch;
    // The ledger writer skips persistence under the node test runner.
    delete process.env.NODE_TEST_CONTEXT;
    try {
      const outcome = await startIndependentEpisodicExtraction({
        eligible: true,
        chatId: turn.chatId,
        assistantMessageId: turn.assistantMessageId,
        sourceUserMessageId: turn.userMessageId,
        generationScope: scope,
        charName: NAMES.charName,
        personaName: NAMES.userName,
        userMessage: REN_WOLFGANG_USER_TEXT,
        assistantProse: REN_WOLFGANG_ASSISTANT_TEXT,
        correctionCandidates: [],
      });
      assert.equal(outcome.status, "extracted");
    } finally {
      globalThis.fetch = previousFetch;
      if (previousKey == null) delete process.env.CHEAPER_INFERENCE_API_KEY;
      else process.env.CHEAPER_INFERENCE_API_KEY = previousKey;
      if (previousTestContext != null) process.env.NODE_TEST_CONTEXT = previousTestContext;
    }

    assert.equal(bodies.length, 1);
    const wire = bodies[0] as {
      response_format?: { json_schema?: { schema?: { required?: string[]; properties?: Record<string, unknown> } } };
    };
    const schema = wire.response_format?.json_schema?.schema;
    assert.deepEqual(schema?.required, ["episodic"]);
    assert.deepEqual(Object.keys(schema?.properties ?? {}), ["episodic"]);

    const rows = listProviderCostEventsForAssistantGeneration(
      turn.assistantMessageId,
      scope.generationSequence,
      getDb()
    );
    assert.equal(rows.length, 1);
    assert.equal(rows[0]!.request_kind, POST_TURN_EPISODIC_REQUEST_KIND);
    assert.equal(rows[0]!.family, "post_turn_shared_initial");
    assert.equal(rows[0]!.funding_class, "platform_funded");
    assert.equal(rows[0]!.execution_phase, "async_post_turn");
    assert.notEqual(rows[0]!.request_kind, POST_TURN_SHARED_INITIAL_REQUEST_KIND);
    assert.equal(
      countPostTurnSharedInitialPhysicalRows(rows),
      0,
      "independent episodic row must not satisfy a Shared Initial consumer expectation"
    );
  });

  it("does not touch the user point settlement tables", async () => {
    const db = getDb();
    const tables = ["point_ledger", "chat_billing_settlements"].filter(
      (name) => db.prepare(`SELECT 1 FROM sqlite_master WHERE name=?`).get(name) != null
    );
    const count = (name: string) =>
      (db.prepare(`SELECT COUNT(*) AS c FROM ${name}`).get() as { c: number }).c;
    const before = tables.map(count);
    const turn = seedTurn();
    await commit(turn, extraction(turn, fakeProvider(() => episodicJson([REFUSAL_FACT]))));
    assert.deepEqual(tables.map(count), before);
  });
});

const B34_LIVE_RUNS_URL = new URL(
  "../../../docs/evidence/b34-pr1718/live-runs-detailed.jsonl",
  import.meta.url
);

type B34LiveRun = { path: string; run: number; providerText: string; rawFactCount: number };

function b34IndependentLiveRuns(): B34LiveRun[] {
  return readFileSync(B34_LIVE_RUNS_URL, "utf8")
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line) as B34LiveRun)
    .filter((entry) => entry.path === "NEW_independent_episodic");
}

describe("B35 — B34 live provider output replayed through the canonical persist path", () => {
  const runs = b34IndependentLiveRuns();

  it("fixture holds the five captured live runs", () => {
    assert.equal(runs.length, 5);
  });

  for (const index of [0, 1, 2, 3, 4]) {
    it(`live run ${index + 1}: every verbatim-quoted event is stored (no owner/canonicalization drop)`, async () => {
      const live = runs[index]!;
      const turn = seedTurn();
      const provider = fakeProvider(() => live.providerText);
      await commit(turn, extraction(turn, provider));
      assert.equal(factRows(turn.chatId).length, live.rawFactCount);
    });
  }
});

describe("B35 — attribute naming must not change whether the same event is stored", () => {
  const ATTRIBUTES = [
    "statement_consent",
    "consent_to_statement_transfer",
    "refused_statement_transfer",
    "statement_transferred_refusal",
    "statement_received_refusal",
  ];

  for (const attribute of ATTRIBUTES) {
    it(`USER refusal to forward the statement is stored with attribute ${attribute}`, async () => {
      const turn = seedTurn();
      const provider = fakeProvider(() => episodicJson([{ ...REFUSAL_FACT, attribute }]));
      await commit(turn, extraction(turn, provider));
      assert.equal(factRows(turn.chatId).length, 1);
    });
  }

  it("withdrawal of consent to disclose the record is stored even with a transfer attribute", async () => {
    const turn = seedTurn();
    const withdrawal = {
      ...REFUSAL_FACT,
      category: "character",
      attribute: "record_disclosure_consent_transfer",
      value: "consent_withdrawn",
      fact_text: "렌은 기록을 황실 감찰관에게 공개하는 데 대한 동의를 철회했다.",
    };
    const provider = fakeProvider(() => episodicJson([withdrawal]));
    await commit(turn, extraction(turn, provider));
    assert.equal(factRows(turn.chatId).length, 1);
  });

  it("a transfer-attribute consent claim without a verifiable source quote is still rejected", async () => {
    const turn = seedTurn();
    const unsourced = {
      ...FABRICATED_QUOTE_FACT,
      attribute: "consent_to_statement_transfer",
    };
    const missingEvidence = {
      ...REFUSAL_FACT,
      attribute: "refused_statement_transfer",
      evidence: undefined,
    };
    const provider = fakeProvider(() => episodicJson([unsourced, missingEvidence]));
    await commit(turn, extraction(turn, provider));
    assert.equal(factRows(turn.chatId).length, 0);
  });

  it("a real item handover stays owned by the Relationship Ledger and is not stored as an episodic fact", async () => {
    const turn = seedTurn();
    const handover = {
      category: "item",
      subject: "ren",
      attribute: "item_transfer",
      value: "silver_ring_to_wolfgang",
      importance: "important",
      fact_text: "렌은 은반지를 볼프강에게 건넸다.",
      evidence_type: "explicit_scene_event",
      evidence: { source_role: "assistant", source_quote: "볼프강은 렌의 손이 기록철 위에 얹히는 것을 말없이 지켜보았다." },
      corrects: "",
    };
    const provider = fakeProvider(() => episodicJson([handover]));
    await commit(turn, extraction(turn, provider));
    assert.equal(factRows(turn.chatId).length, 0);
  });
});
