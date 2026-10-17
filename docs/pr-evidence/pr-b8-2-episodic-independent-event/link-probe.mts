/**
 * Provider-free B8-2 correction-link probe on an in-memory DB (scenarios A–G of the ticket).
 * Every turn runs the production chain available at the checked-out revision:
 *   server candidate list (when the revision has one) → simulated model output with `corrects`
 *   → parseSharedEpisodicSection → persistEpisodicMemoryFactsCore (quote verified against the
 *   stored message) → getEpisodicMemoryForPrompt.
 * Revisions without the link contract ignore `corrects`, so the same script measures them too.
 * Usage: node --conditions=react-server --import tsx link-probe.mts
 */
import type Database from "better-sqlite3";

import * as episodicFacts from "@/lib/episodicMemoryFacts";
import { parseSharedEpisodicSection } from "@/lib/memory/memory-episodic-shared";
import { openDb } from "@/lib/memory/memory-rp-benchmark-suite";

console.info = () => {};

const env = {
  NODE_ENV: "development",
  MEMORY_FEATURE_ENABLED: "1",
  EPISODIC_MEMORY_RECALL_ENABLED: "1",
} as NodeJS.ProcessEnv;

type Candidate = { handle: string; factId: number; sourceTurn: number };
const listCandidates = (episodicFacts as Record<string, unknown>).listEpisodicCorrectionCandidates as
  | ((db: Database.Database, input: Record<string, unknown>, env: NodeJS.ProcessEnv) => Candidate[])
  | undefined;
console.log(`link contract present at this revision: ${listCandidates ? "yes" : "no"}`);

const BITE_QUOTE = "늑대가 에녹의 왼팔을 깊이 물어뜯었다.";
const BITE_GLOSSES = { event: "에녹은 늑대에게 물려 왼팔을 크게 다쳤다.", state: "에녹의 왼팔에는 늑대에게 물린 상처가 남아 있다." };
const RECOVERY_QUOTE = "치료를 마친 에녹의 왼팔은 완전히 회복되었다.";
const ANKLE_QUOTE = "에녹은 계단에서 미끄러지며 오른쪽 발목을 접질렀다.";
const CORRECTION_MESSAGE = "아까 그 부상 장면 정정할게. 늑대에게 물린 게 아니라 문에 팔이 끼인 거야. 같은 사건이야.";
const CORRECTION_QUOTE = "늑대에게 물린 게 아니라 문에 팔이 끼인 거야.";
const SEPARATE_MESSAGE = "(에녹의 오른손에 붕대를 감아 준다) 어제 훈련하다 칼에 오른손을 베였잖아.";
const SEPARATE_QUOTE = "어제 훈련하다 칼에 오른손을 베였잖아.";
const CAUSE = "예전에 에녹 왼팔은 왜 다쳤었지?";
const HAND = "에녹 오른손은 왜 다쳤었지?";
const ANKLE = "예전에 에녹 발목은 왜 다쳤었지?";
const FILLER = [
  "에녹은 새벽에 검을 손질하며 말없이 앉아 있었다.",
  "에녹은 여관 마당에서 장작을 패 주었다.",
  "에녹이 지도 위의 남쪽 길을 손가락으로 짚었다.",
  "에녹은 유저에게 따뜻한 차를 건넸다.",
];

type ModelFact = Record<string, unknown>;
let failures = 0;

function chatDb(): Database.Database {
  const db = openDb();
  db.exec(
    "CREATE TABLE messages (id INTEGER PRIMARY KEY, chat_id INTEGER, role TEXT, content TEXT, generation_status TEXT, model TEXT, user_message_id INTEGER, usage TEXT)"
  );
  return db;
}

function turn(
  db: Database.Database,
  sourceTurn: number,
  userText: string,
  assistantText: string,
  facts: (candidates: Candidate[]) => ModelFact[]
): number | undefined {
  const userId = sourceTurn * 10 + 1;
  const assistantId = sourceTurn * 10 + 2;
  const message = db.prepare(
    "INSERT INTO messages (id, chat_id, role, content, generation_status, model, user_message_id) VALUES (?, 1, ?, ?, 'completed', 'm', ?)"
  );
  message.run(userId, "user", userText, null);
  message.run(assistantId, "assistant", assistantText, userId);
  const candidates = listCandidates?.(db, { chatId: 1, currentTurn: sourceTurn, currentUserMessage: userText }, env) ?? [];
  const parsed = (parseSharedEpisodicSection as (raw: unknown, c?: unknown) => { facts: unknown[] })(
    { extracted_facts: facts(candidates) },
    candidates
  );
  episodicFacts.persistEpisodicMemoryFactsCore(db, {
    chatId: 1,
    sourceTurn,
    sourceUserMessageId: userId,
    sourceUserText: userText,
    evidenceBinding: { userMessageId: userId, assistantMessageId: assistantId },
    metadata: { extraction: "shared_initial_per_turn", assistant_message_id: assistantId, content_route: "safe" },
    facts: parsed.facts as episodicFacts.EpisodicExtractedFact[],
  });
  const row = db.prepare("SELECT id FROM episodic_memory_facts WHERE source_turn = ? AND subject = 'enoch' ORDER BY id DESC").get(sourceTurn) as
    | { id: number }
    | undefined;
  return row?.id;
}

const fact = (over: ModelFact): ModelFact => ({
  category: "character",
  subject: "enoch",
  attribute: "injury",
  importance: "important",
  evidence_type: "explicit_scene_event",
  corrects: "",
  ...over,
});

function bite(db: Database.Database, gloss: string, attribute = "injury"): number {
  return turn(db, 30, "(에녹의 팔을 붙잡는다) 괜찮아?", `${BITE_QUOTE} 에녹은 이를 악물었다.`, () => [
    fact({ attribute, value: "left_arm_bitten", fact_text: gloss, evidence: { source_role: "assistant", source_quote: BITE_QUOTE } }),
  ])!;
}

function correction(db: Database.Database, target: number | null, sourceTurn = 120, attribute = "injury"): number {
  return turn(db, sourceTurn, CORRECTION_MESSAGE, "에녹은 잠시 생각하다 고개를 끄덕였다.", (offered) => [
    fact({
      attribute,
      value: "left_arm_caught_in_door",
      fact_text: "에녹의 왼팔 부상은 늑대가 아니라 문에 팔이 끼여서 생긴 것이다.",
      evidence_type: "explicit_user_statement",
      evidence: { source_role: "user", source_quote: CORRECTION_QUOTE },
      corrects: target == null ? "" : (offered.find((c) => c.factId === target)?.handle ?? ""),
    }),
  ])!;
}

function separateUserInjury(db: Database.Database, sourceTurn: number): number {
  return turn(db, sourceTurn, SEPARATE_MESSAGE, "에녹은 붕대 감긴 손을 내려다보았다.", () => [
    fact({
      value: "right_hand_cut",
      fact_text: "에녹은 훈련 중 칼날에 오른손을 다쳤다.",
      evidence_type: "explicit_user_statement",
      evidence: { source_role: "user", source_quote: SEPARATE_QUOTE },
    }),
  ])!;
}

function scene(db: Database.Database, sourceTurn: number, quote: string, gloss: string, value: string): number {
  return turn(db, sourceTurn, "(조심스럽게 다가간다)", `${quote} 바람이 잦아들었다.`, () => [
    fact({ value, importance: "normal", fact_text: gloss, evidence: { source_role: "assistant", source_quote: quote } }),
  ])!;
}

function fill(db: Database.Database, from: number, to: number): void {
  const insert = db.prepare(
    `INSERT INTO episodic_memory_facts (chat_id, source_turn, category, subject, attribute, value, importance, fact_text, metadata)
     VALUES (1, ?, 'event', 'bg', 'scene_event', ?, 'normal', ?, ?)`
  );
  for (let t = from; t < to; t++) {
    const text = FILLER[t % FILLER.length]!;
    insert.run(t, `f${t}`, text, JSON.stringify({ memory_evidence_type: "explicit_scene_event", assistant_message_id: t * 10 + 9 }));
  }
}

function printStoredRows(db: Database.Database): void {
  const rows = db
    .prepare(
      `SELECT id, source_turn, attribute, value,
              json_extract(metadata, '$.memory_evidence_type') AS evidence_type,
              json_extract(metadata, '$.evidence.role') AS role,
              json_extract(metadata, '$.evidence.authority') AS authority,
              json_extract(metadata, '$.evidence.quote') AS quote,
              json_extract(metadata, '$.correction') AS correction
         FROM episodic_memory_facts WHERE subject = 'enoch' ORDER BY source_turn, id`
    )
    .all() as Array<Record<string, unknown>>;
  console.log("   stored enoch rows:");
  for (const row of rows) {
    console.log(
      `     id=${row.id} T${row.source_turn} ${row.attribute}=${row.value} ${row.evidence_type} role=${row.role} authority=${row.authority} quote=“${row.quote}” correction=${row.correction ?? "null"}`
    );
  }
}

function check(db: Database.Database, label: string, currentTurn: number, question: string, include: string[], exclude: string[]): void {
  const result = episodicFacts.getEpisodicMemoryForPrompt(db, { chatId: 1, currentTurn, currentUserMessage: question }, env);
  const lines = result.promptBlock.split("\n").filter((line) => line.startsWith("- [T"));
  const missing = include.filter((q) => !result.promptBlock.includes(q));
  const leaked = exclude.filter((q) => result.promptBlock.includes(q));
  const ok = missing.length === 0 && leaked.length === 0;
  if (!ok) failures++;
  console.log(`-- ${label} @T${currentTurn} q="${question}" -> ${ok ? "PASS" : "FAIL"}`);
  if (missing.length) console.log(`   missing: ${missing.map((q) => `“${q}”`).join(" ")}`);
  if (leaked.length) console.log(`   must not appear: ${leaked.map((q) => `“${q}”`).join(" ")}`);
  for (const line of lines.filter((l) => !FILLER.some((f) => l.includes(f)))) console.log(`   ${line}`);
  console.log(`   (+${lines.filter((l) => FILLER.some((f) => l.includes(f))).length} filler lines)`);
}

for (const [glossName, gloss] of Object.entries(BITE_GLOSSES)) {
  console.log(`\n== A (${glossName} gloss) T30 AI scene injury, T120 user corrects the same event (corrects → T30)`);
  {
    const db = chatDb();
    fill(db, 1, 30);
    const t30 = bite(db, gloss);
    fill(db, 31, 120);
    correction(db, t30);
    fill(db, 121, 1000);
    printStoredRows(db);
    for (const h of [500, 1000]) check(db, `A ${glossName}`, h, CAUSE, [CORRECTION_QUOTE], [BITE_QUOTE]);
  }

  console.log(`\n== B (${glossName} gloss) T200 user tells a separate same-key injury (corrects "")`);
  {
    const db = chatDb();
    fill(db, 1, 30);
    bite(db, gloss);
    fill(db, 31, 200);
    separateUserInjury(db, 200);
    fill(db, 201, 1000);
    printStoredRows(db);
    for (const h of [500, 1000]) {
      check(db, `B ${glossName} old cause`, h, CAUSE, [BITE_QUOTE], []);
      check(db, `B ${glossName} new injury`, h, HAND, [SEPARATE_QUOTE], []);
    }
  }

  for (const separate of ["AI scene", "user statement"] as const) {
    console.log(`\n== C (${glossName} gloss) T30 corrected at T120, then a separate T312 injury told by ${separate}`);
    const db = chatDb();
    fill(db, 1, 30);
    const t30 = bite(db, gloss);
    fill(db, 31, 120);
    correction(db, t30);
    fill(db, 121, 312);
    if (separate === "AI scene") scene(db, 312, ANKLE_QUOTE, "에녹은 계단에서 미끄러져 오른쪽 발목을 접질렀다.", "sprained_right_ankle");
    else separateUserInjury(db, 312);
    fill(db, 313, 1000);
    printStoredRows(db);
    for (const h of [500, 1000]) {
      check(db, `C ${glossName}/${separate} corrected cause`, h, CAUSE, [CORRECTION_QUOTE], [BITE_QUOTE]);
      check(db, `C ${glossName}/${separate} T312`, h, separate === "AI scene" ? ANKLE : HAND, [separate === "AI scene" ? ANKLE_QUOTE : SEPARATE_QUOTE], [BITE_QUOTE]);
    }
  }
}

for (const attribute of ["scene_event", "action"]) {
  console.log(`\n== D T30 filed as ${attribute}, correction filed as injury_cause (corrects → T30)`);
  const db = chatDb();
  fill(db, 1, 30);
  const t30 = bite(db, BITE_GLOSSES.event, attribute);
  fill(db, 31, 120);
  correction(db, t30, 120, "injury_cause");
  fill(db, 121, 1000);
  printStoredRows(db);
  for (const h of [500, 1000]) check(db, `D ${attribute}`, h, CAUSE, [CORRECTION_QUOTE], [BITE_QUOTE]);
}

console.log("\n== E T30 real injury, T80 recovery (corrects \"\")");
{
  const db = chatDb();
  fill(db, 1, 30);
  bite(db, BITE_GLOSSES.event);
  fill(db, 31, 80);
  scene(db, 80, RECOVERY_QUOTE, "에녹의 왼팔 부상은 치료 후 회복했다.", "left_arm_recovered");
  fill(db, 81, 1000);
  printStoredRows(db);
  for (const h of [500, 1000]) check(db, "E", h, CAUSE, [BITE_QUOTE, RECOVERY_QUOTE], []);
}

console.log("\n== unclear target: the same correction words but corrects \"\" (nothing invalidated)");
{
  const db = chatDb();
  fill(db, 1, 30);
  bite(db, BITE_GLOSSES.event);
  fill(db, 31, 120);
  correction(db, null);
  fill(db, 121, 1000);
  printStoredRows(db);
  check(db, "unclear", 500, CAUSE, [BITE_QUOTE], []);
}

console.log("\n== F the correction turn deleted / its user source edited → T30 restored; T30 deleted → correction stands alone");
{
  const db = chatDb();
  fill(db, 1, 30);
  const t30 = bite(db, BITE_GLOSSES.event);
  fill(db, 31, 120);
  correction(db, t30);
  fill(db, 121, 1000);
  episodicFacts.deleteEpisodicMemoryFactsByAssistantMessageIds(db, 1, [120 * 10 + 2]);
  check(db, "F correction deleted", 500, CAUSE, [BITE_QUOTE], [CORRECTION_QUOTE]);
}
{
  const db = chatDb();
  fill(db, 1, 30);
  const t30 = bite(db, BITE_GLOSSES.event);
  fill(db, 31, 120);
  correction(db, t30);
  fill(db, 121, 1000);
  episodicFacts.deleteSharedEpisodicFactsForEditedUserSource(db, { chatId: 1, sourceUserMessageId: 120 * 10 + 1 });
  check(db, "F correction user source edited", 500, CAUSE, [BITE_QUOTE], [CORRECTION_QUOTE]);
}
{
  const db = chatDb();
  fill(db, 1, 30);
  const t30 = bite(db, BITE_GLOSSES.event);
  fill(db, 31, 120);
  correction(db, t30);
  fill(db, 121, 1000);
  episodicFacts.deleteEpisodicMemoryFactsByAssistantMessageIds(db, 1, [30 * 10 + 2]);
  check(db, "F T30 deleted", 500, CAUSE, [CORRECTION_QUOTE], [BITE_QUOTE]);
}

console.log(`\nRESULT failures=${failures}`);
