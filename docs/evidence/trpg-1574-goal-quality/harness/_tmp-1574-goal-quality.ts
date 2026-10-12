/**
 * #1574 real-model goal quality evidence driver (throwaway; not part of the product tree).
 * It only wires existing owners: createTrpgCampaign / startTrpgCampaign / submitTrpgAction / advanceTrpgCampaign
 * with the real callTrpgGm and the real final prompt assembly. Nothing here builds a prompt.
 *
 * G_MODE=dry|live  G_OUT=<dir>  G_BUDGET_KRW=<n>  G_SRC_DB=<sqlite copy>
 * At most 4 provider calls (A R0, B R0, C R2, C R3). Any fetch beyond that is blocked, so no retry can happen.
 */
import Database from "better-sqlite3";
import { copyFileSync, mkdirSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { resolve } from "node:path";
import { creditPointsWithIds } from "../src/lib/points";
import { EVEN_STATS, createTrpgCampaign, saveTrpgSheet } from "../src/lib/trpg/engineCreate";
import {
  advanceTrpgCampaign,
  startTrpgCampaign,
  submitTrpgAction,
  type TrpgEngineDeps,
} from "../src/lib/trpg/engineAdvance";
import { callTrpgGm } from "../src/lib/trpg/gmCall";
import { parseTrpgGmOutput } from "../src/lib/trpg/gmPrompt";
import { loadTrpgSnapshot } from "../src/lib/trpg/engineSnapshot";
import { loadCampaignLedger } from "../src/lib/trpg/campaignLedger";
import { insertScenarioTemplate } from "../src/lib/trpg/scenarioTemplates";
import { ensureTrpgTables } from "../src/lib/trpg/schema";
import { buildTrpgGmStructuredWireText } from "../src/lib/trpg/gmStructuredOutput";
import type { TrpgModelUsage } from "../src/lib/trpg/billing";

const MODE = (process.env.G_MODE ?? "dry") as "dry" | "live";
const OUT = resolve(process.env.G_OUT ?? `/tmp/g1574/out-${MODE}`);
const BUDGET_KRW = Number(process.env.G_BUDGET_KRW ?? "900");
const MAX_PROVIDER_CALLS = 4;
const KRW_PER_USD = 1450;
const BENCH_KEY = process.env.CHEAPER_INFERENCE_BENCHMARK_API_KEY?.trim() ?? "";
const SRC_DB = process.env.G_SRC_DB ?? "/tmp/p2/dev-copy.db";

mkdirSync(OUT, { recursive: true });
const WORK_DB = `/tmp/g1574/work-${MODE}.db`;
mkdirSync("/tmp/g1574", { recursive: true });
copyFileSync(SRC_DB, WORK_DB);

if (MODE === "live") {
  if (!BENCH_KEY) throw new Error("NOT_RUN: CHEAPER_INFERENCE_BENCHMARK_API_KEY missing");
  process.env.CHEAPER_INFERENCE_API_KEY = BENCH_KEY;
}
delete process.env.OPENROUTER_API_KEY;
delete process.env.OPENAI_API_KEY;

type FetchLog = { n: number; url: string; method: string; bodyBytes: number; status: number | null; blocked: boolean; ms: number | null };
const fetchLog: FetchLog[] = [];
const requestBodies: string[] = [];
const realFetch = globalThis.fetch.bind(globalThis);
let spentKrwTotal = 0;
globalThis.fetch = (async (input: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]) => {
  const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : (input as Request).url;
  const entry: FetchLog = {
    n: fetchLog.length + 1,
    url: url.split("?")[0]!,
    method: init?.method ?? "GET",
    bodyBytes: typeof init?.body === "string" ? Buffer.byteLength(init.body) : 0,
    status: null,
    blocked: false,
    ms: null,
  };
  fetchLog.push(entry);
  const allowed = MODE === "live" && url.startsWith("https://") && /cheaperinference/i.test(url);
  if (!allowed || fetchLog.filter((f) => !f.blocked).length > MAX_PROVIDER_CALLS) {
    entry.blocked = true;
    throw new Error(`[g1574] fetch blocked: ${entry.url}`);
  }
  if (spentKrwTotal >= BUDGET_KRW) {
    entry.blocked = true;
    throw new Error(`[g1574] budget reached before call: ${spentKrwTotal.toFixed(1)} KRW`);
  }
  if (typeof init?.body === "string") requestBodies.push(init.body);
  const started = Date.now();
  const res = await realFetch(input as never, init);
  entry.status = res.status;
  entry.ms = Date.now() - started;
  return res;
}) as typeof fetch;

const sha = (s: string) => createHash("sha256").update(s).digest("hex");

function usageKrw(u: TrpgModelUsage | null | undefined): number {
  if (!u) return 0;
  if (u.upstreamCostUsd != null) return u.upstreamCostUsd * KRW_PER_USD;
  const uncachedIn = Math.max(0, u.inputTokens - (u.cacheReadTokens ?? 0));
  const usd = (uncachedIn * 0.375 + (u.cacheReadTokens ?? 0) * 0.0375 + u.outputTokens * 1.875) / 1_000_000;
  return usd * KRW_PER_USD;
}

const db = new Database(WORK_DB);
db.pragma("journal_mode = MEMORY");
ensureTrpgTables(db);

const HOST_ID = 920001;
const AUTHOR_ID = 920007;
for (const [id, nick] of [[HOST_ID, "렌"], [AUTHOR_ID, "작가"]] as const) {
  db.prepare(
    `INSERT INTO users (id, email, nickname, pw_hash, is_adult, points, created_at) VALUES (?,?,?,?,1,0,datetime('now'))`
  ).run(id, `g1574-${id}@example.invalid`, nick, "x");
}
creditPointsWithIds(db, HOST_ID, 20000, "PAID", "g1574-test-credit");

const SECRET_LITERALS = ["강도현", "침몰", "밀수", "장부", "오 노인", "오노인", "형제", "지시"];
const LIGHTHOUSE = "곶 끝의 등대";

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
  encounters: [
    {
      id: "enc_watch",
      name: "등대 감시자",
      kind: "enemy",
      damageClass: "MEDIUM",
      activateRound: 1,
      maxStrikes: 6,
      hitDc: 10,
      location: LIGHTHOUSE,
    },
  ],
};

function scenarioCampaign(): number {
  const templateId = insertScenarioTemplate(db, AUTHOR_ID, {
    title: "안개항 실종 사건",
    summary: "해무의 항구에서 돌아오지 않는 어선의 행방을 쫓는 이야기.",
    content:
      "마레노는 해무가 자주 끼는 항구도시다. 부두에는 선원 조합 회관과 세관이 마주 보고 있고, 곶 끝에는 오래된 등대가 서 있다. 사흘 전 출항한 어선 해오라기호가 돌아오지 않아 부두의 분위기가 무겁다.",
    secretContent: SCENARIO_PLAN.secret,
    visibility: "public",
    startLocation: "마레노 부두",
    scenarioPlan: SCENARIO_PLAN as never,
  });
  const campaignId = createTrpgCampaign(db, { hostUserId: HOST_ID, hostNickname: "렌", viewerUserId: HOST_ID, templateId });
  saveTrpgSheet(db, { campaignId, userId: HOST_ID, name: "렌", stats: EVEN_STATS });
  return campaignId;
}

let worldSeq = 920100;
function worldOnlyCampaign(): number {
  const worldId = worldSeq++;
  db.prepare(
    `INSERT INTO worlds (id, creator_id, name, summary, content, secret_content, trpg_enabled, trpg_visibility)
     VALUES (?,?,?,?,?,?,1,'public')`
  ).run(
    worldId,
    AUTHOR_ID,
    "안개항 마레노",
    "해무가 일 년의 절반을 덮는 항구도시 마레노. 어시장, 선원 조합, 세관, 오래된 등대가 얽힌 도시.",
    [
      "마레노는 만 안쪽에 자리 잡은 중소 규모의 항구도시다. 연중 절반은 짙은 해무가 낀다.",
      "도시의 중심은 새벽마다 서는 어시장이고, 부두 쪽에는 선원 조합 회관과 세관이 마주 보고 있다. 곶 끝에는 백 년 된 등대가 서 있고 등대지기 가문이 대대로 관리한다.",
      "선원 조합은 항로와 임금을 쥐고 있고, 세관은 입항 기록과 관세를 쥐고 있어 두 기관은 늘 불편한 관계다. 어시장 상인들은 이 둘 사이에서 눈치를 보며 장사를 한다.",
      "이 도시의 사람들은 대체로 낯선 방문객에게 경계심을 보이지만, 값을 치르거나 호의를 보이면 의외로 쉽게 마음을 연다.",
    ].join("\n\n"),
    ""
  );
  const campaignId = createTrpgCampaign(db, { hostUserId: HOST_ID, hostNickname: "렌", viewerUserId: HOST_ID, worldId });
  saveTrpgSheet(db, { campaignId, userId: HOST_ID, name: "렌", stats: EVEN_STATS });
  return campaignId;
}

type CallRecord = {
  seq: number;
  label: string;
  campaignId: number;
  round: number;
  model: string | null;
  systemSha256: string;
  userSha256: string;
  systemChars: number;
  userChars: number;
  usage: TrpgModelUsage | null;
  estKrw: number;
  responseChars: number;
  finishReason: string | null;
  error: string | null;
  elapsedMs: number;
};
const calls: CallRecord[] = [];
const files: Array<{ file: string; content: string }> = [];
const put = (file: string, content: string) => files.push({ file, content });
const putJson = (file: string, value: unknown) => put(file, JSON.stringify(value, null, 2));

let current = { label: "", campaignId: 0, round: 0 };

const rollD20 = () => 14;
const rollDie = ((sides: number) => Math.max(1, Math.min(sides, Math.ceil(sides / 2)))) as never;

function scriptedText(location: string, narration: string, extra: Record<string, unknown>, seatIds: number[]): string {
  return buildTrpgGmStructuredWireText(narration, {
    players: seatIds.map((participantId) => ({ participantId, location })),
    location,
    next_round_context: "",
    campaign_finished: false,
    ...extra,
  });
}

function hostSeat(campaignId: number): number {
  return (db.prepare(`SELECT id FROM trpg_participants WHERE campaign_id=? AND kind='human'`).get(campaignId) as { id: number }).id;
}

const stateOf = (campaignId: number) => {
  const state = db
    .prepare(`SELECT location, quests_json, goals_json, world_flags_json, next_round_context FROM trpg_campaign_state WHERE campaign_id=?`)
    .get(campaignId) as Record<string, unknown>;
  const ledger = loadCampaignLedger(db, campaignId);
  const snapshot = loadTrpgSnapshot(db, campaignId, HOST_ID);
  return {
    stored: { ...state, _metadata: undefined },
    storedGoals: typeof state.goals_json === "string" ? JSON.parse(state.goals_json as string) : null,
    ledgerActiveTitles: ledger.quests,
    playerVisibleGoals: snapshot?.goals ?? null,
    sheets: db
      .prepare(`SELECT participant_id AS participantId, location FROM trpg_character_sheets WHERE campaign_id=?`)
      .all(campaignId),
  };
};

function liveDeps(): TrpgEngineDeps {
  return {
    rollD20,
    rollDie,
    memoryCall: async () => ({ text: "" }),
    gmCall: async ({ system, user, stream }) => {
      const seq = calls.length + 1;
      const tag = `call-${String(seq).padStart(2, "0")}-${current.label}-r${current.round}`;
      put(`prompts/${tag}-system.txt`, system);
      put(`prompts/${tag}-user.txt`, user);
      const rec: CallRecord = {
        seq,
        label: current.label,
        campaignId: current.campaignId,
        round: current.round,
        model: null,
        systemSha256: sha(system),
        userSha256: sha(user),
        systemChars: system.length,
        userChars: user.length,
        usage: null,
        estKrw: 0,
        responseChars: 0,
        finishReason: null,
        error: null,
        elapsedMs: 0,
      };
      calls.push(rec);
      const started = Date.now();
      try {
        if (MODE === "dry") {
          const text = scriptedText("마레노 부두", "안개가 걷히지 않는 부두의 풍경이다. ".repeat(40) + "GM: 무엇을 하겠는가.", {}, []);
          rec.responseChars = text.length;
          put(`raw/${tag}-response.txt`, text);
          return { text };
        }
        const bodyIndex = requestBodies.length;
        const res = await callTrpgGm({ system, user, stream, cheaperInferenceApiKeyOverride: BENCH_KEY });
        rec.usage = res.usage ?? null;
        rec.estKrw = Number(usageKrw(rec.usage).toFixed(2));
        spentKrwTotal += usageKrw(rec.usage);
        rec.responseChars = res.text.length;
        rec.finishReason = res.finishReason ?? null;
        const body = requestBodies[bodyIndex];
        if (body) {
          put(`wire/${tag}-provider-request.json`, body);
          try {
            rec.model = (JSON.parse(body) as { model?: string }).model ?? null;
          } catch {
            rec.model = null;
          }
        }
        put(`raw/${tag}-response.txt`, res.text);
        const parsed = parseTrpgGmOutput(res.text);
        putJson(`parsed/${tag}-parsed-delta.json`, {
          delta: parsed.delta,
          location: parsed.location,
          campaignFinished: parsed.campaignFinished,
          diagnostics: parsed.diagnostics ?? null,
          narrationChars: parsed.narration.length,
        });
        return res;
      } catch (e) {
        rec.error = (e as Error).message;
        throw e;
      } finally {
        rec.elapsedMs = Date.now() - started;
      }
    },
    botCall: async () => ({ text: "" }),
  };
}

function scriptedDeps(campaignId: number, location: string, narration: string, extra: Record<string, unknown>): TrpgEngineDeps {
  return {
    skipBilling: true,
    rollD20,
    rollDie,
    memoryCall: async () => ({ text: "" }),
    botCall: async () => ({ text: "" }),
    gmCall: async () => ({ text: scriptedText(location, narration, extra, [hostSeat(campaignId)]) }),
  };
}

const evidenceStates: Record<string, unknown> = {};
const errors: string[] = [];

async function act(campaignId: number, body: string, actionType: string, deps: TrpgEngineDeps) {
  submitTrpgAction(db, { campaignId, userId: HOST_ID, body, actionType: actionType as never });
  await advanceTrpgCampaign(db, { campaignId, userId: HOST_ID, deps });
}

async function main() {
  // A: scenario R0 with a GM-only plan.goal / secret / endings.
  const a = scenarioCampaign();
  current = { label: "A-scenario", campaignId: a, round: 0 };
  try {
    await startTrpgCampaign(db, { campaignId: a, userId: HOST_ID, deps: liveDeps() });
  } catch (e) {
    errors.push(`A R0: ${(e as Error).message}`);
  }
  evidenceStates["A_after_R0"] = stateOf(a);

  // B: world-only R0 (no scenario, no Blueprint).
  const b = worldOnlyCampaign();
  current = { label: "B-world", campaignId: b, round: 0 };
  try {
    await startTrpgCampaign(db, { campaignId: b, userId: HOST_ID, deps: liveDeps() });
  } catch (e) {
    errors.push(`B R0: ${(e as Error).message}`);
  }
  evidenceStates["B_after_R0"] = stateOf(b);

  // C: a verifiable reach_location goal built through the real engine path. R0 and R1 are scripted (no provider call);
  // the player's explicit move is approved and the server completes the goal at R1. R2 and R3 are real GM calls.
  const c = scenarioCampaign();
  const reachTitle = "등대로 가서 상황을 살핀다";
  const askTitle = "부두 사람들에게 해오라기호 소문을 묻는다";
  await startTrpgCampaign(db, {
    campaignId: c,
    userId: HOST_ID,
    deps: scriptedDeps(c, "마레노 부두", "안개 낀 새벽 부두에 어부들이 모여 웅성거린다. 사흘째 돌아오지 않은 해오라기호의 소식을 기다리는 사람들이다. ".repeat(3) + "GM: 무엇을 하겠는가.", {
      questsAdd: [{ title: reachTitle, criterion: { type: "reach_location", place: LIGHTHOUSE } }, askTitle],
    }),
  });
  evidenceStates["C_after_R0_scripted"] = stateOf(c);
  await act(c, "곶 끝의 등대로 이동한다.", "free", scriptedDeps(c, LIGHTHOUSE, "해무 속 곶 길을 따라 걸어 등대 앞에 닿았다. 짠 바람이 불고 등대 문은 닫혀 있다. ".repeat(3) + "GM: 무엇을 하겠는가.", {}));
  evidenceStates["C_after_R1_scripted_move_completed"] = stateOf(c);

  current = { label: "C-after-completion", campaignId: c, round: 2 };
  try {
    await act(c, "등대 안을 둘러본다.", "investigate", liveDeps());
  } catch (e) {
    errors.push(`C R2: ${(e as Error).message}`);
  }
  evidenceStates["C_after_R2_real"] = stateOf(c);

  current = { label: "C-after-completion", campaignId: c, round: 3 };
  try {
    await act(c, "더 자세히 살펴본다.", "investigate", liveDeps());
  } catch (e) {
    errors.push(`C R3: ${(e as Error).message}`);
  }
  evidenceStates["C_after_R3_real"] = stateOf(c);

  const leakCheck = calls.map((record) => {
    const raw = files.find((f) => f.file.startsWith(`raw/call-${String(record.seq).padStart(2, "0")}-`))?.content ?? "";
    return {
      seq: record.seq,
      label: record.label,
      round: record.round,
      literalsFoundInRawOutput: SECRET_LITERALS.filter((literal) => raw.includes(literal)),
    };
  });
  const summary = {
    mode: MODE,
    campaigns: { A_scenario: a, B_world_only: b, C_after_completion: c },
    maxProviderCalls: MAX_PROVIDER_CALLS,
    calls,
    fetchLog,
    totalEstKrw: Number(calls.reduce((sum, r) => sum + usageKrw(r.usage), 0).toFixed(2)),
    fxAssumptionKrwPerUsd: KRW_PER_USD,
    scriptedRoundsNoProviderCall: ["C R0 (reach_location goal construction)", "C R1 (approved move; server completes the goal)"],
    secretLiteralsChecked: SECRET_LITERALS,
    literalContainmentOfRawOutputs: leakCheck,
    errors,
  };
  putJson("summary.json", summary);
  putJson("states.json", evidenceStates);
  put("scenario-fixture.json", JSON.stringify({ SCENARIO_PLAN, startLocation: "마레노 부두" }, null, 2));
  for (const f of files) {
    const path = `${OUT}/${f.file}`;
    mkdirSync(path.slice(0, path.lastIndexOf("/")), { recursive: true });
    writeFileSync(path, f.content);
  }
  console.log(JSON.stringify({ out: OUT, calls: calls.length, totalEstKrw: summary.totalEstKrw, errors, fetchCount: fetchLog.length }, null, 2));
}

main()
  .catch((e) => {
    console.error("[g1574] fatal", e);
    process.exitCode = 1;
  })
  .finally(() => db.close());
