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
import { loadChatRelationshipMeta, mergeRelationshipMetaFromTurn } from "./memory/memory-relationship-meta";
import { getOrCreateChatMemory } from "./memory/memory-db";

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
        { kind: "escalate", text: "정체를 밝히며 한 걸음 다가선다. *목소리는 낮게 가라앉힌다.*" },
        { kind: "soften", text: "잠시 숨을 고르고 미소를 짓는다. *긴장을 풀어 보려 애쓴다.*" },
        { kind: "pivot", text: "화제를 돌려 복도 끝을 가리킨다. *더 이상 캐묻지 않겠다는 뜻이다.*" },
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
