/**
 * Hard post-turn Luna budget:
 * ONE ASSISTANT GENERATION = AT MOST ONE POST-TURN GPT-5.6 LUNA PHYSICAL CALL.
 *
 * These fixtures fail on the pre-fix tree (shared attempt followed by status
 * repair / relationship recovery) and pass once the shared owner is the only
 * provider capability on the regular post-turn path.
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
import { resolveSuggestedRepliesExtractMaxAttempts } from "./suggestedReplies/job";
import { getOrCreateChatMemory } from "./memory/memory-db";
import {
  loadChatRelationshipMeta,
  mergeRelationshipMetaFromTurn,
} from "./memory/memory-relationship-meta";

const WIDGET: StatusWidget = {
  ...DEFAULT_STATUS_WIDGET,
  fields: [
    { id: "place", label: "장소", instruction: "현재 장소" },
    { id: "mood", label: "속마음", instruction: "NPC의 속마음" },
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

function characterValues(): Record<string, string> {
  const out: Record<string, string> = {};
  for (const key of collectWidgetJsonKeys(WIDGET)) out[key] = `값-${key}`;
  return out;
}

function sharedJson(opts: { statusValid: boolean; relationship: unknown }): string {
  return JSON.stringify({
    statusWidget: {
      character_values: opts.statusValid ? characterValues() : {},
      extracted_facts: [],
    },
    relationship: opts.relationship,
  });
}

async function runExtract(caller: StatusWidgetExtractCaller) {
  return extractStatusWidgetValuesForTurn({
    charName: "라이크",
    personaName: "렌",
    userMessage: "*검을 내려놓는다.*",
    assistantProse: "라이크는 검을 받아 들었다.",
    resolved: characterResolved(),
    coalesceSuggestedReplies: { enabled: true },
    shareRelationshipDelta: true,
    caller,
    primaryModelId: "gpt-5.6-luna",
  });
}

const VALID_RELATIONSHIP = {
  items: ["렌: 검"],
  itemsRemove: [],
  promisesAdd: [],
  promisesRemove: [],
};

describe("hard budget — status malformed never triggers provider repair", () => {
  const cases: Array<{ name: string; statusValid: boolean; relationship: unknown }> = [
    { name: "status malformed + relationship malformed", statusValid: false, relationship: { items: "bad" } },
    { name: "status valid + relationship malformed", statusValid: true, relationship: { items: "bad" } },
    { name: "status malformed + relationship valid", statusValid: false, relationship: VALID_RELATIONSHIP },
    { name: "status malformed + relationship missing", statusValid: false, relationship: undefined },
  ];

  for (const row of cases) {
    it(`${row.name} => exactly ONE physical call`, async () => {
      const calls: string[] = [];
      const caller: StatusWidgetExtractCaller = async (_s, _h, opts) => {
        calls.push(opts.requestKind);
        return { text: sharedJson(row), usage: usage(1) };
      };
      const result = await runExtract(caller);
      assert.equal(calls.length, 1, `calls: ${calls.join(", ")}`);
      assert.equal(calls[0], "background-post-turn-shared-initial");
      assert.equal(result.meta.actualCallCount, 1);
      assert.equal(result.meta.sharedInitialAttempted, true);
    });
  }

  it("valid status values survive a malformed relationship section", async () => {
    const calls: string[] = [];
    const caller: StatusWidgetExtractCaller = async (_s, _h, opts) => {
      calls.push(opts.requestKind);
      return { text: sharedJson({ statusValid: true, relationship: { items: "bad" } }), usage: usage(1) };
    };
    const result = await runExtract(caller);
    assert.equal(calls.length, 1);
    assert.ok(result.values.character && Object.keys(result.values.character).length > 0);
    assert.equal(result.meta.sharedInitialRelationshipUsable, false);
  });

  it("valid relationship survives a malformed status section", async () => {
    const calls: string[] = [];
    const caller: StatusWidgetExtractCaller = async (_s, _h, opts) => {
      calls.push(opts.requestKind);
      return { text: sharedJson({ statusValid: false, relationship: VALID_RELATIONSHIP }), usage: usage(1) };
    };
    const result = await runExtract(caller);
    assert.equal(calls.length, 1);
    assert.equal(result.meta.sharedInitialRelationshipUsable, true);
    assert.deepEqual(result.meta.sharedInitialRelationshipDelta?.items, ["렌: 검"]);
  });

  it("shared transport failure consumes the budget (one attempted call, no retry)", async () => {
    const calls: string[] = [];
    const caller: StatusWidgetExtractCaller = async (_s, _h, opts) => {
      calls.push(opts.requestKind);
      throw new Error("502 upstream");
    };
    const result = await runExtract(caller);
    assert.equal(calls.length, 1, `calls: ${calls.join(", ")}`);
    assert.equal(result.meta.sharedInitialAttempted, true);
    assert.equal(result.meta.sharedInitialTransportOk, false);
  });

  it("no shared attempt when status widget inactive and only status would extract", async () => {
    const calls: string[] = [];
    const caller: StatusWidgetExtractCaller = async (_s, _h, opts) => {
      calls.push(opts.requestKind);
      return { text: sharedJson({ statusValid: true, relationship: VALID_RELATIONSHIP }), usage: usage(1) };
    };
    const inactive: ResolvedStatusWidgetTurn = { ...characterResolved(), active: false };
    await extractStatusWidgetValuesForTurn({
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
    assert.equal(calls.length, 0);
  });
});

describe("hard budget — relationship has no provider recovery after a shared attempt", () => {
  before(() => {
    installIsolatedTestDatabase();
  });

  async function seedChat(): Promise<{ chatId: number; userId: number; characterId: number }> {
    const db = getDb();
    const tag = `hardbudget_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`;
    const userId = Number(
      db
        .prepare("INSERT INTO users (email, nickname, pw_hash, points) VALUES (?,?,?,0)")
        .run(`${tag}@test.local`, tag, "x").lastInsertRowid
    );
    const characterId = Number(
      db.prepare("INSERT INTO characters (name) VALUES ('hard-budget')").run().lastInsertRowid
    );
    const chatId = Number(
      db.prepare("INSERT INTO chats (user_id, character_id) VALUES (?,?)").run(userId, characterId)
        .lastInsertRowid
    );
    getOrCreateChatMemory(chatId, userId, characterId, "free");
    return { chatId, userId, characterId };
  }

  const base = (chatId: number, over: Record<string, unknown>) => ({
    chatId,
    names: { charName: "라이크", userName: "렌" },
    userMessage: "*검을 내려놓는다.*",
    assistantMessage: "라이크는 검을 받아 들었다.",
    route: "safe" as const,
    sourceUserMessageId: 1,
    ...over,
  });

  it("section invalid after shared attempt => 0 provider calls, prior memory_meta unchanged", async () => {
    const { chatId } = await seedChat();
    const before = JSON.stringify(loadChatRelationshipMeta(chatId));
    let providerCalls = 0;
    const meta = await mergeRelationshipMetaFromTurn(
      base(chatId, {
        sharedInitialParsed: false,
        sharedInitialAttempted: true,
        sharedInitialTransportOk: true,
        __testExtract: async () => {
          providerCalls += 1;
          return { delta: { items: ["렌: 검"] }, parseOk: true };
        },
      }) as never
    );
    assert.equal(providerCalls, 0, "no relationship provider recovery");
    assert.equal(JSON.stringify(meta), before, "prior memory_meta unchanged");
  });

  it("transport failure after shared attempt => 0 provider calls", async () => {
    const { chatId } = await seedChat();
    let providerCalls = 0;
    await mergeRelationshipMetaFromTurn(
      base(chatId, {
        sharedInitialParsed: false,
        sharedInitialAttempted: true,
        sharedInitialTransportOk: false,
        __testExtract: async () => {
          providerCalls += 1;
          return { delta: {}, parseOk: false };
        },
      }) as never
    );
    assert.equal(providerCalls, 0);
  });

  it("valid shared delta still persists (no provider)", async () => {
    const { chatId } = await seedChat();
    let providerCalls = 0;
    const meta = await mergeRelationshipMetaFromTurn(
      base(chatId, {
        sharedInitialParsed: true,
        sharedInitialDelta: { items: ["렌: 검"] },
        sharedInitialAttempted: true,
        __testExtract: async () => {
          providerCalls += 1;
          return { delta: {}, parseOk: false };
        },
      }) as never
    );
    assert.equal(providerCalls, 0);
    assert.ok(JSON.stringify(meta).includes("검"));
  });

  it("next normal turn (no shared attempt) can still update relationship memory", async () => {
    const { chatId } = await seedChat();
    const meta = await mergeRelationshipMetaFromTurn(
      base(chatId, {
        sharedInitialParsed: false,
        sharedInitialAttempted: false,
        __testExtract: async () => ({ delta: { items: ["렌: 방패"] }, parseOk: true }),
      }) as never
    );
    assert.ok(JSON.stringify(meta).includes("방패"));
  });
});

describe("hard budget — suggestions have no provider repair after a shared attempt", () => {
  it("shared attempt consumed => 0 independent retries", () => {
    assert.equal(resolveSuggestedRepliesExtractMaxAttempts(true), 0);
  });
  it("no shared attempt => existing retry budget", () => {
    assert.equal(resolveSuggestedRepliesExtractMaxAttempts(false), 3);
  });
});
