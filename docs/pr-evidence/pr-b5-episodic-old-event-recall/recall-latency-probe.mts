/**
 * Provider-free latency probe for B5: median wall time of the real episodic
 * recall owner (getEpisodicMemoryForPrompt) over in-memory long-horizon chats.
 * Run the same file on the base tree and the PR tree to compare.
 *
 *   node --conditions=react-server --import tsx docs/pr-evidence/pr-b5-episodic-old-event-recall/recall-latency-probe.mts
 */
import { getEpisodicMemoryForPrompt } from "@/lib/episodicMemoryFacts";
import { openDb, seed } from "@/lib/memory/memory-rp-benchmark-suite";

const env = {
  MEMORY_FEATURE_ENABLED: "1",
  EPISODIC_MEMORY_RECALL_ENABLED: "1",
} as unknown as NodeJS.ProcessEnv;

const TEXTS = [
  ["luka", "루카는 시장에서 말린 생선을 흥정해 샀다."],
  ["bella", "벨라가 우리를 위해 따뜻한 수프를 끓였다."],
  ["harin", "하린은 낡은 지도를 펼쳐 남쪽 숲길을 표시했다."],
  ["enoch", "에녹은 여관 마당에서 장작을 패 주었다."],
  ["world", "항구에 낯선 깃발을 단 배가 들어왔다."],
] as const;

const QUERIES = [
  "그러고 보니 우리 예전에 지하실에서 루카가 찾았던 그 은색 열쇠, 아직 기억나?",
  "그때 등대에서 루카가 찾았던 붉은 봉인 편지 기억나?",
  "오늘 날씨 좋다.",
];

const RUNS = 30;
console.error = () => {};
console.info = () => {};
console.log = ((log) => (...args: unknown[]) => {
  if (typeof args[0] === "string" && args[0].startsWith("[EpisodicMemory]")) return;
  log(...args);
})(console.log);

for (const horizon of [150, 1000, 4000]) {
  const db = openDb();
  for (let turn = 1; turn < horizon; turn++) {
    const [subject, text] = TEXTS[turn % TEXTS.length]!;
    seed(db, [[turn, "character", subject, "scene_event", `d${turn}`, turn % 9 === 0 ? "important" : "normal", text]]);
    if (turn % 3 === 0) seed(db, [[turn, "character", "user", "action", `e${turn}`, "normal", "유저는 상인에게 은화 세 닢을 건넸다."]]);
  }
  const rows = (db.prepare("SELECT COUNT(*) c FROM episodic_memory_facts").get() as { c: number }).c;
  for (const query of QUERIES) {
    const input = { chatId: 1, currentTurn: horizon, currentUserMessage: query };
    getEpisodicMemoryForPrompt(db, input, env);
    const times: number[] = [];
    for (let i = 0; i < RUNS; i++) {
      const started = performance.now();
      getEpisodicMemoryForPrompt(db, input, env);
      times.push(performance.now() - started);
    }
    times.sort((a, b) => a - b);
    console.log(
      `H=${horizon} rows=${rows} query="${query.slice(0, 18)}…" median_ms=${times[RUNS >> 1]!.toFixed(2)} p90_ms=${times[Math.floor(RUNS * 0.9)]!.toFixed(2)}`
    );
  }
  db.close();
}
