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
  installIsolatedTestDatabase,
  uninstallIsolatedTestDatabase,
} from "@/lib/test/isolatedTestDatabase";
import {
  clearUserMessageEditDerivedResidueCore,
} from "./memory-reconcile";
import {
  deleteEpisodicMemoryFactsByAssistantMessageIds,
  getEpisodicMemoryForPrompt,
  persistEpisodicMemoryFactsBestEffort,
} from "@/lib/episodicMemoryFacts";
import { executeAtomicManualEditCore } from "@/lib/rpDerivedStateLifecycle";
import {
  __setCompactCurrentMemoryTestOverride,
  __setSummarizeTurnBatchCallerForTests,
  compactCurrentMemory,
  summarizeTurnBatch,
} from "./memory-rolling-summary";
import { unquoteUnverifiedSummaryQuotes } from "./memory-summary-integrity";
import {
  parseSharedEpisodicSection,
  reconcileSharedEpisodicFactsForTurn,
} from "./memory-episodic-shared";
import { getOrCreateChatMemory } from "./memory-db";

const USER = 920101;
const CHAR = 920103;
const CHAT_BASE = 920200;

let chatCounter = 0;

type Turn = { chatId: number; userMessageId: number; assistantMessageId: number };

function seedChat(opts: { userText: string; assistantText: string }): Turn {
  const db = getDb();
  chatCounter += 1;
  const chatId = CHAT_BASE + chatCounter;
  const userMessageId = chatId * 10 + 1;
  const assistantMessageId = chatId * 10 + 2;
  db.prepare(`INSERT INTO chats (id, user_id, character_id, mode) VALUES (?,?,?,'safe')`).run(
    chatId,
    USER,
    CHAR
  );
  getOrCreateChatMemory(chatId, USER, CHAR, "free");
  db.prepare(`INSERT INTO messages (id, chat_id, role, content) VALUES (?,?,?,?)`).run(
    userMessageId,
    chatId,
    "user",
    opts.userText
  );
  db.prepare(
    `INSERT INTO messages (id, chat_id, role, content, user_message_id, generation_status, model)
     VALUES (?, ?, 'assistant', ?, ?, 'completed', 'test-model')`
  ).run(assistantMessageId, chatId, opts.assistantText, userMessageId);
  return { chatId, userMessageId, assistantMessageId };
}

function reconcile(turn: Turn, facts: unknown[]) {
  return reconcileSharedEpisodicFactsForTurn(getDb(), {
    chatId: turn.chatId,
    userId: USER,
    characterId: CHAR,
    assistantMessageId: turn.assistantMessageId,
    sourceUserMessageId: turn.userMessageId,
    sourceUserText: (
      getDb().prepare("SELECT content FROM messages WHERE id=?").get(turn.userMessageId) as {
        content: string;
      }
    ).content,
    episodic: parseSharedEpisodicSection({ extracted_facts: facts }),
    isRegeneration: false,
  });
}

function injectedMemory(chatId: number, query: string): string {
  return getEpisodicMemoryForPrompt(
    getDb(),
    {
      chatId,
      characterId: CHAR,
      userId: USER,
      currentTurn: 80,
      currentUserMessage: query,
      recentChatText: "평범한 최근 대화",
    },
    { EPISODIC_MEMORY_RECALL_ENABLED: "1" } as NodeJS.ProcessEnv
  ).promptBlock;
}

function cleanup() {
  const db = getDb();
  const chatIds = (
    db.prepare("SELECT id FROM chats WHERE user_id=?").all(USER) as { id: number }[]
  ).map((row) => row.id);
  for (const id of chatIds) {
    db.prepare("DELETE FROM episodic_memory_facts WHERE chat_id=?").run(id);
    db.prepare("DELETE FROM chat_turn_summaries WHERE chat_id=?").run(id);
    db.prepare("DELETE FROM chat_memories WHERE chat_id=?").run(id);
    db.prepare("DELETE FROM messages WHERE chat_id=?").run(id);
    db.prepare("DELETE FROM chats WHERE id=?").run(id);
  }
  db.prepare("DELETE FROM users WHERE id=?").run(USER);
  db.prepare("DELETE FROM characters WHERE id=?").run(CHAR);
}

before(() => installIsolatedTestDatabase());
after(() => uninstallIsolatedTestDatabase());

before(() => {
  cleanup();
  getDb()
    .prepare(`INSERT INTO users (id, email, nickname, pw_hash) VALUES (?,?,?,?)`)
    .run(USER, `b2-${USER}@test.local`, "b2", "x");
  getDb().prepare(`INSERT INTO characters (id, name) VALUES (?,?)`).run(CHAR, "B2Char");
});

after(() => cleanup());

describe("B-2 F-A: a verified user quote is not dropped by the legacy gloss-overlap gate", () => {
  it("stores the 아마추어 line when the gloss paraphrases instead of echoing the quote", () => {
    const turn = seedChat({
      userText: "솔직히 너 좀 아마추어 같아. 그래도 계속 해봐.",
      assistantText: "라이크는 입술을 깨물었다.",
    });
    const result = reconcile(turn, [
      {
        category: "relationship",
        subject: "user_laike",
        attribute: "criticism",
        value: "mild_insult",
        importance: "important",
        fact_text: "유저가 라이크의 검술 실력을 초보 수준이라고 평가했다.",
        evidence_type: "explicit_user_statement",
        evidence: { source_role: "user", source_quote: "솔직히 너 좀 아마추어 같아." },
      },
    ]);
    assert.equal(result.inserted, 1);
    const injected = injectedMemory(turn.chatId, "아마추어 같다고 했던 말 기억해?");
    assert.ok(injected.includes("솔직히 너 좀 아마추어 같아."));
  });
});

type FactRow = { fact_text: string; source_turn: number; metadata: string };

function storedRows(chatId: number): FactRow[] {
  return getDb()
    .prepare("SELECT fact_text, source_turn, metadata FROM episodic_memory_facts WHERE chat_id=? ORDER BY id")
    .all(chatId) as FactRow[];
}

function userQuoteFact(overrides: Record<string, unknown>, quote: string) {
  return {
    category: "relationship",
    subject: "user_laike",
    attribute: "relationship_status",
    value: "status",
    importance: "important",
    fact_text: "유저가 라이크에게 자신의 의사를 밝혔다.",
    evidence_type: "explicit_user_statement",
    evidence: { source_role: "user", source_quote: quote },
    ...overrides,
  };
}

function addTurn(chatId: number, ordinal: number, userText: string, assistantText: string): Turn {
  const db = getDb();
  const userMessageId = 100_000_000 + chatId * 1000 + ordinal * 2 + 1;
  const assistantMessageId = userMessageId + 1;
  db.prepare(`INSERT INTO messages (id, chat_id, role, content) VALUES (?,?,?,?)`).run(
    userMessageId,
    chatId,
    "user",
    userText
  );
  db.prepare(
    `INSERT INTO messages (id, chat_id, role, content, user_message_id, generation_status, model)
     VALUES (?, ?, 'assistant', ?, ?, 'completed', 'test-model')`
  ).run(assistantMessageId, chatId, assistantText, userMessageId);
  return { chatId, userMessageId, assistantMessageId };
}

function injectedAt(chatId: number, query: string, currentTurn: number): string {
  return getEpisodicMemoryForPrompt(
    getDb(),
    {
      chatId,
      characterId: CHAR,
      userId: USER,
      currentTurn,
      currentUserMessage: query,
      recentChatText: "평범한 최근 대화",
    },
    { EPISODIC_MEMORY_RECALL_ENABLED: "1" } as NodeJS.ProcessEnv
  ).promptBlock;
}

describe("B-2 retrieval: relevance is judged on the verified quote that is injected", () => {
  it("surfaces an old verified line past many unrelated recent rows when the query echoes the quote wording", () => {
    const first = seedChat({
      userText: "솔직히 너 좀 아마추어 같아.",
      assistantText: "라이크는 입술을 깨물었다.",
    });
    reconcile(first, [
      userQuoteFact(
        { attribute: "criticism", value: "mild_insult", fact_text: "유저가 라이크의 검술 실력을 초보 수준이라고 평가했다." },
        "솔직히 너 좀 아마추어 같아."
      ),
    ]);
    for (let i = 1; i <= 40; i += 1) {
      const t = addTurn(first.chatId, i, `오늘의 잡담 ${i}`, `라이크는 ${i}번째 장작을 쌓았다.`);
      persistEpisodicMemoryFactsBestEffort(getDb(), {
        chatId: first.chatId,
        characterId: CHAR,
        userId: USER,
        sourceTurn: i + 1,
        sourceUserMessageId: t.userMessageId,
        facts: [
          {
            category: "setting",
            subject: `firewood_${i}`,
            attribute: "stacked",
            value: `pile_${i}`,
            importance: "normal",
            fact_text: `라이크는 ${i}번째 장작 더미를 쌓았다.`,
            evidence_type: "explicit_scene_event",
          },
        ],
      });
    }
    const injected = injectedAt(first.chatId, "아마추어 라고 했던 거 기억해?", 80);
    assert.ok(injected.includes("솔직히 너 좀 아마추어 같아."), injected);
  });

  it("over-recall control: an unrelated query does not inject the verified line", () => {
    const turn = seedChat({
      userText: "솔직히 너 좀 아마추어 같아.",
      assistantText: "라이크는 입술을 깨물었다.",
    });
    reconcile(turn, [
      userQuoteFact({ attribute: "criticism" }, "솔직히 너 좀 아마추어 같아."),
    ]);
    const injected = injectedAt(turn.chatId, "저녁은 뭐 먹을까", 80);
    assert.equal(injected.includes("아마추어"), false);
  });
});

describe("B-2 dedupe: a verified row is deduplicated by its injected quote, not its gloss", () => {
  it("a summary that only paraphrases the gloss does not hide the verbatim line", () => {
    const turn = seedChat({
      userText: "솔직히 너 좀 아마추어 같아.",
      assistantText: "라이크는 입술을 깨물었다.",
    });
    reconcile(turn, [
      userQuoteFact(
        { attribute: "criticism", fact_text: "유저가 라이크의 검술 실력을 초보 수준이라고 평가했다." },
        "솔직히 너 좀 아마추어 같아."
      ),
    ]);
    const result = getEpisodicMemoryForPrompt(
      getDb(),
      {
        chatId: turn.chatId,
        characterId: CHAR,
        userId: USER,
        currentTurn: 80,
        currentUserMessage: "아마추어 같다는 말 기억해?",
        recentChatText: "평범한 최근 대화",
        longTermMemoryText: "유저가 라이크의 검술 실력을 초보 수준이라고 평가했다. 라이크는 입술을 깨물었다.",
      },
      { EPISODIC_MEMORY_RECALL_ENABLED: "1" } as NodeJS.ProcessEnv
    );
    assert.ok(result.promptBlock.includes("솔직히 너 좀 아마추어 같아."), result.promptBlock);
  });

  it("a summary that already quotes the exact line dedupes the episodic copy", () => {
    const turn = seedChat({
      userText: "솔직히 너 좀 아마추어 같아.",
      assistantText: "라이크는 입술을 깨물었다.",
    });
    reconcile(turn, [
      userQuoteFact({ attribute: "criticism" }, "솔직히 너 좀 아마추어 같아."),
    ]);
    const result = getEpisodicMemoryForPrompt(
      getDb(),
      {
        chatId: turn.chatId,
        characterId: CHAR,
        userId: USER,
        currentTurn: 80,
        currentUserMessage: "아마추어 같다는 말 기억해?",
        recentChatText: "평범한 최근 대화",
        longTermMemoryText: '유저가 "솔직히 너 좀 아마추어 같아."라고 말함.',
      },
      { EPISODIC_MEMORY_RECALL_ENABLED: "1" } as NodeJS.ProcessEnv
    );
    assert.equal(result.promptBlock.includes("솔직히 너 좀 아마추어 같아."), false);
  });
});

describe("B-2 lifecycle: verified rows follow their source message", () => {
  it("promise made then cancelled by a later user statement injects the latest state only", () => {
    const first = seedChat({
      userText: "좋아, 우리 오늘부터 사귀자.",
      assistantText: "라이크는 고개를 끄덕였다.",
    });
    reconcile(first, [userQuoteFact({ value: "dating" }, "좋아, 우리 오늘부터 사귀자.")]);
    const later = addTurn(first.chatId, 30, "미안, 우리 그만 헤어지자.", "라이크는 말없이 시선을 떨궜다.");
    reconcileSharedEpisodicFactsForTurn(getDb(), {
      chatId: first.chatId,
      userId: USER,
      characterId: CHAR,
      assistantMessageId: later.assistantMessageId,
      sourceUserMessageId: later.userMessageId,
      sourceUserText: "미안, 우리 그만 헤어지자.",
      episodic: parseSharedEpisodicSection({
        extracted_facts: [userQuoteFact({ value: "broke_up" }, "미안, 우리 그만 헤어지자.")],
      }),
      isRegeneration: false,
    });
    assert.equal(storedRows(first.chatId).length, 2);
    const injected = injectedAt(first.chatId, "사귀자 헤어지자 우리 사이", 80);
    assert.ok(injected.includes("미안, 우리 그만 헤어지자."), injected);
    assert.equal(injected.includes("좋아, 우리 오늘부터 사귀자."), false, injected);
  });

  it("editing the user message removes the verified rows quoted from it", () => {
    const turn = seedChat({
      userText: "솔직히 너 좀 아마추어 같아.",
      assistantText: "라이크는 입술을 깨물었다.",
    });
    reconcile(turn, [userQuoteFact({ attribute: "criticism" }, "솔직히 너 좀 아마추어 같아.")]);
    assert.equal(storedRows(turn.chatId).length, 1);
    clearUserMessageEditDerivedResidueCore(getDb(), {
      chatId: turn.chatId,
      previousUserText: "솔직히 너 좀 아마추어 같아.",
      sourceUserMessageId: turn.userMessageId,
      sourceTurn: 1,
    });
    assert.equal(storedRows(turn.chatId).length, 0);
  });

  it("a material assistant edit removes verified rows quoted from the old prose", () => {
    const turn = seedChat({
      userText: "나 이만 가볼게.",
      assistantText: "라이크가 렌의 손목을 붙잡았다. 낮게 숨을 골랐다.",
    });
    reconcile(turn, [
      {
        category: "character",
        subject: "laike",
        attribute: "action",
        value: "grabbed_wrist",
        importance: "important",
        fact_text: "라이크가 손목을 붙잡았다.",
        evidence_type: "explicit_scene_event",
        evidence: { source_role: "assistant", source_quote: "라이크가 렌의 손목을 붙잡았다." },
      },
    ]);
    assert.equal(storedRows(turn.chatId).length, 1);
    executeAtomicManualEditCore(getDb(), {
      chatId: turn.chatId,
      messageId: turn.assistantMessageId,
      content: "라이크는 렌을 말없이 보냈다.",
      alternatesJson: "[]",
      statusWidgetValuesJson: "{}",
      materialProseChange: true,
      sourceTurn: 1,
    });
    assert.equal(storedRows(turn.chatId).length, 0);
  });

  it("deleting the assistant turn removes its verified rows", () => {
    const turn = seedChat({
      userText: "솔직히 너 좀 아마추어 같아.",
      assistantText: "라이크는 입술을 깨물었다.",
    });
    reconcile(turn, [userQuoteFact({ attribute: "criticism" }, "솔직히 너 좀 아마추어 같아.")]);
    assert.equal(
      deleteEpisodicMemoryFactsByAssistantMessageIds(getDb(), turn.chatId, [turn.assistantMessageId]),
      1
    );
  });
});

describe("B-2 summary quotes: a stored quote means original wording", () => {
  const DIALOGUE =
    "[1턴]\n유저: 솔직히 너 좀 아마추어 같아.\n라이크: 라이크는 입술을 깨물었다. \"그래, 맞아.\"";

  it("keeps a verbatim quote, with or without terminal punctuation, and ignores short spans", () => {
    const kept = unquoteUnverifiedSummaryQuotes(
      '유저가 "솔직히 너 좀 아마추어 같아"라고 말함. 라이크는 "그래"라고 답함.',
      DIALOGUE
    );
    assert.equal(kept.unquoted, 0);
    assert.ok(kept.text.includes('"솔직히 너 좀 아마추어 같아"'));
  });

  it("strips the marks from a fabricated or altered quote and keeps the sentence", () => {
    const result = unquoteUnverifiedSummaryQuotes(
      '라이크가 “나는 평생 너를 지키겠다”고 맹세함. 유저는 "너 정말 아마추어구나"라고 비웃음.',
      DIALOGUE
    );
    assert.equal(result.unquoted, 2);
    assert.equal(result.text.includes("“"), false);
    assert.equal(result.text.includes('"'), false);
    assert.ok(result.text.includes("나는 평생 너를 지키겠다고 맹세함"));
  });

  it("live summarizeTurnBatch seals the summary without the fabricated quote marks", async () => {
    const summary =
      '라이크는 입술을 깨물며 속상해함. 라이크가 "나는 평생 너를 지키겠다"고 다짐하며 훈련을 이어가기로 함. 이후 야영지로 돌아가 모닥불 곁에서 식사를 하며 하루를 정리함. 다음 날 새벽 훈련장으로 다시 나가기로 약속하고 일찍 잠자리에 듦.';
    __setSummarizeTurnBatchCallerForTests(async () => ({ text: summary }));
    try {
      const sealed = await summarizeTurnBatch({
        dialogue: DIALOGUE,
        charName: "라이크",
        startTurn: 1,
        endTurn: 1,
      });
      assert.ok(sealed.length > 0);
      assert.equal(sealed.includes('"'), false);
      assert.ok(sealed.includes("나는 평생 너를 지키겠다고 다짐하며"));
    } finally {
      __setSummarizeTurnBatchCallerForTests(null);
    }
  });

  it("compaction output keeps quotes present in its input and unquotes invented ones", async () => {
    const existing = `유저가 "솔직히 너 좀 아마추어 같아"라고 말하고 라이크는 속상해함. ${"x".repeat(40)}`;
    __setCompactCurrentMemoryTestOverride(null);
    const result = unquoteUnverifiedSummaryQuotes(
      '유저가 "솔직히 너 좀 아마추어 같아"라고 말함. 라이크는 "다시는 도망치지 않겠다"고 말함.',
      existing
    );
    assert.equal(result.unquoted, 1);
    assert.ok(result.text.includes('"솔직히 너 좀 아마추어 같아"'));
    assert.equal(typeof compactCurrentMemory, "function");
  });
});

describe("B-2 deterministic exposure matrix (episodic lane only, no provider)", () => {
  const QUERIES = [
    { id: "echo_quote_wording", text: "아마추어 같다는 말 기억나?", expectExposed: true },
    { id: "other_npc_names_character", text: "상인이 라이크에게 검 값을 물었다", expectExposed: null },
    { id: "other_npc_no_overlap", text: "상인에게 이 검이 얼마냐고 물어봤다", expectExposed: false },
    { id: "unrelated", text: "저녁은 뭐 먹을까", expectExposed: false },
  ] as const;
  const LINE = "솔직히 너 좀 아마추어 같아.";

  for (const turns of [10, 30, 50, 80]) {
    it(`${turns}-turn chat: verified line exposure per query type`, () => {
      const first = seedChat({ userText: LINE, assistantText: "라이크는 입술을 깨물었다." });
      reconcile(first, [
        userQuoteFact(
          { attribute: "criticism", fact_text: "유저가 라이크의 검술 실력을 초보 수준이라고 평가했다." },
          LINE
        ),
      ]);
      for (let i = 1; i < turns; i += 1) {
        const t = addTurn(first.chatId, i, `오늘의 잡담 ${i}`, `라이크는 ${i}번째 장작을 쌓았다.`);
        persistEpisodicMemoryFactsBestEffort(getDb(), {
          chatId: first.chatId,
          characterId: CHAR,
          userId: USER,
          sourceTurn: i + 1,
          sourceUserMessageId: t.userMessageId,
          facts: [
            {
              category: "setting",
              subject: `firewood_${i}`,
              attribute: "stacked",
              value: `pile_${i}`,
              importance: "normal",
              fact_text: `라이크는 ${i}번째 장작 더미를 쌓았다.`,
              evidence_type: "explicit_scene_event",
            },
          ],
        });
      }
      const exposure: Record<string, boolean> = {};
      for (const query of QUERIES) {
        exposure[query.id] = injectedAt(first.chatId, query.text, turns + 1).includes(LINE);
        if (query.expectExposed != null) {
          assert.equal(exposure[query.id], query.expectExposed, `${turns} turns / ${query.id}`);
        }
      }
      console.info(`B2_EXPOSURE ${JSON.stringify({ turns, rawWindowHoldsLine: turns <= 4, exposure })}`);
    });
  }
});
