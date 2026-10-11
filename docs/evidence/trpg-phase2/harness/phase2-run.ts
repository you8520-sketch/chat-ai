/**
 * Phase 2 evidence driver (throwaway; not part of the repo). It only wires existing owners together:
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
const BUDGET_KRW = Number(process.env.P2_BUDGET_KRW ?? "400");
const KRW_PER_USD = 1450;
const MAX_FETCH = Number(process.env.P2_MAX_FETCH ?? "30");
const ROUNDS = Number(process.env.P2_ROUNDS ?? "5");
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
  const plan = d20Plan[currentRound] ?? [14];
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
function insertChar(id: number, name: string, description: string, systemPrompt: string, greeting: string) {
  db.prepare(
    `INSERT INTO characters (id, name, tagline, description, greeting, system_prompt, genre, tags, nsfw, official, emoji, hue, creator_id, creator_name, world, visibility, moderation_status, trpg_reuse_allowed, gender)
     VALUES (?,?,?,?,?,?,?,?,0,1,'🎭',200,?,?,?,'public','approved',1,?)`
  ).run(id, name, "", description, greeting, systemPrompt, "mystery", "[]", AUTHOR_ID, "작가", "", "unspecified");
}
insertChar(
  CHAR_A,
  "서하",
  "서른 둘, 전직 철도 사고조사관. 침착하고 관찰력이 좋으며 감정을 잘 드러내지 않는다. 말투는 정중한 존댓말이고 짧게 끊어 말한다. 사고 보고서에서 지워진 열두 명의 이름을 십 년째 외우고 있다.",
  "서하는 단정하고 신중한 존댓말을 쓴다. 증거와 기록을 중시하며, 위험할 때일수록 목소리가 낮아진다. 동료를 돕지만 근거 없는 낙관은 하지 않는다.",
  "…기록은 거짓말을 하지 않으니까요."
);
insertChar(
  CHAR_B,
  "도윤",
  "스물아홉, 폐선로 철거 일을 하던 인부. 덩치가 크고 입이 걸며 농담으로 겁을 숨긴다. 반말과 거친 말투를 쓰고, 동료가 다치면 앞뒤 재지 않고 뛰어든다. 어릴 때 이 역에서 아버지를 잃었다.",
  "도윤은 거칠고 장난스러운 반말을 쓴다. 겁이 날수록 말이 많아지고, 행동이 앞선다. 서하의 신중함을 답답해하지만 믿는다.",
  "하, 여기 공기 한번 더럽게 차네."
);

const PLAN = {
  startingSituation: "비 내리는 새벽, 일행이 막차에서 내려 폐역 무령역의 승강장에 선다. 기관사의 일지를 찾아 달라는 의뢰를 받았다.",
  centralConflict: "십 년 전 마지막 열차 사고로 사라진 승무원 열두 명의 그림자가 승강장을 떠나지 못하고 있다.",
  goal: "기관사 일지를 찾아 사고의 진실을 확인하고, 그림자들이 안식에 들 방법을 찾는다.",
  secret: "일지는 시계탑 아래 점검함에 있다. 그림자 사냥꾼은 사라진 승무원들의 그림자가 뭉친 존재이며, 일지가 제자리에 놓이고 이름이 불리면 잠잠해진다.",
  endingConditions: ["일지가 시계탑 아래로 돌아가 그림자들이 잠잠해진다", "일행이 역을 떠난다"],
  clues: ["대합실 매표소 서랍의 승무원 명단", "승강장 시계탑 아래 점검함"],
  gmDirection: "사건은 일행의 선택에 따라 진행한다. 위협은 장면 안의 인과로 설명하고, 인물의 감정과 환경을 소설처럼 묘사한다.",
};
const HUNTER = {
  id: "enc_hunter",
  name: "그림자 사냥꾼",
  kind: "enemy" as const,
  damageClass: "MEDIUM" as const,
  activateRound: 2,
  maxStrikes: 6,
  hitDc: 12,
  location: "승강장",
};
const templateId = insertScenarioTemplate(db, AUTHOR_ID, {
  title: "무령역의 마지막 열차",
  summary: "십 년 전 사라진 승무원들의 그림자가 떠도는 폐역에서 기관사의 일지를 찾는 미스터리.",
  content: [
    "해안선에서 떨어진 폐역 '무령역'. 십 년 전 마지막 열차 사고로 승무원 열두 명이 사라졌고, 밤마다 선로 위에 불 꺼진 열차 한 량이 나타난다는 소문이 돈다.",
    "일행은 새벽 막차에서 내려 승강장에 선다. 승강장 끝에는 시계탑이 서 있고, 개찰구 너머 대합실에는 오래된 매표소와 노선도, 잠긴 역장실이 있다. 사고 이후 역을 지키듯 서성이는 '그림자 사냥꾼'은 평소 선로 쪽 어둠에 웅크려 있다가, 자정을 알리는 종이 울린 뒤에야 승강장의 침입자를 쫓아낸다.",
    "사냥꾼은 말이 통하지 않지만, 사라진 승무원들의 이름이 불리고 기관사의 일지가 제자리로 돌아가면 잠잠해진다는 전승이 있다.",
  ].join("\n\n"),
  visibility: "public",
  startLocation: "승강장",
  characterIds: [CHAR_A, CHAR_B],
  scenarioPlan: { ...PLAN, ...(ENCOUNTERS ? { encounters: [HUNTER] } : {}) },
});

const campaignId = createTrpgCampaign(db, {
  hostUserId: HOST_ID,
  hostNickname: "렌",
  viewerUserId: HOST_ID,
  templateId,
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
  1: {
    ren: ["승강장을 천천히 둘러보며 시계탑과 선로, 벤치 주변을 조심스럽게 살핀다.", "investigate"],
    hyeon: ["서하에게 십 년 전 사고 이야기를 조용히 묻는다.", "persuade"],
  },
  2: {
    ren: ["승강장 끝의 시계탑 아래로 걸어가 바닥과 점검함 주변을 꼼꼼히 조사한다.", "investigate"],
    hyeon: ["승강장에서 대합실로 돌아가 잠긴 역장실 문을 살피고 열쇠 구멍과 문틈을 조사한다.", "investigate"],
  },
  3: {
    ren: ["그림자 사냥꾼에게 달려들어 짧은 칼로 정면에서 공격한다.", "attack"],
    hyeon: ["대합실에서 승강장으로 달려가 다친 동료 앞을 막아서며 사냥꾼의 시선을 끈다.", "defend"],
  },
  4: {
    ren: ["칼을 내리고 시계탑 아래 점검함에 일지를 놓은 뒤, 사냥꾼에게 더는 싸울 뜻이 없다고 말한다.", "persuade"],
    hyeon: ["사라진 승무원들의 이름을 하나씩 부르며 일지를 소리 내어 읽어 준다.", "support"],
  },
  5: {
    ren: ["승강장에 남아 시계탑 아래를 마저 살피며 열차가 들어올 기척을 기다린다.", "investigate"],
    hyeon: ["벤치에 앉아 숨을 고르며 주변의 그림자와 소리를 살핀다.", "free"],
  },
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
    templateId,
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
