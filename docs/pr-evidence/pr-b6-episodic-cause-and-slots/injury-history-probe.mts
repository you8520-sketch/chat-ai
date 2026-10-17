/**
 * Provider-free B6-1 probe: after "T30 wolf bite -> T80 treated and recovered",
 * which of the two rows reaches the final episodic block for four questions at
 * T200/T500/T1000, for each way the extractor can shape the T30 row.
 *
 *   node --conditions=react-server --import tsx docs/pr-evidence/pr-b6-episodic-cause-and-slots/injury-history-probe.mts
 *
 * In-memory SQLite, synthetic rows, no provider.
 */
import { fetchEpisodicMemoryCandidatesForDebug, getEpisodicMemoryForPrompt } from "@/lib/episodicMemoryFacts";
import { openDb } from "@/lib/memory/memory-rp-benchmark-suite";

const env = { MEMORY_FEATURE_ENABLED: "1", EPISODIC_MEMORY_RECALL_ENABLED: "1" } as unknown as NodeJS.ProcessEnv;
console.info = () => {};
const origLog = console.log;
console.log = (...a: unknown[]) => { if (typeof a[0] === "string" && a[0].startsWith("[EpisodicMemory]")) return; origLog(...a); };

const QUESTIONS = [
  ["now", "에녹 왼팔은 지금 괜찮아?"],
  ["why", "예전에 에녹 왼팔은 왜 다쳤었지?"],
  ["how-recovered", "언제 어떻게 회복했어?"],
  ["still-injured", "아직도 왼팔이 다친 상태야?"],
] as const;

const FILLER = [
  "에녹은 새벽에 검을 손질하며 말없이 앉아 있었다.",
  "에녹은 여관 마당에서 장작을 패 주었다.",
  "에녹이 지도 위의 남쪽 길을 손가락으로 짚었다.",
  "에녹은 유저에게 따뜻한 차를 건넸다.",
];

type Shape = "injury(state-like, verified)" | "action(historical, verified)" | "injury(state-like, legacy no source)";

function insert(db: ReturnType<typeof openDb>, turn: number, attribute: string, value: string, importance: string, gloss: string, quote: string | null, messageId: number) {
  const metadata = {
    memory_evidence_type: "explicit_scene_event",
    content_route: "safe",
    ...(quote ? { evidence: { role: "assistant", message_id: messageId, quote, authority: "CURRENT_SCENE", match: "normalized_exact" } } : {}),
  };
  return Number(db.prepare(
    `INSERT INTO episodic_memory_facts (chat_id, source_turn, category, subject, attribute, value, importance, fact_text, metadata)
     VALUES (1, ?, 'character', 'enoch', ?, ?, ?, ?, ?)`
  ).run(turn, attribute, value, importance, gloss, JSON.stringify(metadata)).lastInsertRowid);
}

function build(shape: Shape, horizon: number) {
  const db = openDb();
  const attr = shape.startsWith("action") ? "action" : "injury";
  const verified = !shape.includes("legacy");
  let t30 = 0, t80 = 0;
  for (let turn = 1; turn < horizon; turn++) {
    if (turn === 30) t30 = insert(db, 30, attr, "left_arm_bitten", "important", "에녹은 늑대에게 물려 왼팔을 크게 다쳤다.", verified ? "늑대가 에녹의 왼팔을 깊이 물어뜯었다." : null, 3001);
    if (turn === 80) t80 = insert(db, 80, attr, "left_arm_recovered", "important", "에녹의 왼팔 부상은 치료 후 회복했다.", verified ? "치료를 마친 에녹의 왼팔은 완전히 회복되었다." : null, 8001);
    insert(db, turn, "scene_event", `f${turn}`, turn % 9 === 0 ? "important" : "normal", FILLER[turn % FILLER.length]!, null, 0);
  }
  return { db, t30, t80 };
}

const rows: unknown[] = [];
for (const shape of ["injury(state-like, verified)", "action(historical, verified)", "injury(state-like, legacy no source)"] as Shape[]) {
  for (const horizon of [200, 500, 1000]) {
    const { db, t30, t80 } = build(shape, horizon);
    for (const [qid, q] of QUESTIONS) {
      const input = { chatId: 1, currentTurn: horizon, currentUserMessage: q };
      const cands = fetchEpisodicMemoryCandidatesForDebug(db, input, env);
      const final = getEpisodicMemoryForPrompt(db, input, env);
      const stage = (id: number) => {
        if (final.facts.some((f) => f.id === id)) return `INJECTED#${final.debug.find((d) => d.id === id)?.final_rank}`;
        if (!(cands.laneById.get(id) ?? []).length) return "CANDIDATE_MISS";
        if (!final.debug.some((d) => d.id === id)) return "RECONCILED_OUT";
        return "DROPPED";
      };
      const line = `${shape} H=${horizon} ${qid}: T30=${stage(t30)} T80=${stage(t80)}`;
      console.log(line);
      rows.push({ shape, horizon, question: qid, t30: stage(t30), t80: stage(t80), promptBlock: final.promptBlock });
    }
    db.close();
  }
}
if (process.argv.includes("--json")) console.log(JSON.stringify(rows, null, 1));
