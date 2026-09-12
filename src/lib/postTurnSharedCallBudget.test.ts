/**
 * Whole-turn post-turn physical-call budget contract.
 *
 * Invariant: a normal turn has <= 1 post-turn auxiliary GPT-5.6 Luna physical
 * invocation. Status widget values, suggested replies, and the durable
 * Relationship Memory delta are produced by ONE shared inference and consumed by
 * their own persistence owners.
 *
 * These tests use the extractor's mock caller seam (no network) plus the real
 * relationship persistence owner for the shared-delta consumption path.
 */

import assert from "node:assert/strict";
import { before, describe, it } from "node:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { getDb } from "./db";
import { installIsolatedTestDatabase } from "./test/isolatedTestDatabase";
import { DEFAULT_STATUS_WIDGET } from "./statusWidget/defaultTemplate";
import { collectWidgetJsonKeys } from "./statusWidget/prompt";
import type { ResolvedStatusWidgetTurn, StatusWidget } from "./statusWidget/types";
import {
  extractStatusWidgetValuesForTurn,
  type StatusWidgetExtractCaller,
} from "./statusWidget/extract";
import type { TokenUsage } from "./ai";
import { loadChatRelationshipMeta, mergeRelationshipMetaFromTurn, mergeRelationshipMetaAfterRegenerate } from "./memory/memory-relationship-meta";
import { getOrCreateChatMemory } from "./memory/memory-db";
import { ensureProviderCostLedgerSchema, recordBackgroundProviderCost } from "./providerCostLedger";
import { buildPostTurnSharedInitialSystem } from "./postTurnSharedInitial/prompt";
import { buildPostTurnSharedInitialUserBlock } from "./postTurnSharedInitial/prompt";
import { parsePostTurnSharedInitialResponse } from "./postTurnSharedInitial/parse";
import { runPostTurnRelationshipOnlyInitial } from "./postTurnSharedInitial/run";
import {
  POST_TURN_SHARED_INITIAL_REQUEST_KIND,
  type PostTurnSharedInitialInput,
} from "./postTurnSharedInitial/types";

const WIDGET: StatusWidget = {
  ...DEFAULT_STATUS_WIDGET,
  fields: [
    { id: "place", label: "장소", instruction: "현재 장소" },
    { id: "time", label: "시각", instruction: "현재 시각" },
    { id: "hp", label: "체력", instruction: "체력 수치" },
    { id: "mood", label: "속마음", instruction: "NPC의 속마음" },
    { id: "situation", label: "현재상황", instruction: "지금 벌어지는 상황" },
  ],
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

const usage = (n: number): TokenUsage => ({
  inputTokens: 10 + n,
  outputTokens: 5 + n,
  estimated: true,
});

function padReply(seed: string, length = 72): string {
  const filler = "가".repeat(Math.max(0, length - seed.length));
  return `${seed}${filler}`.slice(0, length);
}

function sharedResponse(opts: {
  relationship: Record<string, unknown>;
}): string {
  const characterValues: Record<string, string> = {};
  for (const key of collectWidgetJsonKeys(WIDGET)) characterValues[key] = `값-${key}`;
  characterValues["장소"] = "에이지스 복도";
  characterValues["시각"] = "14:30";
  return JSON.stringify({
    statusWidget: { character_values: characterValues, extracted_facts: [] },
    suggestedReplies: {
      items: [
        { kind: "escalate", text: padReply("*목소리를 낮추며* \"그만 숨기고 말할게.\" ") },
        { kind: "soften", text: padReply("*숨을 고르며* \"일단 여기 앉아서 천천히 얘기하자.\" ") },
        { kind: "pivot", text: padReply("*창밖을 가리키며* \"저기 새로 생긴 카페, 같이 가볼래?\" ") },
      ],
    },
    relationship: opts.relationship,
  });
}

async function runExtract(
  caller: StatusWidgetExtractCaller,
  calls: string[]
): Promise<Awaited<ReturnType<typeof extractStatusWidgetValuesForTurn>>> {
  return extractStatusWidgetValuesForTurn({
    charName: "라이크",
    personaName: "렌",
    userMessage: "*검을 내려놓는다.*",
    assistantProse: "라이크는 잠시 말이 없었다. 복도 끝에서 발소리가 멀어졌다.",
    resolved: characterResolved(),
    coalesceSuggestedReplies: { enabled: true },
    shareRelationshipDelta: true,
    caller,
    primaryModelId: "gpt-5.6-luna",
  });
}

describe("whole-turn post-turn Luna call budget", () => {
  it("S1. status + suggestions + relationship share ONE physical call", async () => {
    const calls: string[] = [];
    const caller: StatusWidgetExtractCaller = async (_system, _history, opts) => {
      calls.push(opts.requestKind);
      return {
        text: sharedResponse({
          relationship: {
            items: ["렌: 검"],
            itemsRemove: [],
            promisesAdd: [{ text: "다음에 다시 만나기", deadline: "내일" }],
            promisesRemove: [],
          },
        }),
        usage: usage(1),
      };
    };

    const result = await runExtract(caller, calls);

    assert.equal(calls.length, 1, "exactly one auxiliary provider call");
    assert.equal(calls[0], "background-post-turn-shared-initial");
    assert.equal(result.meta.actualCallCount, 1);
    assert.equal(result.meta.sharedInitialRelationshipUsable, true);
    assert.deepEqual(result.meta.sharedInitialRelationshipDelta?.items, ["렌: 검"]);
    assert.deepEqual(result.meta.sharedInitialRelationshipDelta?.promisesAdd, [
      { text: "다음에 다시 만나기", deadline: "내일" },
    ]);
    assert.equal(result.values.character?.["장소"], "에이지스 복도");
  });

  it("S2. relationship no-op (empty delta) is still ONE call and usable", async () => {
    const calls: string[] = [];
    const caller: StatusWidgetExtractCaller = async (_system, _history, opts) => {
      calls.push(opts.requestKind);
      return {
        text: sharedResponse({
          relationship: { items: [], itemsRemove: [], promisesAdd: [], promisesRemove: [] },
        }),
        usage: usage(1),
      };
    };

    const result = await runExtract(caller, calls);
    assert.equal(calls.length, 1);
    assert.equal(result.meta.actualCallCount, 1);
    assert.equal(result.meta.sharedInitialRelationshipUsable, true);
    assert.deepEqual(result.meta.sharedInitialRelationshipDelta?.items, []);
  });

  it("S3. transport failure leaves relationship usable=false so recovery can run once", async () => {
    const calls: string[] = [];
    const caller: StatusWidgetExtractCaller = async (_system, _history, opts) => {
      calls.push(opts.requestKind);
      throw new Error("502 upstream");
    };

    const result = await runExtract(caller, calls);
    assert.ok(calls.length >= 1, "failure recovery path ran");
    assert.equal(calls[0], "background-post-turn-shared-initial");
    assert.equal(result.meta.sharedInitialRelationshipUsable, false);
  });
});

describe("shared relationship delta consumption (no second provider call)", () => {
  before(() => {
    installIsolatedTestDatabase();
    ensureProviderCostLedgerSchema(getDb());
  });

  it("S4. mergeRelationshipMetaFromTurn consumes the shared delta without provider", async () => {
    const db = getDb();
    const userId = Number(
      db
        .prepare("INSERT INTO users (email, nickname, pw_hash, points) VALUES (?,?,?,0)")
        .run(`sharedrel_${Date.now()}@test.local`, `sharedrel_${Date.now()}`, "x").lastInsertRowid
    );
    const characterId = Number(
      db.prepare("INSERT INTO characters (name) VALUES ('shared-test')").run().lastInsertRowid
    );
    const chatId = Number(
      db.prepare("INSERT INTO chats (user_id, character_id) VALUES (?,?)").run(userId, characterId)
        .lastInsertRowid
    );
    getOrCreateChatMemory(chatId, userId, characterId, "free");

    let providerCalls = 0;
    const meta = await mergeRelationshipMetaFromTurn({
      chatId,
      names: { charName: "라이크", userName: "렌" },
      userMessage: "*검을 내려놓는다.*",
      assistantMessage: "라이크는 검을 받아 들었다.",
      route: "safe",
      sharedInitialParsed: true,
      sourceUserMessageId: 1,
      sharedInitialDelta: {
        items: ["렌: 검"],
        promisesAdd: [{ text: "다음에 다시 만나기" }],
      },
      __testExtract: async () => {
        providerCalls += 1;
        throw new Error("independent relationship provider call must not run");
      },
    });

    assert.equal(providerCalls, 0);
    assert.ok(JSON.stringify(meta).includes("검"));
    assert.ok(meta.items.length > 0);
    const persisted = loadChatRelationshipMeta(chatId);
    assert.ok(JSON.stringify(persisted).includes("검"));
    // Accounting parity: consuming a shared delta adds NO provider-cost row
    // (the single physical shared call owns its one ledger row elsewhere).
    const ledgerRows = (
      db.prepare("SELECT COUNT(*) AS c FROM api_cost_ledger").get() as { c: number }
    ).c;
    assert.equal(ledgerRows, 0);
  });

  it("S5. end-to-end normal turn: shared extract + shared merge = ONE provider call", async () => {
    const db = getDb();
    const userId = Number(
      db
        .prepare("INSERT INTO users (email, nickname, pw_hash, points) VALUES (?,?,?,0)")
        .run(`sharedturn_${Date.now()}@test.local`, `sharedturn_${Date.now()}`, "x").lastInsertRowid
    );
    const characterId = Number(
      db.prepare("INSERT INTO characters (name) VALUES ('shared-turn')").run().lastInsertRowid
    );
    const chatId = Number(
      db.prepare("INSERT INTO chats (user_id, character_id) VALUES (?,?)").run(userId, characterId)
        .lastInsertRowid
    );
    getOrCreateChatMemory(chatId, userId, characterId, "free");

    // 1) The canonical shared extractor (mock caller = one physical call).
    const calls: string[] = [];
    const caller: StatusWidgetExtractCaller = async (_system, _history, opts) => {
      calls.push(opts.requestKind);
      return {
        text: sharedResponse({
          relationship: { items: ["렌: 검"], itemsRemove: [], promisesAdd: [], promisesRemove: [] },
        }),
        usage: usage(1),
      };
    };
    const extract = await runExtract(caller, calls);
    assert.equal(calls.length, 1);

    // 2) The relationship subsystem consumes the shared delta; no provider.
    let relationshipProviderCalls = 0;
    await mergeRelationshipMetaFromTurn({
      chatId,
      names: { charName: "라이크", userName: "렌" },
      userMessage: "*검을 내려놓는다.*",
      assistantMessage: "라이크는 검을 받아 들었다.",
      route: "safe",
      sharedInitialParsed: extract.meta.sharedInitialRelationshipUsable === true,
      sharedInitialDelta: extract.meta.sharedInitialRelationshipDelta,
      sourceUserMessageId: 1,
      __testExtract: async () => {
        relationshipProviderCalls += 1;
        return { delta: { items: ["렌: 검"] }, parseOk: true };
      },
    });

    const totalPhysicalCalls = calls.length + relationshipProviderCalls;
    assert.equal(totalPhysicalCalls, 1, "whole-turn auxiliary Luna physical calls must be 1");
    assert.ok(loadChatRelationshipMeta(chatId).items.length > 0);

    // Negative control: without the shared flag the independent relationship
    // provider path still runs (pre-fix behavior => 1 shared + 1 relationship = 2).
    let independentProviderCalls = 0;
    await mergeRelationshipMetaFromTurn({
      chatId,
      names: { charName: "라이크", userName: "렌" },
      userMessage: "*검을 내려놓는다.*",
      assistantMessage: "라이크는 검을 받아 들었다.",
      route: "safe",
      sharedInitialParsed: false,
      sourceUserMessageId: 1,
      __testExtract: async () => {
        independentProviderCalls += 1;
        return { delta: { items: ["렌: 검"] }, parseOk: true };
      },
    });
    assert.equal(independentProviderCalls, 1, "unshared path still performs one provider call");
  });
});

const baseInput = (
  over: Partial<PostTurnSharedInitialInput>
): PostTurnSharedInitialInput => ({
  mode: "character",
  charName: "라이크",
  personaName: "렌",
  userMessage: "*검을 내려놓는다.*",
  assistantProse: "라이크는 검을 받아 들었다.",
  characterWidget: WIDGET,
  primaryModelId: "gpt-5.6-luna",
  includeSuggestions: false,
  includeRelationship: false,
  ...over,
});

describe("shared prompt envelope — active consumers only", () => {
  it("includes only the requested sections", () => {
    const statusOnly = buildPostTurnSharedInitialSystem(baseInput({}));
    assert.match(statusOnly, /"statusWidget"/);
    assert.doesNotMatch(statusOnly, /"suggestedReplies"/);
    assert.doesNotMatch(statusOnly, /"relationship"/);

    const statusSuggest = buildPostTurnSharedInitialSystem(
      baseInput({ includeSuggestions: true })
    );
    assert.match(statusSuggest, /"suggestedReplies"/);
    assert.doesNotMatch(statusSuggest, /"relationship"/);

    const statusRelationship = buildPostTurnSharedInitialSystem(
      baseInput({ includeRelationship: true })
    );
    assert.match(statusRelationship, /"relationship"/);
    assert.doesNotMatch(statusRelationship, /"suggestedReplies"/);

    const all = buildPostTurnSharedInitialSystem(
      baseInput({ includeSuggestions: true, includeRelationship: true })
    );
    assert.match(all, /"statusWidget"/);
    assert.match(all, /"suggestedReplies"/);
    assert.match(all, /"relationship"/);

    const relationshipOnly = buildPostTurnSharedInitialSystem(
      baseInput({ mode: "relationship_only", includeRelationship: true })
    );
    assert.doesNotMatch(relationshipOnly, /"statusWidget"/);
    assert.doesNotMatch(relationshipOnly, /"suggestedReplies"/);
    assert.match(relationshipOnly, /"relationship"/);
  });
});

describe("relationship section parse evidence", () => {
  const parseRel = (relationship: unknown) =>
    parsePostTurnSharedInitialResponse(
      JSON.stringify({ relationship }),
      baseInput({ includeRelationship: true })
    ).relationship;

  it("explicit empty arrays => valid no-op", () => {
    const section = parseRel({ items: [], itemsRemove: [], promisesAdd: [], promisesRemove: [] });
    assert.equal(section.present, true);
    assert.equal(section.valid, true);
    assert.deepEqual(section.delta.items, []);
    assert.deepEqual(section.delta.promisesAdd, []);
  });

  it("missing key => present=false valid=false (SECTION FAILURE)", () => {
    const parsed = parsePostTurnSharedInitialResponse(
      JSON.stringify({}),
      baseInput({ includeRelationship: true })
    );
    assert.equal(parsed.relationship.present, false);
    assert.equal(parsed.relationship.valid, false);
  });

  it("malformed arrays => present=true valid=false (SECTION FAILURE)", () => {
    const section = parseRel({ items: "not-an-array" });
    assert.equal(section.present, true);
    assert.equal(section.valid, false);
  });

  it("valid delta => present=true valid=true with delta", () => {
    const section = parseRel({
      items: ["렌: 검"],
      itemsRemove: [],
      promisesAdd: [{ text: "다음에 다시 만나기" }],
      promisesRemove: [],
    });
    assert.equal(section.valid, true);
    assert.deepEqual(section.delta.items, ["렌: 검"]);
    assert.deepEqual(section.delta.promisesAdd, [{ text: "다음에 다시 만나기" }]);
  });

  it("section failure does not invalidate status/suggestions sections", () => {
    const parsed = parsePostTurnSharedInitialResponse(
      JSON.stringify({
        statusWidget: { character_values: { 장소: "복도" }, extracted_facts: [] },
        suggestedReplies: {
          items: [
            { kind: "escalate", text: padReply("*목소리를 낮추며* \"그만 숨기고 말할게.\" ") },
            { kind: "soften", text: padReply("*숨을 고르며* \"일단 여기 앉아서 천천히 얘기하자.\" ") },
            { kind: "pivot", text: padReply("*창밖을 가리키며* \"저기 새로 생긴 카페, 같이 가볼래?\" ") },
          ],
        },
        relationship: { items: 42 },
      }),
      baseInput({ includeSuggestions: true, includeRelationship: true })
    );
    assert.equal(parsed.character?.ok, true);
    assert.equal(parsed.suggestedRepliesOk, true);
    assert.equal(parsed.relationship.present, true);
    assert.equal(parsed.relationship.valid, false);
  });
});

describe("relationship-only canonical shared owner", () => {
  it("status OFF + relationship ON => same shared runner, ONE call, no status/suggestions ask", async () => {
    const calls: string[] = [];
    let systemSeen = "";
    const caller: StatusWidgetExtractCaller = async (system, _history, opts) => {
      calls.push(opts.requestKind);
      systemSeen = system;
      return {
        text: JSON.stringify({
          relationship: { items: ["렌: 검"], itemsRemove: [], promisesAdd: [], promisesRemove: [] },
        }),
        usage: usage(1),
      };
    };

    const run = await runPostTurnRelationshipOnlyInitial(
      {
        charName: "라이크",
        personaName: "렌",
        userMessage: "*검을 내려놓는다.*",
        assistantProse: "라이크는 검을 받아 들었다.",
        primaryModelId: "gpt-5.6-luna",
      },
      caller
    );

    assert.equal(calls.length, 1);
    assert.equal(calls[0], POST_TURN_SHARED_INITIAL_REQUEST_KIND);
    assert.doesNotMatch(systemSeen, /"statusWidget"/);
    assert.doesNotMatch(systemSeen, /"suggestedReplies"/);
    assert.equal(run.parsed?.relationship.valid, true);
    assert.deepEqual(run.parsed?.relationship.delta.items, ["렌: 검"]);
  });

  it("status OFF + suggestions ON + relationship ON => same owner, ONE call, both sections", async () => {
    const calls: string[] = [];
    let systemSeen = "";
    const caller: StatusWidgetExtractCaller = async (system, _history, opts) => {
      calls.push(opts.requestKind);
      systemSeen = system;
      return {
        text: JSON.stringify({
          relationship: { items: ["렌: 검"], itemsRemove: [], promisesAdd: [], promisesRemove: [] },
          suggestedReplies: {
            items: [
              { kind: "escalate", text: padReply("*목소리를 낮추며* \"그만 숨기고 말할게.\" ") },
              { kind: "soften", text: padReply("*숨을 고르며* \"일단 여기 앉아서 천천히 얘기하자.\" ") },
              { kind: "pivot", text: padReply("*창밖을 가리키며* \"저기 새로 생긴 카페, 같이 가볼래?\" ") },
            ],
          },
        }),
        usage: usage(1),
      };
    };

    const run = await runPostTurnRelationshipOnlyInitial(
      {
        charName: "라이크",
        personaName: "렌",
        userMessage: "*검을 내려놓는다.*",
        assistantProse: "라이크는 검을 받아 들었다.",
        primaryModelId: "gpt-5.6-luna",
        includeSuggestions: true,
      },
      caller
    );

    assert.equal(calls.length, 1);
    assert.doesNotMatch(systemSeen, /"statusWidget"/);
    assert.match(systemSeen, /"relationship"/);
    assert.match(systemSeen, /"suggestedReplies"/);
    assert.equal(run.parsed?.relationship.valid, true);
    assert.equal(run.parsed?.suggestedRepliesOk, true);
  });
});

describe("consumer combination physical-call matrix", () => {
  it("all OFF => zero auxiliary provider calls", async () => {
    let called = 0;
    const caller: StatusWidgetExtractCaller = async () => {
      called += 1;
      return { text: "", usage: null };
    };
    const inactive: ResolvedStatusWidgetTurn = {
      active: false,
      requestedMode: "character_only",
      mode: "character_only",
      displayMode: "creator",
      stackOrder: "character_first",
      characterWidget: WIDGET,
      userWidget: null,
      needsCharacterValues: true,
      needsUserValues: false,
    };
    const result = await extractStatusWidgetValuesForTurn({
      charName: "라이크",
      personaName: "렌",
      userMessage: "안녕",
      assistantProse: "그는 대답하지 않았다.",
      resolved: inactive,
      caller,
      primaryModelId: "gpt-5.6-luna",
      coalesceSuggestedReplies: { enabled: true },
      shareRelationshipDelta: true,
    });
    assert.equal(called, 0);
    assert.equal(result.meta.actualCallCount, 0);
  });

  const matrix: Array<{
    name: string;
    includeSuggestions: boolean;
    includeRelationship: boolean;
    expectSuggestions: boolean;
    expectRelationship: boolean;
  }> = [
    { name: "status+suggestions+relationship", includeSuggestions: true, includeRelationship: true, expectSuggestions: true, expectRelationship: true },
    { name: "status+relationship (suggestions OFF)", includeSuggestions: false, includeRelationship: true, expectSuggestions: false, expectRelationship: true },
    { name: "status+suggestions (relationship OFF)", includeSuggestions: true, includeRelationship: false, expectSuggestions: true, expectRelationship: false },
  ];

  for (const row of matrix) {
    it(`${row.name} => ONE physical call requesting only active sections`, async () => {
      const calls: string[] = [];
      const caller: StatusWidgetExtractCaller = async (_system, _history, opts) => {
        calls.push(opts.requestKind);
        const characterValues: Record<string, string> = {};
        for (const key of collectWidgetJsonKeys(WIDGET)) characterValues[key] = `값-${key}`;
        return {
          text: JSON.stringify({
            statusWidget: { character_values: characterValues, extracted_facts: [] },
            ...(row.expectSuggestions
              ? {
                  suggestedReplies: {
                    items: [
                      { kind: "escalate", text: padReply("*목소리를 낮추며* \"그만 숨기고 말할게.\" ") },
                      { kind: "soften", text: padReply("*숨을 고르며* \"일단 여기 앉아서 천천히 얘기하자.\" ") },
                      { kind: "pivot", text: padReply("*창밖을 가리키며* \"저기 새로 생긴 카페, 같이 가볼래?\" ") },
                    ],
                  },
                }
              : {}),
            ...(row.expectRelationship
              ? { relationship: { items: [], itemsRemove: [], promisesAdd: [], promisesRemove: [] } }
              : {}),
          }),
          usage: usage(1),
        };
      };

      const result = await extractStatusWidgetValuesForTurn({
        charName: "라이크",
        personaName: "렌",
        userMessage: "*검을 내려놓는다.*",
        assistantProse: "라이크는 검을 받아 들었다.",
        resolved: characterResolved(),
        caller,
        primaryModelId: "gpt-5.6-luna",
        coalesceSuggestedReplies: row.includeSuggestions ? { enabled: true } : undefined,
        shareRelationshipDelta: row.includeRelationship,
      });

      assert.equal(calls.length, 1, `${row.name}: one physical call`);
      assert.equal(result.meta.actualCallCount, 1);
      if (row.expectSuggestions) {
        assert.equal(result.meta.prefetchedSuggestedReplies?.length, 3);
      } else {
        assert.equal(result.meta.prefetchedSuggestedReplies ?? null, null);
      }
      assert.equal(result.meta.sharedInitialRelationshipUsable, row.expectRelationship);
    });
  }
});

describe("relationship section strict validity", () => {
  const parse = (relationship: unknown) =>
    parsePostTurnSharedInitialResponse(
      JSON.stringify({ relationship }),
      baseInput({ includeRelationship: true })
    ).relationship;

  const invalidCases: Array<[string, unknown]> = [
    ["{}", {}],
    ["partial items only", { items: [] }],
    ["partial items+promisesAdd", { items: [], promisesAdd: [] }],
    ["null", null],
    ["array root", []],
    ["string root", "not-an-object"],
    ["wrong type items", { items: "x", itemsRemove: [], promisesAdd: [], promisesRemove: [] }],
    ["wrong type promisesAdd", { items: [], itemsRemove: [], promisesAdd: "x", promisesRemove: [] }],
  ];
  for (const [name, value] of invalidCases) {
    it(`${name} => invalid section`, () => {
      assert.equal(parse(value).valid, false);
    });
  }

  it("all four canonical arrays present => valid", () => {
    const section = parse({ items: [], itemsRemove: [], promisesAdd: [], promisesRemove: [] });
    assert.equal(section.present, true);
    assert.equal(section.valid, true);
  });
});

describe("status-OFF suggestions-only context", () => {
  it("user block always contains the current turn (relationship OFF, empty persona)", () => {
    const block = buildPostTurnSharedInitialUserBlock(
      baseInput({
        mode: "relationship_only",
        includeSuggestions: true,
        includeRelationship: false,
        userMessage: "지금 무슨 생각해?",
        assistantProse: "그는 잠시 창밖을 보았다.",
      })
    );
    assert.match(block, /\[THIS TURN — USER\]/);
    assert.match(block, /지금 무슨 생각해\?/);
    assert.match(block, /\[THIS TURN — ASSISTANT\]/);
    assert.match(block, /그는 잠시 창밖을 보았다\./);
  });

  it("suggestions-only (relationship OFF, empty persona) still calls provider once", async () => {
    const calls: string[] = [];
    const caller: StatusWidgetExtractCaller = async (_s, _h, opts) => {
      calls.push(opts.requestKind);
      return {
        text: JSON.stringify({
          suggestedReplies: {
            items: [
              { kind: "escalate", text: padReply("*목소리를 낮추며* \"그만 숨기고 말할게.\" ") },
              { kind: "soften", text: padReply("*숨을 고르며* \"일단 여기 앉아서 천천히 얘기하자.\" ") },
              { kind: "pivot", text: padReply("*창밖을 가리키며* \"저기 새로 생긴 카페, 같이 가볼래?\" ") },
            ],
          },
        }),
        usage: usage(1),
      };
    };
    const run = await runPostTurnRelationshipOnlyInitial(
      {
        charName: "라이크",
        personaName: "렌",
        userMessage: "지금 무슨 생각해?",
        assistantProse: "그는 잠시 창밖을 보았다.",
        primaryModelId: "gpt-5.6-luna",
        includeSuggestions: true,
        includeRelationship: false,
        userPersona: null,
        personaDescription: null,
        personaSpeechExamples: null,
      },
      caller
    );
    assert.equal(calls.length, 1);
    assert.equal(run.parsed?.suggestedRepliesOk, true);
    assert.equal(run.parsed?.relationship.valid, false);
  });
});

describe("regeneration shared relationship path", () => {
  it("regen user block includes rejected draft and new canonical reply", () => {
    const block = buildPostTurnSharedInitialUserBlock(
      baseInput({
        mode: "relationship_only",
        includeRelationship: true,
        relationshipRegenContext: { previousAssistantMessage: "그는 검을 버렸다." },
      })
    );
    assert.match(block, /REJECTED ASSISTANT DRAFT/);
    assert.match(block, /그는 검을 버렸다\./);
    assert.match(block, /NEW CANONICAL ASSISTANT/);
  });

  it("regen consumes the shared delta without a second provider call", async () => {
    const db = getDb();
    const userId = Number(
      db
        .prepare("INSERT INTO users (email, nickname, pw_hash, points) VALUES (?,?,?,0)")
        .run(`regenrel_${Date.now()}@test.local`, `regenrel_${Date.now()}`, "x").lastInsertRowid
    );
    const characterId = Number(
      db.prepare("INSERT INTO characters (name) VALUES ('regen-shared')").run().lastInsertRowid
    );
    const chatId = Number(
      db.prepare("INSERT INTO chats (user_id, character_id) VALUES (?,?)").run(userId, characterId)
        .lastInsertRowid
    );
    getOrCreateChatMemory(chatId, userId, characterId, "free");

    let providerCalls = 0;
    const meta = await mergeRelationshipMetaAfterRegenerate({
      chatId,
      names: { charName: "라이크", userName: "렌" },
      userMessage: "*검을 내려놓는다.*",
      newAssistantMessage: "라이크는 검을 받아 들었다.",
      previousAssistantMessage: "라이크는 검을 버렸다.",
      route: "safe",
      sharedInitialParsed: true,
      sharedInitialDelta: { items: ["렌: 검"] },
      sourceUserMessageId: 1,
      __testExtract: async () => {
        providerCalls += 1;
        return { delta: {}, parseOk: true };
      },
    });
    assert.equal(providerCalls, 0);
    assert.ok(JSON.stringify(meta).includes("검"));
  });
});

describe("status-OFF lifecycle guardrail", () => {
  it("shared work is deferred past SSE done, not awaited in the status-OFF branch", () => {
    const route = readFileSync(join(process.cwd(), "src/app/api/chat/route.ts"), "utf8");
    assert.match(route, /deferPostTurnShared = true;/);
    assert.match(route, /if \(deferPostTurnShared\) \{/);
    const marker = "} else if (isMemoryFeatureEnabled() || suggestedRepliesEligibleForCoalesce) {";
    const start = route.indexOf(marker);
    assert.ok(start > 0, "status-OFF branch present");
    const end = route.indexOf("if (visualPolicy.hair", start);
    assert.ok(end > start);
    assert.doesNotMatch(
      route.slice(start, end),
      /await runPostTurnRelationshipOnlyInitial/,
      "status-OFF branch must not await the shared provider before SSE done"
    );
  });
});

describe("provider-cost accounting parity (status-OFF shared owner)", () => {
  it("one shared physical call shape => exactly one ledger row; consumers add none", () => {
    const db = getDb();
    const before = (
      db.prepare("SELECT COUNT(*) AS c FROM api_cost_ledger").get() as { c: number }
    ).c;
    // The route's status-OFF shared call records via callBackgroundMemory with
    // one ledger context. This is the canonical writer shape/path.
    recordBackgroundProviderCost(
      {
        provider: "cheaperinference",
        outcome: "success",
        persistInTests: true,
        model: "gpt-5.6-luna",
        cheaperInferenceBilledCostUsd: 0.003,
        requestKind: POST_TURN_SHARED_INITIAL_REQUEST_KIND,
        costCenter: "other",
      },
      db
    );
    const after = (
      db.prepare("SELECT COUNT(*) AS c FROM api_cost_ledger").get() as { c: number }
    ).c;
    assert.equal(after - before, 1, "one physical call => exactly one ledger row");
    // Consuming the shared relationship delta writes no additional provider row.
    const rowsForShared = (
      db
        .prepare(
          "SELECT COUNT(*) AS c FROM api_cost_ledger WHERE request_kind = ?"
        )
        .get(POST_TURN_SHARED_INITIAL_REQUEST_KIND) as { c: number }
    ).c;
    assert.equal(rowsForShared, 1);
  });
});
