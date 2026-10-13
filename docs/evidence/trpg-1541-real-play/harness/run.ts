/**
 * #1541 real 2-human + 2-AI TRPG goal-progression evidence driver (throwaway; not part of the product tree).
 * Wires only existing owners: createTrpgCampaign / startTrpgCampaign / submitTrpgAction / advanceTrpgCampaign
 * with the real callTrpgGm / callTrpgBot and the real final prompt assembly. Nothing here builds a prompt.
 * The two human seats are agent-scripted (not real people).
 *
 * Run from /workspace:  DATA_DIR=/tmp/g1541/<mode>/data G_MODE=dry|live tsx /tmp/g1541/run.ts <cmd> [args]
 * cmd: init | open | round <actions.json> | confirm | snapshot <tag>
 */
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { getDb } from "@/lib/db";
import { getDatabasePath } from "@/lib/dataDir";
import { EVEN_STATS, createTrpgCampaign, joinTrpgCampaign, saveTrpgSheet, writeSheet } from "@/lib/trpg/engineCreate";
import { advanceTrpgCampaign, startTrpgCampaign, submitTrpgAction, type TrpgEngineDeps } from "@/lib/trpg/engineAdvance";
import { callTrpgBot, callTrpgGm } from "@/lib/trpg/gmCall";
import { parseTrpgGmOutput } from "@/lib/trpg/gmPrompt";
import { loadTrpgSnapshot } from "@/lib/trpg/engineSnapshot";
import { loadCampaignLedger } from "@/lib/trpg/campaignLedger";
import { insertScenarioTemplate } from "@/lib/trpg/scenarioTemplates";
import { insertParticipant } from "@/lib/trpg/store";
import { answerTrpgGoalClaim } from "@/lib/trpg/goalConfirm";
import { buildTrpgGmStructuredWireText } from "@/lib/trpg/gmStructuredOutput";
import { goalHudView } from "@/app/trpg/goalHudView";
import { goalClaimItems } from "@/app/trpg/goalClaimView";
import type { TrpgModelUsage } from "@/lib/trpg/billing";

const MODE = (process.env.G_MODE ?? "dry") as "dry" | "live";
const ROOT = `/tmp/g1541/${MODE}`;
const OUT = `${ROOT}/out`;
const STATE_FILE = `${ROOT}/state.json`;
const MAX_POSTS = 14;
const BUDGET_KRW = 800;
const KRW_PER_USD = 1450;
const PRICE = { input: 0.4875, cacheRead: 0.04875, output: 2.4375 };
const GM_MAX_TOKENS = Number(process.env.G_GM_MAX_TOKENS ?? "0");
const BOT_MAX_TOKENS = Number(process.env.G_BOT_MAX_TOKENS ?? "0");
const BENCH_KEY = process.env.CHEAPER_INFERENCE_BENCHMARK_API_KEY?.trim() ?? "";

const dbPath = getDatabasePath();
if (!dbPath.startsWith(`${ROOT}/`) || process.env.TURSO_DATABASE_URL) {
  throw new Error(`REFUSED: database is not the isolated ${ROOT} path (${dbPath})`);
}
mkdirSync(OUT, { recursive: true });

if (MODE === "live") {
  if (!BENCH_KEY) throw new Error("NOT_RUN: CHEAPER_INFERENCE_BENCHMARK_API_KEY missing");
  process.env.CHEAPER_INFERENCE_API_KEY = BENCH_KEY;
}
delete process.env.OPENROUTER_API_KEY;
delete process.env.OPENAI_API_KEY;
delete process.env.TRPG_MECHANICS_REFEREE_ENABLED;

type Spend = { posts: number; krw: number; usd: number };
type State = {
  hostUserId: number;
  guestUserId: number;
  campaignId: number;
  seats: Record<string, number>;
  callSeq: number;
  round: number;
  spend: Spend;
};

const sha = (s: string) => createHash("sha256").update(s).digest("hex");
const put = (file: string, content: string) => {
  const path = `${OUT}/${file}`;
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, content);
};
const putJson = (file: string, value: unknown) => put(file, `${JSON.stringify(value, null, 2)}\n`);

let state: State | null = existsSync(STATE_FILE) ? (JSON.parse(readFileSync(STATE_FILE, "utf8")) as State) : null;
const save = () => state && writeFileSync(STATE_FILE, JSON.stringify(state, null, 2));

// ---- fetch guard: one POST allowance per logical call, so no retry/fallback can be issued ----
let allowance = 0;
let lastRequestBody: string | null = null;
const fetchLog: Array<Record<string, unknown>> = [];
const realFetch = globalThis.fetch.bind(globalThis);
globalThis.fetch = (async (input: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]) => {
  const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : (input as Request).url;
  const method = (init?.method ?? "GET").toUpperCase();
  const entry: Record<string, unknown> = { url: url.split("?")[0], method, blocked: false, status: null };
  fetchLog.push(entry);
  const allowedHost = MODE === "live" && /^https:\/\/[^/]*cheaperinference/i.test(url) && method === "POST";
  const spent = state?.spend ?? { posts: 0, krw: 0, usd: 0 };
  if (!allowedHost || allowance <= 0 || spent.posts >= MAX_POSTS || spent.krw >= BUDGET_KRW) {
    entry.blocked = true;
    throw new Error(`[g1541] fetch blocked: ${method} ${entry.url} (allowance=${allowance} posts=${spent.posts} krw=${spent.krw.toFixed(1)})`);
  }
  allowance -= 1;
  spent.posts += 1;
  save();
  let nextInit = init;
  if (typeof init?.body === "string") {
    const body = JSON.parse(init.body) as Record<string, unknown>;
    const stream = body.stream === true;
    const cap = stream ? GM_MAX_TOKENS : BOT_MAX_TOKENS;
    if (cap > 0) body.max_tokens = cap;
    const serialized = JSON.stringify(body);
    lastRequestBody = serialized;
    nextInit = { ...init, body: serialized };
  }
  const res = await realFetch(input as never, nextInit);
  entry.status = res.status;
  return res;
}) as typeof fetch;

function usageCost(u: TrpgModelUsage | null | undefined): { usd: number; krw: number; source: string } {
  if (!u) return { usd: 0, krw: 0, source: "no_usage" };
  if (u.upstreamCostUsd != null) return { usd: u.upstreamCostUsd, krw: u.upstreamCostUsd * KRW_PER_USD, source: "provider_reported" };
  const cacheRead = u.cacheReadTokens ?? 0;
  const usd = (Math.max(0, u.inputTokens - cacheRead) * PRICE.input + cacheRead * PRICE.cacheRead + u.outputTokens * PRICE.output) / 1e6;
  return { usd, krw: usd * KRW_PER_USD, source: "catalog_price_x_usage" };
}

function estimateWorstCaseKrw(system: string, user: string, outCap: number): number {
  const inTokens = system.length + user.length; // conservative: 1 token per char (Korean-heavy text)
  return ((inTokens * PRICE.input + outCap * PRICE.output) / 1e6) * KRW_PER_USD;
}

let currentLabel = "";
let currentRound = 0;

async function recordedCall(
  role: "gm" | "bot",
  system: string,
  user: string,
  run: () => Promise<{ text: string; usage?: TrpgModelUsage; finishReason?: string | null }>,
  dryText: () => string
) {
  if (!state) throw new Error("state missing");
  state.callSeq += 1;
  const seq = state.callSeq;
  const tag = `call-${String(seq).padStart(2, "0")}-${role}-${currentLabel}`;
  put(`wire/${tag}-system.txt`, system);
  put(`wire/${tag}-user.txt`, user);
  const outCap = role === "gm" ? GM_MAX_TOKENS || 65_535 : BOT_MAX_TOKENS || 65_535;
  const worst = estimateWorstCaseKrw(system, user, outCap);
  const rec: Record<string, unknown> = {
    seq, role, label: currentLabel, round: currentRound, systemChars: system.length, userChars: user.length,
    systemSha256: sha(system), userSha256: sha(user), worstCaseKrwThisCall: Number(worst.toFixed(1)),
  };
  const started = Date.now();
  try {
    if (MODE === "dry") {
      const text = dryText();
      rec.dryRun = true;
      put(`raw/${tag}.txt`, text);
      return { text };
    }
    if (state.spend.krw + worst > 1000) {
      throw new Error(`[g1541] cost gate: spent ${state.spend.krw.toFixed(1)} + worst ${worst.toFixed(1)} too high`);
    }
    allowance = 1;
    const res = await run();
    allowance = 0;
    const cost = usageCost(res.usage);
    state.spend.krw += cost.krw;
    state.spend.usd += cost.usd;
    rec.usage = res.usage ?? null;
    rec.cost = cost;
    rec.finishReason = res.finishReason ?? null;
    rec.responseChars = res.text.length;
    if (lastRequestBody) {
      rec.requestBodyWithoutMessages = (() => {
        const b = JSON.parse(lastRequestBody) as Record<string, unknown>;
        delete b.messages;
        return b;
      })();
      put(`wire/${tag}-provider-request.json`, lastRequestBody);
    }
    put(`raw/${tag}.txt`, res.text);
    if (role === "gm") {
      const parsed = parseTrpgGmOutput(res.text);
      putJson(`parsed/${tag}-delta.json`, {
        delta: parsed.delta,
        location: parsed.location,
        campaignFinished: parsed.campaignFinished,
        diagnostics: parsed.diagnostics ?? null,
        narrationChars: parsed.narration.length,
      });
    }
    return res;
  } catch (error) {
    allowance = 0;
    rec.error = (error as Error).message;
    throw error;
  } finally {
    rec.elapsedMs = Date.now() - started;
    putJson(`calls/${tag}.json`, rec);
    save();
  }
}

function liveDeps(): TrpgEngineDeps {
  return {
    skipBilling: true,
    memoryCall: async () => {
      throw new Error("[g1541] memoryCall blocked (paid background work not in plan)");
    },
    mechanicsCall: async () => {
      throw new Error("[g1541] mechanicsCall blocked");
    },
    gmCall: ({ system, user, stream }) =>
      recordedCall(
        "gm",
        system,
        user,
        () => callTrpgGm({ system, user, stream, cheaperInferenceApiKeyOverride: BENCH_KEY }),
        () => buildTrpgGmStructuredWireText("안개가 걷히지 않는 부두의 풍경이다. GM: 무엇을 하겠는가?", {
          players: [], location: "마레노 부두", next_round_context: "", campaign_finished: false,
        })
      ),
    botCall: (system, user) =>
      recordedCall("bot", system, user, () => callTrpgBot({ system, user }), () => "주변을 조용히 살핀다."),
  };
}

// ---- scenario / party (substitute fixture: ops-published admin scenario is not readable here) ----
const SCENARIO_PLAN = {
  startingSituation: "안개 낀 새벽, 마레노 부두. 어선 해오라기호가 사흘째 돌아오지 않고 있다.",
  centralConflict: "사라진 어선의 진실을 두고 세관과 선원 조합이 서로를 의심한다.",
  goal: "세관장 강도현이 해오라기호를 침몰시킨 범인임을 밝혀 낸다.",
  secret:
    "해오라기호는 세관장 강도현이 밀수 장부를 없애려고 침몰시켰다. 등대지기 오 노인은 그 장면을 목격했지만 강도현의 협박 때문에 입을 다물고 있다. 강도현과 오 노인은 사실 형제다.",
  endingConditions: ["밀수 장부가 공개되고 강도현이 체포된다", "강도현이 증거를 모두 없애고 도주한다"],
  majorEvents: ["부두에서 해오라기호 선원의 가족이 울며 호소한다", "등대 신호등 기록에서 사건 당일의 공백이 드러난다"],
  clues: ["찢긴 장부 조각", "등대 신호등 기록의 공백", "세관 입항 기록의 수정 흔적"],
  forbiddenEvents: ["첫 장면에서 범인을 직접 지목하는 장면"],
  climax: "등대에서 오 노인이 진실을 털어놓고 강도현이 나타난다.",
  gmDirection: "단서는 플레이어가 조사해서 얻게 하고, 범인과 동기는 중반 이후에 드러낸다.",
};

const AI = [
  {
    name: "서하",
    persona: {
      description:
        "서하는 스물일곱 살의 부두 서기 출신 조사관이다. 말수가 적고 기록과 숫자에 집착하며, 확인되지 않은 소문은 믿지 않는다. 겉으로는 냉정하지만 실종된 선원들의 가족 앞에서는 말이 부드러워진다.",
      greeting: "기록부터 확인하죠. 소문은 그다음이에요.",
      systemPrompt: "서하는 신중하고 원칙적이다. 증거 없이 단정하지 않고, 위험한 지름길을 말린다.",
    },
  },
  {
    name: "도윤",
    persona: {
      description:
        "도윤은 서른한 살의 전직 어선 갑판장이다. 호탕하고 직선적이며 말보다 몸이 먼저 나간다. 해오라기호의 선원들과 술친구였던 탓에 이번 일에 사적인 분노가 있다.",
      greeting: "가만히 있을 수는 없지. 일단 움직이자고.",
      systemPrompt: "도윤은 충동적이고 의리가 있다. 사람들을 직접 찾아가 따지고 몸으로 부딪친다.",
    },
  },
];

function init() {
  const db = getDb();
  const stamp = Date.now();
  const mk = (label: string, nick: string) =>
    Number(
      db
        .prepare("INSERT INTO users (email, nickname, pw_hash, points, is_adult) VALUES (?,?,?,5000,1)")
        .run(`g1541-${label}-${stamp}@example.invalid`, nick, "x").lastInsertRowid
    );
  const host = mk("host", "렌");
  const guest = mk("guest", "현");
  const author = mk("author", "작가");
  const templateId = insertScenarioTemplate(db, author, {
    title: "안개항 실종 사건",
    summary: "해무의 항구에서 돌아오지 않는 어선의 행방을 쫓는 이야기.",
    content:
      "마레노는 해무가 자주 끼는 항구도시다. 부두에는 선원 조합 회관과 세관이 마주 보고 있고, 곶 끝에는 오래된 등대가 서 있다. 사흘 전 출항한 어선 해오라기호가 돌아오지 않아 부두의 분위기가 무겁다.",
    secretContent: SCENARIO_PLAN.secret,
    visibility: "public",
    startLocation: "마레노 부두",
    scenarioPlan: SCENARIO_PLAN as never,
  });
  const campaignId = createTrpgCampaign(db, { hostUserId: host, hostNickname: "렌", viewerUserId: host, templateId });
  saveTrpgSheet(db, { campaignId, userId: host, name: "렌", stats: EVEN_STATS });
  const invite = (db.prepare("SELECT invite_code FROM trpg_campaigns WHERE id=?").get(campaignId) as { invite_code: string }).invite_code;
  joinTrpgCampaign(db, { code: invite, userId: guest, nickname: "현" });
  saveTrpgSheet(db, { campaignId, userId: guest, name: "현", stats: EVEN_STATS });
  const seatOf = (u: number) =>
    (db.prepare("SELECT id FROM trpg_participants WHERE campaign_id=? AND user_id=?").get(campaignId, u) as { id: number }).id;
  const seats: Record<string, number> = { 렌: seatOf(host), 현: seatOf(guest) };
  AI.forEach((ai, index) => {
    const id = insertParticipant(db, {
      campaignId, slotIndex: 2 + index, kind: "ai_character", userId: null, characterId: null,
      displayName: ai.name, persona: ai.persona,
    });
    writeSheet(db, campaignId, id, ai.name, EVEN_STATS, "마레노 부두");
    seats[ai.name] = id;
  });
  state = { hostUserId: host, guestUserId: guest, campaignId, seats, callSeq: 0, round: 0, spend: { posts: 0, krw: 0, usd: 0 } };
  save();
  console.log("INIT", JSON.stringify(state));
}

function dump(tag: string) {
  if (!state) throw new Error("state missing");
  const db = getDb();
  const s = state;
  const stored = db
    .prepare("SELECT round_number, location, quests_json, goals_json, world_flags_json, next_round_context FROM trpg_campaign_state WHERE campaign_id=?")
    .get(s.campaignId) as Record<string, unknown>;
  const views: Record<string, unknown> = {};
  for (const [who, userId, isHost] of [["렌(host)", s.hostUserId, true], ["현(guest)", s.guestUserId, false]] as const) {
    const snap = loadTrpgSnapshot(db, s.campaignId, userId);
    views[who] = {
      snapshotGoals: snap?.goals ?? null,
      hudView: goalHudView(snap?.goals),
      claimItems: goalClaimItems(snap?.goals, isHost),
    };
  }
  const ledger = loadCampaignLedger(db, s.campaignId);
  const gm = db
    .prepare(
      `SELECT r.round_number AS round, g.narration FROM trpg_gm_messages g JOIN trpg_rounds r ON r.id=g.round_id
       WHERE r.campaign_id=? ORDER BY r.round_number`
    )
    .all(s.campaignId);
  const actions = db
    .prepare(
      `SELECT r.round_number AS round, p.display_name AS who, p.kind, sub.body, sub.source
       FROM trpg_action_submissions sub JOIN trpg_rounds r ON r.id=sub.round_id JOIN trpg_participants p ON p.id=sub.participant_id
       WHERE r.campaign_id=? ORDER BY r.round_number, p.slot_index`
    )
    .all(s.campaignId);
  const sheets = db
    .prepare("SELECT participant_id AS participantId, name, location, hp, max_hp AS maxHp FROM trpg_character_sheets WHERE campaign_id=?")
    .all(s.campaignId);
  putJson(`state/${tag}.json`, {
    storedState: stored,
    storedGoals: typeof stored.goals_json === "string" ? JSON.parse(stored.goals_json as string) : null,
    ledger,
    sheets,
    actions,
    gmMessages: gm,
    participantViews: views,
    spend: s.spend,
  });
}

async function main() {
  const cmd = process.argv[2];
  if (cmd === "init") return init();
  if (!state) throw new Error("run init first");
  const db = getDb();
  const s = state;
  if (cmd === "open") {
    currentLabel = "open";
    currentRound = 0;
    await startTrpgCampaign(db, { campaignId: s.campaignId, userId: s.hostUserId, deps: liveDeps() });
    s.round = 0;
    save();
    dump("after-open");
  } else if (cmd === "round") {
    const actions = JSON.parse(readFileSync(resolve(process.argv[3]!), "utf8")) as { 렌: string; 현: string };
    s.round += 1;
    currentLabel = `r${s.round}`;
    currentRound = s.round;
    save();
    dump(`before-r${s.round}`);
    submitTrpgAction(db, { campaignId: s.campaignId, userId: s.hostUserId, body: actions.렌, actionType: "free" });
    submitTrpgAction(db, { campaignId: s.campaignId, userId: s.guestUserId, body: actions.현, actionType: "free" });
    await advanceTrpgCampaign(db, { campaignId: s.campaignId, userId: s.hostUserId, deps: liveDeps() });
    dump(`after-r${s.round}`);
  } else if (cmd === "confirm") {
    dump("before-confirm");
    const goal = loadCampaignLedger(db, s.campaignId).goals.find((g) => g.status === "active" && g.claimedRound != null);
    if (!goal) throw new Error("no pending GM resolution proposal to confirm");
    const result = answerTrpgGoalClaim(db, {
      campaignId: s.campaignId, userId: s.hostUserId, decision: "confirm", goalId: goal.id, claimedRound: goal.claimedRound!,
    });
    putJson("state/confirm-result.json", { goal, outcome: result.outcome });
    dump("after-confirm");
  } else if (cmd === "snapshot") {
    dump(process.argv[3] ?? "snapshot");
  } else {
    throw new Error(`unknown cmd ${cmd}`);
  }
  putJson(`fetch-log-${cmd}-${Date.now()}.json`, fetchLog);
  console.log("DONE", cmd, JSON.stringify(s.spend));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});

