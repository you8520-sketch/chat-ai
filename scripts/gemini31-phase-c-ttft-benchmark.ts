/**
 * Phase C — Gemini 3.1 Pro / CheaperInference same-chat cache + TTFT root-cause benchmark.
 * READ-ONLY measurement — no production prompt/provider/memory/layout changes.
 *
 * Requires dev server with:
 *   GEMINI_TTFT_PHASE_AUDIT=1 PROMPT_SECTION_FINGERPRINT=1 npm run dev
 *
 *   node --conditions=react-server --import tsx scripts/gemini31-phase-c-ttft-benchmark.ts
 *
 * Env:
 *   PHASE_C_TURNS=12        — live turns per fixture (min 10)
 *   PHASE_C_FIXTURES=A,B,C  — subset filter
 *   SMOKE_BASE=http://127.0.0.1:3000
 */
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import Database from "better-sqlite3";
import { loadEnvLocal } from "./load-env-local";
import { getDatabasePath } from "../src/lib/dataDir";
import { creditPointsWithIds } from "../src/lib/points";
import { CHEAPER_INFERENCE_GEMINI_31_PRO_PREVIEW_MODEL } from "../src/lib/chatModels";
import { DEFAULT_TARGET_RESPONSE_CHARS } from "../src/lib/responseLengthConstants";
import { TERRA_PROMPT_CANARY_GREETING_NEUTRAL } from "../src/lib/terraPromptCanary";

loadEnvLocal();

const BASE = process.env.SMOKE_BASE ?? "http://127.0.0.1:3000";
const OUT_DIR = "/opt/cursor/artifacts/gemini31-phase-c-ttft";
const TURNS = Math.max(10, Number(process.env.PHASE_C_TURNS ?? "12") || 12);
const EMAIL = process.env.PHASE_C_EMAIL ?? "gemini31.phasec.ttft@example.com";
const PASSWORD = process.env.PHASE_C_PASSWORD ?? "gemini31-phasec-ttft-26";
const MODEL = CHEAPER_INFERENCE_GEMINI_31_PRO_PREVIEW_MODEL;

const FIXTURE_FILTER = (process.env.PHASE_C_FIXTURES ?? "A,B,C")
  .split(",")
  .map((s) => s.trim().toUpperCase())
  .filter((s) => s === "A" || s === "B" || s === "C") as FixtureKind[];

const SEED_USER_TURNS = [
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
  "목적지부터 말해줘. 어디까지 가는 거야?",
  "*초커를 흘깃* 저거 아프진 않아?",
  "렌인 건 알겠는데, 그 다음이 비어 있어.",
  "잠깐. 발소리 많아. 여기 서 있을까.",
] as const;

/** Varied live turns — not exact-repeat benchmark. */
const LIVE_MEASURE_TURNS = [
  "일단 네 옆에서 걸어갈게. 갑자기 멈추면 말해.",
  "저기 안내판 뭐라고 써 있어?",
  "*발걸음 맞추며* 여기 공기 차갑다.",
  "민재는 왜 우리를 막는 거야?",
  "이명 지금 어때? 솔직히 말해줘.",
  "*초커를 만지며* 이거 풀면 안 돼?",
  "복도 끝 소리… 사람 더 온 것 같아.",
  "잠깐 벽 쪽으로 숨을까.",
  "렌이라는 이름… 점점 익숙해지는 것 같아.",
  "네가 곁에 있으면 좀 나아져.",
  "*속삭이며* 비밀 하나만 말해줄래?",
  "다음엔 어디로 가야 해?",
  "*주변을 살피며* CCTV 있어?",
  "조태형, 너도 무섭지?",
  "잠깐만. 숨소리 들려.",
  "일단 여기서 기다리자.",
  "손… 잠깐만 잡아도 돼?",
  "이 복도 끝이 어디로 이어져?",
  "기억 조각 하나라도 떠오르면 말해줘.",
  "좋아. 천천히 가자.",
] as const;

const JO_TAEHYUNG_CARD = `너는 조태형이다. 에이지스 본부 S급 특수계 음압 센티넬. 고위험 폭주형.
북극곰 귀 흰 후드티, 유광 블랙 재킷, 녹색 눈, 검은 네일, 은반지, 여자 향수.
목에 전자 초커. 낙천적이고 능청스러우며 사람을 옭아매는 관찰력이 있다.
렌 곁에서는 이명이 가라앉는다.`;

const JO_WORLD = `에이지스 컨트롤 본부. 센티넬/가이드. 중앙 로비, 지원국, 동기화 챔버, 환풍구, 지하 완충 덱.`;

const MOCK_SUMMARY =
  "짧지만 중요한 사건 하나만 기록함. 이후 전개에 영향을 주는 약속과 관계 변화만 남김. " +
  "추가 장식 없이 사실만 압축. 반복 묘사는 생략. 핵심만 유지.";

type FixtureKind = "A" | "B" | "C";
type CacheDropClass = "EXPECTED" | "UNEXPECTED" | "PROVIDER_VARIANCE" | "UNKNOWN" | "NONE";

type TurnRecord = {
  fixture: FixtureKind;
  turnIndex: number;
  chatId: number;
  userMessage: string;
  clientSubmitMs: number;
  prompt_tokens: number | null;
  cached_tokens: number | null;
  uncached_tokens: number | null;
  cache_ratio: number | null;
  reasoning_tokens: number | null;
  visible_output_tokens: number | null;
  visible_chars: number | null;
  billed_cost_usd: number | null;
  ttft_ms: number | null;
  total_latency_ms: number | null;
  pre_provider_ms: number | null;
  summary_barrier_ms: number | null;
  summary_contention_active: boolean;
  summary_active_count: number;
  catch_up_scheduled_count: number;
  first_changed_section: string | null;
  first_changed_position: number | null;
  order_change_detected: boolean;
  unchanged_prefix_sections: number;
  unchanged_count: number;
  section_count: number;
  cache_drop_class: CacheDropClass;
  cache_drop_tokens: number | null;
  httpStatus: number;
  error?: string;
};

function median(nums: number[]): number {
  if (!nums.length) return 0;
  const s = [...nums].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid]! : (s[mid - 1]! + s[mid]!) / 2;
}

function stats(nums: number[]) {
  if (!nums.length) return { min: null, median: null, max: null, n: 0 };
  return {
    min: Math.min(...nums),
    median: median(nums),
    max: Math.max(...nums),
    n: nums.length,
  };
}

function cookieFromSetCookie(header: string | null): string {
  if (!header) throw new Error("no set-cookie");
  const m = /(?:^|,)\s*session=([^;]+)/i.exec(header);
  if (!m?.[1]) throw new Error("session cookie missing");
  return m[1];
}

function ensureE2ePointBalance(db: Database.Database, userId: number, minTotal = 5_000_000) {
  const row = db
    .prepare(
      `SELECT COALESCE(SUM(remaining_amount), 0) AS total
       FROM point_transactions
       WHERE user_id = ? AND remaining_amount > 0 AND expires_at > datetime('now')`
    )
    .get(userId) as { total: number };
  const current = Number(row?.total ?? 0);
  if (current >= minTotal) return;
  creditPointsWithIds(db, userId, minTotal - current, "FREE", "gemini31-phase-c top-up");
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
  const p = path.join(process.cwd(), `docs/audits/gemini-37-flash-pricing/t${turn}-raw.txt`);
  if (!fs.existsSync(p)) throw new Error(`missing fixture ${p}`);
  return fs.readFileSync(p, "utf8").trim();
}

function fixtureLabel(kind: FixtureKind): string {
  if (kind === "A") return "healthy steady-state (summaries through turn 15)";
  if (kind === "B") return "one-summary-batch-behind (summaries through turn 10)";
  return "background catch-up active (no sealed summaries)";
}

function sealSummaryBatch(
  db: Database.Database,
  chatId: number,
  userId: number,
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
}

function applyFixtureSummaries(
  db: Database.Database,
  kind: FixtureKind,
  chatId: number,
  userId: number
) {
  const playable = SEED_USER_TURNS.length;
  if (kind === "C") return;
  sealSummaryBatch(db, chatId, userId, 1, playable);
  sealSummaryBatch(db, chatId, userId, 6, playable);
  if (kind === "B") return;
  sealSummaryBatch(db, chatId, userId, 11, playable);
}

function seedChat(userId: number, fixture: FixtureKind): { chatId: number; characterId: number } {
  const db = new Database(getDatabasePath());
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
      `조태형-PhaseC-${fixture}`,
      "Phase C TTFT fixture",
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
         VALUES (?, ?, 'nsfw', ?, ?, 'Phase C same-chat TTFT benchmark')
         RETURNING id`
    )
    .get(userId, charId, DEFAULT_TARGET_RESPONSE_CHARS, MODEL) as { id: number };
  const chatId = chatRow.id;

  const insertMsg = db.prepare(
    `INSERT INTO messages (chat_id, role, content, model) VALUES (?, ?, ?, ?)`
  );
  insertMsg.run(chatId, "assistant", TERRA_PROMPT_CANARY_GREETING_NEUTRAL, MODEL);

  for (let i = 0; i < SEED_USER_TURNS.length; i++) {
    insertMsg.run(chatId, "user", SEED_USER_TURNS[i]!, MODEL);
    insertMsg.run(chatId, "assistant", loadAssistantRaw(i + 1), MODEL);
  }

  applyFixtureSummaries(db, fixture, chatId, userId);
  db.close();
  return { chatId, characterId: charId };
}

function classifyCacheDrop(prev: TurnRecord | null, curr: TurnRecord): CacheDropClass {
  if (prev == null || prev.cached_tokens == null || curr.cached_tokens == null) return "UNKNOWN";
  if (curr.cached_tokens >= prev.cached_tokens) return "NONE";

  const drop = prev.cached_tokens - curr.cached_tokens;
  curr.cache_drop_tokens = drop;
  const fp = curr.first_changed_section ?? "";

  if (
    /layout-recency|persona-reference|memory|episodic|dynamic|user-persona|current-user|lore|status/i.test(
      fp
    )
  ) {
    return "EXPECTED";
  }
  if (curr.order_change_detected) return "EXPECTED";

  if (
    curr.first_changed_position != null &&
    curr.first_changed_position <= 2 &&
    /korean-prose|contamination|godmodding|character-core|identity-and-rules|prose-style|openrouter/i.test(
      fp
    )
  ) {
    return "UNEXPECTED";
  }

  if (
    drop > 0 &&
    curr.unchanged_prefix_sections >= (prev.unchanged_prefix_sections ?? 0) &&
    fp === prev.first_changed_section
  ) {
    return "PROVIDER_VARIANCE";
  }

  return "UNKNOWN";
}

async function consumeChatTurn(opts: {
  token: string;
  characterId: number;
  chatId: number;
  fixture: FixtureKind;
  turnIndex: number;
  message: string;
}): Promise<TurnRecord> {
  const clientSubmitMs = Date.now();
  const clientRequestId = `phasec-${opts.fixture}-${opts.turnIndex}-${crypto.randomUUID().slice(0, 8)}`;
  const res = await fetch(`${BASE}/api/chat`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "text/event-stream",
      Cookie: `session=${opts.token}`,
    },
    body: JSON.stringify({
      characterId: opts.characterId,
      chatId: opts.chatId,
      message: opts.message,
      clientRequestId,
      isAdultMode: true,
    }),
    signal: AbortSignal.timeout(900_000),
  });

  const base: TurnRecord = {
    fixture: opts.fixture,
    turnIndex: opts.turnIndex,
    chatId: opts.chatId,
    userMessage: opts.message,
    clientSubmitMs,
    prompt_tokens: null,
    cached_tokens: null,
    uncached_tokens: null,
    cache_ratio: null,
    reasoning_tokens: null,
    visible_output_tokens: null,
    visible_chars: null,
    billed_cost_usd: null,
    ttft_ms: null,
    total_latency_ms: null,
    pre_provider_ms: null,
    summary_barrier_ms: null,
    summary_contention_active: false,
    summary_active_count: 0,
    catch_up_scheduled_count: 0,
    first_changed_section: null,
    first_changed_position: null,
    order_change_detected: false,
    unchanged_prefix_sections: 0,
    unchanged_count: 0,
    section_count: 0,
    cache_drop_class: "UNKNOWN",
    cache_drop_tokens: null,
    httpStatus: res.status,
  };

  if (!res.ok || !res.body) {
    base.error = await res.text().catch(() => `HTTP ${res.status}`);
    return base;
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let firstDeltaMs: number | null = null;
  let phaseReport: Record<string, unknown> | null = null;
  let doneUsage: Record<string, unknown> | null = null;
  let doneCost: number | null = null;
  let visibleChars = 0;

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
      if (ev.type === "done") {
        doneUsage = (ev.usage as Record<string, unknown> | undefined) ?? null;
        doneCost = typeof ev.cost === "number" ? ev.cost : null;
        if (typeof ev.finalContent === "string") visibleChars = ev.finalContent.length;
      }
      const text = String(ev.text ?? ev.delta ?? "");
      if (
        firstDeltaMs == null &&
        (ev.type === "delta" || ev.type === "append" || (ev.type === "replace" && text.trim()))
      ) {
        firstDeltaMs = Date.now() - clientSubmitMs;
        if (text) visibleChars = Math.max(visibleChars, text.length);
      } else if (text) {
        visibleChars = Math.max(visibleChars, text.length);
      }
    }
  }

  const totalLatencyMs = Date.now() - clientSubmitMs;
  const tokens = (phaseReport?.tokens ?? {}) as Record<string, unknown>;
  const fp = (phaseReport?.prompt_section_fingerprint ?? {}) as Record<string, unknown>;
  const sc = (phaseReport?.summary_contention ?? {}) as Record<string, unknown>;

  const promptTokens =
    typeof tokens.prompt_tokens === "number" ? tokens.prompt_tokens : null;
  const cachedTokens =
    typeof tokens.cached_tokens === "number" ? tokens.cached_tokens : null;

  base.prompt_tokens = promptTokens;
  base.cached_tokens = cachedTokens;
  base.uncached_tokens =
    promptTokens != null && cachedTokens != null ? Math.max(0, promptTokens - cachedTokens) : null;
  base.cache_ratio =
    typeof tokens.cache_ratio === "number"
      ? tokens.cache_ratio
      : promptTokens != null && cachedTokens != null && promptTokens > 0
        ? Math.round((cachedTokens / promptTokens) * 1000) / 1000
        : null;
  base.reasoning_tokens =
    typeof tokens.reasoning_tokens === "number" ? tokens.reasoning_tokens : null;
  base.visible_output_tokens =
    typeof tokens.completion_tokens === "number" ? tokens.completion_tokens : null;
  base.visible_chars = visibleChars;
  base.billed_cost_usd = doneCost;
  base.ttft_ms =
    typeof phaseReport?.PROVIDER_VISIBLE_TTFT_MS === "number"
      ? phaseReport.PROVIDER_VISIBLE_TTFT_MS
      : firstDeltaMs;
  base.total_latency_ms = totalLatencyMs;
  base.pre_provider_ms =
    typeof phaseReport?.PRE_PROVIDER_TOTAL_MS === "number"
      ? phaseReport.PRE_PROVIDER_TOTAL_MS
      : null;
  base.summary_barrier_ms =
    typeof phaseReport?.SUMMARY_BARRIER_WAIT_MS === "number"
      ? phaseReport.SUMMARY_BARRIER_WAIT_MS
      : null;
  base.summary_contention_active = Boolean(sc.summaryBackgroundActiveAtProviderStart);
  base.summary_active_count = Number(sc.summaryActiveCount ?? 0);
  base.catch_up_scheduled_count = Number(sc.catchUpScheduledCount ?? 0);
  base.first_changed_section =
    typeof fp.first_changed_section === "string" ? fp.first_changed_section : null;
  base.first_changed_position =
    typeof fp.first_changed_position === "number" ? fp.first_changed_position : null;
  base.order_change_detected = Boolean(fp.order_change_detected);
  base.unchanged_prefix_sections = Number(fp.unchanged_prefix_sections ?? 0);
  base.unchanged_count = Number(fp.unchanged_count ?? 0);
  base.section_count = Number(fp.section_count ?? 0);

  if (doneUsage) {
    const apiIn = doneUsage.apiReportedInputTokens ?? doneUsage.input;
    const apiCached = doneUsage.cacheReadTokens;
    if (base.prompt_tokens == null && typeof apiIn === "number") base.prompt_tokens = apiIn;
    if (base.cached_tokens == null && typeof apiCached === "number") base.cached_tokens = apiCached;
    if (base.reasoning_tokens == null && typeof doneUsage.apiReasoningOutputTokens === "number") {
      base.reasoning_tokens = doneUsage.apiReasoningOutputTokens;
    }
    if (base.billed_cost_usd == null && typeof doneUsage.upstreamCostUsd === "number") {
      base.billed_cost_usd = doneUsage.upstreamCostUsd;
    }
  }

  return base;
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

function analyzeFixture(turns: TurnRecord[]) {
  const ratios = turns
    .map((t) => t.cache_ratio)
    .filter((n): n is number => n != null && Number.isFinite(n));
  const ttfts = turns.map((t) => t.ttft_ms).filter((n): n is number => n != null);
  const uncached = turns.map((t) => t.uncached_tokens).filter((n): n is number => n != null);
  const reasoning = turns.map((t) => t.reasoning_tokens).filter((n): n is number => n != null);
  const drops = turns.filter((t) => t.cache_drop_class !== "NONE" && t.cache_drop_class !== "UNKNOWN");

  const firstMiss = turns.find((t) => t.turnIndex <= 3 && (t.cache_ratio ?? 1) < 0.05);
  const contentionTurns = turns.filter((t) => t.summary_contention_active);

  return {
    turnCount: turns.length,
    median_cache_ratio: stats(ratios),
    median_ttft_ms: stats(ttfts),
    median_uncached_tokens: stats(uncached),
    median_reasoning_tokens: stats(reasoning),
    cache_drop_events: drops.length,
    cache_drop_breakdown: {
      EXPECTED: drops.filter((t) => t.cache_drop_class === "EXPECTED").length,
      UNEXPECTED: drops.filter((t) => t.cache_drop_class === "UNEXPECTED").length,
      PROVIDER_VARIANCE: drops.filter((t) => t.cache_drop_class === "PROVIDER_VARIANCE").length,
      UNKNOWN: drops.filter((t) => t.cache_drop_class === "UNKNOWN").length,
    },
    early_cache_miss_turn: firstMiss?.turnIndex ?? null,
    contention_turn_count: contentionTurns.length,
    first_changed_sections: [...new Set(turns.map((t) => t.first_changed_section).filter(Boolean))],
  };
}

function buildDiagnosis(allFixtures: Record<FixtureKind, TurnRecord[]>) {
  const allTurns = Object.values(allFixtures).flat();
  const unexpected = allTurns.filter((t) => t.cache_drop_class === "UNEXPECTED");
  const contention = allTurns.filter((t) => t.summary_contention_active);
  const lowCache = allTurns.filter((t) => (t.cache_ratio ?? 0) < 0.1 && t.turnIndex > 2);

  const sectionFreq = new Map<string, number>();
  for (const t of allTurns) {
    if (t.first_changed_section) {
      sectionFreq.set(t.first_changed_section, (sectionFreq.get(t.first_changed_section) ?? 0) + 1);
    }
  }
  const topSections = [...sectionFreq.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5);

  const ttftUncachedCorr = (() => {
    const pairs = allTurns
      .filter((t) => t.ttft_ms != null && t.uncached_tokens != null)
      .map((t) => ({ x: t.uncached_tokens!, y: t.ttft_ms! }));
    if (pairs.length < 3) return null;
    const mx = median(pairs.map((p) => p.x));
    const my = median(pairs.map((p) => p.y));
    const num = pairs.reduce((s, p) => s + (p.x - mx) * (p.y - my), 0);
    const den = Math.sqrt(
      pairs.reduce((s, p) => s + (p.x - mx) ** 2, 0) *
        pairs.reduce((s, p) => s + (p.y - my) ** 2, 0)
    );
    return den > 0 ? Math.round((num / den) * 1000) / 1000 : null;
  })();

  const primaryCacheMissOwner =
    unexpected.length > 0
      ? `UNEXPECTED prefix churn at ${unexpected.map((t) => t.first_changed_section).join(", ")}`
      : topSections[0]
        ? `first_changed_section=${topSections[0][0]} (${topSections[0][1]} turns) — likely dynamic/history growth`
        : lowCache.length > 0
          ? "low cache_ratio after turn 2 — provider cold prefix or CI queue floor"
          : "no dominant miss owner — cache warming as expected";

  const primaryTtftOwner =
    ttftUncachedCorr != null && ttftUncachedCorr > 0.5
      ? `uncached_tokens (r≈${ttftUncachedCorr}) — prefix size drives TTFT`
      : median(allTurns.map((t) => t.pre_provider_ms ?? 0).filter((n) => n > 0)) >
          median(allTurns.map((t) => t.ttft_ms ?? 0).filter((n) => n > 0)) * 0.3
        ? "pre-provider assembly (context build + memory) significant vs provider TTFT"
        : "provider wait dominates — check CI serving/queue";

  const backgroundSummaryContention =
    contention.length > 0
      ? `YES — ${contention.length}/${allTurns.length} turns had summary background active at provider start`
      : "NO — no measurable foreground contention in this run";

  const ciServingFloorLikely =
    median(allTurns.map((t) => t.ttft_ms ?? 0).filter((n) => n > 5000)) > 30_000
      ? "LIKELY — median provider TTFT >30s suggests CI queue/serving floor"
      : "UNLIKELY — TTFT within interactive range for this environment";

  let nextRecommendation = "Merge PR #724 diagnostics only; run Phase C on production-like CI with longer same-chat series.";
  if (unexpected.length > 0) {
    nextRecommendation =
      "Investigate UNEXPECTED static-prefix churn before cache optimization; do not change layout/memory yet.";
  } else if (contention.length > allTurns.length * 0.2) {
    nextRecommendation =
      "Measure summary catch-up isolation (separate worker) before prompt changes; contention may inflate TTFT.";
  } else if ((ttftUncachedCorr ?? 0) > 0.6) {
    nextRecommendation =
      "Focus Phase D on reducing uncached prefix (history trim / cache breakpoint) — not reasoning or layout.";
  }

  return {
    PRIMARY_CACHE_MISS_OWNER: primaryCacheMissOwner,
    PRIMARY_TTFT_OWNER: primaryTtftOwner,
    BACKGROUND_SUMMARY_CONTENTION: backgroundSummaryContention,
    CI_SERVING_FLOOR_LIKELY: ciServingFloorLikely,
    NEXT_RECOMMENDATION: nextRecommendation,
    top_first_changed_sections: topSections,
    ttft_uncached_correlation: ttftUncachedCorr,
    unexpected_cache_drops: unexpected.length,
  };
}

async function runFixture(token: string, userId: number, fixture: FixtureKind): Promise<TurnRecord[]> {
  console.log(`\n######## FIXTURE ${fixture} — ${fixtureLabel(fixture)} ########`);
  const { chatId, characterId } = seedChat(userId, fixture);
  const turns: TurnRecord[] = [];

  for (let i = 0; i < TURNS; i++) {
    const message = LIVE_MEASURE_TURNS[i % LIVE_MEASURE_TURNS.length]!;
    console.log(`  turn ${i + 1}/${TURNS} chatId=${chatId} …`);
    const record = await consumeChatTurn({
      token,
      characterId,
      chatId,
      fixture,
      turnIndex: i + 1,
      message,
    });
    const prev = turns[turns.length - 1] ?? null;
    record.cache_drop_class = classifyCacheDrop(prev, record);
    turns.push(record);

    fs.appendFileSync(path.join(OUT_DIR, `turns-${fixture}.jsonl`), JSON.stringify(record) + "\n");

    console.log(
      `    cache=${record.cache_ratio ?? "n/a"} ttft=${record.ttft_ms ?? "n/a"}ms uncached=${record.uncached_tokens ?? "n/a"} firstΔ=${record.first_changed_section ?? "null"} drop=${record.cache_drop_class}`
    );

    if (record.error) {
      console.warn(`    ERROR: ${record.error.slice(0, 120)}`);
    }

    if (i + 1 < TURNS) await new Promise((r) => setTimeout(r, 3000));
  }

  return turns;
}

async function main() {
  if (!process.env.OPENROUTER_API_KEY && !process.env.CHEAPER_INFERENCE_API_KEY) {
    throw new Error("OPENROUTER_API_KEY or CHEAPER_INFERENCE_API_KEY required for live measurement");
  }

  fs.mkdirSync(OUT_DIR, { recursive: true });
  await waitForServer();

  const { token, userId } = await ensureAuth();
  const patchAi = await fetch(`${BASE}/api/user/selected-ai`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json", Cookie: `session=${token}` },
    body: JSON.stringify({ selectedAI: MODEL }),
  });
  if (!patchAi.ok) console.warn("selected-ai patch", patchAi.status);

  const fixtures = FIXTURE_FILTER.length ? FIXTURE_FILTER : (["A", "B", "C"] as FixtureKind[]);
  const byFixture: Partial<Record<FixtureKind, TurnRecord[]>> = {};

  for (const fixture of fixtures) {
    byFixture[fixture] = await runFixture(token, userId, fixture);
  }

  const allFixtures = byFixture as Record<FixtureKind, TurnRecord[]>;
  const diagnosis = buildDiagnosis(allFixtures);

  const report = {
    generatedAt: new Date().toISOString(),
    phase: "C",
    readOnly: true,
    model: MODEL,
    provider: "CheaperInference",
    reasoning_effort: "low",
    productionChanges: "NONE",
    seedHistoryTurns: SEED_USER_TURNS.length,
    liveTurnsPerFixture: TURNS,
    fixtures: Object.fromEntries(
      fixtures.map((f) => [f, { label: fixtureLabel(f), analysis: analyzeFixture(allFixtures[f]!), turns: allFixtures[f] }])
    ),
    diagnosis,
    measurementGoals: {
      actual_same_chat_cache_ratio: "fixtures.*.analysis.median_cache_ratio",
      first_cache_divergence_owner: "diagnosis.PRIMARY_CACHE_MISS_OWNER",
      prefix_churn: "fixtures.*.analysis.first_changed_sections",
      uncached_vs_ttft: "diagnosis.ttft_uncached_correlation",
      reasoning_vs_ttft: "fixtures.*.analysis.median_reasoning_tokens",
      summary_contention: "diagnosis.BACKGROUND_SUMMARY_CONTENTION",
      cache_drop_classification: "fixtures.*.analysis.cache_drop_breakdown",
      ci_serving_floor: "diagnosis.CI_SERVING_FLOOR_LIKELY",
    },
  };

  fs.writeFileSync(path.join(OUT_DIR, "report.json"), JSON.stringify(report, null, 2));
  console.log("\n=== Phase C diagnosis ===");
  console.log(JSON.stringify(diagnosis, null, 2));
  console.log("\nWrote", path.join(OUT_DIR, "report.json"));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
