/**
 * Phase 2 FREE-PLAY (world-only) evidence driver (throwaway; not part of the repo). It only wires existing owners together:
 * createTrpgCampaign / startTrpgCampaign / submitTrpgAction / advanceTrpgCampaign with the real
 * callTrpgGm / callTrpgBot and the real final prompt assembly. Nothing here builds a prompt.
 *
 * P2_VERSION=old|new  P2_MODE=dry|live  P2_OUT=<dir>  P2_ENCOUNTERS=0|1  P2_BUDGET_KRW=<n>
 */
import Database from "better-sqlite3";
import { copyFileSync, mkdirSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { resolve } from "node:path";
import { creditPointsWithIds, getPointBalanceOnDb } from "../src/lib/points";
import { EVEN_STATS, createTrpgCampaign, joinTrpgCampaign, saveTrpgSheet } from "../src/lib/trpg/engineCreate";
import {
  advanceTrpgCampaign,
  startTrpgCampaign,
  submitTrpgAction,
  type TrpgEngineDeps,
} from "../src/lib/trpg/engineAdvance";
import { callTrpgBot, callTrpgGm } from "../src/lib/trpg/gmCall";
import { callBackgroundMemory } from "../src/lib/ai";
import { loadMechanicsResolution } from "../src/lib/trpg/mechanicsStore";
import { loadSheetSnapshots } from "../src/lib/trpg/engineSheets";
import { insertScenarioTemplate } from "../src/lib/trpg/scenarioTemplates";
import { ensureTrpgTables } from "../src/lib/trpg/schema";
import { buildTrpgGmStructuredWireText } from "../src/lib/trpg/gmStructuredOutput";
import type { TrpgModelUsage } from "../src/lib/trpg/billing";

const VERSION = process.env.P2_VERSION ?? "";
const MODE = (process.env.P2_MODE ?? "dry") as "dry" | "live";
const OUT = resolve(process.env.P2_OUT ?? `/tmp/p2/out-${VERSION}-${MODE}`);
const ENCOUNTERS = process.env.P2_ENCOUNTERS === "1";
const BUDGET_KRW = Number(process.env.P2_BUDGET_KRW ?? "300");
const KRW_PER_USD = 1450;
const MAX_FETCH = Number(process.env.P2_MAX_FETCH ?? "30");
const ROUNDS = Number(process.env.P2_ROUNDS ?? "10");
const BENCH_KEY = process.env.CHEAPER_INFERENCE_BENCHMARK_API_KEY?.trim() ?? "";
const SRC_DB = process.env.P2_SRC_DB ?? "/tmp/p2/dev-copy.db";

mkdirSync(OUT, { recursive: true });
const WORK_DB = `/tmp/p2/work-${VERSION}-${MODE}.db`;
copyFileSync(SRC_DB, WORK_DB);

if (MODE === "live") {
  if (!BENCH_KEY) throw new Error("NOT_RUN: CHEAPER_INFERENCE_BENCHMARK_API_KEY missing");
  process.env.CHEAPER_INFERENCE_API_KEY = BENCH_KEY;
}
delete process.env.OPENROUTER_API_KEY;
delete process.env.OPENAI_API_KEY;

type FetchLog = { n: number; url: string; method: string; bodyBytes: number; status: number | null; blocked: boolean; ms: number | null };
const fetchLog: FetchLog[] = [];
const realFetch = globalThis.fetch.bind(globalThis);
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
  if (!allowed || fetchLog.filter((f) => !f.blocked).length > MAX_FETCH) {
    entry.blocked = true;
    throw new Error(`[phase2] fetch blocked: ${entry.url}`);
  }
  if (spentKrw() >= BUDGET_KRW) {
    entry.blocked = true;
    throw new Error(`[phase2] budget reached before call: ${spentKrw().toFixed(1)} KRW`);
  }
  const started = Date.now();
  const res = await realFetch(input as never, init);
  entry.status = res.status;
  entry.ms = Date.now() - started;
  return res;
}) as typeof fetch;

type CallRecord = {
  seq: number;
  kind: "gm" | "bot" | "memory";
  round: number;
  participant?: string;
  systemSha256: string;
  userSha256: string;
  systemChars: number;
  userChars: number;
  usage: TrpgModelUsage | null;
  responseChars: number;
  error: string | null;
  elapsedMs: number;
};
const calls: CallRecord[] = [];
const promptFiles: Array<{ file: string; content: string }> = [];
let currentRound = 0;
const sha = (s: string) => createHash("sha256").update(s).digest("hex");

function usageKrw(u: TrpgModelUsage | null | undefined): number {
  if (!u) return 0;
  if (u.upstreamCostUsd != null) return u.upstreamCostUsd * KRW_PER_USD;
  const uncachedIn = Math.max(0, u.inputTokens - (u.cacheReadTokens ?? 0));
  const usd = (uncachedIn * 0.375 + (u.cacheReadTokens ?? 0) * 0.0375 + u.outputTokens * 1.875) / 1_000_000;
  return usd * KRW_PER_USD;
}
function spentKrw(): number {
  return calls.reduce((sum, c) => sum + usageKrw(c.usage), 0);
}

const d20Plan: Record<number, number[]> = {
  0: [14, 14, 14, 14],
  1: [14, 13, 15, 12, 16, 11],
  2: [15, 12, 14, 13, 16, 12],
  3: [16, 13, 15, 14, 11, 17],
  4: [14, 15, 13, 16, 12, 15],
  5: [13, 14, 15, 12, 14, 16],
};
const strikeD20: Record<number, number> = { 1: 15, 2: 15, 3: 14, 4: 15, 5: 15 };
const diceLog: Array<{ round: number; kind: string; value: number }> = [];
let d20Counter = 0;
const rollD20 = (): number => {
  const stack = new Error().stack ?? "";
  if (/resolveThreatStrikes/.test(stack)) {
    const v = strikeD20[currentRound] ?? 15;
    diceLog.push({ round: currentRound, kind: "threat_strike_d20", value: v });
    return v;
  }
  const plan = d20Plan[currentRound] ?? [14, 13, 15, 12, 16, 11];
  const v = plan[d20Counter % plan.length]!;
  d20Counter += 1;
  diceLog.push({ round: currentRound, kind: "d20", value: v });
  return v;
};
const rollDie = (sides: number): number => {
  const v = Math.max(1, Math.min(sides, Math.ceil(sides / 2)));
  diceLog.push({ round: currentRound, kind: `die_d${sides}`, value: v });
  return v;
};

function dryGmText(participantIds: number[]): string {
  const narration = "무령역 승강장의 공기가 낮게 가라앉았다. ".repeat(80) + "GM: 무엇을 하겠는가.";
  return buildTrpgGmStructuredWireText(narration, {
    players: [],
    location: "",
    next_round_context: "다음",
    campaign_finished: false,
  });
}

const db = new Database(WORK_DB);
db.pragma("journal_mode = MEMORY");
ensureTrpgTables(db);

const HOST_ID = 910001;
const GUEST_ID = 910002;
const AUTHOR_ID = 910007;
const CHAR_A = 9100001;
const CHAR_B = 9100002;
for (const [id, nick] of [[HOST_ID, "렌"], [GUEST_ID, "현"], [AUTHOR_ID, "작가"]] as const) {
  db.prepare(
    `INSERT INTO users (id, email, nickname, pw_hash, is_adult, points, created_at) VALUES (?,?,?,?,1,0,datetime('now'))`
  ).run(id, `phase2-${id}@example.invalid`, nick, "x");
}
const WORLD_ID = 910100;
db.prepare(
  `INSERT INTO worlds (id, creator_id, name, summary, content, secret_content, trpg_enabled, trpg_visibility)
   VALUES (?,?,?,?,?,?,1,'public')`
).run(
  WORLD_ID,
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
const campaignId = createTrpgCampaign(db, {
  hostUserId: HOST_ID,
  hostNickname: "렌",
  viewerUserId: HOST_ID,
  worldId: WORLD_ID,
});
saveTrpgSheet(db, { campaignId, userId: HOST_ID, name: "렌", stats: EVEN_STATS });
const invite = (db.prepare(`SELECT invite_code FROM trpg_campaigns WHERE id=?`).get(campaignId) as { invite_code: string }).invite_code;
joinTrpgCampaign(db, { code: invite, userId: GUEST_ID, nickname: "현" });
saveTrpgSheet(db, { campaignId, userId: GUEST_ID, name: "현", stats: EVEN_STATS });
creditPointsWithIds(db, HOST_ID, 20000, "PAID", "phase2-test-credit");
creditPointsWithIds(db, GUEST_ID, 20000, "PAID", "phase2-test-credit");

const nameOf = (id: number) =>
  (db.prepare(`SELECT display_name AS n FROM trpg_participants WHERE id=?`).get(id) as { n: string }).n;

const deps: TrpgEngineDeps = {
  rollD20,
  rollDie: rollDie as never,
  gmCall: async ({ system, user, stream }) => {
    const seq = calls.length + 1;
    promptFiles.push({ file: `prompts/call-${String(seq).padStart(2, "0")}-gm-round${currentRound}-system.txt`, content: system });
    promptFiles.push({ file: `prompts/call-${String(seq).padStart(2, "0")}-gm-round${currentRound}-user.txt`, content: user });
    const rec: CallRecord = {
      seq, kind: "gm", round: currentRound, systemSha256: sha(system), userSha256: sha(user),
      systemChars: system.length, userChars: user.length, usage: null, responseChars: 0, error: null, elapsedMs: 0,
    };
    calls.push(rec);
    const started = Date.now();
    try {
      if (MODE === "dry") {
        const text = dryGmText([]);
        rec.responseChars = text.length;
        return { text };
      }
      const res = await callTrpgGm({ system, user, stream, cheaperInferenceApiKeyOverride: BENCH_KEY });
      rec.usage = res.usage ?? null;
      rec.responseChars = res.text.length;
      promptFiles.push({ file: `raw/call-${String(seq).padStart(2, "0")}-gm-round${currentRound}-response.txt`, content: res.text });
      return res;
    } catch (e) {
      rec.error = (e as Error).message;
      throw e;
    } finally {
      rec.elapsedMs = Date.now() - started;
    }
  },
  memoryCall: async (system, user) => {
    const seq = calls.length + 1;
    promptFiles.push({ file: `prompts/call-${String(seq).padStart(2, "0")}-memory-round${currentRound}-system.txt`, content: system });
    promptFiles.push({ file: `prompts/call-${String(seq).padStart(2, "0")}-memory-round${currentRound}-user.txt`, content: user });
    const rec: CallRecord = {
      seq, kind: "memory", round: currentRound, systemSha256: sha(system), userSha256: sha(user),
      systemChars: system.length, userChars: user.length, usage: null, responseChars: 0, error: null, elapsedMs: 0,
    };
    calls.push(rec);
    const started = Date.now();
    try {
      if (MODE === "dry") return { text: "" };
      const { text, usage } = await callBackgroundMemory(
        system,
        [{ role: "user", content: user }],
        undefined,
        "background-memory-extract",
        { maxTokens: 1536, temperature: 0.2 }
      );
      rec.usage = {
        modelId: "background-memory",
        inputTokens: usage.inputTokens,
        outputTokens: usage.outputTokens,
        cacheReadTokens: usage.cacheReadTokens,
        upstreamCostUsd: usage.upstreamCostUsd,
      };
      rec.responseChars = text.length;
      promptFiles.push({ file: `raw/call-${String(seq).padStart(2, "0")}-memory-round${currentRound}-response.txt`, content: text });
      return { text };
    } catch (e) {
      rec.error = (e as Error).message;
      throw e;
    } finally {
      rec.elapsedMs = Date.now() - started;
    }
  },
  botCall: async (system, user) => {
    const seq = calls.length + 1;
    promptFiles.push({ file: `prompts/call-${String(seq).padStart(2, "0")}-bot-round${currentRound}-system.txt`, content: system });
    promptFiles.push({ file: `prompts/call-${String(seq).padStart(2, "0")}-bot-round${currentRound}-user.txt`, content: user });
    const rec: CallRecord = {
      seq, kind: "bot", round: currentRound, systemSha256: sha(system), userSha256: sha(user),
      systemChars: system.length, userChars: user.length, usage: null, responseChars: 0, error: null, elapsedMs: 0,
    };
    calls.push(rec);
    const started = Date.now();
    try {
      if (MODE === "dry") {
        const text = "조용히 주변을 살피며 동료 곁을 지킨다.";
        rec.responseChars = text.length;
        return { text };
      }
      const res = await callTrpgBot({ system, user });
      rec.usage = res.usage ?? null;
      rec.responseChars = res.text.length;
      promptFiles.push({ file: `raw/call-${String(seq).padStart(2, "0")}-bot-round${currentRound}-response.txt`, content: res.text });
      return res;
    } catch (e) {
      rec.error = (e as Error).message;
      throw e;
    } finally {
      rec.elapsedMs = Date.now() - started;
    }
  },
};

type Script = { ren: [string, string]; hyeon: [string, string] };
const SCRIPT: Record<number, Script> = {
  1: { ren: ["주위를 둘러보고 가까이 있는 사람에게 말을 걸어 지금 이 항구에서 무슨 일이 벌어지고 있는지 묻는다.", "investigate"], hyeon: ["근처를 천천히 살피며 눈에 띄는 단서가 없는지 확인한다.", "investigate"] },
  2: { ren: ["들은 이야기를 따라 어시장으로 가서 상인들에게 소문에 대해 묻는다.", "persuade"], hyeon: ["렌과 함께 어시장으로 이동해 가판대 사이를 둘러본다.", "free"] },
  3: { ren: ["어시장에서 들은 이야기를 확인하러 선원 조합 회관으로 향한다.", "free"], hyeon: ["렌을 따라 선원 조합 회관으로 걸어간다.", "free"] },
  4: { ren: ["조합 회관 안에서 책임자에게 직접 면담을 요청한다.", "persuade"], hyeon: ["회관 게시판과 항해 기록부를 살펴본다.", "investigate"] },
  5: { ren: ["알게 된 내용을 확인하러 곶 끝의 등대로 이동한다.", "free"], hyeon: ["등대로 이어지는 길을 따라 걸으며 주변을 살핀다.", "investigate"] },
  6: { ren: ["등대지기를 만나 이야기를 나눈다.", "persuade"], hyeon: ["등대 위로 올라가 바다 쪽을 살핀다.", "investigate"] },
  7: { ren: ["지금까지 알아낸 것을 정리하고, 다음에 가 볼 곳을 정해 세관으로 향한다.", "free"], hyeon: ["렌을 따라 세관으로 이동한다.", "free"] },
  8: { ren: ["세관 직원에게 말을 걸어 최근 입항 기록을 확인해 달라고 청한다.", "persuade"], hyeon: ["세관 건물 안의 서류함과 게시물을 살펴본다.", "investigate"] },
  9: { ren: ["세관에서 얻은 단서를 들고 다시 어시장으로 돌아가 아까 만난 사람을 찾는다.", "free"], hyeon: ["렌과 함께 어시장으로 돌아간다.", "free"] },
  10: { ren: ["지금까지의 단서를 바탕으로 가장 의심스러운 인물을 직접 찾아가 대화한다.", "persuade"], hyeon: ["렌 곁에서 상대의 표정과 주변 상황을 지켜본다.", "investigate"] },
};

type SheetRow = { id: number; name: string; hp: number; maxHp: number; location: string; conditions: unknown };
function sheetsNow(): SheetRow[] {
  return loadSheetSnapshots(db, campaignId).map((s) => ({
    id: s.participantId,
    name: nameOf(s.participantId),
    hp: s.hp,
    maxHp: s.maxHp,
    location: s.location,
    conditions: s.conditions,
  }));
}

function dumpTables(): Record<string, unknown[]> {
  const out: Record<string, unknown[]> = {};
  const tables = (db.prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name LIKE 'trpg_%'`).all() as { name: string }[]).map((t) => t.name);
  const roundIds = (db.prepare(`SELECT id FROM trpg_rounds WHERE campaign_id=?`).all(campaignId) as { id: number }[]).map((r) => r.id);
  const partIds = (db.prepare(`SELECT id FROM trpg_participants WHERE campaign_id=?`).all(campaignId) as { id: number }[]).map((r) => r.id);
  for (const t of tables) {
    const cols = (db.prepare(`PRAGMA table_info(${t})`).all() as { name: string }[]).map((c) => c.name);
    let rows: unknown[] = [];
    if (cols.includes("campaign_id")) rows = db.prepare(`SELECT * FROM ${t} WHERE campaign_id=?`).all(campaignId);
    else if (cols.includes("round_id")) rows = db.prepare(`SELECT * FROM ${t} WHERE round_id IN (${roundIds.join(",") || "NULL"})`).all();
    else if (cols.includes("participant_id")) rows = db.prepare(`SELECT * FROM ${t} WHERE participant_id IN (${partIds.join(",") || "NULL"})`).all();
    if (rows.length > 0) out[t] = rows;
  }
  return out;
}

function ctxNow() {
  return {
    context: db.prepare(`SELECT source_mode, director_plan_json, story_phase, active_threads_json, resolved_threads_json, local_scene_progress_json FROM trpg_campaign_context WHERE campaign_id=?`).get(campaignId),
    state: db.prepare(`SELECT location, quests_json, npcs_json, world_flags_json, next_round_context FROM trpg_campaign_state WHERE campaign_id=?`).get(campaignId),
  };
}

type RoundEvidence = Record<string, unknown>;
const rounds: RoundEvidence[] = [];
const errors: string[] = [];

async function main() {
  const startPoints = { host: getPointBalanceOnDb(db, HOST_ID), guest: getPointBalanceOnDb(db, GUEST_ID) };
  const before0 = sheetsNow();
  currentRound = 0;
  d20Counter = 0;
  try {
    await startTrpgCampaign(db, { campaignId, userId: HOST_ID, deps });
  } catch (e) {
    errors.push(`opening: ${(e as Error).message}`);
  }
  const opening = {
    round: 0,
    sheetsBefore: before0,
    sheetsAfter: sheetsNow(),
    contextAfter: ctxNow(),
    gmMessage: db.prepare(`SELECT m.*, r.round_number FROM trpg_gm_messages m JOIN trpg_rounds r ON r.id=m.round_id WHERE r.campaign_id=? ORDER BY m.id`).all(campaignId),
  };
  rounds.push(opening);

  for (let n = 1; n <= ROUNDS; n += 1) {
    currentRound = n;
    d20Counter = 0;
    const script = SCRIPT[n]!;
    const before = sheetsNow();
    const callStart = calls.length;
    const resultBefore = {
      round: n,
      humanActions: [
        { player: "렌", userId: HOST_ID, actionType: script.ren[1], body: script.ren[0] },
        { player: "현", userId: GUEST_ID, actionType: script.hyeon[1], body: script.hyeon[0] },
      ],
      sheetsBefore: before,
    };
    try {
      submitTrpgAction(db, { campaignId, userId: HOST_ID, body: script.ren[0], actionType: script.ren[1] });
      submitTrpgAction(db, { campaignId, userId: GUEST_ID, body: script.hyeon[0], actionType: script.hyeon[1] });
      await advanceTrpgCampaign(db, { campaignId, userId: HOST_ID, deps });
    } catch (e) {
      errors.push(`round ${n}: ${(e as Error).message}`);
    }
    const roundRow = db.prepare(`SELECT id, phase FROM trpg_rounds WHERE campaign_id=? AND round_number=?`).get(campaignId, n) as { id: number; phase: string } | undefined;
    const mech = roundRow ? loadMechanicsResolution(db, roundRow.id) : null;
    const lockedSubs = roundRow
      ? db.prepare(
          `SELECT p.display_name AS name, p.kind, s.body, s.action_type AS actionType, s.source, r.d20, r.final_score AS finalScore, r.dc, r.tier
           FROM trpg_action_submissions s JOIN trpg_participants p ON p.id=s.participant_id
           LEFT JOIN trpg_dice_rolls r ON r.submission_id=s.id WHERE s.round_id=? ORDER BY s.id`
        ).all(roundRow.id)
      : [];
    rounds.push({
      ...resultBefore,
      roundRowPhase: roundRow?.phase ?? null,
      actionsAsResolved: lockedSubs,
      authoritativeMechanics: mech,
      sheetsAfter: sheetsNow(),
      contextAfter: ctxNow(),
      callsThisRound: calls.slice(callStart).map((c) => ({ seq: c.seq, kind: c.kind, error: c.error })),
    });
    if (spentKrw() >= BUDGET_KRW) {
      errors.push(`stopped: budget ${spentKrw().toFixed(1)} KRW reached after round ${n}`);
      break;
    }
  }

  const endPoints = { host: getPointBalanceOnDb(db, HOST_ID), guest: getPointBalanceOnDb(db, GUEST_ID) };
  const gm = db.prepare(`SELECT m.*, r.round_number FROM trpg_gm_messages m JOIN trpg_rounds r ON r.id=m.round_id WHERE r.campaign_id=? ORDER BY m.id`).all(campaignId);
  const summary = {
    version: VERSION,
    mode: MODE,
    encountersConfigured: ENCOUNTERS,
    worldId: WORLD_ID,
    sandboxDirectorEnv: process.env.TRPG_SANDBOX_DIRECTOR_ENABLED ?? null,
    campaignId,
    calls: calls.map((c) => ({ ...c, estKrw: Number(usageKrw(c.usage).toFixed(2)) })),
    fetchLog,
    totalCalls: { gm: calls.filter((c) => c.kind === "gm").length, bot: calls.filter((c) => c.kind === "bot").length, memory: calls.filter((c) => c.kind === "memory").length },
    totalEstKrw: Number(spentKrw().toFixed(2)),
    fxAssumptionKrwPerUsd: KRW_PER_USD,
    tokens: {
      input: calls.reduce((s, c) => s + (c.usage?.inputTokens ?? 0), 0),
      output: calls.reduce((s, c) => s + (c.usage?.outputTokens ?? 0), 0),
      cacheRead: calls.reduce((s, c) => s + (c.usage?.cacheReadTokens ?? 0), 0),
    },
    testPointsBilled: { start: startPoints, end: endPoints },
    errors,
    diceLog,
  };
  writeFileSync(`${OUT}/summary.json`, JSON.stringify(summary, null, 2));
  writeFileSync(`${OUT}/rounds.json`, JSON.stringify(rounds, null, 2));
  writeFileSync(`${OUT}/messages.json`, JSON.stringify(gm, null, 2));
  writeFileSync(`${OUT}/db-tables.json`, JSON.stringify(dumpTables(), null, 2));
  for (const f of promptFiles) {
    const path = `${OUT}/${f.file}`;
    mkdirSync(path.slice(0, path.lastIndexOf("/")), { recursive: true });
    writeFileSync(path, f.content);
  }
  console.log(JSON.stringify({ out: OUT, totalCalls: summary.totalCalls, totalEstKrw: summary.totalEstKrw, errors, fetchCount: fetchLog.length }, null, 2));
}

main()
  .catch((e) => {
    console.error("[phase2] fatal", e);
    process.exitCode = 1;
  })
  .finally(() => db.close());
