/**
 * Bounded live B8-2 extraction check (PAID — at most 12 calls / 100 KRW for the whole ticket).
 * Production call path: runPostTurnRelationshipOnlyInitial → runPostTurnSharedInitial →
 * callBackgroundMemory (model BACKGROUND_OPENROUTER_MODEL) → parsePostTurnSharedInitialResponse.
 * The parsed episodic facts are then saved by reconcileEpisodicMemoryFactsForGeneration (quote
 * verified against the stored message) and read back by getEpisodicMemoryForPrompt at T500/T1000.
 * Only the current turn is live; the T30 record and fillers are seeded fixtures.
 * Usage (isolated DATA_DIR, in-memory chat DB, no production DB):
 *   CHEAPER_INFERENCE_API_KEY=$CHEAPER_INFERENCE_BENCHMARK_API_KEY OPENROUTER_API_KEY= OPENAI_API_KEY= \
 *   DATA_DIR=$(mktemp -d) LIVE_LEDGER=/tmp/b82-live-ledger.json LIVE_ONLY=S1,S3 \
 *   node --conditions=react-server --import tsx live-extraction.mts
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";

import type Database from "better-sqlite3";

import { BACKGROUND_OPENROUTER_MODEL } from "@/lib/ai";
import * as episodicFacts from "@/lib/episodicMemoryFacts";
import { openDb } from "@/lib/memory/memory-rp-benchmark-suite";
import { runPostTurnRelationshipOnlyInitial } from "@/lib/postTurnSharedInitial/run";

console.info = () => {};

const MAX_CALLS = 12;
const MAX_KRW = 100;
const KRW_PER_USD = 1500;
const LUNA_USD_PER_M = { input: 0.07, output: 0.35 };
const LEDGER = process.env.LIVE_LEDGER ?? "/tmp/b82-live-ledger.json";
const LABEL = process.env.LIVE_LABEL ?? "after";
const ONLY = (process.env.LIVE_ONLY ?? "").split(",").filter(Boolean);

const env = {
  NODE_ENV: "development",
  MEMORY_FEATURE_ENABLED: "1",
  EPISODIC_MEMORY_RECALL_ENABLED: "1",
} as NodeJS.ProcessEnv;

type Candidate = { handle: string; factId: number; sourceTurn: number; factText: string };
const listCandidates = (episodicFacts as Record<string, unknown>).listEpisodicCorrectionCandidates as
  | ((db: Database.Database, input: Record<string, unknown>, env: NodeJS.ProcessEnv) => Candidate[])
  | undefined;

type LedgerEntry = { label: string; scenario: string; model: string | null; inputTokens: number; outputTokens: number; krw: number };
const readLedger = (): LedgerEntry[] => (existsSync(LEDGER) ? (JSON.parse(readFileSync(LEDGER, "utf8")) as LedgerEntry[]) : []);

function assertBudget(scenario: string): void {
  const ledger = readLedger();
  const spent = ledger.reduce((sum, e) => sum + e.krw, 0);
  const nextEstimate = Math.max(2, ...ledger.map((e) => e.krw)) * 1.5;
  if (ledger.length >= MAX_CALLS || spent + nextEstimate > MAX_KRW) {
    console.log(`STOP before ${scenario}: calls=${ledger.length}/${MAX_CALLS} spent≈${spent.toFixed(2)}원 next≈${nextEstimate.toFixed(2)}원`);
    process.exit(2);
  }
}

const BITE_QUOTE = "늑대가 에녹의 왼팔을 깊이 물어뜯었다.";
const CAUSE = "예전에 에녹 왼팔은 왜 다쳤었지?";
const HAND = "에녹 오른손은 왜 다쳤었지?";
const FILLER = [
  "에녹은 새벽에 검을 손질하며 말없이 앉아 있었다.",
  "에녹은 여관 마당에서 장작을 패 주었다.",
  "에녹이 지도 위의 남쪽 길을 손가락으로 짚었다.",
  "에녹은 유저에게 따뜻한 차를 건넸다.",
];

type Scenario = {
  id: string;
  title: string;
  seedAttribute: string;
  turn: number;
  user: string;
  assistant: string;
  expectLink: boolean;
  questions: string[];
};

const CORRECTION_USER = "아까 그 부상 장면 정정할게. 늑대에게 물린 게 아니라 문에 팔이 끼인 거야. 같은 사건이야.";
const CORRECTION_ASSISTANT = "에녹은 잠시 생각하다 고개를 끄덕였다. “그래, 문이었지. 내가 잘못 기억했나 보군.”";

const SCENARIOS: Scenario[] = [
  { id: "S1", title: "explicit correction of the T30 event", seedAttribute: "injury", turn: 120, user: CORRECTION_USER, assistant: CORRECTION_ASSISTANT, expectLink: true, questions: [CAUSE] },
  {
    id: "S2",
    title: "implicit correction (no 정정 keyword)",
    seedAttribute: "injury",
    turn: 120,
    user: "늑대한테 물린 거 아니잖아. 그때 창고 문에 왼팔이 끼여서 다친 거였어.",
    assistant: "에녹이 멋쩍게 웃었다. “…그랬던가. 문에 끼였던 거였지.”",
    expectLink: true,
    questions: [CAUSE],
  },
  {
    id: "S3",
    title: "separate same-key injury told by the user",
    seedAttribute: "injury",
    turn: 200,
    user: "(에녹의 오른손에 붕대를 감아 준다) 어제 훈련하다 칼에 오른손을 베였잖아.",
    assistant: "에녹은 붕대 감긴 손을 내려다보았다. “별것 아니다.”",
    expectLink: false,
    questions: [CAUSE, HAND],
  },
  {
    id: "S4",
    title: "recovery of the T30 injury",
    seedAttribute: "injury",
    turn: 80,
    user: "(붕대를 풀어 본다) 왼팔은 이제 괜찮아?",
    assistant: "치료를 마친 에녹의 왼팔은 완전히 회복되었다. 에녹이 팔을 가볍게 돌려 보였다.",
    expectLink: false,
    questions: [CAUSE],
  },
  {
    id: "S5",
    title: "unclear doubt about the past injury",
    seedAttribute: "injury",
    turn: 120,
    user: "그때 왼팔 다친 거, 내가 알던 거랑 좀 다른 것 같기도 하고… 잘 모르겠다.",
    assistant: "에녹은 대답 없이 왼팔을 쓰다듬었다.",
    expectLink: false,
    questions: [CAUSE],
  },
  { id: "S6", title: "D — T30 filed as scene_event, user corrects it", seedAttribute: "scene_event", turn: 120, user: CORRECTION_USER, assistant: CORRECTION_ASSISTANT, expectLink: true, questions: [CAUSE] },
  { id: "S1r", title: "repeat of S1", seedAttribute: "injury", turn: 120, user: CORRECTION_USER, assistant: CORRECTION_ASSISTANT, expectLink: true, questions: [CAUSE] },
  {
    id: "S3r",
    title: "repeat of S3",
    seedAttribute: "injury",
    turn: 200,
    user: "(에녹의 오른손에 붕대를 감아 준다) 어제 훈련하다 칼에 오른손을 베였잖아.",
    assistant: "에녹은 붕대 감긴 손을 내려다보았다. “별것 아니다.”",
    expectLink: false,
    questions: [CAUSE, HAND],
  },
];

function chatDb(): Database.Database {
  const db = openDb();
  db.exec(
    "CREATE TABLE messages (id INTEGER PRIMARY KEY, chat_id INTEGER, role TEXT, content TEXT, generation_status TEXT, model TEXT, user_message_id INTEGER, usage TEXT)"
  );
  return db;
}

function insertTurn(db: Database.Database, turn: number, user: string, assistant: string): void {
  const message = db.prepare(
    "INSERT INTO messages (id, chat_id, role, content, generation_status, model, user_message_id) VALUES (?, 1, ?, ?, 'completed', 'm', ?)"
  );
  message.run(turn * 10 + 1, "user", user, null);
  message.run(turn * 10 + 2, "assistant", assistant, turn * 10 + 1);
}

function save(db: Database.Database, turn: number, user: string, facts: unknown[]): void {
  episodicFacts.reconcileEpisodicMemoryFactsForGeneration(db, {
    chatId: 1,
    sourceTurn: turn,
    sourceUserMessageId: turn * 10 + 1,
    sourceUserText: user,
    evidenceBinding: { userMessageId: turn * 10 + 1, assistantMessageId: turn * 10 + 2 },
    metadata: { extraction: "shared_initial_per_turn", assistant_message_id: turn * 10 + 2, content_route: "safe" },
    facts: facts as episodicFacts.EpisodicExtractedFact[],
    isRegeneration: false,
  });
}

function seedT30(db: Database.Database, attribute: string): void {
  insertTurn(db, 30, "(에녹의 팔을 붙잡는다) 괜찮아?", `${BITE_QUOTE} 에녹은 이를 악물었다.`);
  save(db, 30, "(에녹의 팔을 붙잡는다) 괜찮아?", [
    {
      category: "character",
      subject: "enoch",
      attribute,
      value: "left_arm_bitten",
      importance: "important",
      fact_text: "에녹은 늑대에게 물려 왼팔을 크게 다쳤다.",
      evidence_type: "explicit_scene_event",
      evidence: { source_role: "assistant", source_quote: BITE_QUOTE },
    },
  ]);
}

function fill(db: Database.Database, from: number, to: number): void {
  const insert = db.prepare(
    `INSERT INTO episodic_memory_facts (chat_id, source_turn, category, subject, attribute, value, importance, fact_text, metadata)
     VALUES (1, ?, 'event', 'bg', 'scene_event', ?, 'normal', ?, ?)`
  );
  for (let t = from; t < to; t++) {
    insert.run(t, `f${t}`, FILLER[t % FILLER.length]!, JSON.stringify({ memory_evidence_type: "explicit_scene_event", assistant_message_id: t * 10 + 9 }));
  }
}

type StoredRow = { id: number; source_turn: number; attribute: string; value: string; fact_text: string; role: string | null; authority: string | null; quote: string | null; correction: string | null };

function storedRows(db: Database.Database): StoredRow[] {
  return db
    .prepare(
      `SELECT id, source_turn, attribute, value, fact_text,
              json_extract(metadata, '$.evidence.role') AS role,
              json_extract(metadata, '$.evidence.authority') AS authority,
              json_extract(metadata, '$.evidence.quote') AS quote,
              json_extract(metadata, '$.correction') AS correction
         FROM episodic_memory_facts WHERE subject <> 'bg' ORDER BY source_turn, id`
    )
    .all() as StoredRow[];
}

function rawCorrects(text: string): string[] {
  try {
    const root = JSON.parse(text) as { episodic?: { extracted_facts?: Array<{ corrects?: unknown }> } };
    return (root.episodic?.extracted_facts ?? []).map((f) => (typeof f.corrects === "string" ? JSON.stringify(f.corrects) : "(absent)"));
  } catch {
    return ["(unparseable)"];
  }
}

let contractFailures = 0;
console.log(`label=${LABEL} model=${BACKGROUND_OPENROUTER_MODEL} link contract present: ${listCandidates ? "yes" : "no"}`);

for (const scenario of SCENARIOS.filter((s) => ONLY.length === 0 || ONLY.includes(s.id))) {
  console.log(`\n== ${scenario.id} ${scenario.title} (live turn T${scenario.turn})`);
  const db = chatDb();
  fill(db, 1, 30);
  seedT30(db, scenario.seedAttribute);
  const t30 = (db.prepare("SELECT id FROM episodic_memory_facts WHERE source_turn = 30").get() as { id: number }).id;
  fill(db, 31, scenario.turn);
  insertTurn(db, scenario.turn, scenario.user, scenario.assistant);

  const candidates = listCandidates?.(db, { chatId: 1, currentTurn: scenario.turn, currentUserMessage: scenario.user }, env) ?? [];
  const t30Handle = candidates.find((c) => c.factId === t30)?.handle ?? null;
  console.log(`   user: ${scenario.user}`);
  console.log(`   assistant: ${scenario.assistant}`);
  console.log(`   offered candidates: ${candidates.length ? candidates.map((c) => `${c.handle}=T${c.sourceTurn}${c.factId === t30 ? "(T30 seed)" : ""}`).join(" ") : "(none)"}`);

  assertBudget(scenario.id);
  const result = await runPostTurnRelationshipOnlyInitial({
    charName: "에녹",
    personaName: "유저",
    userMessage: scenario.user,
    assistantProse: scenario.assistant,
    primaryModelId: BACKGROUND_OPENROUTER_MODEL,
    activePromises: [],
    includeSuggestions: false,
    includeRelationship: true,
    includeEpisodic: true,
    episodicCorrectionCandidates: candidates,
  });
  const usage = result.usage;
  const inputTokens = usage?.inputTokens ?? 0;
  const outputTokens = usage?.outputTokens ?? 0;
  const billedUsd = usage?.cheaperInferenceBilledCostUsd ?? usage?.upstreamCostUsd ?? null;
  const usd = billedUsd ?? (inputTokens * LUNA_USD_PER_M.input + outputTokens * LUNA_USD_PER_M.output) / 1e6;
  const krw = usd * KRW_PER_USD;
  const ledger = readLedger();
  ledger.push({ label: LABEL, scenario: scenario.id, model: usage?.responseModelId ?? null, inputTokens, outputTokens, krw });
  writeFileSync(LEDGER, JSON.stringify(ledger, null, 1));
  console.log(
    `   call: transportOk=${result.transportOk} http=${result.httpStatus ?? "-"} responseModel=${usage?.responseModelId ?? "?"} input=${inputTokens} (cacheRead=${usage?.cacheReadTokens ?? 0}) output=${outputTokens} cost=$${usd.toFixed(6)}${billedUsd == null ? " (rate estimate)" : " (billed)"} ≈${krw.toFixed(3)}원`
  );
  if (!result.transportOk) {
    console.log(`   transport failed: ${result.errorCode ?? "unknown"}`);
    continue;
  }

  const episodic = result.parsed?.episodic;
  console.log(`   raw response: ${result.text.replace(/\s+/g, " ").slice(0, 900)}`);
  console.log(`   model corrects (raw): ${rawCorrects(result.text).join(" ") || "(no facts)"}`);
  for (const fact of (episodic?.facts ?? []) as Array<Record<string, unknown>>) {
    const evidence = fact.evidence as { source_role?: string; source_quote?: string } | undefined;
    console.log(
      `   parsed: ${fact.attribute}=${fact.value} ${fact.evidence_type} role=${evidence?.source_role} quote=“${evidence?.source_quote}” correction_target_fact_id=${fact.correction_target_fact_id ?? "-"}`
    );
  }
  save(db, scenario.turn, scenario.user, episodic?.facts ?? []);
  fill(db, scenario.turn + 1, 1000);

  const rows = storedRows(db);
  console.log("   stored rows:");
  for (const row of rows) {
    console.log(`     id=${row.id} T${row.source_turn} ${row.attribute}=${row.value} role=${row.role} authority=${row.authority} quote=“${row.quote}” correction=${row.correction ?? "null"}`);
  }
  const linked = rows.some((r) => r.source_turn === scenario.turn && r.correction && (JSON.parse(r.correction) as { target_fact_id: number }).target_fact_id === t30);
  const expectedOk = !listCandidates || scenario.expectLink === linked;
  if (!expectedOk) contractFailures++;
  console.log(`   link to T30: ${linked ? "linked" : "not linked"} (expected ${scenario.expectLink ? "linked" : "not linked"}${t30Handle ? `, T30 offered as ${t30Handle}` : ", T30 not offered"}) -> ${expectedOk ? "PASS" : "FAIL"}`);

  for (const currentTurn of [500, 1000]) {
    for (const question of scenario.questions) {
      const block = episodicFacts.getEpisodicMemoryForPrompt(db, { chatId: 1, currentTurn, currentUserMessage: question }, env).promptBlock;
      const lines = block.split("\n").filter((l) => l.startsWith("- [T") && !FILLER.some((f) => l.includes(f)));
      const biteShown = block.includes(BITE_QUOTE);
      const consistent = question !== CAUSE || biteShown === !linked;
      if (!consistent) contractFailures++;
      console.log(`   final block @T${currentTurn} q="${question}" T30 bite ${biteShown ? "shown" : "hidden"} -> ${consistent ? "consistent with link" : "INCONSISTENT"}`);
      for (const line of lines) console.log(`     ${line}`);
    }
  }
}

const all = readLedger();
const mine = all.filter((e) => e.label === LABEL);
console.log(
  `\nRESULT label=${LABEL} calls=${mine.length} input=${mine.reduce((s, e) => s + e.inputTokens, 0)} output=${mine.reduce((s, e) => s + e.outputTokens, 0)} cost≈${mine.reduce((s, e) => s + e.krw, 0).toFixed(3)}원 contract_failures=${contractFailures}`
);
console.log(`TICKET TOTAL calls=${all.length}/${MAX_CALLS} cost≈${all.reduce((s, e) => s + e.krw, 0).toFixed(3)}원/${MAX_KRW}원`);
