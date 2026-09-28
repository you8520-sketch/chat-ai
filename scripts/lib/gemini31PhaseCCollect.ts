/**
 * Shared Phase C live collection helpers (read-only diagnostic).
 */
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import Database from "better-sqlite3";

import { getDatabasePath } from "../../src/lib/dataDir";
import { creditPointsWithIds } from "../../src/lib/points";
import { CHEAPER_INFERENCE_GEMINI_31_PRO_PREVIEW_MODEL } from "../../src/lib/chatModels";
import { DEFAULT_TARGET_RESPONSE_CHARS } from "../../src/lib/responseLengthConstants";
import { TERRA_PROMPT_CANARY_GREETING_NEUTRAL } from "../../src/lib/terraPromptCanary";

import {
  classifyCacheDrop,
  extractTurnFromPhaseReport,
  type FixtureKind,
  type PhaseCTurnRecord,
} from "./gemini31PhaseCAnalyzer";

export const BASE = process.env.SMOKE_BASE ?? "http://127.0.0.1:3000";
export const MODEL = CHEAPER_INFERENCE_GEMINI_31_PRO_PREVIEW_MODEL;
export const EMAIL = process.env.PHASE_C_EMAIL ?? "gemini31.phasec.ttft@example.com";
export const PASSWORD = process.env.PHASE_C_PASSWORD ?? "gemini31-phasec-ttft-26";

export const SEED_USER_TURNS = [
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

export const LIVE_MEASURE_TURNS = [
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

export async function ensureAuth(): Promise<{ token: string; userId: number }> {
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

export function seedChat(userId: number, fixture: FixtureKind): { chatId: number; characterId: number } {
  const db = new Database(getDatabasePath());
  ensureE2ePointBalance(db, userId);
  db.prepare(`UPDATE users SET is_adult = 1, nsfw_on = 1, selected_ai = ? WHERE id = ?`).run(MODEL, userId);

  const charRow = db
    .prepare(
      `INSERT INTO characters (
          name, tagline, description, greeting, system_prompt, genre, tags, nsfw, official,
          world, example_dialog, gender, visibility, moderation_status, content_kind
        ) VALUES (?, ?, ?, ?, ?, '일상', '[]', 1, 0, ?, ?, 'male', 'public', 'approved', 'character')
        RETURNING id`
    )
    .get(
      `조태형-PhaseC-${fixture}-${Date.now()}`,
      "Phase C TTFT fixture",
      JO_TAEHYUNG_CARD.slice(0, 200),
      TERRA_PROMPT_CANARY_GREETING_NEUTRAL,
      JO_TAEHYUNG_CARD,
      JO_WORLD,
      `유저: …무서워.\n조태형: …괜찮아.`
    ) as { id: number };

  const chatRow = db
    .prepare(
      `INSERT INTO chats (user_id, character_id, mode, target_response_chars, gemini_model, user_note)
         VALUES (?, ?, 'nsfw', ?, ?, 'Phase C same-chat TTFT benchmark')
         RETURNING id`
    )
    .get(userId, charRow.id, DEFAULT_TARGET_RESPONSE_CHARS, MODEL) as { id: number };

  const insertMsg = db.prepare(
    `INSERT INTO messages (chat_id, role, content, model) VALUES (?, ?, ?, ?)`
  );
  insertMsg.run(chatRow.id, "assistant", TERRA_PROMPT_CANARY_GREETING_NEUTRAL, MODEL);
  for (let i = 0; i < SEED_USER_TURNS.length; i++) {
    insertMsg.run(chatRow.id, "user", SEED_USER_TURNS[i]!, MODEL);
    insertMsg.run(chatRow.id, "assistant", loadAssistantRaw(i + 1), MODEL);
  }
  applyFixtureSummaries(db, fixture, chatRow.id, userId);
  db.close();
  return { chatId: chatRow.id, characterId: charRow.id };
}

export async function waitForServer(maxMs = 120_000): Promise<void> {
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

function usageKeyInventory(obj: unknown, prefix = ""): string[] {
  if (!obj || typeof obj !== "object") return [];
  const keys: string[] = [];
  for (const [k, v] of Object.entries(obj as Record<string, unknown>)) {
    const p = prefix ? `${prefix}.${k}` : k;
    keys.push(p);
    if (v && typeof v === "object" && !Array.isArray(v)) {
      keys.push(...usageKeyInventory(v, p));
    }
  }
  return keys;
}

export async function consumeTurn(opts: {
  token: string;
  characterId: number;
  chatId: number;
  fixture: FixtureKind;
  turnIndex: number;
  message: string;
  captureUsageInventory?: boolean;
}): Promise<PhaseCTurnRecord & { usage_key_inventory?: string[]; response_headers?: Record<string, string> }> {
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

  const responseHeaders: Record<string, string> = {};
  res.headers.forEach((v, k) => {
    if (/cache|ci|request|x-/i.test(k)) responseHeaders[k] = v;
  });

  if (!res.ok || !res.body) {
    return {
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
      provider_completion_tokens: null,
      visible_chars: null,
      user_charge_points: null,
      provider_billed_cost_usd: null,
      visible_ttft_ms: null,
      provider_first_sse_ms: null,
      provider_wait_ms: null,
      pre_visible_gap_ms: null,
      total_latency_ms: Date.now() - clientSubmitMs,
      pre_provider_ms: null,
      memory_sync_to_canon_ms: null,
      summary_contention_active: false,
      summary_active_count: 0,
      catch_up_scheduled_count: 0,
      first_changed_section: null,
      first_changed_position: null,
      order_change_detected: false,
      unchanged_prefix_sections: 0,
      unchanged_count: 0,
      section_count: 0,
      cache_drop_class: "NOT_MEASURABLE",
      cache_drop_tokens: null,
      httpStatus: res.status,
      error: await res.text().catch(() => `HTTP ${res.status}`),
    };
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let firstDeltaMs: number | null = null;
  let phaseReport: Record<string, unknown> | null = null;
  let doneUsage: Record<string, unknown> | null = null;
  let doneCost: number | null = null;
  let doneProviderBilledUsd: number | null = null;
  let visibleChars = 0;
  let usageInventory: string[] | undefined;

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
        const ci = (doneUsage?.cheaperInference ?? doneUsage?.cheaper_inference) as
          | Record<string, unknown>
          | undefined;
        const billing = ci?.billing as Record<string, unknown> | undefined;
        if (billing && typeof billing.billed_cost_usd === "number") {
          doneProviderBilledUsd = billing.billed_cost_usd;
        } else if (typeof doneUsage?.cheaperInferenceBilledCostUsd === "number") {
          doneProviderBilledUsd = doneUsage.cheaperInferenceBilledCostUsd;
        }
        if (opts.captureUsageInventory && doneUsage) {
          usageInventory = usageKeyInventory(doneUsage);
        }
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

  const extracted = extractTurnFromPhaseReport({
    phaseReport,
    doneUsage,
    doneCost,
    doneProviderBilledUsd,
    visibleChars,
    clientSubmitMs,
    firstDeltaMs,
  });

  if (
    doneUsage &&
    !("cacheReadTokens" in doneUsage) &&
    !("cachedContentTokens" in doneUsage)
  ) {
    extracted.cached_tokens = null;
    extracted.cache_read_tokens_reported = false;
    extracted.cache_ratio = null;
    extracted.uncached_tokens = null;
  }

  return {
    fixture: opts.fixture,
    turnIndex: opts.turnIndex,
    chatId: opts.chatId,
    userMessage: opts.message,
    clientSubmitMs,
    total_latency_ms: Date.now() - clientSubmitMs,
    cache_drop_class: "NOT_MEASURABLE",
    cache_drop_tokens: null,
    httpStatus: res.status,
    ...extracted,
    ...(usageInventory ? { usage_key_inventory: usageInventory } : {}),
    ...(Object.keys(responseHeaders).length ? { response_headers: responseHeaders } : {}),
  };
}

export async function setupSession(fixture: FixtureKind) {
  await waitForServer();
  const { token, userId } = await ensureAuth();
  await fetch(`${BASE}/api/user/selected-ai`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json", Cookie: `session=${token}` },
    body: JSON.stringify({ selectedAI: MODEL }),
  });
  const { chatId, characterId } = seedChat(userId, fixture);
  return { token, userId, chatId, characterId };
}

export const runPhaseCTurn = {
  LIVE_MEASURE_TURNS,
  setupSession,
  consumeTurn,
  seedChat,
  ensureAuth,
  waitForServer,
  classifyCacheDrop,
};
