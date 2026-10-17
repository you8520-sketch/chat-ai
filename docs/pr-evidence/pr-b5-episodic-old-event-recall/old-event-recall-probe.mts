/**
 * Provider-free probe for B5: does a user's reference to an old event reach the
 * final episodic memory block? Runs the real candidate owner
 * (fetchEpisodicMemoryCandidatesForDebug) and the real selection owner
 * (getEpisodicMemoryForPrompt) over deterministic long-horizon fixtures and
 * reports, per case and horizon, where the target row stops:
 * candidate lane → relevance → rank → budget → final block.
 *
 *   node --conditions=react-server --import tsx docs/pr-evidence/pr-b5-episodic-old-event-recall/old-event-recall-probe.mts
 *
 * No network, no provider, in-memory SQLite only.
 */
import {
  fetchEpisodicMemoryCandidatesForDebug,
  getEpisodicMemoryForPrompt,
} from "@/lib/episodicMemoryFacts";
import { openDb, seed, type Row } from "@/lib/memory/memory-rp-benchmark-suite";
import { estimateTokens } from "@/lib/tokenEstimate";

const env = {
  MEMORY_FEATURE_ENABLED: "1",
  EPISODIC_MEMORY_RECALL_ENABLED: "1",
} as unknown as NodeJS.ProcessEnv;

const HORIZONS = [30, 50, 80, 150, 500, 1000];

/** Everyday events that keep happening in a long RP; NPC names recur on purpose. */
const DISTRACTORS: Array<[string, string, string]> = [
  ["luka", "scene_event", "루카는 시장에서 말린 생선을 흥정해 샀다."],
  ["luka", "scene_event", "루카가 여관 방 열쇠를 카운터에 맡겼다."],
  ["luka", "scene_event", "루카는 우리에게 북쪽 다리가 무너졌다는 소문을 전했다."],
  ["bella", "scene_event", "벨라는 경비대 초소 앞에서 순찰 교대를 지켜보았다."],
  ["bella", "scene_event", "벨라가 우리를 위해 따뜻한 수프를 끓였다."],
  ["harin", "scene_event", "하린은 낡은 지도를 펼쳐 남쪽 숲길을 표시했다."],
  ["harin", "scene_event", "하린이 우리 일행의 장부를 정리했다."],
  ["enoch", "scene_event", "에녹은 새벽에 검을 손질하며 말없이 앉아 있었다."],
  ["enoch", "scene_event", "에녹은 여관 마당에서 장작을 패 주었다."],
  ["user", "action", "유저는 상인에게 은화 세 닢을 건넸다."],
  ["world", "scene_event", "비가 그친 뒤 마을 광장에 장이 섰다."],
  ["world", "scene_event", "항구에 낯선 깃발을 단 배가 들어왔다."],
  ["luka", "scene_event", "루카는 지하 창고에서 술통을 옮겼다."],
  ["bella", "scene_event", "벨라는 우리와 함께 다시 길을 떠나기로 했다."],
  ["harin", "scene_event", "하린은 오래된 은색 브로치를 시장에 팔았다."],
];

type Target = { key: string; turn: number; row: Row };
type Case = {
  id: string;
  label: string;
  targets: Target[];
  query: string;
  /** Targets the answer needs. Empty = nothing should be recalled for the asked detail. */
  expect: string[];
};

function ev(turn: number, subject: string, attribute: string, value: string, importance: string, text: string): Row {
  return [turn, "character", subject, attribute, value, importance, text];
}

const CASES: Case[] = [
  {
    id: "A",
    label: "오래된 사건(NPC 단서 발견)",
    targets: [{ key: "A_T12", turn: 12, row: ev(12, "luka", "scene_event", "silver_key_found", "important", "루카가 지하실 선반 뒤에서 녹슨 은색 열쇠를 발견했다.") }],
    query: "그러고 보니 우리 예전에 지하실에서 루카가 찾았던 그 은색 열쇠, 아직 기억나?",
    expect: ["A_T12"],
  },
  {
    id: "B",
    label: "NPC 행동(배신)",
    targets: [{ key: "B_T25", turn: 25, row: ev(25, "bella", "action", "betrayed_to_guard", "critical", "벨라가 유저의 은신처를 경비대에 알려 유저를 넘겼다.") }],
    query: "근데 있잖아, 그때 벨라가 우리를 경비대에 넘겼던 거 말이야. 왜 그랬을까?",
    expect: ["B_T25"],
  },
  {
    id: "C",
    label: "관계 변화(불신 → 화해)",
    targets: [
      { key: "C_T20", turn: 20, row: ev(20, "enoch", "scene_event", "distrust_user", "important", "에녹은 유저가 첩자일지 모른다며 유저를 믿지 못한다고 말했다.") },
      { key: "C_T60", turn: 60, row: ev(60, "enoch", "scene_event", "reconciled_user", "important", "에녹은 유저가 자신을 구해 준 뒤 유저를 의심했던 일을 사과하고 화해했다.") },
    ],
    query: "우리 처음엔 서로 못 믿었잖아. 에녹 네가 나를 의심하다가 어떻게 화해하게 됐는지 기억나?",
    expect: ["C_T20", "C_T60"],
  },
  {
    id: "D",
    label: "감정 변화(상실 → 위로)",
    targets: [
      { key: "D_T15", turn: 15, row: ev(15, "harin", "scene_event", "lost_brother", "critical", "하린은 화재로 동생을 잃고 무너져 울었다.") },
      { key: "D_T40", turn: 40, row: ev(40, "harin", "scene_event", "comforted_by_user", "important", "유저가 동생의 묘 앞에서 하린의 손을 잡아 주었고 하린은 처음으로 동생 이야기를 꺼냈다.") },
    ],
    query: "하린, 예전에 동생 잃었을 때 많이 힘들었잖아. 그때랑 지금 마음은 좀 달라졌어?",
    expect: ["D_T15", "D_T40"],
  },
  {
    id: "E",
    label: "시간적 사실 갱신(부상 → 회복)",
    targets: [
      { key: "E_T30", turn: 30, row: ev(30, "enoch", "injury", "left_arm_bitten", "important", "에녹은 늑대에게 물려 왼팔을 크게 다쳤다.") },
      { key: "E_T80", turn: 80, row: ev(80, "enoch", "injury", "left_arm_recovered", "important", "에녹의 왼팔 부상은 치료 후 회복했다.") },
    ],
    query: "에녹, 예전에 늑대한테 물렸던 왼팔은 이제 다 나았어?",
    expect: ["E_T30", "E_T80"],
  },
  {
    id: "A2",
    label: "중간 이력의 일반 사건(T300 단서)",
    targets: [{ key: "A2_T300", turn: 300, row: ev(300, "luka", "scene_event", "sealed_letter_found", "normal", "루카가 등대 꼭대기에서 붉은 봉인이 찍힌 편지를 찾아냈다.") }],
    query: "그때 등대에서 루카가 찾았던 붉은 봉인 편지 기억나?",
    expect: ["A2_T300"],
  },
  {
    id: "F",
    label: "근거 없는 질문(기록 없는 장소)",
    targets: [{ key: "F_T25", turn: 25, row: ev(25, "bella", "action", "betrayed_to_guard", "critical", "벨라가 유저의 은신처를 경비대에 알려 유저를 넘겼다.") }],
    query: "벨라가 배신하기 전날 밤에 혼자 어디에 갔었는지 너 알아?",
    expect: [],
  },
];

function buildFixture(c: Case, horizon: number) {
  const db = openDb();
  const ids = new Map<string, number>();
  const last = horizon - 1;
  for (let turn = 1; turn <= last; turn++) {
    for (const target of c.targets) {
      if (target.turn === turn) ids.set(target.key, seed(db, [target.row])[0]!);
    }
    const [subject, attribute, text] = DISTRACTORS[(turn * 7) % DISTRACTORS.length]!;
    const importance = turn % 9 === 0 ? "important" : "normal";
    seed(db, [[turn, "character", subject, attribute, `d${turn}`, importance, text]]);
    if (turn % 3 === 0) {
      const [s2, a2, t2] = DISTRACTORS[(turn * 11 + 3) % DISTRACTORS.length]!;
      seed(db, [[turn, "character", s2, a2, `e${turn}`, "normal", t2]]);
    }
  }
  return { db, ids };
}

type Stage =
  | "INJECTED"
  | "CANDIDATE_MISS"
  /** Candidate, but removed before scoring by state reconciliation / latest-by-key (no debug row). */
  | "RECONCILED_OUT"
  | "RELEVANCE_FAIL"
  | "DEDUPED"
  | "BUDGET_DROP"
  | "NOT_IN_FIXTURE";

const report: unknown[] = [];
for (const c of CASES) {
  for (const horizon of HORIZONS) {
    if (c.targets.some((t) => t.turn >= horizon - 5)) continue;
    const { db, ids } = buildFixture(c, horizon);
    const input = { chatId: 1, currentTurn: horizon, currentUserMessage: c.query };
    const started = performance.now();
    const candidates = fetchEpisodicMemoryCandidatesForDebug(db, input, env);
    const final = getEpisodicMemoryForPrompt(db, input, env);
    const ms = Number((performance.now() - started).toFixed(1));
    const totalRows = (db.prepare("SELECT COUNT(*) c FROM episodic_memory_facts").get() as { c: number }).c;
    const perTarget = c.targets.map((t) => {
      const id = ids.get(t.key);
      if (id == null) return { key: t.key, stage: "NOT_IN_FIXTURE" as Stage };
      const lanes = candidates.laneById.get(id) ?? [];
      const debug = final.debug.find((d) => d.id === id);
      const injected = final.facts.some((f) => f.id === id);
      let stage: Stage;
      if (injected) stage = "INJECTED";
      else if (lanes.length === 0) stage = "CANDIDATE_MISS";
      else if (!debug) stage = "RECONCILED_OUT";
      else if (debug?.duplicate_reason) stage = "DEDUPED";
      else if (debug && debug.relevance_pass === false) stage = "RELEVANCE_FAIL";
      else stage = "BUDGET_DROP";
      return {
        key: t.key,
        row_id: id,
        source_turn: t.turn,
        lanes,
        relevance: debug?.relevance_score ?? null,
        composite: debug?.composite_score ?? null,
        rank: debug?.final_rank ?? null,
        budget_reason: debug?.budget_reason ?? null,
        stage,
      };
    });
    const selectedTurns = final.facts.map((f) => f.source_turn);
    const relevanceTurns = [...candidates.laneById.entries()]
      .filter(([, lanes]) => lanes.includes("relevance"))
      .map(([id]) => (db.prepare("SELECT source_turn FROM episodic_memory_facts WHERE id=?").get(id) as { source_turn: number }).source_turn);
    const relevanceLaneTurnRange = relevanceTurns.length
      ? [Math.min(...relevanceTurns), Math.max(...relevanceTurns)]
      : null;
    report.push({
      case: c.id,
      horizon,
      totalRows,
      laneCounts: candidates.stats.laneCounts,
      relevanceLaneTurnRange,
      ms,
      promptChars: final.promptBlock.length,
      promptTokensEstimate: estimateTokens(final.promptBlock),
      selectedTurns,
      targets: perTarget,
      promptBlock: final.promptBlock,
    });
    const summary = perTarget.map((t) => `${t.key}:${t.stage}${"rank" in t && t.rank ? `#${t.rank}` : ""}`).join(" ");
    console.log(
      `[${c.id} ${c.label}] H=${horizon} rows=${totalRows} relevanceLane=${candidates.stats.laneCounts.relevance}${relevanceLaneTurnRange ? `(T${relevanceLaneTurnRange[0]}-T${relevanceLaneTurnRange[1]})` : ""} ${summary} | injected turns=${JSON.stringify(selectedTurns)} chars=${final.promptBlock.length} tokens≈${estimateTokens(final.promptBlock)} ms=${ms}`
    );
    db.close();
  }
}

if (process.argv.includes("--json")) console.log(JSON.stringify(report, null, 1));
