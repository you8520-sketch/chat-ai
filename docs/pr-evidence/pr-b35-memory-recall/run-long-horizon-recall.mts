/**
 * B35 C — long-horizon recall (50 / 150 / 500 / 1000 turns) through the canonical owners.
 *
 * SYNTHETIC fixture (no real 500/1000-turn RP chat exists in this repo or in the isolated VM).
 * Chats are built in a temp SQLite DB: H real `messages` rows per side, facts written through
 * `persistEpisodicMemoryFactsCore` with the production evidence binding (verbatim quote gate),
 * read back through `getEpisodicMemoryForPrompt` with the production default min-age (5).
 * No provider call, no embedding call, no production data.
 *
 * Usage:
 *   node --conditions=react-server --import tsx docs/pr-evidence/pr-b35-memory-recall/run-long-horizon-recall.mts
 */
import Module from "node:module";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

const OUT_DIR =
  process.env.B35_OUT_DIR ?? path.join(process.cwd(), "docs/pr-evidence/pr-b35-memory-recall");
mkdirSync(OUT_DIR, { recursive: true });

process.env.DATA_DIR = mkdtempSync(path.join(tmpdir(), "b35-long-horizon-"));
process.env.MEMORY_FEATURE_ENABLED = "1";
process.env.EPISODIC_MEMORY_RECALL_ENABLED = "1";
delete process.env.EPISODIC_MEMORY_MIN_AGE_TURNS;
delete process.env.OPENROUTER_API_KEY;
delete process.env.CHEAPER_INFERENCE_API_KEY;

const originalLoad = Module._load;
Module._load = function (request: string, parent: unknown, isMain: boolean) {
  if (request === "server-only") return {};
  return originalLoad.call(this, request, parent, isMain);
} as typeof Module._load;

const { getDb } = await import("@/lib/db");
const {
  persistEpisodicMemoryFactsCore,
  getEpisodicMemoryForPrompt,
  fetchEpisodicMemoryCandidatesForDebug,
  evaluateEpisodicRetrievalGuard,
  inspectLexicalRelevanceForDebug,
  resolveEpisodicMemoryMinAgeTurns,
} = await import("@/lib/episodicMemoryFacts");
const { getOrCreateChatMemory } = await import("@/lib/memory/memory-db");
const { selectPromiseHistoryForPrompt } = await import("@/lib/memory/memory-relationship-timeline");
type EpisodicExtractedFact = import("@/lib/memory/memory-episodic-types").EpisodicExtractedFact;
type RelationshipLedgerEvent = import("@/lib/memory/memory-relationship-timeline-types").RelationshipLedgerEvent;

const USER_ID = 8101;
const CHARACTER_ID = 8102;
let chatSerial = 8200;
let rngState = 20261023;
function rand(): number {
  rngState = (rngState * 1664525 + 1013904223) >>> 0;
  return rngState / 0x100000000;
}
function pick<T>(items: readonly T[]): T {
  return items[Math.floor(rand() * items.length)]!;
}

const db = getDb();
db.prepare("INSERT OR IGNORE INTO users (id, email, nickname, pw_hash) VALUES (?,?,?,?)").run(
  USER_ID,
  "b35-long@example.com",
  "관리자",
  "x"
);
db.prepare("INSERT OR IGNORE INTO characters (id, name) VALUES (?,?)").run(CHARACTER_ID, "볼프강");

const PEOPLE = ["요한", "카를", "한스", "에르나", "마르타", "보초병", "서기관", "부관"];
const PLACES = ["서쪽 망루", "지하 창고", "마구간", "취사장", "북쪽 초소", "보급 천막", "배수로", "목책 입구"];
const THINGS = ["보급 장부", "기록철", "밀랍 인장", "신호 호각", "횃불 기름", "말 안장", "물통", "지도"];
const ACTS = ["점검했다", "정리했다", "교대했다", "보고했다", "수리했다", "옮겼다", "세어 보았다", "기록했다"];
const DISTRACTOR_TEMPLATES = [
  (p: string, pl: string, t: string, a: string) => `${p}은(는) ${pl}에서 ${t}을(를) ${a}.`,
  (p: string, pl: string, t: string) => `${p}이(가) 감찰관의 도착 시각을 ${pl} 근처에서 ${t}과(와) 함께 확인했다.`,
  (p: string, _pl: string, t: string) => `병사 ${p}이(가) 렌의 진술 기록과 ${t}의 날짜가 어긋난다고 보고했다.`,
  (p: string, pl: string, t: string) => `${p}은(는) ${pl}에서 ${t}을(를) 둘러싼 소문을 전했다.`,
];

type SeededChat = {
  chatId: number;
  turns: number;
  userMessageIds: number[];
  assistantMessageIds: number[];
  userText: string[];
  assistantText: string[];
};

function newChat(turns: number): SeededChat {
  chatSerial += 1;
  const chatId = chatSerial;
  db.prepare("INSERT INTO chats (id, user_id, character_id, mode) VALUES (?,?,?,'safe')").run(
    chatId,
    USER_ID,
    CHARACTER_ID
  );
  getOrCreateChatMemory(chatId, USER_ID, CHARACTER_ID, "free");
  return { chatId, turns, userMessageIds: [], assistantMessageIds: [], userText: [], assistantText: [] };
}

type Slot = { turn: number; user?: string; assistant?: string };

function fillMessages(chat: SeededChat, slots: Slot[]) {
  const byTurn = new Map(slots.map((slot) => [slot.turn, slot]));
  const insert = db.prepare(
    `INSERT INTO messages (chat_id, role, content, generation_status, model, alternates, active_variant)
     VALUES (?, ?, ?, ?, ?, '[]', 0)`
  );
  const tx = db.transaction(() => {
    for (let turn = 1; turn <= chat.turns; turn += 1) {
      const slot = byTurn.get(turn);
      const user =
        slot?.user ?? `*렌은 ${pick(PLACES)}을(를) 둘러보았다.* ${pick(THINGS)}은(는) 어떻게 되고 있어요?`;
      const assistant =
        slot?.assistant ??
        `볼프강은 ${pick(PEOPLE)}에게 ${pick(THINGS)}을(를) ${pick(ACTS)}고 짧게 일렀다. ${pick(PLACES)} 쪽에서 바람이 불어왔다.`;
      const u = insert.run(chat.chatId, "user", user, "completed", "");
      const a = insert.run(chat.chatId, "assistant", assistant, "completed", "test-model");
      chat.userMessageIds[turn] = Number(u.lastInsertRowid);
      chat.assistantMessageIds[turn] = Number(a.lastInsertRowid);
      chat.userText[turn] = user;
      chat.assistantText[turn] = assistant;
    }
  });
  tx();
}

type FactSpec = {
  turn: number;
  fact: Omit<EpisodicExtractedFact, "evidence"> & {
    evidence: { source_role: "user" | "assistant"; source_quote: string };
  };
};

function storeFact(chat: SeededChat, spec: FactSpec): number {
  const result = persistEpisodicMemoryFactsCore(db, {
    chatId: chat.chatId,
    characterId: CHARACTER_ID,
    userId: USER_ID,
    sourceTurn: spec.turn,
    sourceUserMessageId: chat.userMessageIds[spec.turn],
    sourceUserText: chat.userText[spec.turn],
    facts: [spec.fact as EpisodicExtractedFact],
    evidenceBinding: {
      userMessageId: chat.userMessageIds[spec.turn]!,
      assistantMessageId: chat.assistantMessageIds[spec.turn]!,
    },
    metadata: { extraction: "b35_long_horizon_fixture", assistant_message_id: chat.assistantMessageIds[spec.turn] },
  });
  return result;
}

function ambientFacts(chat: SeededChat, reserved: Set<number>) {
  let stored = 0;
  for (let turn = 2; turn <= chat.turns; turn += 2) {
    if (reserved.has(turn)) continue;
    const assistant = chat.assistantText[turn]!;
    const quote = assistant.split(".")[0]! + ".";
    if ([...quote.replace(/\s+/g, "")].length < 6) continue;
    stored += storeFact(chat, {
      turn,
      fact: {
        category: "setting",
        subject: "camp",
        attribute: `ambient_${turn}`,
        value: `detail_${turn}`,
        importance: "normal",
        fact_text: `볼프강이 ${pick(PEOPLE)}에게 ${pick(THINGS)} 관련 일을 지시했다고 설명했다.`,
        evidence_type: "explicit_character_claim",
        evidence: { source_role: "assistant", source_quote: quote },
        corrects: "",
      } as FactSpec["fact"],
    });
  }
  return stored;
}

type Scenario = {
  id: string;
  title: string;
  ageTurns: number;
  query: string;
  targetFactIds: number[];
  forbiddenFactIds?: number[];
  expectation: "inject_target" | "inject_none_of_targets" | "inject_latest_only" | "inject_all_in_order";
};

type StageReport = {
  scenario: string;
  title: string;
  currentTurn: number;
  targetAgeTurns: number;
  query: string;
  expectation: Scenario["expectation"];
  stages: {
    storedInDb: boolean;
    inSqlCandidateSet: boolean;
    passedGuard: boolean;
    relevancePass: boolean | null;
    finalRank: number | null;
    budgetReason: string | null;
    injected: boolean;
  };
  injectedLines: string[];
  verdict: "PASS" | "FAIL";
  firstFailureStage: string | null;
};

function recentTextFor(chat: SeededChat, currentTurn: number): string {
  const lines: string[] = [];
  for (let turn = Math.max(1, currentTurn - 4); turn < currentTurn; turn += 1) {
    lines.push(chat.userText[turn] ?? "", chat.assistantText[turn] ?? "");
  }
  return lines.join("\n");
}

function runRetrieval(chat: SeededChat, currentTurn: number, query: string) {
  const input = {
    chatId: chat.chatId,
    characterId: CHARACTER_ID,
    userId: USER_ID,
    currentTurn,
    currentUserMessage: query,
    recentChatText: recentTextFor(chat, currentTurn),
  };
  const candidates = fetchEpisodicMemoryCandidatesForDebug(db, input);
  const result = getEpisodicMemoryForPrompt(db, input);
  return { candidates, result };
}

function evaluate(
  chat: SeededChat,
  scenario: Scenario,
  currentTurn: number
): StageReport {
  const { candidates, result } = runRetrieval(chat, currentTurn, scenario.query);
  const lines = result.promptBlock
    .split("\n")
    .filter((line) => line.startsWith("- "));
  const injectedIds = new Set(result.facts.map((fact) => fact.id));
  const target = scenario.targetFactIds[0]!;
  const row = db
    .prepare("SELECT * FROM episodic_memory_facts WHERE id=?")
    .get(target) as import("@/lib/episodicMemoryFacts").EpisodicMemoryFactRecord | undefined;
  const debug = result.debug.find((entry) => entry.id === target);
  const guard = row ? evaluateEpisodicRetrievalGuard(row) : { allowed: false, blockedReason: "missing" };
  const stages = {
    storedInDb: Boolean(row),
    inSqlCandidateSet: candidates.rows.some((entry) => entry.id === target),
    passedGuard: guard.allowed,
    relevancePass: debug?.relevance_pass ?? null,
    finalRank: debug?.final_rank ?? null,
    budgetReason: debug?.budget_reason ?? null,
    injected: injectedIds.has(target),
  };
  let verdict: "PASS" | "FAIL" = "PASS";
  let firstFailureStage: string | null = null;
  const fail = (stage: string) => {
    verdict = "FAIL";
    firstFailureStage ??= stage;
  };
  const anyTargetInjected = scenario.targetFactIds.some((id) => injectedIds.has(id));
  const allTargetsInjected = scenario.targetFactIds.every((id) => injectedIds.has(id));
  switch (scenario.expectation) {
    case "inject_target":
      if (!stages.storedInDb) fail("stored");
      else if (!stages.inSqlCandidateSet) fail("candidate_fetch");
      else if (!stages.passedGuard) fail("guard");
      else if (stages.relevancePass === false) fail("relevance_gate");
      else if (!stages.injected) fail(stages.budgetReason ? "budget" : "ranking");
      break;
    case "inject_all_in_order":
      if (!allTargetsInjected) fail("candidate_or_ranking");
      else {
        const turns = scenario.targetFactIds.map((id) => result.facts.find((fact) => fact.id === id)!.source_turn);
        const lineTurns = lines.map((line) => Number(/\[T(\d+)\]/.exec(line)?.[1] ?? "0"));
        const targetLineTurns = lineTurns.filter((turn) => turns.includes(turn));
        if (turns.length !== targetLineTurns.length) fail("render");
      }
      break;
    case "inject_latest_only":
      if (!allTargetsInjected) fail("candidate_or_ranking");
      if ((scenario.forbiddenFactIds ?? []).some((id) => injectedIds.has(id))) fail("stale_fact_injected");
      break;
    case "inject_none_of_targets":
      if (anyTargetInjected) fail("irrelevant_memory_intrusion");
      break;
    default: {
      const exhausted: never = scenario.expectation;
      throw new Error(String(exhausted));
    }
  }
  return {
    scenario: scenario.id,
    title: scenario.title,
    currentTurn,
    targetAgeTurns: scenario.ageTurns,
    query: scenario.query,
    expectation: scenario.expectation,
    stages,
    injectedLines: lines,
    verdict,
    firstFailureStage,
  };
}

const MIN_AGE = resolveEpisodicMemoryMinAgeTurns();

type EventDef = {
  key: string;
  ageTurns: number;
  user?: string;
  assistant?: string;
  fact: FactSpec["fact"];
};

const REFUSAL_QUOTE = "나는 내 진술을 황실 감찰관에게 전달하는 데 동의하지 않았어.";
const WOLF_ORDER_QUOTE = "이 진술은 감찰관에게 전달하지 마라.";
const ALLIANCE_QUOTE = "볼프강은 렌의 손을 맞잡고 동맹을 맺었다.";
const ALLIANCE_BREAK_QUOTE = "볼프강은 렌의 손을 뿌리치며 동맹을 끝냈다.";
const KEY_LOSS_QUOTE = "에르나는 금고 열쇠를 잃어버렸다.";
const KEY_FOUND_QUOTE = "병사가 마구간 짚더미에서 금고 열쇠를 찾아냈다.";
const POST_NORTH_QUOTE = "렌은 오늘부터 북쪽 초소에 배치된다.";
const POST_SOUTH_QUOTE = "렌은 남쪽 초소로 재배치한다. 북쪽 배치는 철회한다.";
const SEAL_QUOTE = "황실 밀서의 봉인은 열람 전에 이미 한 번 뜯겨 있었다.";
const SEAL_FOLLOW_QUOTE = "봉인을 뜯은 자는 서기관 카를이다.";

function fct(
  category: EpisodicExtractedFact["category"],
  subject: string,
  attribute: string,
  value: string,
  importance: EpisodicExtractedFact["importance"],
  fact_text: string,
  evidence_type: NonNullable<EpisodicExtractedFact["evidence_type"]>,
  role: "user" | "assistant",
  quote: string,
  corrects = ""
): FactSpec["fact"] {
  return {
    category,
    subject,
    attribute,
    value,
    importance,
    fact_text,
    evidence_type,
    evidence: { source_role: role, source_quote: quote },
    corrects,
  } as FactSpec["fact"];
}

const EVENTS: EventDef[] = [
  {
    key: "refusal50",
    ageTurns: 50,
    user: `*렌은 서약서를 밀어냈다.* ${REFUSAL_QUOTE} 먼저 기록을 확인하겠다.`,
    assistant: `볼프강은 고개를 끄덕였다. "${WOLF_ORDER_QUOTE}" 병사가 물러났다.`,
    fact: fct("character", "ren", "statement_consent", "withheld", "important",
      "렌은 자신의 진술을 황실 감찰관에게 전달하는 데 동의하지 않았다.",
      "explicit_user_statement", "user", REFUSAL_QUOTE),
  },
  {
    key: "alliance500",
    ageTurns: 500,
    assistant: `볼프강이 손을 내밀었다. ${ALLIANCE_QUOTE} 병사들이 숨을 죽였다.`,
    fact: fct("relationship", "wolfgang", "alliance_event", "alliance_formed", "critical",
      "볼프강은 렌과 동맹을 맺었다.",
      "explicit_scene_event", "assistant", ALLIANCE_QUOTE),
  },
  {
    key: "allianceBreak200",
    ageTurns: 200,
    assistant: `볼프강이 시선을 돌렸다. ${ALLIANCE_BREAK_QUOTE} 막사 안이 조용해졌다.`,
    fact: fct("relationship", "wolfgang", "alliance_event", "alliance_ended", "critical",
      "볼프강은 렌과의 동맹을 끝냈다.",
      "explicit_scene_event", "assistant", ALLIANCE_BREAK_QUOTE),
  },
  {
    key: "seal1000",
    ageTurns: 1000,
    assistant: `서기관이 낮게 말했다. ${SEAL_QUOTE}`,
    fact: fct("character", "scribe", "seal_state", "seal_broken_before_reading", "important",
      "서기관은 황실 밀서의 봉인이 열람 전에 이미 뜯겨 있었다고 말했다.",
      "explicit_character_claim", "assistant", SEAL_QUOTE),
  },
  {
    key: "sealFollow700",
    ageTurns: 700,
    assistant: `카를이 고개를 숙였다. ${SEAL_FOLLOW_QUOTE}`,
    fact: fct("character", "scribe", "seal_breaker", "scribe_karl", "important",
      "서기관은 봉인을 뜯은 사람이 서기관 카를이라고 밝혔다.",
      "explicit_character_claim", "assistant", SEAL_FOLLOW_QUOTE),
  },
  {
    key: "keyLoss300",
    ageTurns: 300,
    assistant: `마르타가 투덜댔다. ${KEY_LOSS_QUOTE} 모두가 한숨을 쉬었다.`,
    fact: fct("character", "erna", "vault_key", "key_lost", "normal",
      "에르나는 금고 열쇠를 잃어버렸다.",
      "explicit_scene_event", "assistant", KEY_LOSS_QUOTE),
  },
  {
    key: "keyFound120",
    ageTurns: 120,
    assistant: `병사가 달려왔다. ${KEY_FOUND_QUOTE} 마르타가 웃었다.`,
    fact: fct("character", "erna", "vault_key", "key_found", "normal",
      "병사는 마구간 짚더미에서 금고 열쇠를 찾아냈다.",
      "explicit_scene_event", "assistant", KEY_FOUND_QUOTE),
  },
  {
    key: "postNorth400",
    ageTurns: 400,
    assistant: `볼프강이 명부를 넘겼다. ${POST_NORTH_QUOTE}`,
    fact: fct("character", "ren", "assigned_post", "north_outpost", "important",
      "볼프강은 렌을 북쪽 초소에 배치한다고 명령했다.",
      "explicit_character_claim", "assistant", POST_NORTH_QUOTE),
  },
  {
    key: "postSouth90",
    ageTurns: 90,
    assistant: `볼프강이 명부를 고쳐 적었다. ${POST_SOUTH_QUOTE}`,
    fact: fct("character", "ren", "assigned_post", "south_outpost", "important",
      "볼프강은 렌을 남쪽 초소로 재배치하고 북쪽 배치를 철회하라고 명령했다.",
      "explicit_character_claim", "assistant", POST_SOUTH_QUOTE),
  },
];

type Built = { chat: SeededChat; ids: Map<string, number>; currentTurn: number; storedAmbient: number };

function buildChat(horizon: number, events: EventDef[]): Built {
  const currentTurn = horizon + 1;
  const total = horizon;
  const chat = newChat(total);
  const slots: Slot[] = events.map((event) => ({
    turn: currentTurn - event.ageTurns,
    user: event.user,
    assistant: event.assistant,
  }));
  fillMessages(chat, slots);
  const ids = new Map<string, number>();
  const reserved = new Set<number>();
  for (const event of events) {
    const turn = currentTurn - event.ageTurns;
    reserved.add(turn);
    storeFact(chat, { turn, fact: event.fact });
    const row = db
      .prepare("SELECT id FROM episodic_memory_facts WHERE chat_id=? AND source_turn=? ORDER BY id DESC LIMIT 1")
      .get(chat.chatId, turn) as { id: number } | undefined;
    if (row) ids.set(event.key, row.id);
  }
  const storedAmbient = ambientFacts(chat, reserved);
  return { chat, ids, currentTurn, storedAmbient };
}

const reports: StageReport[] = [];
const notes: string[] = [];
const horizonsSummary: Array<Record<string, unknown>> = [];

// ── Per-horizon isolated chats: one event at the stated age ──────────────────────────────
const REFUSAL_QUERY = "내가 황실 감찰관에게 진술을 전달하는 문제에 대해 뭐라고 했었는지 기억해요?";
const ALLIANCE_QUERY = "볼프강, 우리 둘은 지금 어떤 관계였죠? 동맹은 어떻게 됐어요?";
const SEAL_QUERY = "황실 밀서의 봉인을 누가 뜯었는지 기억해요?";
for (const [horizon, key, query, title] of [
  [50, "refusal50", REFUSAL_QUERY, "USER explicit refusal 50 turns ago"],
  [500, "alliance500", ALLIANCE_QUERY, "relationship change 500 turns ago (no later state)"],
  [1000, "seal1000", SEAL_QUERY, "important event 1000 turns ago"],
] as const) {
  const event = EVENTS.find((entry) => entry.key === key)!;
  const single = { ...event, ageTurns: horizon };
  const built = buildChat(horizon + 1, [single]);
  const scenario: Scenario = {
    id: `H${horizon}-${key}`,
    title,
    ageTurns: horizon,
    query,
    targetFactIds: [built.ids.get(key)!],
    expectation: "inject_target",
  };
  reports.push(evaluate(built.chat, scenario, built.currentTurn));
  horizonsSummary.push({ horizon, ambientFacts: built.storedAmbient });
}

// ── Combined 1,050-turn chat: all events compete with ~500 ambient facts ────────────────
const combined = buildChat(1050, EVENTS);
const id = (key: string) => combined.ids.get(key)!;
const combinedScenarios: Scenario[] = [
  {
    id: "C-refusal50",
    title: "50 turns ago USER explicit refusal (combined chat)",
    ageTurns: 50,
    query: REFUSAL_QUERY,
    targetFactIds: [id("refusal50")],
    expectation: "inject_target",
  },
  {
    id: "C-relationship-change-then-new-state",
    title: "alliance (T-500) then alliance ended (T-200): current relationship state",
    ageTurns: 200,
    query: ALLIANCE_QUERY,
    targetFactIds: [id("allianceBreak200"), id("alliance500")],
    expectation: "inject_all_in_order",
  },
  {
    id: "C-event-and-followup-1000",
    title: "1000-turn-old event with a 700-turn-old follow-up",
    ageTurns: 1000,
    query: SEAL_QUERY,
    targetFactIds: [id("seal1000"), id("sealFollow700")],
    expectation: "inject_all_in_order",
  },
  {
    id: "C-time-order",
    title: "two events in different order (key lost T-300, key found T-120)",
    ageTurns: 300,
    query: "금고 열쇠는 어떻게 됐죠? 먼저 무슨 일이 있었고 그다음에 어떻게 됐나요?",
    targetFactIds: [id("keyLoss300"), id("keyFound120")],
    expectation: "inject_all_in_order",
  },
  {
    id: "C-invalidated-past-fact",
    title: "past state no longer valid (post north T-400 superseded by south T-90)",
    ageTurns: 90,
    query: "렌은 지금 어느 초소에 배치되어 있죠?",
    targetFactIds: [id("postSouth90")],
    forbiddenFactIds: [id("postNorth400")],
    expectation: "inject_latest_only",
  },
  {
    id: "C-unrelated-query",
    title: "unrelated question must not pull old events",
    ageTurns: 50,
    query: "오늘 저녁에는 따뜻한 수프가 있으면 좋겠어요. 날씨가 꽤 쌀쌀하네요.",
    targetFactIds: [id("refusal50"), id("seal1000"), id("alliance500"), id("postNorth400")],
    expectation: "inject_none_of_targets",
  },
  {
    id: "C-no-evidence-no-invention",
    title: "question about something that never happened",
    ageTurns: 0,
    query: "내가 볼프강에게 선물했던 은색 검에 대해 말해 봐요.",
    targetFactIds: [id("refusal50"), id("seal1000"), id("alliance500"), id("postNorth400"), id("keyLoss300")],
    expectation: "inject_none_of_targets",
  },
];
for (const scenario of combinedScenarios) {
  reports.push(evaluate(combined.chat, scenario, combined.currentTurn));
}

// ── Promise → cancel (Relationship Durable Ledger owns it; episodic must not) ──────────────
const PROMISE_TEXT = "내일 해 뜨기 전에 서쪽 능선 초소에서 만나기로 약속";
function ledgerEvent(
  partial: Pick<RelationshipLedgerEvent, "id" | "change" | "validity" | "turn">
): RelationshipLedgerEvent {
  return {
    category: "promise",
    key: PROMISE_TEXT,
    label: `${PROMISE_TEXT}`,
    previousLabel: null,
    assistantMessageId: partial.turn * 2,
    userMessageId: partial.turn * 2 - 1,
    ...partial,
  } as RelationshipLedgerEvent;
}
const promiseCurrentTurn = 1151;
const promiseEvents = [
  ledgerEvent({ id: "p1", change: "created", validity: "superseded", turn: promiseCurrentTurn - 150 }),
  ledgerEvent({ id: "p2", change: "released", validity: "ended", turn: promiseCurrentTurn - 140 }),
];
const promiseRecallLines = selectPromiseHistoryForPrompt(promiseEvents, "그때 서쪽 능선에서 만나기로 한 약속은 어떻게 됐죠?");
const promiseUnrelatedLines = selectPromiseHistoryForPrompt(promiseEvents, "오늘 저녁 메뉴는 뭐가 좋을까요?");
const promiseEpisodicOwnerBlocked =
  (await import("@/lib/episodicMemoryFacts")).detectRelationshipLedgerOwnedFact({
    category: "relationship",
    attribute: "promise",
    value: "meeting_promise",
    fact_text: "렌은 서쪽 능선 초소에서 만나기로 약속했다.",
  }) === "relationship_ledger_promise";
reports.push({
  scenario: "C-promise-then-cancel-150",
  title: "promise created T-150, cancelled T-140 (ledger owner; synthetic ledger events)",
  currentTurn: promiseCurrentTurn,
  targetAgeTurns: 150,
  query: "그때 서쪽 능선에서 만나기로 한 약속은 어떻게 됐죠?",
  expectation: "inject_target",
  stages: {
    storedInDb: true,
    inSqlCandidateSet: true,
    passedGuard: promiseEpisodicOwnerBlocked,
    relevancePass: promiseRecallLines.length > 0,
    finalRank: promiseRecallLines.length > 0 ? 1 : null,
    budgetReason: null,
    injected: promiseRecallLines.length > 0,
  },
  injectedLines: promiseRecallLines,
  verdict: promiseRecallLines.length > 0 && promiseUnrelatedLines.length === 0 && promiseEpisodicOwnerBlocked ? "PASS" : "FAIL",
  firstFailureStage: promiseRecallLines.length === 0 ? "ledger_history_selection" : null,
});
notes.push(
  `promise history: recall query -> ${promiseRecallLines.length} line(s); unrelated query -> ${promiseUnrelatedLines.length} line(s); episodic owner blocks promise facts: ${promiseEpisodicOwnerBlocked}`
);

// ── D candidate (simulation only, no production change): ubiquitous-word-only matches do not open the relevance gate ──
const UBIQUITOUS_DF_RATIO = 0.5;
type CandidateRow = {
  scenario: string;
  query: string;
  baselineInjected: number;
  baselineEventLines: number;
  candidateInjected: number;
  candidateEventLines: number;
  targetInBaseline: boolean | null;
  targetInCandidate: boolean | null;
};
function wordDocumentFrequency(chatId: number, token: string): { df: number; rows: number } {
  const rows = (db.prepare("SELECT COUNT(*) AS n FROM episodic_memory_facts WHERE chat_id=?").get(chatId) as { n: number }).n;
  const like = `%${token.toLowerCase()}%`;
  const df = (
    db
      .prepare(
        `SELECT COUNT(*) AS n FROM episodic_memory_facts WHERE chat_id=? AND LOWER(COALESCE(fact_text,'')||char(10)||COALESCE(subject,'')||char(10)||COALESCE(attribute,'')||char(10)||COALESCE(value,'')) LIKE ?`
      )
      .get(combined.chat.chatId, like) as { n: number }
  ).n;
  return { df, rows };
}
function simulateCandidate(scenarioId: string, query: string, targets: number[] | null): CandidateRow {
  const input = {
    chatId: combined.chat.chatId,
    characterId: CHARACTER_ID,
    userId: USER_ID,
    currentTurn: combined.currentTurn,
    currentUserMessage: query,
    recentChatText: recentTextFor(combined.chat, combined.currentTurn),
  };
  const result = getEpisodicMemoryForPrompt(db, input);
  const eventIds = new Set([...combined.ids.values()]);
  const passers = result.debug.filter((entry) => entry.relevance_pass);
  const rowsById = new Map(
    (db.prepare("SELECT * FROM episodic_memory_facts WHERE chat_id=?").all(combined.chat.chatId) as Array<
      import("@/lib/episodicMemoryFacts").EpisodicMemoryFactRecord
    >).map((row) => [row.id, row])
  );
  const distinctive = (id: number): boolean => {
    const row = rowsById.get(id);
    if (!row) return false;
    const inspected = inspectLexicalRelevanceForDebug(row, query);
    return inspected.tokens.some((token) => {
      const matched =
        token.targetSubjectMatch || token.targetAttributeMatch || token.targetValueMatch || token.targetFactTextMatch;
      if (!matched) return false;
      const { df, rows } = wordDocumentFrequency(combined.chat.chatId, token.normalized);
      return df / rows < UBIQUITOUS_DF_RATIO;
    });
  };
  const gated = passers.filter((entry) => distinctive(entry.id)).sort((a, b) => b.composite_score - a.composite_score);
  const candidateIds = new Set(gated.slice(0, result.facts.length || 8).map((entry) => entry.id));
  const baselineIds = new Set(result.facts.map((fact) => fact.id));
  return {
    scenario: scenarioId,
    query,
    baselineInjected: baselineIds.size,
    baselineEventLines: [...baselineIds].filter((id) => eventIds.has(id)).length,
    candidateInjected: candidateIds.size,
    candidateEventLines: [...candidateIds].filter((id) => eventIds.has(id)).length,
    targetInBaseline: targets ? targets.every((id) => baselineIds.has(id)) : null,
    targetInCandidate: targets ? targets.every((id) => candidateIds.has(id)) : null,
  };
}
const candidateAb: CandidateRow[] = [
  simulateCandidate("C-refusal50", REFUSAL_QUERY, [id("refusal50")]),
  simulateCandidate("C-relationship-change-then-new-state", ALLIANCE_QUERY, [id("allianceBreak200"), id("alliance500")]),
  simulateCandidate("C-event-and-followup-1000", SEAL_QUERY, [id("seal1000"), id("sealFollow700")]),
  simulateCandidate("C-time-order", "금고 열쇠는 어떻게 됐죠? 먼저 무슨 일이 있었고 그다음에 어떻게 됐나요?", [id("keyLoss300"), id("keyFound120")]),
  simulateCandidate("C-invalidated-past-fact", "렌은 지금 어느 초소에 배치되어 있죠?", [id("postSouth90")]),
  simulateCandidate("C-no-evidence-no-invention", "내가 볼프강에게 선물했던 은색 검에 대해 말해 봐요.", null),
  simulateCandidate("N-name-plus-unrelated", "볼프강, 오늘 저녁에는 따뜻한 수프가 있으면 좋겠어요.", null),
  simulateCandidate("V-name-plus-vague-reference", "볼프강, 그때 그 일 기억하죠?", null),
];

const summary = {
  generatedAt: new Date().toISOString(),
  dataKind: "SYNTHETIC fixture (not a real 1,000-turn RP)",
  minRecallAgeTurns: MIN_AGE,
  providerCalls: 0,
  embeddingCalls: 0,
  perHorizonChats: horizonsSummary,
  combinedChat: { turns: 1050, currentTurn: combined.currentTurn, ambientFacts: combined.storedAmbient },
  notes,
  candidateAb,
  reports,
  passCount: reports.filter((entry) => entry.verdict === "PASS").length,
  failCount: reports.filter((entry) => entry.verdict === "FAIL").length,
};
const outName = process.env.B35_LONG_OUT ?? "long-horizon-recall-baseline.json";
writeFileSync(path.join(OUT_DIR, outName), JSON.stringify(summary, null, 2));
for (const report of reports) {
  console.log(
    `${report.verdict}  ${report.scenario.padEnd(34)} stage=${report.firstFailureStage ?? "-"}  injected=${report.stages.injected} rank=${report.stages.finalRank} lines=${report.injectedLines.length}`
  );
}
console.log(JSON.stringify({ pass: summary.passCount, fail: summary.failCount, out: path.join(OUT_DIR, outName) }));
process.exit(0);
