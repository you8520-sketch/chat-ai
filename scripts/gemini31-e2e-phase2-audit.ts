/**
 * Phase 2 — Gemini 3.1 Pro production /api/chat E2E TTFT audit.
 * Requires dev server with GEMINI_TTFT_PHASE_AUDIT=1.
 *
 *   GEMINI_TTFT_PHASE_AUDIT=1 npm run dev   (separate terminal)
 *   node --conditions=react-server --import tsx /tmp/gemini31-e2e-phase2-audit.ts
 */
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import Database from "better-sqlite3";
import { loadEnvLocal } from "../scripts/load-env-local";
import { getDatabasePath } from "../src/lib/dataDir";
import { creditPointsWithIds } from "../src/lib/points";
import { CHEAPER_INFERENCE_GEMINI_31_PRO_PREVIEW_MODEL } from "../src/lib/chatModels";
import { DEFAULT_TARGET_RESPONSE_CHARS } from "../src/lib/responseLengthConstants";
import { TERRA_PROMPT_CANARY_GREETING_NEUTRAL } from "../src/lib/terraPromptCanary";

loadEnvLocal();

const BASE = process.env.SMOKE_BASE ?? "http://127.0.0.1:3000";
const OUT_DIR = "/opt/cursor/artifacts/gemini31-e2e-phase2-audit";
const RUNS = Math.max(5, Number(process.env.E2E_RUNS ?? "5") || 5);
const EMAIL = process.env.E2E_EMAIL ?? "gemini31.ttft.e2e@example.com";
const PASSWORD = process.env.E2E_PASSWORD ?? "gemini31-ttft-e2e-26";
const MODEL = CHEAPER_INFERENCE_GEMINI_31_PRO_PREVIEW_MODEL;

const USER_TURNS = [
  "나는 렌이라고… 본 기억이 안 나는데… 나 알아?",
  "같이 갈래? *두리번*",
  "어디로 가? 안내해줘.",
  "*따라가며* 여기 처음이야.",
  "그 초커... 왜 차고 있어?",
  "귀 괜찮아? 방금 또 찡그린 것 같은데.",
  "잠깐 여기 서서 숨 좀 고를까.",
  "너는 여기서 오래 일했어?",
  "...나, 여기 오기 전에 뭐 하고 있었는지 전혀 기억이 안 나.",
  "일단 네 말대로 가볼게. 옆에 있어줄래?",
  "저쪽 복도 맞아? *걸음을 맞추며*",
  "사람들이 너 보면 슬쩍 피하던데. 왜 그래?",
  "이명, 지금은 좀 어때.",
  "목적지부터 말해줘. 어디까지 가는 거야.",
  "*초커를 흘깃* 저거 아프진 않아?",
  "렌인 건 알겠는데, 그 다음이 비어 있어.",
  "잠깐. 발소리 많아. 여기 서 있을까.",
  "너 혼자 이렇게 다녀도 괜찮아?",
] as const;

const MEASURE_USER =
  "일단 네 옆에서 걸어갈게. 갑자기 멈추면 말해.";

const JO_TAEHYUNG_CARD = `너는 조태형이다. 에이지스 본부 S급 특수계 음압 센티넬. 고위험 폭주형.
북극곰 귀 흰 후드티, 유광 블랙 재킷, 녹색 눈, 검은 네일, 은반지, 여자 향수.
목에 전자 초커. 낙천적이고 능청스러우며 사람을 옭아매는 관찰력이 있다.
렌 곁에서는 이명이 가라앉는다.`;

const JO_WORLD = `에이지스 컨트롤 본부. 센티넬/가이드. 중앙 로비, 지원국, 동기화 챔버, 환풍구, 지하 완충 덱.`;

function median(nums: number[]): number {
  if (!nums.length) return 0;
  const s = [...nums].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid]! : (s[mid - 1]! + s[mid]!) / 2;
}

function stats(nums: number[]) {
  return { min: Math.min(...nums), median: median(nums), max: Math.max(...nums) };
}

function cookieFromSetCookie(header: string | null): string {
  if (!header) throw new Error("no set-cookie");
  const m = /(?:^|,)\s*session=([^;]+)/i.exec(header);
  if (!m?.[1]) throw new Error("session cookie missing");
  return m[1];
}

function ensureE2ePointBalance(db: Database.Database, userId: number, minTotal = 2_000_000) {
  const row = db
    .prepare(
      `SELECT COALESCE(SUM(remaining_amount), 0) AS total
       FROM point_transactions
       WHERE user_id = ? AND remaining_amount > 0 AND expires_at > datetime('now')`
    )
    .get(userId) as { total: number };
  const current = Number(row?.total ?? 0);
  if (current >= minTotal) return;
  creditPointsWithIds(db, userId, minTotal - current, "FREE", "gemini31-e2e-audit top-up");
  db.prepare("UPDATE users SET points = MAX(points, ?), is_adult = 1, nsfw_on = 1 WHERE id = ?").run(
    minTotal,
    userId
  );
}

async function ensureAuth(): Promise<{ token: string; userId: number }> {
  for (const attempt of ["login", "signup"]) {
    if (attempt === "signup") {
      const signup = await fetch(`${BASE}/api/auth/signup`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email: EMAIL,
          nickname: "렌",
          password: PASSWORD,
          pref: null,
        }),
      });
      if (!signup.ok && signup.status !== 409) {
        throw new Error(`signup ${signup.status} ${await signup.text()}`);
      }
    }
    const login = await fetch(`${BASE}/api/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: EMAIL, password: PASSWORD }),
    });
    if (!login.ok) continue;
    const token = cookieFromSetCookie(login.headers.get("set-cookie"));
    const me = await fetch(`${BASE}/api/auth/me`, { headers: { Cookie: `session=${token}` } });
    const meJson = (await me.json()) as { id?: number; user?: { id: number } };
    const userId = meJson.id ?? meJson.user?.id;
    if (!userId) throw new Error("me missing id");
    const db = new Database(getDatabasePath());
    ensureE2ePointBalance(db, userId);
    db.close();
    return { token, userId };
  }
  throw new Error("auth failed");
}

function loadAssistantRaw(turn: number): string {
  const p = path.join(
    process.cwd(),
    `docs/audits/gemini-37-flash-pricing/t${turn}-raw.txt`
  );
  if (!fs.existsSync(p)) throw new Error(`missing fixture ${p}`);
  return fs.readFileSync(p, "utf8").trim();
}

const FIXTURE = (process.env.E2E_FIXTURE ?? "all").toLowerCase();
const FIXTURES_TO_RUN =
  FIXTURE === "all" ? (["A", "B", "C"] as const) : ([FIXTURE.toUpperCase()] as ("A" | "B" | "C")[]);

const MOCK_SUMMARY =
  "짧지만 중요한 사건 하나만 기록함. 이후 전개에 영향을 주는 약속과 관계 변화만 남김. " +
  "추가 장식 없이 사실만 압축. 반복 묘사는 생략. 핵심만 유지.";

type FixtureKind = "A" | "B" | "C";

function fixtureLabel(kind: FixtureKind): string {
  if (kind === "A") return "steady-state (~23k class)";
  if (kind === "B") return "cold-backlog (0 summaries)";
  return "one-batch-behind (summarized through 10)";
}

function sealSummaryBatch(
  db: Database.Database,
  chatId: number,
  userId: number,
  charId: number,
  turnStart: number,
  playableTurnCount: number
) {
  const turnEnd = turnStart + 4;
  db.prepare(
    `INSERT INTO chat_turn_summaries (
        chat_id, turn_number, turn_end, summary, summary_kind, scope_payload,
        branch_id, branch_status, inactive, user_edited
      ) VALUES (?, ?, ?, ?, 'main_canon', ?, NULL, NULL, 0, 0)
      ON CONFLICT(chat_id, turn_number) DO UPDATE SET
        turn_end=excluded.turn_end,
        summary=excluded.summary,
        summary_kind=excluded.summary_kind,
        scope_payload=excluded.scope_payload,
        inactive=0`
  ).run(
    chatId,
    turnStart,
    turnEnd,
    MOCK_SUMMARY,
    JSON.stringify({
      v: 1,
      scopes: { main_canon: MOCK_SUMMARY },
      branchId: null,
      branchStatus: null,
      promotedBy: null,
      promotedAt: null,
    })
  );
  db.prepare(
    `UPDATE chat_memories SET summarized_turn_count=?, message_count=?, recent_summary=COALESCE(recent_summary,'') || ? WHERE chat_id=? AND user_id=?`
  ).run(turnEnd, playableTurnCount, `\n\n${MOCK_SUMMARY}`, chatId, userId);
  void charId;
}

function applyFixtureSummaries(
  db: Database.Database,
  kind: FixtureKind,
  chatId: number,
  userId: number,
  charId: number
) {
  const playable = USER_TURNS.length;
  if (kind === "B") return;
  sealSummaryBatch(db, chatId, userId, charId, 1, playable);
  sealSummaryBatch(db, chatId, userId, charId, 6, playable);
  if (kind === "C") return;
  sealSummaryBatch(db, chatId, userId, charId, 11, playable);
}

function seedCharacterAndHistory(userId: number, runIndex: number, fixture: FixtureKind): number {
  const dbPath = getDatabasePath();
  const db = new Database(dbPath);

  ensureE2ePointBalance(db, userId);
  db.prepare(`UPDATE users SET is_adult = 1, nsfw_on = 1, selected_ai = ? WHERE id = ?`).run(
    MODEL,
    userId
  );

  const charRow = db
    .prepare(
      `INSERT INTO characters (
          name, tagline, description, greeting, system_prompt, genre, tags, nsfw, official,
          world, example_dialog, gender, visibility, moderation_status, content_kind
        ) VALUES (?, ?, ?, ?, ?, '일상', '[]', 1, 0, ?, ?, 'male', 'public', 'approved', 'character')
        RETURNING id`
    )
    .get(
      `조태형-E2E-${runIndex}`,
      "TTFT E2E fixture",
      JO_TAEHYUNG_CARD.slice(0, 200),
      TERRA_PROMPT_CANARY_GREETING_NEUTRAL,
      JO_TAEHYUNG_CARD,
      JO_WORLD,
      `유저: …무서워.\n조태형: …괜찮아.`
    ) as { id: number };
  const charId = charRow.id;

  const chatRow = db
    .prepare(
      `INSERT INTO chats (user_id, character_id, mode, target_response_chars, gemini_model, user_note)
         VALUES (?, ?, 'nsfw', ?, ?, 'TTFT E2E audit')
         RETURNING id`
    )
    .get(userId, charId, DEFAULT_TARGET_RESPONSE_CHARS, MODEL) as { id: number };
  const chatId = chatRow.id;

  const insertMsg = db.prepare(
    `INSERT INTO messages (chat_id, role, content, model) VALUES (?, ?, ?, ?)`
  );
  insertMsg.run(chatId, "assistant", TERRA_PROMPT_CANARY_GREETING_NEUTRAL, MODEL);

  for (let i = 0; i < USER_TURNS.length; i++) {
    insertMsg.run(chatId, "user", USER_TURNS[i]!, MODEL);
    const assistant = loadAssistantRaw(i + 1);
    insertMsg.run(chatId, "assistant", assistant, MODEL);
  }

  applyFixtureSummaries(db, fixture, chatId, userId, charId);

  db.close();
  return chatId;
}

type SseRunResult = {
  run: number;
  fixture: FixtureKind;
  chatId: number;
  clientSubmitMs: number;
  firstDeltaMs: number | null;
  phaseReport: Record<string, unknown> | null;
  httpStatus: number;
  error?: string;
};

async function consumeChatSse(
  token: string,
  characterId: number,
  chatId: number,
  run: number,
  fixture: FixtureKind
): Promise<SseRunResult> {
  const clientSubmitMs = Date.now();
  const clientRequestId = `e2e-g31-${run}-${crypto.randomUUID().slice(0, 8)}`;
  const res = await fetch(`${BASE}/api/chat`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "text/event-stream",
      Cookie: `session=${token}`,
    },
    body: JSON.stringify({
      characterId,
      chatId,
      message: MEASURE_USER,
      clientRequestId,
      isAdultMode: true,
    }),
    signal: AbortSignal.timeout(600_000),
  });

  if (!res.ok || !res.body) {
    return {
      run,
      fixture,
      chatId,
      clientSubmitMs,
      firstDeltaMs: null,
      phaseReport: null,
      httpStatus: res.status,
      error: await res.text().catch(() => `HTTP ${res.status}`),
    };
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let firstDeltaMs: number | null = null;
  let phaseReport: Record<string, unknown> | null = null;

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed.startsWith("data:")) continue;
      const payload = trimmed.slice(5).trim();
      if (!payload) continue;
      let ev: Record<string, unknown>;
      try {
        ev = JSON.parse(payload) as Record<string, unknown>;
      } catch {
        continue;
      }
      if (ev.type === "phase_latency_audit" && ev.report) {
        phaseReport = ev.report as Record<string, unknown>;
      }
      if (
        firstDeltaMs == null &&
        (ev.type === "delta" || ev.type === "append" || (ev.type === "replace" && String(ev.text ?? "").trim()))
      ) {
        firstDeltaMs = Date.now() - clientSubmitMs;
      }
    }
  }

  if (phaseReport) {
    (phaseReport as { client_first_delta_ms?: number }).client_first_delta_ms = firstDeltaMs ?? undefined;
    (phaseReport as { client_submit_epoch_ms?: number }).client_submit_epoch_ms = clientSubmitMs;
  }

  return { run, fixture, chatId, clientSubmitMs, firstDeltaMs, phaseReport, httpStatus: res.status };
}

async function waitForServer(maxMs = 120_000): Promise<void> {
  const started = Date.now();
  while (Date.now() - started < maxMs) {
    try {
      const res = await fetch(`${BASE}/`);
      if (res.ok || res.status === 404) return;
    } catch {
      /* retry */
    }
    await new Promise((r) => setTimeout(r, 2000));
  }
  throw new Error(`server not ready at ${BASE}`);
}

async function runFixture(token: string, userId: number, fixture: FixtureKind) {
  console.log(`\n######## FIXTURE ${fixture} — ${fixtureLabel(fixture)} ########`);
  const results: SseRunResult[] = [];
  for (let run = 1; run <= RUNS; run++) {
    console.log(`\n=== E2E ${fixture} run ${run}/${RUNS} ===`);
    const chatId = seedCharacterAndHistory(userId, run + fixture.charCodeAt(0) * 100, fixture);
    const db = new Database(getDatabasePath(), { readonly: true });
    const charRow = db
      .prepare(`SELECT character_id FROM chats WHERE id=?`)
      .get(chatId) as { character_id: number };
    db.close();
    const characterId = charRow.character_id;
    process.stdout.write(`  chatId=${chatId} calling /api/chat...`);
    const r = await consumeChatSse(token, characterId, chatId, run, fixture);
    results.push(r);
    fs.appendFileSync(
      path.join(OUT_DIR, `runs-${fixture}.jsonl`),
      JSON.stringify(r) + "\n"
    );
    const pr = r.phaseReport as {
      PRE_PROVIDER_TOTAL_MS?: number;
      PROVIDER_VISIBLE_TTFT_MS?: number;
      USER_VISIBLE_TTFT_MS?: number;
      SUMMARY_BARRIER_WAIT_MS?: number;
      tokens?: { prompt_tokens?: number; cached_tokens?: number };
    } | null;
    console.log(
      ` delta=${r.firstDeltaMs ?? "n/a"}ms pre=${pr?.PRE_PROVIDER_TOTAL_MS ?? "n/a"} barrier=${pr?.SUMMARY_BARRIER_WAIT_MS ?? "n/a"} provider=${pr?.PROVIDER_VISIBLE_TTFT_MS ?? "n/a"} prompt=${pr?.tokens?.prompt_tokens ?? "n/a"}`
    );
    if (run < RUNS) await new Promise((res) => setTimeout(res, 5000));
  }

  const phaseRows = results
    .map((r) => r.phaseReport)
    .filter(Boolean) as Array<Record<string, unknown>>;
  const num = (key: string) =>
    phaseRows.map((p) => Number(p[key])).filter((n) => Number.isFinite(n));
  const clientDeltas = results.map((r) => r.firstDeltaMs).filter((n): n is number => n != null);

  return {
    fixture,
    label: fixtureLabel(fixture),
    runCount: RUNS,
    summary: {
      MEDIAN_PROMPT_TOKENS: median(
        phaseRows.map((p) => Number((p.tokens as { prompt_tokens?: number })?.prompt_tokens ?? 0))
      ),
      MEDIAN_CACHED_TOKENS: median(
        phaseRows.map((p) => Number((p.tokens as { cached_tokens?: number })?.cached_tokens ?? 0))
      ),
      MEDIAN_CLIENT_FIRST_DELTA_MS: stats(clientDeltas),
      MEDIAN_PRE_PROVIDER_MS: stats(num("PRE_PROVIDER_TOTAL_MS")),
      MEDIAN_PROVIDER_VISIBLE_TTFT_MS: stats(num("PROVIDER_VISIBLE_TTFT_MS")),
      MEDIAN_USER_VISIBLE_TTFT_MS: stats(num("USER_VISIBLE_TTFT_MS")),
      MEDIAN_SUMMARY_BARRIER_WAIT_MS: stats(num("SUMMARY_BARRIER_WAIT_MS")),
      MEDIAN_SUMMARY_PREP_MS: stats(num("SUMMARY_PREP_MS")),
    },
    runs: results,
  };
}

async function main() {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  await waitForServer();

  const { token, userId } = await ensureAuth();

  const patchAi = await fetch(`${BASE}/api/user/selected-ai`, {
    method: "PATCH",
    headers: {
      "Content-Type": "application/json",
      Cookie: `session=${token}`,
    },
    body: JSON.stringify({ selectedAI: MODEL }),
  });
  if (!patchAi.ok) {
    console.warn("selected-ai patch", patchAi.status, await patchAi.text());
  }

  const fixtureReports = [];
  for (const fixture of FIXTURES_TO_RUN) {
    fixtureReports.push(await runFixture(token, userId, fixture));
  }

  const report = {
    generatedAt: new Date().toISOString(),
    phase: "3-A.1",
    model: MODEL,
    measureUserMessage: MEASURE_USER,
    historyTurns: USER_TURNS.length,
    targetResponseChars: DEFAULT_TARGET_RESPONSE_CHARS,
    phase2Baseline: {
      MEDIAN_PROMPT_TOKENS: 22955,
      MEDIAN_PRE_PROVIDER_MS: 78825,
      MEDIAN_PROVIDER_TTFT_MS: 63688,
      MEDIAN_SERVER_T14_MS: 136673,
    },
    phase3aRegression: {
      MEDIAN_PROMPT_TOKENS: 66793,
      rootCause: "minRealPlayableExchanges=unsummarized bypassed HISTORY_TOKEN_BUDGET trim",
    },
    fixtures: fixtureReports,
  };

  fs.writeFileSync(path.join(OUT_DIR, "phase3a1-report.json"), JSON.stringify(report, null, 2));
  fs.writeFileSync(path.join(OUT_DIR, "report.json"), JSON.stringify(report, null, 2));
  console.log("\nWrote", path.join(OUT_DIR, "phase3a1-report.json"));
  console.log(JSON.stringify(fixtureReports.map((f) => ({ fixture: f.fixture, summary: f.summary })), null, 2));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
