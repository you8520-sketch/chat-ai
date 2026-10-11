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
import { buildPostTurnSharedInitialJsonSchema } from "@/lib/postTurnSharedInitial/schema";
import { buildPostTurnSharedInitialSystem } from "@/lib/postTurnSharedInitial/prompt";
import { parsePostTurnSharedInitialResponse } from "@/lib/postTurnSharedInitial/parse";
import { EPISODIC_FACTS_EXTRACT_INSTRUCTIONS } from "./memory-episodic-prompt";
import {
  parseSharedEpisodicSection,
  reconcileSharedEpisodicFactsForTurn,
} from "./memory-episodic-shared";
import { scheduleMemoryUpdate } from "./memory-manager";
import { getOrCreateChatMemory } from "./memory-db";

const USER = 910101;
const CHAR = 910103;
const CHAT_BASE = 910200;

let chatCounter = 0;

type EvidenceClaim = { source_role: "user" | "assistant"; source_quote: string };

function fact(overrides: Record<string, unknown> = {}, evidence?: EvidenceClaim | null) {
  return {
    category: "character",
    subject: "enoch",
    attribute: "action",
    value: "locked_door",
    importance: "important",
    fact_text: "에녹은 유저가 떠나려 하자 문을 잠그고 남으라고 요구했다.",
    evidence_type: "explicit_scene_event",
    ...(evidence === null ? {} : { evidence: evidence ?? { source_role: "assistant", source_quote: "에녹이 문을 잠갔다." } }),
    ...overrides,
  };
}

type Turn = {
  chatId: number;
  userMessageId: number;
  assistantMessageId: number;
};

function seedChat(opts: {
  userText: string;
  assistantText: string;
  assistantStatus?: string;
}): Turn {
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
     VALUES (?, ?, 'assistant', ?, ?, ?, 'test-model')`
  ).run(
    assistantMessageId,
    chatId,
    opts.assistantText,
    userMessageId,
    opts.assistantStatus ?? "completed"
  );
  return { chatId, userMessageId, assistantMessageId };
}

function reconcile(
  turn: Turn,
  facts: unknown[],
  extra: {
    isRegeneration?: boolean;
    assistantMessageId?: number;
    userPersona?: string | null;
    boundarySnapshot?: { resetAfterMessageId: number | null; epoch: number };
  } = {}
) {
  return reconcileSharedEpisodicFactsForTurn(getDb(), {
    chatId: turn.chatId,
    userId: USER,
    characterId: CHAR,
    assistantMessageId: extra.assistantMessageId ?? turn.assistantMessageId,
    sourceUserMessageId: turn.userMessageId,
    sourceUserText: (
      getDb()
        .prepare("SELECT content FROM messages WHERE id=?")
        .get(turn.userMessageId) as { content: string }
    ).content,
    userPersona: extra.userPersona,
    boundarySnapshot: extra.boundarySnapshot,
    episodic: parseSharedEpisodicSection({ extracted_facts: facts }),
    isRegeneration: extra.isRegeneration === true,
  });
}

type StoredRow = {
  fact_text: string;
  source_user_message_id: number | null;
  metadata: string;
};

function rows(chatId: number): StoredRow[] {
  return getDb()
    .prepare(
      "SELECT fact_text, source_user_message_id, metadata FROM episodic_memory_facts WHERE chat_id=? ORDER BY id"
    )
    .all(chatId) as StoredRow[];
}

function evidenceOf(row: StoredRow) {
  return (JSON.parse(row.metadata) as { evidence?: Record<string, unknown> }).evidence;
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
  const db = getDb();
  db.prepare(`INSERT INTO users (id, email, nickname, pw_hash) VALUES (?,?,?,?)`).run(
    USER,
    `ev-${USER}@test.local`,
    "ev",
    "x"
  );
  db.prepare(`INSERT INTO characters (id, name) VALUES (?,?)`).run(CHAR, "EvChar");
});

after(() => cleanup());

const SCENE_ASSISTANT = '에녹이 문을 잠갔다. "가지 마."';
const PLAIN_USER = "나 이만 가볼게.";

describe("B-1 Shared Initial episodic evidence gate (live reconcile path)", () => {
  it("accepts a real current-scene assistant action and stores server-resolved provenance", () => {
    const turn = seedChat({ userText: PLAIN_USER, assistantText: SCENE_ASSISTANT });
    const result = reconcile(turn, [fact()]);
    assert.equal(result.inserted, 1);
    const [row] = rows(turn.chatId);
    const evidence = evidenceOf(row!);
    assert.deepEqual(
      {
        role: evidence?.role,
        message_id: evidence?.message_id,
        quote: evidence?.quote,
        authority: evidence?.authority,
      },
      {
        role: "assistant",
        message_id: turn.assistantMessageId,
        quote: "에녹이 문을 잠갔다.",
        authority: "CURRENT_SCENE",
      }
    );
  });

  it("rejects a source-absent fabricated door-lock", () => {
    const turn = seedChat({
      userText: PLAIN_USER,
      assistantText: "에녹은 잠시 창밖을 바라보았다.",
    });
    assert.equal(reconcile(turn, [fact()]).inserted, 0);
    assert.equal(rows(turn.chatId).length, 0);
  });

  it("drops a fact whose evidence field is missing at parse time", () => {
    const parsed = parseSharedEpisodicSection({ extracted_facts: [fact({}, null)] });
    assert.equal(parsed.valid, false);
    const turn = seedChat({ userText: PLAIN_USER, assistantText: SCENE_ASSISTANT });
    assert.equal(reconcile(turn, [fact({}, null)]).inserted, 0);
    assert.equal(rows(turn.chatId).length, 0);
  });

  it("rejects a quote that exists only in the other role's message (wrong actor)", () => {
    const turn = seedChat({
      userText: "에녹이 문을 잠갔다.",
      assistantText: "에녹은 조용히 웃었다.",
    });
    assert.equal(reconcile(turn, [fact()]).inserted, 0);
  });

  it("rejects a quote copied from a previous turn instead of this turn's canonical message", () => {
    const turn = seedChat({ userText: PLAIN_USER, assistantText: "에녹은 고개를 끄덕였다." });
    const previousTurnAssistant = SCENE_ASSISTANT;
    assert.ok(!"에녹은 고개를 끄덕였다.".includes(previousTurnAssistant));
    assert.equal(reconcile(turn, [fact()]).inserted, 0);
  });

  it("rejects an assistant message id that is not the canonical assistant of the source turn", () => {
    const turn = seedChat({ userText: PLAIN_USER, assistantText: SCENE_ASSISTANT });
    const other = seedChat({ userText: PLAIN_USER, assistantText: SCENE_ASSISTANT });
    const result = reconcile(turn, [fact()], { assistantMessageId: other.assistantMessageId });
    assert.equal(result.inserted, 0);
    assert.equal(rows(turn.chatId).length, 0);
  });

  it("rejects a generic short quote that cannot support the added clause", () => {
    const turn = seedChat({
      userText: PLAIN_USER,
      assistantText: "에녹은 시장에 도착했다.",
    });
    const result = reconcile(turn, [
      fact(
        {
          category: "item",
          subject: "enoch",
          attribute: "gift",
          value: "ring_lore",
          fact_text: "에녹은 시장에서 유저에게 반지를 건넸다.",
        },
        { source_role: "assistant", source_quote: "시장에" }
      ),
    ]);
    assert.equal(result.inserted, 0);
  });

  it("keeps an assistant retrospective sister meeting out of objective memory even when quoted verbatim", () => {
    const turn = seedChat({
      userText: PLAIN_USER,
      assistantText: '에녹이 말했다. "누나가 널 예전에 시장에서 봤대."',
    });
    const result = reconcile(turn, [
      fact(
        {
          subject: "sister",
          attribute: "prior_meeting",
          value: "met_at_market",
          fact_text: "누나는 유저를 예전에 시장에서 만난 적이 있다.",
        },
        { source_role: "assistant", source_quote: "누나가 널 예전에 시장에서 봤대." }
      ),
    ]);
    assert.equal(result.inserted, 0);
  });

  it("stores the same quoted sister statement only as an attributed character claim", () => {
    const turn = seedChat({
      userText: PLAIN_USER,
      assistantText: '에녹이 말했다. "누나가 널 예전에 시장에서 봤대."',
    });
    const result = reconcile(turn, [
      fact(
        {
          subject: "enoch",
          attribute: "claim_about_sister",
          value: "sister_saw_user",
          evidence_type: "explicit_character_claim",
          fact_text: "에녹은 누나가 유저를 예전에 시장에서 봤다고 말했다.",
        },
        { source_role: "assistant", source_quote: "누나가 널 예전에 시장에서 봤대." }
      ),
    ]);
    assert.equal(result.inserted, 1);
    assert.equal(evidenceOf(rows(turn.chatId)[0]!)?.authority, "CHARACTER_CLAIM");
  });

  it("rejects a character claim whose quote is not from the assistant message", () => {
    const turn = seedChat({
      userText: "누나가 날 예전에 시장에서 봤대.",
      assistantText: "에녹은 조용히 웃었다.",
    });
    const result = reconcile(turn, [
      fact(
        {
          evidence_type: "explicit_character_claim",
          fact_text: "에녹은 누나가 유저를 예전에 시장에서 봤다고 말했다.",
        },
        { source_role: "user", source_quote: "누나가 날 예전에 시장에서 봤대." }
      ),
    ]);
    assert.equal(result.inserted, 0);
  });

  it("assistant narration cannot authorize a user↔cast relationship or the user's own action", () => {
    const turn = seedChat({
      userText: PLAIN_USER,
      assistantText: "에녹과 유저는 서로 연인이 되기로 합의했다.",
    });
    const relationship = fact(
      {
        category: "relationship",
        subject: "enoch_user",
        attribute: "relationship_status",
        value: "lovers",
        fact_text: "에녹과 유저는 서로 연인이 되기로 명시적으로 합의했다.",
      },
      { source_role: "assistant", source_quote: "에녹과 유저는 서로 연인이 되기로 합의했다." }
    );
    const userAction = fact(
      {
        category: "character",
        subject: "user",
        attribute: "response",
        value: "refused",
        fact_text: "유저는 에녹의 요구를 거절했다.",
      },
      { source_role: "assistant", source_quote: "에녹과 유저는 서로 연인이 되기로 합의했다." }
    );
    assert.equal(reconcile(turn, [relationship, userAction]).inserted, 0);
  });

  it("USER evidence authorizes the user's own consent and records the user message id", () => {
    const turn = seedChat({
      userText: "좋아, 우리 오늘부터 연인하자.",
      assistantText: "에녹은 환하게 웃었다.",
    });
    const result = reconcile(turn, [
      fact(
        {
          category: "relationship",
          subject: "enoch_user",
          attribute: "relationship_status",
          value: "lovers",
          fact_text: "에녹과 유저는 서로 연인이 되기로 명시적으로 합의했다.",
        },
        { source_role: "user", source_quote: "좋아, 우리 오늘부터 연인하자." }
      ),
    ]);
    assert.equal(result.inserted, 1);
    const row = rows(turn.chatId)[0]!;
    assert.equal(row.source_user_message_id, turn.userMessageId);
    const evidence = evidenceOf(row);
    assert.equal(evidence?.role, "user");
    assert.equal(evidence?.message_id, turn.userMessageId);
    assert.equal(evidence?.authority, "USER_EXPLICIT");
  });

  it("keeps valid user self-backstory and preference statements", () => {
    const turn = seedChat({
      userText: "나는 어릴 때 이 마을에서 자랐어. 커피에는 시럽을 두 번 넣어 마셔.",
      assistantText: "에녹은 고개를 끄덕였다.",
    });
    const result = reconcile(turn, [
      fact(
        {
          category: "preference",
          subject: "user",
          attribute: "favorite_drink",
          value: "syrup_coffee",
          fact_text: "사용자는 커피에 시럽을 두 번 넣어 마신다.",
          evidence_type: "explicit_user_statement",
        },
        { source_role: "user", source_quote: "커피에는 시럽을 두 번 넣어 마셔." }
      ),
      fact(
        {
          category: "character",
          subject: "user",
          attribute: "hometown",
          value: "this_village",
          fact_text: "사용자는 어릴 때 이 마을에서 자랐다고 밝혔다.",
          evidence_type: "explicit_user_statement",
        },
        { source_role: "user", source_quote: "나는 어릴 때 이 마을에서 자랐어." }
      ),
    ]);
    assert.equal(result.inserted, 2);
    for (const row of rows(turn.chatId)) {
      assert.equal(evidenceOf(row)?.authority, "USER_EXPLICIT");
    }
  });

  it("rejects a user statement whose quote is not in the user message", () => {
    const turn = seedChat({ userText: PLAIN_USER, assistantText: SCENE_ASSISTANT });
    const result = reconcile(turn, [
      fact(
        {
          category: "preference",
          subject: "user",
          attribute: "favorite_drink",
          value: "syrup_coffee",
          fact_text: "사용자는 커피에 시럽을 두 번 넣어 마신다.",
          evidence_type: "explicit_user_statement",
        },
        { source_role: "user", source_quote: "커피에는 시럽을 두 번 넣어 마셔." }
      ),
    ]);
    assert.equal(result.inserted, 0);
  });

  it("normalizes only NFC, line endings and whitespace; negation and punctuation are not forgiven", () => {
    const decomposed = "에녹이 문을 잠갔다.".normalize("NFD");
    const turn = seedChat({
      userText: PLAIN_USER,
      assistantText: "에녹이   문을\r\n잠갔다.\n\"가지 마.\"",
    });
    assert.equal(
      reconcile(turn, [fact({}, { source_role: "assistant", source_quote: decomposed })]).inserted,
      1
    );
    const negated = seedChat({
      userText: PLAIN_USER,
      assistantText: "에녹은 문을 잠그지 않았다.",
    });
    assert.equal(reconcile(negated, [fact()]).inserted, 0);
    const swapped = seedChat({ userText: PLAIN_USER, assistantText: "문을 에녹이 잠갔다." });
    assert.equal(reconcile(swapped, [fact()]).inserted, 0);
  });

  it("verifies against the CURRENT canonical content on regen and wipes old rows when nothing verifies", () => {
    const turn = seedChat({ userText: PLAIN_USER, assistantText: SCENE_ASSISTANT });
    assert.equal(reconcile(turn, [fact()]).inserted, 1);
    getDb()
      .prepare("UPDATE messages SET content=? WHERE id=?")
      .run("에녹은 조용히 창밖을 바라보았다.", turn.assistantMessageId);
    const regen = reconcile(turn, [fact()], { isRegeneration: true });
    assert.equal(regen.inserted, 0);
    assert.equal(rows(turn.chatId).length, 0);
  });

  it("regen replaces old rows with rows verified against the new variant", () => {
    const turn = seedChat({ userText: PLAIN_USER, assistantText: SCENE_ASSISTANT });
    assert.equal(reconcile(turn, [fact()]).inserted, 1);
    getDb()
      .prepare("UPDATE messages SET content=? WHERE id=?")
      .run("에녹이 창문을 닫았다.", turn.assistantMessageId);
    const regen = reconcile(
      turn,
      [
        fact(
          { attribute: "closed_window", value: "closed_window", fact_text: "에녹은 유저가 있는 방의 창문을 닫았다." },
          { source_role: "assistant", source_quote: "에녹이 창문을 닫았다." }
        ),
      ],
      { isRegeneration: true }
    );
    assert.equal(regen.inserted, 1);
    const stored = rows(turn.chatId);
    assert.equal(stored.length, 1);
    assert.equal(evidenceOf(stored[0]!)?.quote, "에녹이 창문을 닫았다.");
  });

  it("rejects evidence from an assistant message that is not a successful durable generation", () => {
    for (const status of ["failed_partial", "interrupted", "generating"]) {
      const turn = seedChat({
        userText: PLAIN_USER,
        assistantText: SCENE_ASSISTANT,
        assistantStatus: status,
      });
      assert.equal(reconcile(turn, [fact()]).inserted, 0, status);
    }
  });

  it("OOC user turns and a revoked pre-reset source never reach the evidence gate", () => {
    const ooc = seedChat({
      userText: "OOC: 지금 장면 설정 바꿔줘.",
      assistantText: SCENE_ASSISTANT,
    });
    assert.equal(reconcile(ooc, [fact()]).inserted, 0);

    const revoked = seedChat({ userText: PLAIN_USER, assistantText: SCENE_ASSISTANT });
    getDb()
      .prepare("UPDATE chat_memories SET memory_reset_after_message_id=? WHERE chat_id=?")
      .run(revoked.assistantMessageId + 100, revoked.chatId);
    assert.equal(reconcile(revoked, [fact()]).inserted, 0);
    assert.equal(rows(revoked.chatId).length, 0);
  });

  it("a stale memory epoch snapshot cannot write verified facts", () => {
    const turn = seedChat({ userText: PLAIN_USER, assistantText: SCENE_ASSISTANT });
    const staleSnapshot = { resetAfterMessageId: null, epoch: 0 };
    getDb()
      .prepare("UPDATE chat_memories SET memory_epoch=memory_epoch+1 WHERE chat_id=?")
      .run(turn.chatId);
    assert.equal(reconcile(turn, [fact()], { boundarySnapshot: staleSnapshot }).inserted, 0);
    assert.equal(rows(turn.chatId).length, 0);
  });

  it("legacy rows without evidence are left untouched by a verified insert", () => {
    const turn = seedChat({ userText: PLAIN_USER, assistantText: SCENE_ASSISTANT });
    getDb()
      .prepare(
        `INSERT INTO episodic_memory_facts
         (chat_id, character_id, user_id, source_turn, source_user_message_id, category, subject,
          attribute, value, importance, fact_text, metadata)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`
      )
      .run(
        turn.chatId,
        CHAR,
        USER,
        99,
        null,
        "character",
        "legacy",
        "trait",
        "legacy_value",
        "normal",
        "레거시 사실은 증거 없이 저장된 기존 행이다.",
        JSON.stringify({ memory_evidence_type: "explicit_scene_event" })
      );
    assert.equal(reconcile(turn, [fact()]).inserted, 1);
    const stored = rows(turn.chatId);
    assert.equal(stored.length, 2);
    assert.equal(evidenceOf(stored[0]!), undefined);
    assert.ok(evidenceOf(stored[1]!));
  });

  it("server owns message ids: model-supplied ids are discarded at parse", () => {
    const parsed = parseSharedEpisodicSection({
      extracted_facts: [
        fact({}, {
          source_role: "assistant",
          source_quote: "에녹이 문을 잠갔다.",
          message_id: 1,
          authority: "USER_EXPLICIT",
        } as unknown as EvidenceClaim),
      ],
    });
    assert.equal(parsed.valid, true);
    assert.deepEqual(parsed.facts[0]!.evidence, {
      source_role: "assistant",
      source_quote: "에녹이 문을 잠갔다.",
    });
  });

  it("production commit entry (scheduleMemoryUpdate) applies the gate with or without a status widget turn", async () => {
    for (const label of ["status_widget_on", "status_widget_off"]) {
      const supported = seedChat({ userText: PLAIN_USER, assistantText: SCENE_ASSISTANT });
      const fabricated = seedChat({
        userText: PLAIN_USER,
        assistantText: "에녹은 창밖을 바라보았다.",
      });
      for (const turn of [supported, fabricated]) {
        await scheduleMemoryUpdate({
          chatId: turn.chatId,
          userId: USER,
          characterId: CHAR,
          relationshipNames: { charName: "EvChar", userName: "유저" } as never,
          tier: "free",
          memoryCapacity: 10000,
          userMessage: PLAIN_USER,
          assistantMessage: SCENE_ASSISTANT,
          assistantMessageId: turn.assistantMessageId,
          sourceUserMessageId: turn.userMessageId,
          relationshipSharedAttempted: true,
          relationshipSharedParsed: false,
          sharedInitialEpisodic: parseSharedEpisodicSection({ extracted_facts: [fact()] }),
          episodicSharedAttempted: true,
        });
      }
      assert.equal(rows(supported.chatId).length, 1, `${label}: supported`);
      assert.equal(rows(fabricated.chatId).length, 0, `${label}: fabricated`);
    }
  });
});

describe("B-1 canonical prompt/schema contract", () => {
  const input = {
    mode: "relationship_only" as const,
    charName: "c",
    personaName: "u",
    userMessage: "m",
    assistantProse: "a",
    primaryModelId: "gpt-5.6-luna",
    includeSuggestions: false,
    includeRelationship: true,
    includeEpisodic: true,
    relationshipRegenContext: null,
  };

  it("episodic schema requires strict evidence {source_role, source_quote} per fact", () => {
    const schema = buildPostTurnSharedInitialJsonSchema(input) as {
      properties: { episodic: { properties: { extracted_facts: { items: Record<string, unknown> } } } };
    };
    const item = schema.properties.episodic.properties.extracted_facts.items as {
      required: string[];
      properties: Record<string, { required?: string[]; additionalProperties?: boolean; properties?: Record<string, { enum?: string[] }> }>;
    };
    assert.ok(item.required.includes("evidence"));
    const evidence = item.properties.evidence!;
    assert.deepEqual(evidence.required, ["source_role", "source_quote"]);
    assert.equal(evidence.additionalProperties, false);
    assert.deepEqual(evidence.properties!.source_role!.enum, ["user", "assistant"]);
  });

  it("the single canonical instruction owner explains evidence once", () => {
    const system = buildPostTurnSharedInitialSystem(input);
    assert.equal((system.match(/source_quote/g) ?? []).length, (EPISODIC_FACTS_EXTRACT_INSTRUCTIONS.match(/source_quote/g) ?? []).length);
    assert.match(EPISODIC_FACTS_EXTRACT_INSTRUCTIONS, /source_quote/);
    assert.match(EPISODIC_FACTS_EXTRACT_INSTRUCTIONS, /verbatim/i);
    const prompt = readFileSync(new URL("../postTurnSharedInitial/prompt.ts", import.meta.url), "utf8");
    assert.doesNotMatch(prompt, /source_quote/);
  });

  it("a Shared Initial response with a missing quote leaves the relationship consumer intact", () => {
    const text = JSON.stringify({
      relationship: { items: ["렌: 검"], itemsRemove: [], promisesAdd: [], promisesRemove: [] },
      episodic: { extracted_facts: [fact({}, null)] },
    });
    const parsed = parsePostTurnSharedInitialResponse(text, input);
    assert.equal(parsed.relationship.valid, true);
    assert.equal(parsed.episodic.valid, false);
  });
});
