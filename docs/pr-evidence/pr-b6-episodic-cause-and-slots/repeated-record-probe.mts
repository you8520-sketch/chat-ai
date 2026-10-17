/**
 * Provider-free B6-2 probe: a 1000-turn chat with important one-off events and
 * repeated records of three kinds. Prints, per question, which rows reached the
 * final episodic block and why every other tagged row did not.
 *
 *   A  same canonical source stored twice (same message_id + quote, different value)
 *   B  identical gloss at different turns, no source (legacy) - independence unknown
 *   C  identical quote at different turns, different source messages - real repeats
 *
 *   node --conditions=react-server --import tsx docs/pr-evidence/pr-b6-episodic-cause-and-slots/repeated-record-probe.mts [--json]
 */
import { fetchEpisodicMemoryCandidatesForDebug, getEpisodicMemoryForPrompt } from "@/lib/episodicMemoryFacts";
import { openDb } from "@/lib/memory/memory-rp-benchmark-suite";
import { estimateTokens } from "@/lib/tokenEstimate";

const env = { MEMORY_FEATURE_ENABLED: "1", EPISODIC_MEMORY_RECALL_ENABLED: "1" } as unknown as NodeJS.ProcessEnv;
console.info = () => {};
const origLog = console.log;
console.log = (...a: unknown[]) => { if (typeof a[0] === "string" && a[0].startsWith("[EpisodicMemory]")) return; origLog(...a); };

const HORIZON = Number(process.env.B6_HORIZON ?? 1000);
const FILLER = [
  "루카는 시장에서 말린 생선을 흥정해 샀다.",
  "에녹은 새벽에 검을 손질하며 말없이 앉아 있었다.",
  "벨라가 우리를 위해 따뜻한 수프를 끓였다.",
  "하린은 낡은 지도를 펼쳐 남쪽 숲길을 표시했다.",
];

type Tag = { tag: string; id: number; turn: number; kind: string };
const tags: Tag[] = [];

function insert(db: ReturnType<typeof openDb>, o: { turn: number; subject: string; attribute: string; value: string; importance: string; gloss: string; quote?: string; messageId?: number; tag?: string; kind?: string; authority?: string }) {
  const metadata = {
    memory_evidence_type: "explicit_scene_event",
    content_route: "safe",
    ...(o.quote ? { evidence: { role: "assistant", message_id: o.messageId ?? o.turn * 10 + 2, quote: o.quote, authority: o.authority ?? "CURRENT_SCENE", match: "normalized_exact" } } : {}),
  };
  const id = Number(db.prepare(
    `INSERT INTO episodic_memory_facts (chat_id, source_turn, category, subject, attribute, value, importance, fact_text, metadata)
     VALUES (1, ?, 'character', ?, ?, ?, ?, ?, ?)`
  ).run(o.turn, o.subject, o.attribute, o.value, o.importance, o.gloss, JSON.stringify(metadata)).lastInsertRowid);
  if (o.tag) tags.push({ tag: o.tag, id, turn: o.turn, kind: o.kind ?? "" });
  return id;
}

function build() {
  const db = openDb();
  tags.length = 0;
  const lock = "에녹이 문을 잠갔다.";
  for (let turn = 1; turn < HORIZON; turn++) {
    insert(db, { turn, subject: "bg", attribute: "scene_event", value: `f${turn}`, importance: turn % 9 === 0 ? "important" : "normal", gloss: FILLER[turn % FILLER.length]! });
    if (turn === 25) insert(db, { turn, subject: "bella", attribute: "action", value: "betrayed_to_guard", importance: "critical", gloss: "벨라가 유저의 은신처를 경비대에 알려 유저를 넘겼다.", quote: "벨라가 은신처를 경비대에 알렸다.", tag: "I1_betrayal", kind: "important" });
    if (turn === 300) insert(db, { turn, subject: "luka", attribute: "scene_event", value: "sealed_letter_found", importance: "normal", gloss: "루카가 등대 꼭대기에서 붉은 봉인이 찍힌 편지를 찾아냈다.", quote: "루카가 등대 꼭대기에서 붉은 봉인이 찍힌 편지를 찾아냈다.", tag: "I2_letter", kind: "important" });
    for (const [i, t] of [100, 400, 700, 950].entries()) {
      if (turn === t) insert(db, { turn, subject: "enoch", attribute: "action", value: `locked_door_${t}`, importance: "important", gloss: "에녹은 유저가 떠나려 하자 문을 잠갔다.", quote: lock, tag: `C_lock_${i + 1}`, kind: "C real repeat (different source message)" });
    }
    if (turn === 410) {
      insert(db, { turn, subject: "enoch", attribute: "action", value: "locked_door_410", importance: "important", gloss: "에녹은 유저가 떠나려 하자 문을 잠갔다.", quote: lock, messageId: 4102, tag: "A_lock_410_row1", kind: "A same source" });
      insert(db, { turn, subject: "enoch", attribute: "response", value: "kept_user_inside", importance: "important", gloss: "에녹은 문을 잠가 유저를 붙잡았다.", quote: lock, messageId: 4102, tag: "A_lock_410_row2", kind: "A same source" });
    }
    for (const [i, t] of [200, 500].entries()) {
      if (turn === t) insert(db, { turn, subject: "enoch", attribute: "action", value: `locked_door_legacy_${t}`, importance: "important", gloss: "에녹은 유저가 떠나려 하자 문을 잠갔다.", tag: `B_lock_legacy_${i + 1}`, kind: "B identical gloss, no source" });
    }
  }
  return db;
}

const QUESTIONS: Array<[string, string]> = [
  ["count-locks", "에녹이 문을 잠갔던 적이 몇 번이었지?"],
  ["when-locked", "에녹이 문을 잠갔던 때가 언제들이었는지 기억나?"],
  ["letter", "그때 등대에서 루카가 찾았던 붉은 봉인 편지 기억나?"],
  ["betrayal", "벨라가 우리를 경비대에 넘겼던 거 말이야, 왜 그랬을까?"],
  ["unrelated", "오늘 날씨 좋다."],
];

const report: unknown[] = [];
for (const [qid, query] of QUESTIONS) {
  const db = build();
  const input = { chatId: 1, currentTurn: HORIZON, currentUserMessage: query };
  const t0 = performance.now();
  const cands = fetchEpisodicMemoryCandidatesForDebug(db, input, env);
  const final = getEpisodicMemoryForPrompt(db, input, env);
  const ms = Number((performance.now() - t0).toFixed(1));
  const selected = final.facts.map((f) => `T${f.source_turn}#${f.id}`);
  const perTag = tags.map((t) => {
    const d = final.debug.find((x) => x.id === t.id);
    const lanes = cands.laneById.get(t.id) ?? [];
    let stage: string;
    if (final.facts.some((f) => f.id === t.id)) stage = `INJECTED#${d?.final_rank}`;
    else if (!lanes.length) stage = "CANDIDATE_MISS";
    else if (!d) stage = "RECONCILED_OUT";
    else if (d.duplicate_reason) stage = `DEDUPED(${d.duplicate_reason})`;
    else if (d.relevance_pass === false) stage = "RELEVANCE_FAIL";
    else stage = `BUDGET_DROP#${d.final_rank}(${d.budget_reason})`;
    return { ...t, lanes, stage };
  });
  console.log(`\n[${qid}] "${query}" H=${HORIZON} ms=${ms} chars=${final.promptBlock.length} tokens≈${estimateTokens(final.promptBlock)}`);
  console.log(`  selected: ${selected.join(" ")}`);
  for (const t of perTag) {
    const relevant = qid === "unrelated" || qid === "letter" ? t.tag.startsWith("I2") : qid === "betrayal" ? t.tag.startsWith("I1") : t.tag.includes("lock");
    if (relevant || qid === "unrelated") console.log(`  ${t.tag.padEnd(16)} T${String(t.turn).padEnd(4)} ${t.kind.padEnd(40)} ${t.stage}`);
  }
  report.push({ qid, query, horizon: HORIZON, ms, selected, tags: perTag, promptBlock: final.promptBlock });
  db.close();
}
if (process.argv.includes("--json")) console.log(JSON.stringify(report, null, 1));
