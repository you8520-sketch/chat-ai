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
import type { ChatMsg } from "@/lib/ai";
import { OPENROUTER_QWEN_37_MAX_MODEL } from "@/lib/chatModels";
import { formatMemoryMetaForPrompt, type MemoryMeta } from "@/lib/chatMemory";
import { getDb } from "@/lib/db";
import {
  applyRelationshipDeltaToChat,
  loadChatRelationshipMeta,
} from "@/lib/memory/memory-relationship-meta";
import { getMemorySourceBoundary } from "@/lib/memory/memory-source-boundary";
import { getOrCreateChatMemory } from "@/lib/memory/memory-db";
import { runPostTurnRelationshipOnlyInitial } from "@/lib/postTurnSharedInitial/run";
import { DEFAULT_STATUS_WIDGET } from "@/lib/statusWidget/defaultTemplate";
import { extractStatusWidgetValuesForTurn } from "@/lib/statusWidget/extract";
import { resolveStatusWidgetTurn } from "@/lib/statusWidget/resolve";
import { serializeStatusWidget } from "@/lib/statusWidget/serialize";
import {
  installIsolatedTestDatabase,
  uninstallIsolatedTestDatabase,
} from "@/lib/test/isolatedTestDatabase";
import type { buildContext as BuildContextFn } from "@/services/contextBuilder";

const CHAT_ID = 883001;
const USER_ID = 883002;
const CHAR_ID = 883003;
const USER_MSG_ID = 883009;
const NAMES = { charName: "라이크", userName: "렌" };

const NORTH_GATE_PROMISE = "라이크는 보름달이 뜨는 밤 북문에서 렌을 기다리기로 약속했다.";
const SWORD_PROMISE = "렌은 라이크의 검을 갈아 주기로 약속했다.";

const CANCEL_USER_MESSAGE =
  "라이크, 네 검을 갈아 주겠다던 내 약속은 취소할게. 북문에서 기다려 주겠다는 네 약속은 그대로 두자.";
const CANCEL_ASSISTANT_PROSE =
  "*라이크가 고개를 끄덕였다.* \"검 손질은 없던 일로 하지. 하지만 보름달이 뜨면 북문에서 기다리겠다는 말은 그대로야.\"";
const AMBIGUOUS_USER_MESSAGE = "그 약속, 취소할게.";
const AMBIGUOUS_ASSISTANT_PROSE =
  "*라이크가 눈썹을 올렸다.* \"어느 약속을 말하는 거지? 분명히 해 줘.\"";

type CapturedCall = { system: string; userBlock: string };

/**
 * Stand-in for the Luna provider. It follows the contract the prompt states:
 * with an [ACTIVE PROMISES] list it may only answer with a listed string; with no
 * list it can only paraphrase (the production failure: 0/4 stored-string matches).
 */
function makeLuna(opts: { pick: (listed: readonly string[]) => string[] }) {
  const calls: CapturedCall[] = [];
  const caller = async (system: string, history: ChatMsg[]) => {
    const userBlock = String(history[0]?.content ?? "");
    calls.push({ system, userBlock });
    const listed = [...userBlock.matchAll(/^- (.+)$/gm)].map((m) => m[1]!);
    const hasList = userBlock.includes("[ACTIVE PROMISES");
    const promisesRemove = hasList
      ? opts.pick(listed)
      : ["렌이 라이크의 검을 갈아 주기로 한 약속 취소"];
    return {
      text: JSON.stringify({
        relationship: { items: [], itemsRemove: [], promisesAdd: [], promisesRemove },
      }),
      usage: { inputTokens: 900, outputTokens: 40, estimated: false, upstreamCostUsd: 0 },
    };
  };
  return { caller, calls };
}

const pickSwordOnly = (listed: readonly string[]): string[] =>
  listed.filter((text) => text.includes("검"));

function cleanup(): void {
  const db = getDb();
  db.prepare("DELETE FROM messages WHERE chat_id=?").run(CHAT_ID);
  db.prepare("DELETE FROM chat_memories WHERE chat_id=?").run(CHAT_ID);
  db.prepare("DELETE FROM chats WHERE id=?").run(CHAT_ID);
  db.prepare("DELETE FROM users WHERE id=?").run(USER_ID);
  db.prepare("DELETE FROM characters WHERE id=?").run(CHAR_ID);
}

function seedTwoActivePromises(): void {
  cleanup();
  const db = getDb();
  db.prepare(`INSERT INTO users (id, email, nickname, pw_hash) VALUES (?,?,?,?)`).run(
    USER_ID,
    `promise-cancel-${USER_ID}@test.local`,
    "렌",
    "x"
  );
  db.prepare(`INSERT INTO characters (id, name) VALUES (?,?)`).run(CHAR_ID, "라이크");
  const meta: MemoryMeta = {
    honorifics: [],
    items: [],
    thoughts: [],
    promises: [
      { text: NORTH_GATE_PROMISE, deadline: "보름달이 뜨는 밤" },
      { text: SWORD_PROMISE },
    ],
  };
  db.prepare(
    `INSERT INTO chats (id, user_id, character_id, mode, memory_meta) VALUES (?,?,?,'safe',?)`
  ).run(CHAT_ID, USER_ID, CHAR_ID, JSON.stringify(meta));
  db.prepare(
    `INSERT INTO messages (id, chat_id, role, content, model, user_message_id, generation_status)
     VALUES (?, ?, 'user', ?, '', NULL, 'completed')`
  ).run(USER_MSG_ID, CHAT_ID, CANCEL_USER_MESSAGE);
  getOrCreateChatMemory(CHAT_ID, USER_ID, CHAR_ID, "free");
}

function activePromiseTexts(): string[] {
  return loadChatRelationshipMeta(CHAT_ID, NAMES).promises.map((p) => p.text);
}

async function runSharedInitialForTurn(opts: {
  luna: ReturnType<typeof makeLuna>;
  userMessage: string;
  assistantProse: string;
  previousAssistantMessage?: string | null;
}) {
  return runPostTurnRelationshipOnlyInitial(
    {
      charName: NAMES.charName,
      personaName: NAMES.userName,
      userMessage: opts.userMessage,
      assistantProse: opts.assistantProse,
      primaryModelId: OPENROUTER_QWEN_37_MAX_MODEL,
      previousAssistantMessage: opts.previousAssistantMessage ?? null,
      activePromises: activePromiseTexts(),
    },
    opts.luna.caller
  );
}

function commitRelationshipDelta(run: Awaited<ReturnType<typeof runSharedInitialForTurn>>) {
  const section = run.parsed?.relationship;
  assert.equal(section?.present, true);
  assert.equal(section?.valid, true);
  return applyRelationshipDeltaToChat({
    chatId: CHAT_ID,
    names: NAMES,
    delta: section!.delta,
    sourceUserMessageId: USER_MSG_ID,
    boundarySnapshot: getMemorySourceBoundary(CHAT_ID),
  });
}

function promiseLine(wire: string): string {
  return wire.split("\n").find((line) => line.startsWith("약속:")) ?? "";
}

let buildContext: typeof BuildContextFn;

before(async () => {
  installIsolatedTestDatabase();
  ({ buildContext } = await import("@/services/contextBuilder"));
});

after(() => {
  cleanup();
  uninstallIsolatedTestDatabase();
});

beforeEach(seedTwoActivePromises);

describe("Shared Initial promise cancellation — canonical ledger contract", () => {
  it("sends the stored active promise strings to the existing shared call", async () => {
    const luna = makeLuna({ pick: pickSwordOnly });
    await runSharedInitialForTurn({
      luna,
      userMessage: CANCEL_USER_MESSAGE,
      assistantProse: CANCEL_ASSISTANT_PROSE,
    });

    assert.equal(luna.calls.length, 1);
    const { userBlock } = luna.calls[0]!;
    assert.match(userBlock, /\[ACTIVE PROMISES/);
    assert.ok(userBlock.includes(`- ${NORTH_GATE_PROMISE}`));
    assert.ok(userBlock.includes(`- ${SWORD_PROMISE}`));
    assert.doesNotMatch(userBlock, /기한:/, "list carries only the exact stored text key");
  });

  it("status-ON whole-turn call carries the same list in its single physical call", async () => {
    const calls: CapturedCall[] = [];
    const resolved = resolveStatusWidgetTurn({
      characterWidgetJson: serializeStatusWidget(DEFAULT_STATUS_WIDGET),
      userWidgetJson: null,
      chatMode: "character",
      displayMode: "both",
    });
    await extractStatusWidgetValuesForTurn({
      charName: NAMES.charName,
      personaName: NAMES.userName,
      userMessage: CANCEL_USER_MESSAGE,
      assistantProse: CANCEL_ASSISTANT_PROSE,
      resolved,
      primaryModelId: OPENROUTER_QWEN_37_MAX_MODEL,
      shareRelationshipDelta: true,
      activePromises: activePromiseTexts(),
      caller: async (system, history) => {
        calls.push({ system, userBlock: String(history[0]?.content ?? "") });
        return {
          text: JSON.stringify({
            statusWidget: { character_values: {}, user_values: {} },
            relationship: {
              items: [],
              itemsRemove: [],
              promisesAdd: [],
              promisesRemove: [],
            },
          }),
          usage: { inputTokens: 1, outputTokens: 1, estimated: false, upstreamCostUsd: 0 },
        };
      },
    });

    assert.equal(calls.length, 1);
    assert.ok(calls[0]!.userBlock.includes(`- ${NORTH_GATE_PROMISE}`));
    assert.ok(calls[0]!.userBlock.includes(`- ${SWORD_PROMISE}`));
  });

  it("explicit cancellation removes only the cancelled promise and the final wire agrees", async () => {
    const luna = makeLuna({ pick: pickSwordOnly });
    const run = await runSharedInitialForTurn({
      luna,
      userMessage: CANCEL_USER_MESSAGE,
      assistantProse: CANCEL_ASSISTANT_PROSE,
    });
    const applied = commitRelationshipDelta(run);

    assert.equal(applied.accepted, true);
    assert.deepEqual(activePromiseTexts(), [NORTH_GATE_PROMISE]);
    assert.deepEqual(
      loadChatRelationshipMeta(CHAT_ID, NAMES).promises[0]?.deadline,
      "보름달이 뜨는 밤",
      "the valid promise keeps its deadline"
    );

    const memoryMeta = formatMemoryMetaForPrompt(loadChatRelationshipMeta(CHAT_ID, NAMES));
    const built = buildContext({
      charName: "라이크",
      chunks: [],
      userNickname: "렌",
      shortTermHistory: [],
      nsfw: false,
      longTermMemory: "- 렌이 라이크의 검 손질 약속을 취소함 · 북문 약속은 유지됨",
      memoryMeta: memoryMeta ?? "",
      modelId: OPENROUTER_QWEN_37_MAX_MODEL,
      provider: "openrouter",
      currentUserMessage: "다음 장면으로 가자.",
    });

    const finalPromiseLine = promiseLine(built.systemPrompt);
    assert.ok(finalPromiseLine.includes(NORTH_GATE_PROMISE));
    assert.ok(!finalPromiseLine.includes("검"), "cancelled sword promise is not active in the wire");
    assert.match(built.systemPrompt, /검 손질 약속을 취소함/, "summary prose is preserved");
  });

  it("an unclear cancellation target removes nothing", async () => {
    const luna = makeLuna({ pick: () => [] });
    const run = await runSharedInitialForTurn({
      luna,
      userMessage: AMBIGUOUS_USER_MESSAGE,
      assistantProse: AMBIGUOUS_ASSISTANT_PROSE,
    });
    commitRelationshipDelta(run);

    assert.deepEqual(activePromiseTexts(), [NORTH_GATE_PROMISE, SWORD_PROMISE]);
  });

  it("a paraphrased (non-stored) removal text never deletes any promise", async () => {
    const luna = makeLuna({ pick: () => ["렌이 검 갈아 주기로 한 약속", "북문 약속"] });
    const run = await runSharedInitialForTurn({
      luna,
      userMessage: CANCEL_USER_MESSAGE,
      assistantProse: CANCEL_ASSISTANT_PROSE,
    });
    commitRelationshipDelta(run);

    assert.deepEqual(activePromiseTexts(), [NORTH_GATE_PROMISE, SWORD_PROMISE]);
  });

  it("a relationship proposal key in the section cannot change the durable ledger", async () => {
    const caller = async () => ({
      text: JSON.stringify({
        relationship: {
          items: [],
          itemsRemove: [],
          promisesAdd: [],
          promisesRemove: [],
          relationshipStage: "lover",
          stage: "연인",
        },
      }),
      usage: { inputTokens: 1, outputTokens: 1, estimated: false, upstreamCostUsd: 0 },
    });
    const run = await runPostTurnRelationshipOnlyInitial(
      {
        charName: NAMES.charName,
        personaName: NAMES.userName,
        userMessage: "나랑 사귀자.",
        assistantProse: "*라이크가 시선을 피했다.* \"생각할 시간이 필요해.\"",
        primaryModelId: OPENROUTER_QWEN_37_MAX_MODEL,
        activePromises: activePromiseTexts(),
      },
      caller
    );
    const before = JSON.stringify(loadChatRelationshipMeta(CHAT_ID, NAMES));
    assert.deepEqual(run.parsed?.relationship.delta, {
      items: [],
      itemsRemove: [],
      promisesAdd: [],
      promisesRemove: [],
    });
    commitRelationshipDelta(run);
    assert.equal(JSON.stringify(loadChatRelationshipMeta(CHAT_ID, NAMES)), before);
  });

  it("regen keeps the same list and ownership: one call, list present, rejected draft compared", async () => {
    const luna = makeLuna({ pick: pickSwordOnly });
    await runSharedInitialForTurn({
      luna,
      userMessage: CANCEL_USER_MESSAGE,
      assistantProse: CANCEL_ASSISTANT_PROSE,
      previousAssistantMessage: "*라이크는 말없이 검집을 쓰다듬었다.*",
    });

    assert.equal(luna.calls.length, 1);
    const { system, userBlock } = luna.calls[0]!;
    assert.match(system, /REGENERATED/);
    assert.match(system, /promisesRemove: copy EXACTLY the \[ACTIVE PROMISES\]/);
    assert.match(userBlock, /\[REJECTED ASSISTANT DRAFT/);
    assert.ok(userBlock.includes(`- ${SWORD_PROMISE}`));
  });

  it("empty ledger tells the model there is nothing to remove", async () => {
    const luna = makeLuna({ pick: () => [] });
    await runPostTurnRelationshipOnlyInitial(
      {
        charName: NAMES.charName,
        personaName: NAMES.userName,
        userMessage: "안녕",
        assistantProse: "*라이크가 웃었다.*",
        primaryModelId: OPENROUTER_QWEN_37_MAX_MODEL,
        activePromises: [],
      },
      luna.caller
    );
    assert.match(luna.calls[0]!.userBlock, /\(none → promisesRemove \[\]\)/);
  });

  it("does not add the list when the relationship consumer is off", async () => {
    const luna = makeLuna({ pick: () => [] });
    await runPostTurnRelationshipOnlyInitial(
      {
        charName: NAMES.charName,
        personaName: NAMES.userName,
        userMessage: "안녕",
        assistantProse: "*라이크가 웃었다.*",
        primaryModelId: OPENROUTER_QWEN_37_MAX_MODEL,
        includeRelationship: false,
        includeSuggestions: true,
        activePromises: activePromiseTexts(),
      },
      luna.caller
    );
    assert.doesNotMatch(luna.calls[0]!.userBlock, /ACTIVE PROMISES/);
  });
});
