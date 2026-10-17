/**
 * Provider-free B8-2 boundary probe (isolated in-memory DB, zero provider calls).
 *
 * Builds each scenario through the production save path — the server lists its correction
 * candidates, the simulated model copies a handle, `parseSharedEpisodicSection` parses it and
 * `reconcileEpisodicMemoryFactsForGeneration` saves it — then runs the production
 * `getEpisodicMemoryForPrompt` and prints, per scenario and horizon: which record of the
 * corrected event reached the final block, whether the wrong original or an intermediate
 * correction resurfaced, prepared DB statements per call, runtime, the stored rows with their
 * links and the non-filler lines of the final Episodic block. The narrator section saves the
 * first and a separate second injury as scene or user records and prints both recalls.
 *
 * Run from a checkout root so `@/` resolves to that checkout's src:
 *   node --conditions=react-server --import tsx <this file>
 */
import Database from "better-sqlite3";
import {
  getEpisodicMemoryForPrompt,
  listEpisodicCorrectionCandidates,
  reconcileEpisodicMemoryFactsForGeneration,
} from "@/lib/episodicMemoryFacts";
import type { EpisodicCorrectionCandidate } from "@/lib/memory/memory-episodic-correction";
import { parseSharedEpisodicSection } from "@/lib/memory/memory-episodic-shared";
import { openDb } from "@/lib/memory/memory-rp-benchmark-suite";

console.info = () => {};

const env = {
  NODE_ENV: "development",
  MEMORY_FEATURE_ENABLED: "1",
  EPISODIC_MEMORY_RECALL_ENABLED: "1",
} as NodeJS.ProcessEnv;

const BITE_QUOTE = "늑대가 에녹의 왼팔을 깊이 물어뜯었다.";
const CAUSE = "예전에 에녹 왼팔은 왜 다쳤었지?";
const CAUSES = ["창틀", "덫", "낙석", "울타리", "사다리", "마차 바퀴", "얼음판", "쇠사슬", "부러진 창", "녹슨 못"];
const chainQuote = (cause: string) => `그 부상은 사실 ${cause}에 다친 거야.`;
const FILLER = [
  "에녹은 새벽에 검을 손질하며 말없이 앉아 있었다.",
  "에녹은 여관 마당에서 장작을 패 주었다.",
  "에녹이 지도 위의 남쪽 길을 손가락으로 짚었다.",
  "에녹은 유저에게 따뜻한 차를 건넸다.",
];

type ModelFact = Record<string, unknown>;

function chatDb(): Database.Database {
  const db = openDb();
  db.exec(
    "CREATE TABLE messages (id INTEGER PRIMARY KEY, chat_id INTEGER, role TEXT, content TEXT, generation_status TEXT, model TEXT, user_message_id INTEGER, usage TEXT)"
  );
  return db;
}

function fill(db: Database.Database, from: number, to: number, perTurn = 1): void {
  const stmt = db.prepare(
    `INSERT INTO episodic_memory_facts (chat_id, source_turn, category, subject, attribute, value, importance, fact_text, metadata)
     VALUES (1, ?, 'character', ?, 'scene_event', ?, 'normal', ?, ?)`
  );
  for (let turn = from; turn < to; turn++) {
    for (let k = 0; k < perTurn; k++) {
      const gloss = FILLER[(turn + k) % FILLER.length]!;
      const metadata = JSON.stringify({
        memory_evidence_type: "explicit_scene_event",
        content_route: "safe",
        assistant_message_id: turn * 10 + 9,
        evidence: { role: "assistant", message_id: turn * 10 + 9, quote: gloss, authority: "CURRENT_SCENE", match: "normalized_exact" },
      });
      stmt.run(turn, `bg_${k}`, `f${turn}_${k}`, gloss, metadata);
    }
  }
}

function sharedTurn(
  db: Database.Database,
  turn: number,
  userText: string,
  assistantText: string,
  modelFacts: (candidates: EpisodicCorrectionCandidate[]) => ModelFact[],
  offered?: EpisodicCorrectionCandidate[]
): number[] {
  const userId = turn * 10 + 1;
  const assistantId = turn * 10 + 2;
  const message = db.prepare(
    "INSERT INTO messages (id, chat_id, role, content, generation_status, model, user_message_id) VALUES (?, 1, ?, ?, 'completed', 'm', ?)"
  );
  message.run(userId, "user", userText, null);
  message.run(assistantId, "assistant", assistantText, userId);
  const candidates =
    offered ?? listEpisodicCorrectionCandidates(db, { chatId: 1, currentTurn: turn, currentUserMessage: userText }, env);
  const parsed = parseSharedEpisodicSection({ extracted_facts: modelFacts(candidates) }, candidates);
  reconcileEpisodicMemoryFactsForGeneration(db, {
    chatId: 1,
    sourceTurn: turn,
    sourceUserMessageId: userId,
    sourceUserText: userText,
    evidenceBinding: { userMessageId: userId, assistantMessageId: assistantId },
    metadata: { extraction: "shared_initial_per_turn", assistant_message_id: assistantId, content_route: "safe" },
    facts: parsed.facts,
    isRegeneration: false,
  });
  return (
    db.prepare("SELECT id FROM episodic_memory_facts WHERE chat_id = 1 AND source_turn = ? ORDER BY id").all(turn) as Array<{ id: number }>
  ).map((row) => row.id);
}

function bite(db: Database.Database): number {
  return sharedTurn(db, 30, "(에녹의 팔을 붙잡는다) 괜찮아?", `${BITE_QUOTE} 에녹은 이를 악물었다.`, () => [
    {
      category: "character",
      subject: "enoch",
      attribute: "injury",
      value: "left_arm_bitten",
      importance: "important",
      fact_text: "에녹은 늑대에게 물려 왼팔을 크게 다쳤다.",
      evidence_type: "explicit_scene_event",
      evidence: { source_role: "assistant", source_quote: BITE_QUOTE },
      corrects: "",
    },
  ])[0]!;
}

/** Each correction copies the handle of whichever chain member the server offers. */
function correctionChain(db: Database.Database, t30: number, length: number, firstTurn: number, step: number): number[] {
  const chain = [t30];
  for (let k = 0; k < length; k++) {
    const turn = firstTurn + k * step;
    const quote = chainQuote(CAUSES[k]!);
    const ids = sharedTurn(db, turn, `에녹 왼팔 부상 다시 정정할게. ${quote}`, "에녹은 고개를 끄덕였다.", (offered) => {
      const shown = offered.find((c) => chain.includes(c.factId));
      return [
        {
          category: "character",
          subject: "enoch",
          attribute: "injury_cause",
          value: `cause_${turn}`,
          importance: "important",
          fact_text: `에녹의 왼팔 부상 원인은 ${CAUSES[k]}이다.`,
          evidence_type: "explicit_user_statement",
          evidence: { source_role: "user", source_quote: quote },
          corrects: shown?.handle ?? "",
        },
      ];
    });
    chain.push(ids[0]!);
  }
  return chain;
}

/** A new scene record of marker k, and the user's correction of marker k-1 (offered as C1). */
function otherEventTurn(db: Database.Database, turn: number, k: number, previous: number | null): number {
  const sceneQuote = `${k}번 표지석에 붉은 글씨가 새겨져 있었다.`;
  const correctionQuote = `${k - 1}번 표지석 글씨는 붉은색이 아니라 푸른색이야.`;
  const userText = previous == null ? "(표지석을 살핀다)" : `(표지석을 살핀다) ${correctionQuote}`;
  const offered: EpisodicCorrectionCandidate[] =
    previous == null ? [] : [{ handle: "C1", factId: previous, sourceTurn: turn - 1, factText: "", quote: null }];
  sharedTurn(
    db,
    turn,
    userText,
    sceneQuote,
    () => [
      {
        category: "setting",
        subject: `marker_${k}`,
        attribute: "inscription",
        value: "red",
        importance: "normal",
        fact_text: `${k}번 표지석에는 붉은 글씨가 새겨져 있었다.`,
        evidence_type: "explicit_scene_event",
        evidence: { source_role: "assistant", source_quote: sceneQuote },
        corrects: "",
      },
      ...(previous == null
        ? []
        : [
            {
              category: "setting",
              subject: `marker_${k - 1}`,
              attribute: "inscription_color",
              value: "blue",
              importance: "normal",
              fact_text: `${k - 1}번 표지석의 글씨는 푸른색이다.`,
              evidence_type: "explicit_user_statement",
              evidence: { source_role: "user", source_quote: correctionQuote },
              corrects: "C1",
            },
          ]),
    ],
    offered
  );
  return (db.prepare("SELECT id FROM episodic_memory_facts WHERE source_turn = ? AND subject = ?").get(turn, `marker_${k}`) as { id: number }).id;
}

function measure(db: Database.Database, horizon: number, question: string) {
  let prepared = 0;
  const prepare = db.prepare.bind(db);
  db.prepare = ((sql: string) => {
    prepared += 1;
    return prepare(sql);
  }) as typeof db.prepare;
  const input = { chatId: 1, currentTurn: horizon, currentUserMessage: question };
  const started = performance.now();
  const result = getEpisodicMemoryForPrompt(db, input, env);
  const firstMs = performance.now() - started;
  const statements = prepared;
  const RUNS = 20;
  const loop = performance.now();
  for (let i = 0; i < RUNS; i++) getEpisodicMemoryForPrompt(db, input, env);
  const avgMs = (performance.now() - loop) / RUNS;
  db.prepare = prepare;
  return { result, statements, firstMs: Number(firstMs.toFixed(2)), avgMs: Number(avgMs.toFixed(2)) };
}

function blockLines(promptBlock: string): string[] {
  const lines = promptBlock.split("\n").filter((line) => line.startsWith("- [T"));
  const filler = lines.filter((line) => FILLER.some((text) => line.includes(text))).length;
  return [...lines.filter((line) => !FILLER.some((text) => line.includes(text))), `(+${filler} filler lines)`];
}

function storedRows(db: Database.Database, ids: number[]): string[] {
  return (
    db
      .prepare(
        `SELECT id, source_turn, attribute, json_extract(metadata, '$.memory_evidence_type') AS type,
                json_extract(metadata, '$.evidence.authority') AS authority, json_extract(metadata, '$.correction') AS correction
           FROM episodic_memory_facts WHERE id IN (${ids.map(() => "?").join(", ")}) ORDER BY source_turn, id`
      )
      .all(...ids) as Array<Record<string, unknown>>
  ).map((row) => `id=${row.id} T${row.source_turn} ${row.attribute} ${row.type} ${row.authority} correction=${row.correction ?? "null"}`);
}

function detail(label: string, lines: string[]): void {
  console.log(`  ${label}:`);
  for (const line of lines) console.log(`    ${line}`);
}

function report(scenario: string, horizon: number, chain: number[], quotes: string[], measured: ReturnType<typeof measure>, extra: Record<string, unknown> = {}) {
  const { result } = measured;
  const injectedIndex = chain.map((id, index) => (result.facts.some((fact) => fact.id === id) ? index : -1)).filter((index) => index >= 0);
  const quoted = quotes.map((quote, index) => (result.promptBlock.includes(quote) ? index : -1)).filter((index) => index >= 0);
  const latest = chain.length - 1;
  console.log(
    JSON.stringify({
      scenario,
      horizon,
      rows: extra.rows,
      chainLength: latest,
      injectedChainIndex: injectedIndex,
      quotedChainIndex: quoted,
      ok: injectedIndex.length === 1 && injectedIndex[0] === latest && quoted.length === 1 && quoted[0] === latest,
      statementsPerCall: measured.statements,
      firstMs: measured.firstMs,
      avgMs: measured.avgMs,
      ...extra,
    })
  );
}

const quotesFor = (length: number) => [BITE_QUOTE, ...CAUSES.slice(0, length).map(chainQuote)];
const rowCount = (db: Database.Database) => (db.prepare("SELECT COUNT(*) AS n FROM episodic_memory_facts").get() as { n: number }).n;

for (const length of [1, 3, 4, 10]) {
  for (const horizon of [500, 1000]) {
    const db = chatDb();
    fill(db, 1, 30);
    const t30 = bite(db);
    fill(db, 31, 120);
    const chain = correctionChain(db, t30, length, 120, 20);
    fill(db, 120 + length * 20, horizon);
    const measured = measure(db, horizon, CAUSE);
    report(`chain-${length}`, horizon, chain, quotesFor(length), measured, { rows: rowCount(db) });
    if (horizon === 1000 && length >= 4) {
      detail("stored chain", storedRows(db, chain));
      detail(`final block @T${horizon} q="${CAUSE}"`, blockLines(measured.result.promptBlock));
    }
  }
}

for (const horizon of [500, 1000]) {
  const db = chatDb();
  fill(db, 1, 30);
  const t30 = bite(db);
  fill(db, 31, 120);
  const chain = correctionChain(db, t30, 1, 120, 20);
  fill(db, 121, 130);
  let previous: number | null = null;
  for (let k = 0; k <= 210; k++) previous = otherEventTurn(db, 130 + k, k, previous);
  fill(db, 341, horizon);
  const measured = measure(db, horizon, CAUSE);
  const links = (db.prepare("SELECT COUNT(*) AS n FROM episodic_memory_facts WHERE json_extract(metadata, '$.correction') IS NOT NULL").get() as { n: number }).n;
  report("one-correction-then-210-others", horizon, chain, quotesFor(1), measured, { rows: rowCount(db), storedLinks: links });
  if (horizon === 1000) {
    detail("stored", storedRows(db, chain));
    detail(`final block @T${horizon} q="${CAUSE}"`, blockLines(measured.result.promptBlock));
    const markerQuestion = "5번 표지석 글씨는 무슨 색이었지?";
    const marker = getEpisodicMemoryForPrompt(db, { chatId: 1, currentTurn: horizon, currentUserMessage: markerQuestion }, env);
    console.log(`  marker 5 original resurfaced: ${marker.promptBlock.includes("5번 표지석에 붉은 글씨가 새겨져 있었다.")}`);
    detail(`final block @T${horizon} q="${markerQuestion}"`, blockLines(marker.promptBlock));
  }
}

{
  const horizon = 3000;
  const db = chatDb();
  fill(db, 1, 30, 4);
  const t30 = bite(db);
  fill(db, 31, 120, 4);
  const chain = correctionChain(db, t30, 10, 120, 20);
  fill(db, 320, 400, 4);
  let previous: number | null = null;
  for (let k = 0; k <= 300; k++) previous = otherEventTurn(db, 400 + k, k, previous);
  fill(db, 701, horizon, 4);
  const measured = measure(db, horizon, CAUSE);
  report("large-chat-chain-10-plus-300-others", horizon, chain, quotesFor(10), measured, { rows: rowCount(db) });
  detail(`final block @T${horizon} q="${CAUSE}"`, blockLines(measured.result.promptBlock));
}

const HAND = "에녹 오른손은 왜 다쳤었지?";
const NARRATED = {
  first: {
    scene: { user: "(에녹의 팔을 붙잡는다) 괜찮아?", assistant: `${BITE_QUOTE} 에녹은 이를 악물었다.`, role: "assistant", type: "explicit_scene_event", quote: BITE_QUOTE },
    user: {
      user: "(에녹의 팔에 붕대를 감는다) 지난번에 늑대가 네 왼팔을 깊이 물어뜯었잖아.",
      assistant: "에녹은 말없이 팔을 내밀었다.",
      role: "user",
      type: "explicit_user_statement",
      quote: "지난번에 늑대가 네 왼팔을 깊이 물어뜯었잖아.",
    },
  },
  second: {
    scene: { user: "(검을 건넨다)", assistant: "훈련용 칼날이 에녹의 오른손을 베었다. 피가 배어 나왔다.", role: "assistant", type: "explicit_scene_event", quote: "훈련용 칼날이 에녹의 오른손을 베었다." },
    user: { user: "아 맞다, 어제 훈련하다 칼에 오른손을 베였잖아.", assistant: "에녹은 붕대 감긴 손을 내려다보았다.", role: "user", type: "explicit_user_statement", quote: "어제 훈련하다 칼에 오른손을 베였잖아." },
  },
} as const;
const BITE_GLOSSES = ["에녹은 늑대에게 물려 왼팔을 크게 다쳤다.", "에녹의 왼팔에는 늑대에게 물린 상처가 남아 있다."];

for (const gloss of BITE_GLOSSES) {
  for (const first of ["scene", "user"] as const) {
    for (const second of ["scene", "user"] as const) {
      const db = chatDb();
      fill(db, 1, 30);
      const event = (turn: number, spec: { user: string; assistant: string; role: string; type: string; quote: string }, value: string, factText: string) =>
        sharedTurn(db, turn, spec.user, spec.assistant, () => [
          {
            category: "character",
            subject: "enoch",
            attribute: "injury",
            value,
            importance: "important",
            fact_text: factText,
            evidence_type: spec.type,
            evidence: { source_role: spec.role, source_quote: spec.quote },
            corrects: "",
          },
        ])[0]!;
      const t30 = event(30, NARRATED.first[first], "left_arm_bitten", gloss);
      fill(db, 31, 200);
      const t200 = event(200, NARRATED.second[second], "right_hand_cut", "에녹은 훈련 중 칼날에 오른손을 다쳤다.");
      fill(db, 201, 1000);
      const recalled = [500, 1000].map((horizon) => {
        const cause = getEpisodicMemoryForPrompt(db, { chatId: 1, currentTurn: horizon, currentUserMessage: CAUSE }, env);
        const hand = getEpisodicMemoryForPrompt(db, { chatId: 1, currentTurn: horizon, currentUserMessage: HAND }, env);
        return { horizon, cause, hand };
      });
      const ok = recalled.every(
        ({ cause, hand }) =>
          cause.facts.some((fact) => fact.id === t30) &&
          cause.promptBlock.includes(NARRATED.first[first].quote) &&
          hand.facts.some((fact) => fact.id === t200) &&
          hand.promptBlock.includes(NARRATED.second[second].quote)
      );
      console.log(JSON.stringify({ scenario: `narrator-${first}-then-${second}`, gloss, ok }));
      detail("stored", storedRows(db, [t30, t200]));
      const last = recalled[1]!;
      detail(`final block @T1000 q="${CAUSE}"`, blockLines(last.cause.promptBlock));
      detail(`final block @T1000 q="${HAND}"`, blockLines(last.hand.promptBlock));
    }
  }
}
