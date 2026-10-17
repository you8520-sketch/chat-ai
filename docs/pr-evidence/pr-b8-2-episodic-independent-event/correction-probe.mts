/**
 * Provider-free B8-2 correction probe on an in-memory DB.
 * Every fact goes through the production save path (persistEpisodicMemoryFactsCore with
 * evidenceBinding), so each quote is verified against a stored message before it is saved.
 * Prints the stored rows (source, authority, quote) and the final Episodic block per scenario.
 * Usage: node --conditions=react-server --import tsx correction-probe.mts
 */
import type Database from "better-sqlite3";

import {
  deleteEpisodicMemoryFactsByAssistantMessageIds,
  getEpisodicMemoryForPrompt,
  persistEpisodicMemoryFactsCore,
} from "@/lib/episodicMemoryFacts";
import { openDb } from "@/lib/memory/memory-rp-benchmark-suite";

console.info = () => {};

const env = {
  NODE_ENV: "development",
  MEMORY_FEATURE_ENABLED: "1",
  EPISODIC_MEMORY_RECALL_ENABLED: "1",
} as NodeJS.ProcessEnv;

const BITE_QUOTE = "늑대가 에녹의 왼팔을 깊이 물어뜯었다.";
const RECOVERY_QUOTE = "치료를 마친 에녹의 왼팔은 완전히 회복되었다.";
const ANKLE_QUOTE = "에녹은 돌계단에서 미끄러져 오른쪽 발목을 접질렸다.";
const CORRECTION_MESSAGE = "아까 그 부상 장면 정정할게. 늑대에게 물린 게 아니라 문에 팔이 끼인 거야. 같은 사건이야.";
const CORRECTION_QUOTE = "늑대에게 물린 게 아니라 문에 팔이 끼인 거야.";
const CAUSE = "예전에 에녹 왼팔은 왜 다쳤었지?";
const FILLER = [
  "에녹은 새벽에 검을 손질하며 말없이 앉아 있었다.",
  "에녹은 여관 마당에서 장작을 패 주었다.",
  "에녹이 지도 위의 남쪽 길을 손가락으로 짚었다.",
  "에녹은 유저에게 따뜻한 차를 건넸다.",
];

type Fact = Parameters<typeof persistEpisodicMemoryFactsCore>[1]["facts"][number];

function chatDb(): Database.Database {
  const db = openDb();
  db.exec(
    "CREATE TABLE messages (id INTEGER PRIMARY KEY, chat_id INTEGER, role TEXT, content TEXT, generation_status TEXT, model TEXT, user_message_id INTEGER, usage TEXT)"
  );
  return db;
}

function persistTurn(db: Database.Database, turn: number, userText: string, assistantText: string, facts: Fact[]): void {
  const userId = turn * 10 + 1;
  const assistantId = turn * 10 + 2;
  const message = db.prepare(
    "INSERT INTO messages (id, chat_id, role, content, generation_status, model, user_message_id) VALUES (?, 1, ?, ?, 'completed', 'm', ?)"
  );
  message.run(userId, "user", userText, null);
  message.run(assistantId, "assistant", assistantText, userId);
  persistEpisodicMemoryFactsCore(db, {
    chatId: 1,
    sourceTurn: turn,
    sourceUserMessageId: userId,
    sourceUserText: userText,
    evidenceBinding: { userMessageId: userId, assistantMessageId: assistantId },
    metadata: { extraction: "shared_initial_per_turn", assistant_message_id: assistantId, content_route: "safe" },
    facts,
  });
}

function scene(db: Database.Database, turn: number, quote: string, gloss: string, value: string, importance = "important"): void {
  persistTurn(db, turn, "(조심스럽게 다가간다)", `${quote} 바람이 잦아들었다.`, [
    {
      category: "character",
      subject: "enoch",
      attribute: "injury",
      value,
      importance,
      fact_text: gloss,
      evidence_type: "explicit_scene_event",
      evidence: { source_role: "assistant", source_quote: quote },
    } as Fact,
  ]);
}

function correction(db: Database.Database, turn: number): void {
  persistTurn(db, turn, CORRECTION_MESSAGE, "에녹은 잠시 생각하다 고개를 끄덕였다.", [
    {
      category: "character",
      subject: "enoch",
      attribute: "injury",
      value: "left_arm_caught_in_door",
      importance: "important",
      fact_text: "유저는 에녹의 왼팔 부상이 늑대에게 물린 것이 아니라 문에 팔이 끼인 것이라고 정정했다.",
      evidence_type: "explicit_user_statement",
      evidence: { source_role: "user", source_quote: CORRECTION_QUOTE },
    } as Fact,
  ]);
}

function fill(db: Database.Database, from: number, to: number): void {
  for (let turn = from; turn < to; turn++) {
    const text = FILLER[turn % FILLER.length]!;
    persistTurn(db, turn, "(옆에 앉는다)", `${text} 조용한 하루였다.`, [
      {
        category: "event",
        subject: "bg",
        attribute: "scene_event",
        value: `f${turn}`,
        importance: "normal",
        fact_text: text,
        evidence_type: "explicit_scene_event",
        evidence: { source_role: "assistant", source_quote: text },
      } as Fact,
    ]);
  }
}

function printStoredInjuryRows(db: Database.Database): void {
  const rows = db
    .prepare(
      `SELECT id, source_turn, attribute, value,
              json_extract(metadata, '$.memory_evidence_type') AS evidence_type,
              json_extract(metadata, '$.evidence.role') AS role,
              json_extract(metadata, '$.evidence.authority') AS authority,
              json_extract(metadata, '$.evidence.message_id') AS message_id,
              json_extract(metadata, '$.evidence.quote') AS quote
         FROM episodic_memory_facts WHERE subject = 'enoch' ORDER BY source_turn, id`
    )
    .all() as Array<Record<string, unknown>>;
  console.log("stored enoch rows:");
  for (const row of rows) {
    console.log(
      `  id=${row.id} T${row.source_turn} ${row.attribute}=${row.value} ${row.evidence_type} role=${row.role} authority=${row.authority} message_id=${row.message_id} quote=“${row.quote}”`
    );
  }
}

function report(db: Database.Database, label: string, turn: number, question: string, expectWrongCause: boolean): boolean {
  const result = getEpisodicMemoryForPrompt(db, { chatId: 1, currentTurn: turn, currentUserMessage: question }, env);
  const lines = result.promptBlock.split("\n").filter((line) => line.startsWith("- [T"));
  const wrongCause = result.promptBlock.includes(BITE_QUOTE);
  const ok = wrongCause === expectWrongCause;
  console.log(`-- ${label} @currentTurn=${turn} question="${question}"`);
  console.log(`   wolf-bite quote injected=${wrongCause} expected=${expectWrongCause} -> ${ok ? "PASS" : "FAIL"}`);
  for (const line of lines.filter((l) => !FILLER.some((f) => l.includes(f)))) console.log(`   ${line}`);
  console.log(`   (+${lines.filter((l) => FILLER.some((f) => l.includes(f))).length} filler lines)`);
  return ok;
}

const BITE_GLOSS_EVENT = "에녹은 늑대에게 물려 왼팔을 크게 다쳤다.";
const BITE_GLOSS_STATE = "왼팔에는 늑대에게 물린 상처가 남아 있다.";
let failures = 0;

console.log("== S1 mixed-source correction: T30 verified scene record, T120 explicit user correction of the same event");
{
  const db = chatDb();
  fill(db, 1, 30);
  scene(db, 30, BITE_QUOTE, BITE_GLOSS_EVENT, "left_arm_bitten");
  fill(db, 31, 120);
  correction(db, 120);
  fill(db, 121, 1000);
  printStoredInjuryRows(db);
  if (!report(db, "S1 after correction", 500, CAUSE, false)) failures++;
  if (!report(db, "S1 after correction", 1000, CAUSE, false)) failures++;
  deleteEpisodicMemoryFactsByAssistantMessageIds(db, 1, [1202]);
  console.log("   (correction turn deleted: assistant message 1202)");
  if (!report(db, "S1 correction deleted", 500, CAUSE, true)) failures++;
}

console.log("\n== S2 same-key recovery between the record and the correction");
{
  const db = chatDb();
  fill(db, 1, 30);
  scene(db, 30, BITE_QUOTE, BITE_GLOSS_EVENT, "left_arm_bitten");
  fill(db, 31, 80);
  scene(db, 80, RECOVERY_QUOTE, "에녹의 왼팔 부상은 치료 후 회복했다.", "left_arm_recovered");
  fill(db, 81, 120);
  correction(db, 120);
  fill(db, 121, 500);
  printStoredInjuryRows(db);
  if (!report(db, "S2", 500, CAUSE, false)) failures++;
}

console.log("\n== S3 control: a later separate occurrence (T312 ankle) does not correct T30");
{
  const db = chatDb();
  fill(db, 1, 30);
  scene(db, 30, BITE_QUOTE, BITE_GLOSS_EVENT, "left_arm_bitten");
  fill(db, 31, 312);
  scene(db, 312, ANKLE_QUOTE, "에녹은 돌계단에서 미끄러져 오른쪽 발목을 다쳤다.", "right_ankle_sprained", "normal");
  fill(db, 313, 500);
  printStoredInjuryRows(db);
  if (!report(db, "S3", 500, CAUSE, true)) failures++;
}

for (const [name, gloss] of [
  ["event gloss", BITE_GLOSS_EVENT],
  ["state gloss", BITE_GLOSS_STATE],
] as const) {
  console.log(`\n== S4 #1651 preservation (${name}: "${gloss}") with a later same-key recovery, no correction`);
  const db = chatDb();
  fill(db, 1, 30);
  scene(db, 30, BITE_QUOTE, gloss, "left_arm_bitten");
  fill(db, 31, 80);
  scene(db, 80, RECOVERY_QUOTE, "에녹의 왼팔 부상은 치료 후 회복했다.", "left_arm_recovered");
  fill(db, 81, 500);
  printStoredInjuryRows(db);
  if (!report(db, `S4 ${name}`, 500, CAUSE, true)) failures++;
}

console.log(`\nRESULT failures=${failures}`);
