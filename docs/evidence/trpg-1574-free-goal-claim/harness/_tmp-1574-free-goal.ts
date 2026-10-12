/**
 * #1574 real-model goal quality evidence driver (throwaway; not part of the product tree).
 * It only wires existing owners: createTrpgCampaign / startTrpgCampaign / submitTrpgAction / advanceTrpgCampaign
 * with the real callTrpgGm and the real final prompt assembly. Nothing here builds a prompt.
 *
 * G_MODE=dry|live  G_OUT=<dir>  G_BUDGET_KRW=<n>  G_SRC_DB=<sqlite copy>
 * At most 2 provider calls (A resolved scene R2, B clue-only scene R2). Any fetch beyond that is blocked, so no retry can happen.
 */
import Database from "better-sqlite3";
import { copyFileSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
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
const OUT = resolve(process.env.G_OUT ?? `/tmp/g1574/fg-out-${MODE}`);
const BUDGET_KRW = Number(process.env.G_BUDGET_KRW ?? "900");
const MAX_PROVIDER_CALLS = 2;
const KRW_PER_USD = 1450;
const BENCH_KEY = process.env.CHEAPER_INFERENCE_BENCHMARK_API_KEY?.trim() ?? "";
const SRC_DB = process.env.G_SRC_DB ?? "/tmp/p2/dev-copy.db";

mkdirSync(OUT, { recursive: true });
const WORK_DB = `/tmp/g1574/fg-work-${MODE}.db`;
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
const chunkLog: Array<{ call: string; chunks: number; chars: number; firstChunkMs: number | null; lastChunkMs: number | null; partial: string }> = [];

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
        const t0 = Date.now();
        const telemetry = { call: tag, chunks: 0, chars: 0, firstChunkMs: null as number | null, lastChunkMs: null as number | null, partial: "" };
        chunkLog.push(telemetry);
        const wrapped = {
          ...stream,
          onProviderChunk: (piece: string) => {
            telemetry.chunks += 1;
            telemetry.chars += piece.length;
            telemetry.partial += piece;
            telemetry.firstChunkMs ??= Date.now() - t0;
            telemetry.lastChunkMs = Date.now() - t0;
            stream?.onProviderChunk?.(piece);
          },
        };
        let res;
        try {
          res = await callTrpgGm({ system, user, stream: wrapped, cheaperInferenceApiKeyOverride: BENCH_KEY });
        } catch (callError) {
          const failedBody = requestBodies[bodyIndex];
          if (failedBody) put(`wire/${tag}-provider-request.json`, failedBody);
          put(`raw/${tag}-partial-stream-before-failure.txt`, telemetry.partial);
          throw callError;
        }
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


const REAL_R0 = readFileSync(
  process.env.G_R0_RAW ?? "/tmp/evid/docs/evidence/trpg-1574-goal-quality/post-contract-attempt/raw/call-01-A-scenario-r0-response.txt",
  "utf8"
);
const GOAL_TITLE = "해오라기호의 행방 추적: 선원의 가족이나 부두 사람들에게서 실종 정황을 파악한다";

const HISTORY_A =
  "기관수의 아내는 소매로 눈가를 훔치며 천천히 입을 열었다. 남편이 사흘 전 새벽 네 시쯤 해오라기호에 올랐고, 출항 전에 늘 하던 대로 기관 압력계를 두 번 두드리고 갔다고 했다. 배에는 선장과 갑판장, 그리고 남편까지 모두 아홉 명이 탔고, 어획이 아니라 부두 건너편 어장까지 짧게 다녀오는 항로였다고 했다.\n\n" +
  "곁에서 듣던 늙은 갑판원 하나가 헛기침을 하고 말을 보탰다. 해오라기호는 출항한 날 오전 열 시경 곶 끝 등대가 보이는 암초 지대 바깥에서 기적을 한 번 울렸고, 그 소리를 부두 망루지기가 들었다는 것이다. 그 뒤로는 무전도 기적도 없었다고 했다.\n\n" +
  "두 사람의 이야기가 끝나자 사람들 사이에 무거운 침묵이 흘렀다. 세관 건물 쪽에서는 여전히 아무도 나오지 않았다.\n\n" +
  "GM: 기관수의 아내와 갑판원의 이야기가 이어졌다. 렌은 이제 어디에 더 귀를 기울이겠는가?";

const HISTORY_B =
  "기관수의 아내는 한참을 망설이다가 소매로 눈가를 훔치며 겨우 입을 열었다. 남편이 출항 전날 밤 집에 돌아와서는 '등대 불이 이상하다'는 말을 한마디 중얼거렸다고 했다. 그 이상은 아무것도 말해 주지 않았고, 그녀도 무슨 뜻인지 모른다고 고개를 저었다.\n\n" +
  "곁에 있던 선원들은 서로 눈치를 보며 입을 다물었다. 누군가 '조합이 정해 준 대로 말하라고 했다'고 낮게 중얼거리자, 옆의 선원이 팔꿈치로 그를 쳤다. 아무도 해오라기호의 출항 시각이나 항로에 대해서는 입을 열지 않았다.\n\n" +
  "해무는 여전히 걷히지 않았고, 부두의 웅성거림만 낮게 이어졌다.\n\n" +
  "GM: 기관수의 아내가 남편이 남긴 한마디를 전했을 뿐 선원들은 말을 아꼈다. 렌은 이제 어디에 더 귀를 기울이겠는가?";

const ACTION_A = "선원 조합 회관 창가의 원로 선원에게 다가가, 해오라기호가 마지막으로 기적을 울린 위치와 시각을 묻는다. 앞서 들은 이야기와 맞춰 보며 해오라기호가 어떻게 사라졌는지 정황을 정리한다.";
const ACTION_B = "기관수의 아내가 전한 말을 수첩에 적어 두고, 부두의 다른 사람들에게도 해오라기호 이야기를 더 물어본다.";

async function runScene(label: "A-resolved" | "B-clue-only", history: string, action: string): Promise<number> {
  const id = scenarioCampaign();
  await startTrpgCampaign(db, {
    campaignId: id,
    userId: HOST_ID,
    deps: {
      skipBilling: true,
      rollD20,
      rollDie,
      memoryCall: async () => ({ text: "" }),
      botCall: async () => ({ text: "" }),
      gmCall: async () => ({ text: REAL_R0 }),
    },
  });
  evidenceStates[`${label}_after_R0_real_text_replayed`] = stateOf(id);
  await act(id, "해무 속 부두에서 기관수의 아내와 선원들 곁으로 다가가 이야기를 듣는다.", "investigate", scriptedDeps(id, "마레노 부두", history, {}));
  evidenceStates[`${label}_after_R1_scripted`] = stateOf(id);
  current = { label, campaignId: id, round: 2 };
  try {
    await act(id, action, "investigate", liveDeps());
  } catch (e) {
    errors.push(`${label} R2: ${(e as Error).message}`);
  }
  evidenceStates[`${label}_after_R2_real`] = stateOf(id);
  return id;
}

async function main() {
  const a = await runScene("A-resolved", HISTORY_A, ACTION_A);
  const b = await runScene("B-clue-only", HISTORY_B, ACTION_B);
  put("fixture-actions-and-history.json", JSON.stringify({ GOAL_TITLE, HISTORY_A, HISTORY_B, ACTION_A, ACTION_B, r0RawSha256: sha(REAL_R0) }, null, 2));
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
    campaigns: { A_resolved: a, B_clue_only: b },
    maxProviderCalls: MAX_PROVIDER_CALLS,
    calls,
    fetchLog,
    totalEstKrw: Number(calls.reduce((sum, r) => sum + usageKrw(r.usage), 0).toFixed(2)),
    fxAssumptionKrwPerUsd: KRW_PER_USD,
    scriptedRoundsNoProviderCall: ["R0 replays the real A scenario R0 raw output (post-contract-attempt call-01)", "R1 scripted NPC testimony history (A: two facts, B: one fragment)"],
    secretLiteralsChecked: SECRET_LITERALS,
    literalContainmentOfRawOutputs: leakCheck,
    chunkTelemetry: chunkLog.map((c) => ({ ...c, partial: undefined, partialChars: c.partial.length })),
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
