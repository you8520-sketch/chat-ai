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
  getEpisodicMemoryForPrompt,
  reconcileEpisodicMemoryFactsForGeneration,
  resolveEpisodicPromptFactText,
} from "@/lib/episodicMemoryFacts";
import { normalizeEvidenceSpan } from "./memory-episodic-evidence";
import {
  parseSharedEpisodicSection,
  reconcileSharedEpisodicFactsForTurn,
} from "./memory-episodic-shared";
import { getOrCreateChatMemory } from "./memory-db";

/**
 * Deterministic, provider-free golden fixtures. Each case is a (USER, ASSISTANT)
 * exchange plus the fact a COMPLIANT extractor would emit for it. Real model quote
 * compliance is intentionally not measured here (needs separately approved paid runs).
 * Baseline = the previous live behavior (same facts, no evidence binding).
 */

const USER = 920101;
const CHAR = 920103;
const CHAT_BASE = 920200;

type Kind = "user_statement" | "user_event" | "ooc_statement" | "scene_event" | "character_claim";
type Importance = "critical" | "important" | "normal";

type Golden = {
  id: string;
  kind: Kind;
  importance: Importance;
  userText: string;
  assistantText: string;
  fact: Record<string, unknown>;
};

type Adversarial = {
  id: string;
  userText: string;
  assistantText: string;
  fact: Record<string, unknown>;
};

function f(
  category: string,
  subject: string,
  attribute: string,
  value: string,
  importance: Importance,
  fact_text: string,
  evidence_type: string,
  source_role: "user" | "assistant",
  source_quote: string
) {
  return {
    category,
    subject,
    attribute,
    value,
    importance,
    fact_text,
    evidence_type,
    evidence: { source_role, source_quote },
  };
}

const NEUTRAL_ASSISTANT = "에녹은 잠시 말없이 서 있었다.";
const NEUTRAL_USER = "그래, 계속 이야기해 줘.";

const BONA_FIDE: Golden[] = [
  {
    id: "U1 coffee preference",
    kind: "user_statement",
    importance: "important",
    userText: "나는 커피에 시럽을 두 번 넣어 마셔.",
    assistantText: NEUTRAL_ASSISTANT,
    fact: f("preference", "user", "favorite_drink", "syrup_coffee", "important", "사용자는 커피에 시럽을 두 번 넣어 마신다고 밝혔다.", "explicit_user_statement", "user", "커피에 시럽을 두 번 넣어 마셔."),
  },
  {
    id: "U2 self backstory",
    kind: "user_statement",
    importance: "important",
    userText: "나는 어릴 때 이 마을에서 자랐어.",
    assistantText: NEUTRAL_ASSISTANT,
    fact: f("character", "user", "hometown", "this_village", "important", "사용자는 어릴 때 이 마을에서 자랐다고 밝혔다.", "explicit_user_statement", "user", "나는 어릴 때 이 마을에서 자랐어."),
  },
  {
    id: "U3 OOC narration preference",
    kind: "ooc_statement",
    importance: "important",
    userText: "(OOC: 앞으로는 항상 3인칭 서술로 답해줘)",
    assistantText: NEUTRAL_ASSISTANT,
    fact: f("preference", "user", "narration_style", "third_person", "important", "사용자는 앞으로 3인칭 서술을 요청했다.", "explicit_user_statement", "user", "앞으로는 항상 3인칭 서술로 답해줘"),
  },
  {
    id: "U4 occupation",
    kind: "user_statement",
    importance: "critical",
    userText: "내 이름은 하린이고 약사로 일하고 있어.",
    assistantText: NEUTRAL_ASSISTANT,
    fact: f("character", "user", "occupation", "pharmacist", "critical", "사용자는 약사로 일하고 있다고 밝혔다.", "explicit_user_statement", "user", "약사로 일하고 있어."),
  },
  {
    id: "U5 boundary",
    kind: "user_statement",
    importance: "critical",
    userText: "나는 큰 소리로 다투는 장면은 싫어.",
    assistantText: NEUTRAL_ASSISTANT,
    fact: f("preference", "user", "scene_boundary", "no_shouting", "critical", "사용자는 큰 소리로 다투는 장면을 싫어한다고 명시했다.", "explicit_user_statement", "user", "큰 소리로 다투는 장면은 싫어."),
  },
  {
    id: "U6 user consent to relationship",
    kind: "user_statement",
    importance: "critical",
    userText: "좋아, 우리 오늘부터 연인하자.",
    assistantText: NEUTRAL_ASSISTANT,
    fact: f("relationship", "enoch_user", "relationship_status", "lovers", "critical", "에녹과 유저는 서로 연인이 되기로 명시적으로 합의했다.", "explicit_scene_event", "user", "좋아, 우리 오늘부터 연인하자."),
  },
  {
    id: "U7 user action",
    kind: "user_event",
    importance: "important",
    userText: "나는 에녹에게 오래 간직한 편지를 건넸다.",
    assistantText: NEUTRAL_ASSISTANT,
    fact: f("character", "user", "action", "gave_letter", "important", "유저는 에녹에게 오래 간직한 편지를 건넸다.", "explicit_scene_event", "user", "에녹에게 오래 간직한 편지를 건넸다."),
  },
  {
    id: "U8 user refusal",
    kind: "user_event",
    importance: "important",
    userText: "싫어, 나는 여기 남지 않을 거야.",
    assistantText: NEUTRAL_ASSISTANT,
    fact: f("character", "user", "response", "refused", "important", "유저는 에녹의 요구를 거절했다.", "explicit_scene_event", "user", "싫어, 나는 여기 남지 않을 거야."),
  },
  {
    id: "C1 door lock toward user",
    kind: "scene_event",
    importance: "important",
    userText: "나 이만 가볼게.",
    assistantText: '에녹이 문을 잠갔다. "가지 마."',
    fact: f("character", "enoch", "action", "locked_door", "important", "에녹은 유저가 떠나려 하자 문을 잠그고 남으라고 요구했다.", "explicit_scene_event", "assistant", "에녹이 문을 잠갔다."),
  },
  {
    id: "C2 scarf",
    kind: "scene_event",
    importance: "normal",
    userText: NEUTRAL_USER,
    assistantText: "에녹이 낡은 목도리를 유저의 어깨에 둘러주었다.",
    fact: f("character", "enoch", "action", "draped_scarf", "normal", "에녹은 낡은 목도리를 유저의 어깨에 둘러주었다.", "explicit_scene_event", "assistant", "에녹이 낡은 목도리를 유저의 어깨에 둘러주었다."),
  },
  {
    id: "C3 NPC gatekeeper",
    kind: "scene_event",
    importance: "important",
    userText: NEUTRAL_USER,
    assistantText: "문지기가 성문을 닫고 통행을 막았다.",
    fact: f("location", "gatekeeper", "action", "closed_gate", "important", "문지기는 성문을 닫고 통행을 막았다.", "explicit_scene_event", "assistant", "문지기가 성문을 닫고 통행을 막았다."),
  },
  {
    id: "C4 drew sword",
    kind: "scene_event",
    importance: "important",
    userText: NEUTRAL_USER,
    assistantText: "에녹이 칼집에서 칼을 뽑아 들었다.",
    fact: f("character", "enoch", "action", "drew_sword", "important", "에녹은 칼집에서 칼을 뽑아 들었다.", "explicit_scene_event", "assistant", "에녹이 칼집에서 칼을 뽑아 들었다."),
  },
  {
    id: "C5 NPC apology",
    kind: "scene_event",
    importance: "important",
    userText: NEUTRAL_USER,
    assistantText: "리아가 고개를 숙이며 깊이 사과했다.",
    fact: f("character", "lia", "action", "apologized", "important", "리아는 고개를 숙이며 깊이 사과했다.", "explicit_scene_event", "assistant", "리아가 고개를 숙이며 깊이 사과했다."),
  },
  {
    id: "C6 opened window",
    kind: "scene_event",
    importance: "normal",
    userText: NEUTRAL_USER,
    assistantText: "에녹이 창문을 열고 밤바람을 맞았다.",
    fact: f("character", "enoch", "action", "opened_window", "normal", "에녹은 창문을 열고 밤바람을 맞았다.", "explicit_scene_event", "assistant", "에녹이 창문을 열고 밤바람을 맞았다."),
  },
  {
    id: "C7 world event",
    kind: "scene_event",
    importance: "normal",
    userText: NEUTRAL_USER,
    assistantText: "마을 종탑에서 정오를 알리는 종이 울렸다.",
    fact: f("setting", "village", "event", "noon_bell", "normal", "마을 종탑에서 정오를 알리는 종이 울렸다.", "explicit_scene_event", "assistant", "마을 종탑에서 정오를 알리는 종이 울렸다."),
  },
  {
    id: "C8 grabbed user's wrist",
    kind: "scene_event",
    importance: "important",
    userText: NEUTRAL_USER,
    assistantText: "에녹이 유저의 손목을 붙잡고 복도로 끌고 갔다.",
    fact: f("character", "enoch", "action", "dragged_user", "important", "에녹은 유저의 손목을 붙잡고 복도로 끌고 갔다.", "explicit_scene_event", "assistant", "에녹이 유저의 손목을 붙잡고 복도로 끌고 갔다."),
  },
  {
    id: "K1 guild claim",
    kind: "character_claim",
    importance: "important",
    userText: NEUTRAL_USER,
    assistantText: '에녹이 말했다. "나는 길드 소속이야."',
    fact: f("character", "enoch", "guild_claim", "guild_member", "important", "에녹은 자신이 길드원이라고 밝혔다.", "explicit_character_claim", "assistant", "나는 길드 소속이야."),
  },
  {
    id: "K2 sister claim",
    kind: "character_claim",
    importance: "important",
    userText: NEUTRAL_USER,
    assistantText: '리아가 말했다. "누나가 널 예전에 시장에서 봤대."',
    fact: f("character", "lia", "claim_about_sister", "sister_saw_user", "important", "리아는 누나가 유저를 예전에 시장에서 봤다고 말했다.", "explicit_character_claim", "assistant", "누나가 널 예전에 시장에서 봤대."),
  },
  {
    id: "K3 sword heirloom claim",
    kind: "character_claim",
    importance: "normal",
    userText: NEUTRAL_USER,
    assistantText: '에녹이 말했다. "이 검은 선대 왕의 유품이라고 들었어."',
    fact: f("item", "royal_sword", "origin_claim", "former_king", "normal", "에녹은 그 검이 선대 왕의 유품이라고 말했다.", "explicit_character_claim", "assistant", "이 검은 선대 왕의 유품이라고 들었어."),
  },
];

const ADVERSARIAL: Adversarial[] = [
  {
    id: "A1 fabricated door-lock (source absent)",
    userText: "나 이만 가볼게.",
    assistantText: "에녹은 창밖을 바라보았다.",
    fact: f("character", "enoch", "action", "locked_door", "important", "에녹은 유저가 떠나려 하자 문을 잠그고 남으라고 요구했다.", "explicit_scene_event", "assistant", "에녹이 문을 잠갔다."),
  },
  {
    id: "A2 wrong actor (quote only in user message)",
    userText: "에녹이 문을 잠갔다.",
    assistantText: NEUTRAL_ASSISTANT,
    fact: f("character", "enoch", "action", "locked_door", "important", "에녹은 유저가 떠나려 하자 문을 잠그고 남으라고 요구했다.", "explicit_scene_event", "assistant", "에녹이 문을 잠갔다."),
  },
  {
    id: "A3 retrospective sister meeting as objective scene event",
    userText: NEUTRAL_USER,
    assistantText: '리아가 말했다. "누나가 널 예전에 시장에서 봤대."',
    fact: f("character", "lia", "prior_meeting", "met_at_market", "important", "누나는 유저를 예전에 시장에서 만난 적이 있다.", "explicit_scene_event", "assistant", "누나가 널 예전에 시장에서 봤대."),
  },
  {
    id: "A4 generic short quote authorizing ring clause",
    userText: NEUTRAL_USER,
    assistantText: "에녹은 시장에 도착했다.",
    fact: f("item", "enoch", "gift", "ring_lore", "important", "에녹은 시장에서 유저에게 반지를 건넸다.", "explicit_scene_event", "assistant", "시장에"),
  },
  {
    id: "A5 assistant narrates user↔cast relationship",
    userText: NEUTRAL_USER,
    assistantText: "에녹과 유저는 서로 연인이 되기로 합의했다.",
    fact: f("relationship", "enoch_user", "relationship_status", "lovers", "critical", "에녹과 유저는 서로 연인이 되기로 명시적으로 합의했다.", "explicit_scene_event", "assistant", "에녹과 유저는 서로 연인이 되기로 합의했다."),
  },
  {
    id: "A6 assistant narrates the user's own action",
    userText: NEUTRAL_USER,
    assistantText: "유저는 에녹의 요구를 단호하게 거절했다.",
    fact: f("character", "user", "response", "refused", "important", "유저는 에녹의 요구를 거절했다.", "explicit_scene_event", "assistant", "유저는 에녹의 요구를 단호하게 거절했다."),
  },
  {
    id: "A7 paraphrased (non-verbatim) quote of a real event",
    userText: NEUTRAL_USER,
    assistantText: "에녹이 문을 잠갔다.",
    fact: f("character", "enoch", "action", "locked_door", "important", "에녹은 유저가 떠나려 하자 문을 잠그고 남으라고 요구했다.", "explicit_scene_event", "assistant", "에녹은 출입문을 잠가 버렸다."),
  },
  {
    id: "A8 quote from a previous turn",
    userText: NEUTRAL_USER,
    assistantText: "에녹은 고개를 끄덕였다.",
    fact: f("character", "enoch", "action", "locked_door", "important", "에녹은 유저가 떠나려 하자 문을 잠그고 남으라고 요구했다.", "explicit_scene_event", "assistant", "지난 턴에서 에녹이 문을 잠갔다."),
  },
  {
    id: "A9 cue-less invented shared event with no RAW",
    userText: NEUTRAL_USER,
    assistantText: NEUTRAL_ASSISTANT,
    fact: f("character", "enoch", "shared_school", "same_school", "important", "에녹은 유저와 같은 학교에 다닌 적이 있다.", "explicit_scene_event", "assistant", "같은 학교에 다녔다."),
  },
  {
    id: "A10 claim sourced from the user message",
    userText: "누나가 날 예전에 시장에서 봤대.",
    assistantText: NEUTRAL_ASSISTANT,
    fact: f("character", "lia", "claim_about_sister", "sister_saw_user", "important", "리아는 누나가 유저를 예전에 시장에서 봤다고 말했다.", "explicit_character_claim", "user", "누나가 날 예전에 시장에서 봤대."),
  },
  {
    id: "A11 user statement not present in user message",
    userText: NEUTRAL_USER,
    assistantText: NEUTRAL_ASSISTANT,
    fact: f("preference", "user", "favorite_drink", "syrup_coffee", "important", "사용자는 커피에 시럽을 두 번 넣어 마신다고 밝혔다.", "explicit_user_statement", "user", "커피에 시럽을 두 번 넣어 마셔."),
  },
  {
    id: "A12 invented emotional callback",
    userText: NEUTRAL_USER,
    assistantText: NEUTRAL_ASSISTANT,
    fact: f("character", "enoch", "comfort", "remembered_anniversary", "important", "에녹은 유저의 어머니 기일을 기억하고 위로했다.", "explicit_scene_event", "assistant", "어머니 기일을 기억하고 있었다."),
  },
  {
    id: "A13 evidence missing",
    userText: "나 이만 가볼게.",
    assistantText: '에녹이 문을 잠갔다. "가지 마."',
    fact: (() => {
      const { evidence: _omit, ...rest } = f("character", "enoch", "action", "locked_door", "important", "에녹은 유저가 떠나려 하자 문을 잠그고 남으라고 요구했다.", "explicit_scene_event", "assistant", "에녹이 문을 잠갔다.");
      void _omit;
      return rest;
    })(),
  },
];

/**
 * Quote is real and matches its message, but the LLM gloss adds an event the quote
 * does not state. `added` is the unsupported clause that must never reach the prompt.
 */
const OVERREACH: Array<Adversarial & { added: string }> = [
  {
    id: "O1 coffee quote, unrelated kiss (user role)",
    userText: "나는 오늘 커피를 마실래.",
    assistantText: "라이크가 고개를 끄덕였다.",
    fact: f("character", "ren", "action", "kissed_laike", "important", "렌은 라이크에게 먼저 입을 맞췄다.", "explicit_scene_event", "user", "나는 오늘 커피를 마실래."),
    added: "입을 맞췄",
  },
  {
    id: "O2 door-lock quote, extra book burning (assistant role)",
    userText: NEUTRAL_USER,
    assistantText: "라이크는 문을 잠갔다.",
    fact: f("character", "laike", "action", "burned_book", "important", "라이크는 문을 잠근 뒤 중요한 책을 불태웠다.", "explicit_scene_event", "assistant", "라이크는 문을 잠갔다."),
    added: "불태웠",
  },
  {
    id: "O3 user preference quote, extra consent claim",
    userText: "나는 커피에 시럽을 넣어 마셔.",
    assistantText: NEUTRAL_ASSISTANT,
    fact: f("preference", "user", "favorite_drink", "syrup_coffee", "important", "사용자는 시럽 커피를 좋아하고 에녹의 청혼을 수락했다.", "explicit_user_statement", "user", "커피에 시럽을 넣어 마셔."),
    added: "청혼",
  },
  {
    id: "O4 scene quote, extra injury",
    userText: NEUTRAL_USER,
    assistantText: "에녹이 칼을 뽑아 들었다.",
    fact: f("character", "enoch", "action", "drew_sword", "important", "에녹은 칼을 뽑아 들고 리아의 팔을 베었다.", "explicit_scene_event", "assistant", "에녹이 칼을 뽑아 들었다."),
    added: "리아의 팔",
  },
  {
    id: "O5 persona-subject scene quote, extra history",
    userText: NEUTRAL_USER,
    assistantText: "에녹은 창문을 열었다.",
    fact: f("character", "enoch", "action", "opened_window", "important", "에녹은 창문을 열고 렌에게 비밀 편지를 건넸다.", "explicit_scene_event", "assistant", "에녹은 창문을 열었다."),
    added: "비밀 편지",
  },
];

let chatCounter = 0;

function seedExchange(userText: string, assistantText: string) {
  const db = getDb();
  chatCounter += 1;
  const chatId = CHAT_BASE + chatCounter;
  const userMessageId = chatId * 10 + 1;
  const assistantMessageId = chatId * 10 + 2;
  db.prepare(`INSERT INTO chats (id, user_id, character_id, mode) VALUES (?,?,?,'safe')`).run(chatId, USER, CHAR);
  getOrCreateChatMemory(chatId, USER, CHAR, "free");
  db.prepare(`INSERT INTO messages (id, chat_id, role, content) VALUES (?,?,?,?)`).run(userMessageId, chatId, "user", userText);
  db.prepare(
    `INSERT INTO messages (id, chat_id, role, content, user_message_id, generation_status, model)
     VALUES (?, ?, 'assistant', ?, ?, 'completed', 'test-model')`
  ).run(assistantMessageId, chatId, assistantText, userMessageId);
  return { chatId, userMessageId, assistantMessageId };
}

/** New live behavior: Shared Initial reconcile with server-side evidence verification. */
function acceptedWithEvidenceGate(c: { userText: string; assistantText: string; fact: Record<string, unknown> }) {
  const turn = seedExchange(c.userText, c.assistantText);
  const result = reconcileSharedEpisodicFactsForTurn(getDb(), {
    chatId: turn.chatId,
    userId: USER,
    characterId: CHAR,
    assistantMessageId: turn.assistantMessageId,
    sourceUserMessageId: turn.userMessageId,
    sourceUserText: c.userText,
    episodic: parseSharedEpisodicSection({ extracted_facts: [c.fact] }),
    isRegeneration: false,
  });
  return { accepted: result.inserted === 1, turn };
}

/** Previous live behavior: identical facts and single-turn user text, no evidence binding. */
function acceptedByBaseline(c: { userText: string; assistantText: string; fact: Record<string, unknown> }) {
  const turn = seedExchange(c.userText, c.assistantText);
  const { evidence: _evidence, ...legacyFact } = c.fact;
  void _evidence;
  const parsed = parseSharedEpisodicSection({
    extracted_facts: [{ ...legacyFact, evidence: { source_role: "user", source_quote: "baseline placeholder" } }],
  });
  const result = reconcileEpisodicMemoryFactsForGeneration(getDb(), {
    chatId: turn.chatId,
    userId: USER,
    characterId: CHAR,
    sourceTurn: 1,
    sourceUserMessageId: turn.userMessageId,
    sourceUserText: c.userText,
    facts: parsed.facts,
    isRegeneration: false,
    metadata: { extraction: "shared_initial_per_turn", assistant_message_id: turn.assistantMessageId },
  });
  return result.inserted === 1;
}

function cleanup() {
  const db = getDb();
  const chatIds = (db.prepare("SELECT id FROM chats WHERE user_id=?").all(USER) as { id: number }[]).map((r) => r.id);
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
  db.prepare(`INSERT INTO users (id, email, nickname, pw_hash) VALUES (?,?,?,?)`).run(USER, `gold-${USER}@test.local`, "gold", "x");
  db.prepare(`INSERT INTO characters (id, name) VALUES (?,?)`).run(CHAR, "GoldChar");
});
after(() => cleanup());

describe("B-1 golden fixtures: recall loss and unsupported-event acceptance", () => {
  it("keeps every critical/explicit user fact and every bona fide current character/NPC event (≤5pp overall loss)", () => {
    const rows = BONA_FIDE.map((c) => {
      const baseline = acceptedByBaseline(c);
      const gated = acceptedWithEvidenceGate(c);
      return { c, baseline, gated: gated.accepted };
    });
    const eligible = rows.filter((r) => r.baseline);
    const lost = eligible.filter((r) => !r.gated);
    const lossPp = (lost.length / eligible.length) * 100;

    const lostCriticalOrUser = lost.filter(
      (r) =>
        r.c.importance === "critical" ||
        r.c.kind === "user_statement" ||
        r.c.kind === "user_event" ||
        r.c.kind === "ooc_statement"
    );
    const lostCharacterEvents = lost.filter((r) => r.c.kind === "scene_event");

    console.log(
      "B1_GOLDEN_RECALL " +
        JSON.stringify({
          bonaFide: BONA_FIDE.length,
          baselineAccepted: eligible.length,
          gatedAccepted: eligible.length - lost.length,
          lost: lost.map((r) => r.c.id),
          lossPercentagePoints: Number(lossPp.toFixed(2)),
          lostCriticalOrExplicitUser: lostCriticalOrUser.length,
          lostBonaFideCharacterNpcEvents: lostCharacterEvents.length,
        })
    );

    assert.equal(eligible.length, BONA_FIDE.length, "every golden fact must be accepted by the baseline");
    assert.equal(lostCriticalOrUser.length, 0, `lost critical/user facts: ${lostCriticalOrUser.map((r) => r.c.id).join(", ")}`);
    assert.equal(lostCharacterEvents.length, 0, `lost character/NPC events: ${lostCharacterEvents.map((r) => r.c.id).join(", ")}`);
    assert.ok(lossPp <= 5, `overall loss ${lossPp}pp exceeds 5pp`);
  });

  it("accepts zero adversarial facts under the gate and reports how many the baseline accepted", () => {
    const results = ADVERSARIAL.map((c) => ({
      id: c.id,
      baseline: acceptedByBaseline(c),
      gated: acceptedWithEvidenceGate(c).accepted,
    }));
    console.log(
      "B1_GOLDEN_ADVERSARIAL " +
        JSON.stringify({
          total: results.length,
          baselineAccepted: results.filter((r) => r.baseline).map((r) => r.id),
          gatedAccepted: results.filter((r) => r.gated).map((r) => r.id),
        })
    );
    assert.deepEqual(
      results.filter((r) => r.gated).map((r) => r.id),
      []
    );
  });

  it("every accepted fact's stored evidence resolves to the correct RAW role, id and verbatim quote", () => {
    const db = getDb();
    let checked = 0;
    for (const c of BONA_FIDE) {
      const { accepted, turn } = acceptedWithEvidenceGate(c);
      assert.equal(accepted, true, c.id);
      const stored = db
        .prepare("SELECT metadata FROM episodic_memory_facts WHERE chat_id=?")
        .all(turn.chatId) as { metadata: string }[];
      assert.equal(stored.length, 1, c.id);
      const evidence = (JSON.parse(stored[0]!.metadata) as {
        evidence: { role: "user" | "assistant"; message_id: number; quote: string };
      }).evidence;
      const message = db
        .prepare("SELECT role, content FROM messages WHERE id=? AND chat_id=?")
        .get(evidence.message_id, turn.chatId) as { role: string; content: string };
      assert.equal(message.role, evidence.role, c.id);
      assert.ok(normalizeEvidenceSpan(message.content).includes(evidence.quote), c.id);
      checked += 1;
    }
    assert.equal(checked, BONA_FIDE.length);
  });

  it("quote compliance sensitivity: verbatim keeps all, paraphrased quotes lose the fact (cost depends on model compliance)", () => {
    let paraphrasedAccepted = 0;
    for (const c of BONA_FIDE) {
      const evidence = c.fact.evidence as { source_role: "user" | "assistant"; source_quote: string };
      const paraphrased = {
        ...c,
        fact: { ...c.fact, evidence: { ...evidence, source_quote: `${evidence.source_quote} 그리고 그것은 사실이었다.` } },
      };
      if (acceptedWithEvidenceGate(paraphrased).accepted) paraphrasedAccepted += 1;
    }
    console.log(
      "B1_GOLDEN_COMPLIANCE_SENSITIVITY " +
        JSON.stringify({ bonaFide: BONA_FIDE.length, acceptedWhenQuoteNotVerbatim: paraphrasedAccepted })
    );
    assert.equal(paraphrasedAccepted, 0);
  });
});

function storedPromptTexts(chatId: number): string[] {
  const rows = getDb()
    .prepare("SELECT fact_text, metadata FROM episodic_memory_facts WHERE chat_id=? ORDER BY id")
    .all(chatId) as { fact_text: string; metadata: string }[];
  return rows.map((row) => resolveEpisodicPromptFactText(row));
}

describe("B-1 round 2 golden: verified quote that does not entail the LLM gloss", () => {
  it("added events never reach the prompt under the gate, while the previous behavior injected them", () => {
    const results = OVERREACH.map((c) => {
      const baselineTurn = seedExchange(c.userText, c.assistantText);
      const { evidence: _evidence, ...legacyFact } = c.fact;
      void _evidence;
      const baselineParsed = parseSharedEpisodicSection({
        extracted_facts: [{ ...legacyFact, evidence: { source_role: "user", source_quote: "baseline placeholder" } }],
      });
      reconcileEpisodicMemoryFactsForGeneration(getDb(), {
        chatId: baselineTurn.chatId,
        userId: USER,
        characterId: CHAR,
        sourceTurn: 1,
        sourceUserMessageId: baselineTurn.userMessageId,
        sourceUserText: c.userText,
        facts: baselineParsed.facts,
        isRegeneration: false,
        metadata: { extraction: "shared_initial_per_turn", assistant_message_id: baselineTurn.assistantMessageId },
      });
      const baselineInjected = storedPromptTexts(baselineTurn.chatId).join("\n");
      const gated = acceptedWithEvidenceGate(c);
      const gatedInjected = storedPromptTexts(gated.turn.chatId).join("\n");
      return {
        id: c.id,
        baselineInjectsAdded: baselineInjected.includes(c.added),
        gatedStored: gated.accepted,
        gatedInjectsAdded: gatedInjected.includes(c.added),
        gatedInjectsQuote: gatedInjected.includes(
          (c.fact.evidence as { source_quote: string }).source_quote
        ),
      };
    });
    console.log("B1R2_GOLDEN_OVERREACH " + JSON.stringify(results));
    assert.deepEqual(results.filter((r) => !r.baselineInjectsAdded).map((r) => r.id), []);
    assert.deepEqual(results.filter((r) => r.gatedInjectsAdded).map((r) => r.id), []);
    assert.deepEqual(results.filter((r) => r.gatedStored && !r.gatedInjectsQuote).map((r) => r.id), []);
  });

  it("bona fide facts inject exactly their verified quote; reports the injected size versus the gloss", () => {
    let injectedChars = 0;
    let glossChars = 0;
    for (const c of BONA_FIDE) {
      const { accepted, turn } = acceptedWithEvidenceGate(c);
      assert.equal(accepted, true, c.id);
      const [text] = storedPromptTexts(turn.chatId);
      const quote = (c.fact.evidence as { source_quote: string }).source_quote;
      assert.ok(text!.includes(`“${quote}”`), c.id);
      assert.ok(/^\[[^\]]+\] “/.test(text!), c.id);
      injectedChars += text!.length;
      glossChars += String(c.fact.fact_text).length;
    }
    console.log(
      "B1R2_GOLDEN_INJECTED_SIZE " +
        JSON.stringify({
          bonaFide: BONA_FIDE.length,
          avgInjectedChars: Number((injectedChars / BONA_FIDE.length).toFixed(1)),
          avgGlossChars: Number((glossChars / BONA_FIDE.length).toFixed(1)),
        })
    );
  });
});

describe("B-1 80-turn continuous scenario: emotional callback from correctly attributed memory", () => {
  it("stores verified important memories during the run, rejects invented ones, and recalls the verified one at turn 80", () => {
    const db = getDb();
    chatCounter += 1;
    const chatId = CHAT_BASE + chatCounter;
    db.prepare(`INSERT INTO chats (id, user_id, character_id, mode) VALUES (?,?,?,'safe')`).run(chatId, USER, CHAR);
    getOrCreateChatMemory(chatId, USER, CHAR, "free");

    const scripted = new Map<number, { user: string; assistant: string; fact?: Record<string, unknown> }>([
      [
        12,
        {
          user: "오늘은 어머니 기일이라서 마음이 무거워. 혼자 있고 싶어.",
          assistant: "에녹은 조용히 곁에 앉아 따뜻한 차를 내밀었다.",
          fact: f("character", "user", "mother_memorial", "memorial_day", "critical", "사용자는 오늘이 어머니의 기일이라서 마음이 무겁다고 밝혔다.", "explicit_user_statement", "user", "오늘은 어머니 기일이라서 마음이 무거워."),
        },
      ],
      [
        20,
        {
          user: "고마워.",
          assistant: "에녹이 어머니를 기리는 작은 등불을 창가에 올려두었다.",
          fact: f("character", "enoch", "memorial_lantern", "lantern_on_window", "important", "에녹은 어머니를 기리는 작은 등불을 창가에 올려두었다.", "explicit_scene_event", "assistant", "에녹이 어머니를 기리는 작은 등불을 창가에 올려두었다."),
        },
      ],
      [
        33,
        {
          user: "오늘은 좀 괜찮아졌어.",
          assistant: "에녹은 말없이 고개를 끄덕였다.",
          fact: f("character", "enoch", "shared_memory", "met_mother_before", "important", "에녹은 유저의 어머니를 예전에 직접 만난 적이 있다.", "explicit_scene_event", "assistant", "어머니를 직접 만난 적이 있다."),
        },
      ],
    ]);

    let verifiedAtRun = 0;
    let rejectedAtRun = 0;
    for (let turn = 1; turn <= 80; turn += 1) {
      const entry = scripted.get(turn);
      const userMessageId = chatId * 1000 + turn * 2 - 1;
      const assistantMessageId = chatId * 1000 + turn * 2;
      db.prepare(`INSERT INTO messages (id, chat_id, role, content) VALUES (?,?,?,?)`).run(
        userMessageId,
        chatId,
        "user",
        entry?.user ?? `평범한 대화 ${turn}번째 이야기를 이어 간다.`
      );
      db.prepare(
        `INSERT INTO messages (id, chat_id, role, content, user_message_id, generation_status, model)
         VALUES (?, ?, 'assistant', ?, ?, 'completed', 'test-model')`
      ).run(assistantMessageId, chatId, entry?.assistant ?? `에녹은 ${turn}번째 대화에 짧게 답했다.`, userMessageId);
      if (!entry?.fact) continue;
      const result = reconcileSharedEpisodicFactsForTurn(db, {
        chatId,
        userId: USER,
        characterId: CHAR,
        assistantMessageId,
        sourceUserMessageId: userMessageId,
        sourceUserText: entry.user,
        episodic: parseSharedEpisodicSection({ extracted_facts: [entry.fact] }),
        isRegeneration: false,
      });
      if (result.inserted === 1) verifiedAtRun += 1;
      else rejectedAtRun += 1;
    }
    assert.equal(verifiedAtRun, 2);
    assert.equal(rejectedAtRun, 1);

    const recall = getEpisodicMemoryForPrompt(
      db,
      {
        chatId,
        characterId: CHAR,
        userId: USER,
        currentTurn: 80,
        currentUserMessage: "오늘이 어머니 기일이었던 거 기억해?",
        recentChatText: "평범한 최근 대화",
      },
      { EPISODIC_MEMORY_RECALL_ENABLED: "1" } as NodeJS.ProcessEnv
    );
    assert.ok(
      recall.promptBlock.includes("[유저가 직접 쓴 원문] “오늘은 어머니 기일이라서 마음이 무거워.”"),
      "verified user statement is recalled as the user's own quoted words"
    );
    assert.equal(recall.promptBlock.includes("직접 만난 적"), false, "invented shared history never reaches the prompt");
  });
});
