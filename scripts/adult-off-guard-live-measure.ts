/**
 * 성인 OFF 출력 검사 — 15+ 품질 실측(수동 live 프로브). 상시 실행 대상이 아니다.
 *
 * 격리 DB에서 실제 `POST /api/chat` 핸들러를 검사 ON 상태로 호출한다.
 * 모델당 1회, 재시도·자동 대체 호출 없음. 호출 직전에 현재 조건으로 견적을 다시 계산하고
 * 누적 한도를 넘길 것으로 예상되는 호출은 건너뛴다. 출력 목표·상한은 바꾸지 않는다.
 * 공급자 호출은 요청을 시작한 순간부터 기록하고, SSE 종료 뒤의 후속 tail과 장부 마감이
 * 끝난 뒤에만 성공으로 저장한다. 미완료 attempt가 있으면 장부를 지우지 않는다.
 *
 *   node --conditions=react-server --import tsx scripts/adult-off-guard-live-measure.ts
 *
 * env: LIVE_MEASURE_OUT_DIR, LIVE_MEASURE_MODELS(쉼표), LIVE_MEASURE_PRIOR_SPENT_KRW,
 *      LIVE_MEASURE_CAP_KRW, LIVE_MEASURE_USD_KRW(미지정 시 open.er-api.com 현재가)
 */
import Module from "node:module";

let sessionToken = "";
const originalLoad = Module._load;
Module._load = function (request, parent, isMain) {
  if (request === "server-only") return {};
  if (request === "next/headers") {
    return {
      cookies: async () => ({
        get: (name: string) =>
          name === "session" && sessionToken ? { value: sessionToken } : undefined,
      }),
    };
  }
  return originalLoad.call(this, request, parent, isMain);
} as typeof Module._load;

import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  commitMeasuredLedger,
  createAdultOffLiveCapture,
  type MeasuredLedgerRow,
} from "./lib/adultOffGuardLiveCapture";
import {
  estimateUsdFromUsage,
  type UsageTokens,
  checkMessageApiResponse,
  classifyCostRows,
  reconstructScreenText,
  reconstructScreenTimeline,
  screenBeforeAndAfter,
  splitLatency,
} from "./lib/adultOffGuardEvidence";
import {
  installIsolatedTestDatabase,
  uninstallIsolatedTestDatabase,
} from "../src/lib/test/isolatedTestDatabase";
import {
  CANONICAL_RP_QUALIFICATION_SOURCE,
  COMMON_PROSE_BODY_CUE_REVIEW_SCENE_SEEDS,
  loadCanonicalRpQualificationFixture,
} from "./lib/rpModelQualificationFixture";
import { listOpenTurnTailWork } from "../src/lib/turnTailWork";

const USER_ID = 91001;
const CHARACTER_ID = 91002;
const SEED_ID = "relationship_turn_safe";
const OUT_DIR = process.env.LIVE_MEASURE_OUT_DIR?.trim() || "docs/audits/adult-off-output-guard/live";
const PRIOR_SPENT_KRW = Number(process.env.LIVE_MEASURE_PRIOR_SPENT_KRW ?? "62");
const CAP_KRW = Number(process.env.LIVE_MEASURE_CAP_KRW ?? "1000");

type Mode = "dry" | "live";
let mode: Mode = "dry";
let lastDryBodyChars = 0;
const SETTLE_TIMEOUT_MS = Number(process.env.LIVE_MEASURE_SETTLE_TIMEOUT_MS ?? "180000");
const capture = createAdultOffLiveCapture();
const realFetch = globalThis.fetch;

function sseToRaw(text: string): { content: string; usage: unknown; finishReason: unknown } {
  let content = "";
  let usage: unknown = null;
  let finishReason: unknown = null;
  for (const block of text.split("\n\n")) {
    const line = block
      .split("\n")
      .map((part) => part.trim())
      .find((part) => part.startsWith("data:"));
    if (!line) continue;
    const json = line.slice(5).trim();
    if (!json || json === "[DONE]") continue;
    try {
      const row = JSON.parse(json) as {
        choices?: Array<{ delta?: { content?: string }; finish_reason?: unknown }>;
        usage?: unknown;
        cheaper_inference?: unknown;
      };
      const piece = row.choices?.[0]?.delta?.content;
      if (typeof piece === "string") content += piece;
      if (row.choices?.[0]?.finish_reason) finishReason = row.choices[0].finish_reason;
      if (row.usage) usage = { usage: row.usage, cheaper_inference: row.cheaper_inference ?? null };
    } catch {
      /* ignore non-JSON keepalive */
    }
  }
  return { content, usage, finishReason };
}

function installFetch(models: { luna: string }): void {
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url =
      typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
    if (!url.includes("/chat/completions")) {
      if (mode === "dry") return new Response("{}", { status: 200 });
      return realFetch(input, init);
    }
    const bodyText = typeof init?.body === "string" ? init.body : "";
    let model = "";
    let systemContent = "";
    try {
      const body = JSON.parse(bodyText) as {
        model?: unknown;
        messages?: Array<{ role?: string; content?: unknown }>;
      };
      model = String(body.model ?? "");
      const system = body.messages?.find((m) => m.role === "system");
      systemContent =
        typeof system?.content === "string" ? system.content : JSON.stringify(system?.content ?? "");
    } catch {
      /* keep defaults */
    }
    const kind =
      model === models.luna && systemContent.includes("독립 검수기")
        ? "classifier"
        : model === models.luna
          ? "other"
          : "main";
    if (mode === "dry") {
      lastDryBodyChars = Math.max(lastDryBodyChars, bodyText.length);
      return new Response(JSON.stringify({ error: { message: "dry-run estimate only" } }), {
        status: 500,
        headers: { "Content-Type": "application/json" },
      });
    }
    return capture.forward(realFetch, input, init, { kind, model });
  }) as typeof fetch;
}

async function readSse(
  response: Response,
  t0: number
): Promise<Array<{ atMs: number; event: Record<string, unknown> }>> {
  const events: Array<{ atMs: number; event: Record<string, unknown> }> = [];
  if (!response.body) return events;
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let idx = buffer.indexOf("\n\n");
    while (idx >= 0) {
      const block = buffer.slice(0, idx);
      buffer = buffer.slice(idx + 2);
      const line = block
        .split("\n")
        .map((part) => part.trim())
        .find((part) => part.startsWith("data:"));
      if (line) {
        const json = line.slice(5).trim();
        if (json && json !== "[DONE]") {
          try {
            events.push({ atMs: Date.now() - t0, event: JSON.parse(json) as Record<string, unknown> });
          } catch {
            /* ignore */
          }
        }
      }
      idx = buffer.indexOf("\n\n");
    }
  }
  return events;
}

type Estimate = {
  modelId: string;
  requestBodyChars: number;
  inputTokensUpper: number;
  outputTokensExpected: number;
  outputTokensUpper: number;
  inputUsdPerM: number;
  outputUsdPerM: number;
  expectedKrw: number;
  upperKrw: number;
  usdKrwEffective: number;
};

async function main(): Promise<void> {
  const startedIso = new Date().toISOString();
  installIsolatedTestDatabase();
  delete process.env.MOCK_MODE;
  process.env.ADULT_OFF_OUTPUT_GUARD_ENABLED = "1";
  if (!process.env.OPENROUTER_API_KEY?.trim() || !process.env.CHEAPER_INFERENCE_API_KEY?.trim()) {
    throw new Error("OPENROUTER_API_KEY and CHEAPER_INFERENCE_API_KEY are required for the live probe");
  }

  const models = await import("../src/lib/chatModels");
  const auth = await import("../src/lib/auth");
  const dbMod = await import("../src/lib/db");
  const points = await import("../src/lib/points");
  const selected = await import("../src/lib/userSelectedAI");
  const session = await import("../src/lib/chatSessionCreate");
  const pricing = await import("../src/lib/openRouterModelPricing");
  const route = await import("../src/app/api/chat/route");
  const messageRoute = await import("../src/app/api/chat/message/route");
  installFetch({ luna: models.CHEAPER_INFERENCE_GPT_6_LUNA_MODEL });

  const requested = (process.env.LIVE_MEASURE_MODELS ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  const modelOrder = (requested.length ? requested : [...models.MAIN_RP_MODEL_IDS]) as string[];

  let usdKrw = Number(process.env.LIVE_MEASURE_USD_KRW ?? "");
  if (!(usdKrw > 0)) {
    const fx = (await (await realFetch("https://open.er-api.com/v6/latest/USD")).json()) as {
      rates?: { KRW?: number };
    };
    usdKrw = Number(fx.rates?.KRW);
  }
  if (!(usdKrw > 0)) throw new Error("USD/KRW rate unavailable; refusing to estimate");
  const usdKrwEffective = usdKrw * 1.02;

  const fixture = loadCanonicalRpQualificationFixture(process.cwd());
  const seed = COMMON_PROSE_BODY_CUE_REVIEW_SCENE_SEEDS.find((row) => row.id === SEED_ID);
  if (!seed) throw new Error(`missing scene seed ${SEED_ID}`);

  const db = dbMod.getDb();
  db.prepare("INSERT INTO users (id, email, nickname, pw_hash) VALUES (?,?,?,?)").run(
    USER_ID,
    "adult-off-live-measure@example.com",
    CANONICAL_RP_QUALIFICATION_SOURCE.personaName,
    "x"
  );
  db.prepare(
    `INSERT INTO characters (id, name, greeting, nsfw, visibility, moderation_status, official, description, system_prompt)
     VALUES (?,?,?,?,?,?,?,?,?)`
  ).run(
    CHARACTER_ID,
    CANONICAL_RP_QUALIFICATION_SOURCE.characterName,
    fixture.openingAssistant,
    0,
    "public",
    "approved",
    0,
    "고정 시험용 라이크 스냅샷(2026-08-25, HISTORICAL_ONLY)",
    fixture.characterSetting
  );
  points.creditPoints(USER_ID, 200000, "FREE", "live measure fixture free");
  points.creditPoints(USER_ID, 200000, "PAID", "live measure fixture paid");
  sessionToken = auth.createSession(USER_ID);

  const newChat = () =>
    session.createChatSession({
      userId: USER_ID,
      characterId: CHARACTER_ID,
      greeting: fixture.openingAssistant,
      __testOnGreetingSchedule: () => {},
    });
  const post = (chatId: number, requestId: string) =>
    route.POST(
      new Request("http://localhost/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          characterId: CHARACTER_ID,
          chatId,
          message: seed.currentUserMessage,
          clientRequestId: requestId,
        }),
      })
    );

  mkdirSync(OUT_DIR, { recursive: true });
  let spentKrw = PRIOR_SPENT_KRW;
  const summary: Array<Record<string, unknown>> = [];
  const readLedger = (): MeasuredLedgerRow[] =>
    db
      .prepare(
        `SELECT provider_request_id, request_kind, model, event_status,
                input_tokens, output_tokens, actual_cost_usd, actual_cost_source
         FROM api_cost_ledger ORDER BY id ASC`
      )
      .all() as MeasuredLedgerRow[];
  const settleTurn = () =>
    capture.finish({
      listOwners: () => listOpenTurnTailWork(),
      readLedger,
      deadlineMs: SETTLE_TIMEOUT_MS,
    });

  for (const modelId of modelOrder) {
    selected.setUserSelectedAI(db, USER_ID, modelId as never);
    capture.reset();

    mode = "dry";
    lastDryBodyChars = 0;
    const dryChat = newChat();
    const dryResponse = await post(dryChat, `dry-${modelId}`);
    await readSse(dryResponse, Date.now());
    const dryReport = await settleTurn();
    const dryDecision = commitMeasuredLedger(dryReport, () => {
      db.prepare("DELETE FROM api_cost_ledger").run();
    });
    if (dryDecision === "incomplete") {
      summary.push({
        modelId,
        decision: "incomplete",
        phase: "dry",
        settle: { reason: dryReport.reason, calls: dryReport.calls, ledger: dryReport.ledger, cost: dryReport.cost },
      });
      break;
    }
    const rates = pricing.resolveOpenRouterModelRates(modelId);
    const inputTokensUpper = Math.ceil(lastDryBodyChars / 1.2);
    const targetChars = seed.targetResponseChars;
    const outputTokensExpected = Math.ceil(targetChars * 1.4 * 1.25) + 2000;
    const outputTokensUpper = Math.ceil(targetChars * 2.5 * 1.25) + 6000;
    const toKrw = (inputTokens: number, outputTokens: number) =>
      ((inputTokens * rates.inputUsdPerM + outputTokens * rates.outputUsdPerM) / 1_000_000) *
      usdKrwEffective;
    const classifierUpperKrw = (6000 * 0.07 + 400 * 0.35) / 1_000_000 * usdKrwEffective;
    const estimate: Estimate = {
      modelId,
      requestBodyChars: lastDryBodyChars,
      inputTokensUpper,
      outputTokensExpected,
      outputTokensUpper,
      inputUsdPerM: rates.inputUsdPerM,
      outputUsdPerM: rates.outputUsdPerM,
      expectedKrw: toKrw(inputTokensUpper, outputTokensExpected) + classifierUpperKrw,
      upperKrw: toKrw(inputTokensUpper, outputTokensUpper) + classifierUpperKrw,
      usdKrwEffective,
    };
    const remainingKrw = CAP_KRW - spentKrw;
    const entry: Record<string, unknown> = {
      modelId,
      estimate,
      spentBeforeKrw: spentKrw,
      remainingBeforeKrw: remainingKrw,
    };
    console.info(
      `[estimate] ${modelId} bodyChars=${lastDryBodyChars} expected=${estimate.expectedKrw.toFixed(1)}KRW upper=${estimate.upperKrw.toFixed(1)}KRW remaining=${remainingKrw.toFixed(1)}KRW`
    );
    if (process.env.LIVE_MEASURE_ESTIMATE_ONLY === "1") {
      entry.decision = "estimate_only";
      summary.push(entry);
      continue;
    }
    if (estimate.upperKrw > remainingKrw) {
      entry.decision = "skipped_budget";
      entry.note = "상한 견적이 남은 누적 예산을 넘겨 호출하지 않음 — 미검증";
      summary.push(entry);
      continue;
    }

    mode = "live";
    capture.reset();
    const balanceBefore = points.getPointBalance(USER_ID);
    const chatId = newChat();
    const requestId = `live-${modelId}-${Date.now()}`;
    const t0 = Date.now();
    const response = await post(chatId, requestId);
    const events = await readSse(response, t0);
    const totalMs = Date.now() - t0;
    const report = await settleTurn();
    mode = "dry";
    const captured = report.calls;

    const row = db
      .prepare(
        `SELECT id, content, generation_status, usage, model FROM messages
         WHERE chat_id=? AND role='assistant' AND IFNULL(model,'')!='greeting'
         ORDER BY id DESC LIMIT 1`
      )
      .get(chatId) as
      | { id: number; content: string; generation_status: string | null; usage: string | null; model: string | null }
      | undefined;
    const apiResponse = row
      ? await messageRoute.GET(new Request(`http://localhost/api/chat/message?messageId=${row.id}`))
      : null;
    const apiCheck =
      apiResponse && row
        ? checkMessageApiResponse({
            status: apiResponse.status,
            bodyText: await apiResponse.text(),
            storedContent: row.content,
          })
        : null;
    const ledger = report.ledger;
    const decision = commitMeasuredLedger(report, () => {
      db.prepare("DELETE FROM api_cost_ledger").run();
    });

    const main = captured.find((c) => c.kind === "main");
    const classifier = captured.filter((c) => c.kind === "classifier");
    const rawMain = main ? sseToRaw(main.responseText) : null;
    const mainLedgerRow = ledger.find((r) => r.request_kind === "main-rp");
    // 공급자가 비용을 보고하지 않은 호출(Sol/Opus)은 usage 토큰 × 카탈로그 단가로 추정하고 "추정"으로 따로 표시한다.
    let unreportedMainUsd = 0;
    if (mainLedgerRow?.actual_cost_usd == null && rawMain?.usage) {
      const u = (rawMain.usage as { usage?: Record<string, unknown> }).usage ?? {};
      unreportedMainUsd = estimateUsdFromUsage(u as UsageTokens, {
        inputUsdPerM: rates.inputUsdPerM,
        outputUsdPerM: rates.outputUsdPerM,
        cacheReadUsdPerM: pricing.resolveCacheReadUsdPerM(rates),
        cacheWriteUsdPerM: pricing.resolveCacheWriteUsdPerM(rates),
      });
    }
    const costClasses = classifyCostRows(
      ledger,
      new Map(unreportedMainUsd > 0 ? [["main-rp", unreportedMainUsd]] : [])
    );
    const knownUsd =
      costClasses.unconfirmedRows.length === 0
        ? costClasses.confirmedUsd + costClasses.estimatedUsd
        : null;
    const screenEvents = events.map((e) => e.event);
    const deliveredText = reconstructScreenText(screenEvents);
    const screenTimeline = reconstructScreenTimeline(events);
    const textEvents = events.filter((e) =>
      ["text", "delta", "content", "finalContent"].some((k) => typeof e.event[k] === "string")
    );
    const classifierDone = classifier.at(-1)?.endedAtMs ?? null;
    const firstTextAbs = textEvents[0] ? t0 + textEvents[0].atMs : null;
    const usageJson = row?.usage ? (JSON.parse(row.usage) as Record<string, unknown>) : null;
    const balanceAfter = points.getPointBalance(USER_ID);
    const knownPortionUsd = costClasses.confirmedUsd + costClasses.estimatedUsd;
    const costKrw = knownPortionUsd * usdKrwEffective;
    spentKrw += costKrw;

    Object.assign(entry, {
      decision,
      requestId,
      chatId,
      timings: {
        totalMs,
        providerStreamMs: main?.endedAtMs ? main.endedAtMs - main.startedAtMs : null,
        classifierMs: classifier.length
          ? (classifier.at(-1)!.endedAtMs ?? 0) - classifier[0].startedAtMs
          : null,
        firstTextEventAfterClassifierMs:
          firstTextAbs != null && classifierDone != null ? firstTextAbs - classifierDone : null,
        breakdown: splitLatency({
          totalMs,
          providerMs: main?.endedAtMs ? main.endedAtMs - main.startedAtMs : null,
          classifierMs: classifier.length
            ? (classifier.at(-1)!.endedAtMs ?? 0) - classifier[0].startedAtMs
            : null,
        }),
      },
      screen: { ...screenBeforeAndAfter(screenTimeline), reconstructedChars: deliveredText.length },
      sseEventTimeline: events.map((e) => ({ atMs: e.atMs, type: e.event.type ?? null, textChars: typeof e.event.text === "string" ? (e.event.text as string).length : undefined })),
      rawProviderOutput: { chars: rawMain?.content.length ?? 0, finishReason: rawMain?.finishReason ?? null, usage: rawMain?.usage ?? null, text: rawMain?.content ?? "" },
      guardCheck: {
        classifierRequests: classifier.length,
        classifierResponseStatus: classifier.map((c) => c.status),
        classifierResponseBody: classifier.map((c) => c.responseText),
        recordedDecision: usageJson?.adultOffGuard ?? null,
      },
      userDelivered: {
        status: row?.generation_status ?? null,
        screenTextChars: deliveredText.length,
        screenText: deliveredText,
        screenEqualsPersisted: row ? deliveredText === row.content : null,
        screenTextEventCount: textEvents.length,
        persistedChars: row?.content.length ?? 0,
        persistedText: row?.content ?? "",
        messageApi: apiCheck,
      },
      usageJson,
      billing: {
        pointsBefore: balanceBefore,
        pointsAfter: balanceAfter,
        chargedTotalPoints: balanceBefore.total - balanceAfter.total,
      },
      settle: { reason: report.reason, mayDeleteLedger: report.mayDeleteLedger },
      providerCalls: captured.map((call) => ({
        kind: call.kind,
        model: call.model,
        status: call.status,
        providerRequestId: call.providerRequestId,
        completionId: call.completionId,
        ledgerRequestKind: call.ledgerRequestKind,
        headerError: call.headerError,
        bodyError: call.bodyError,
        startedAtMs: call.startedAtMs,
        headerAtMs: call.headerAtMs,
        endedAtMs: call.endedAtMs,
        ...(call.kind === "main" ? {} : { responseText: call.responseText }),
      })),
      cost: {
        ledger,
        confirmedUsd: costClasses.confirmedUsd,
        estimatedUsd: costClasses.estimatedUsd,
        unconfirmedRows: costClasses.unconfirmedRows,
        knownUsd,
        knownKrw: knownUsd == null ? null : knownUsd * usdKrwEffective,
        knownPortionKrw: costKrw,
        spentAfterKrw: spentKrw,
        usdKrwEffective,
      },
    });
    summary.push(entry);
    writeFileSync(
      join(OUT_DIR, `${modelId.replace(/[^a-zA-Z0-9._-]+/g, "-")}.json`),
      JSON.stringify(entry, null, 2)
    );
    console.info(
      `[${decision}] ${modelId} status=${row?.generation_status} raw=${rawMain?.content.length}chars settle=${report.reason} calls=${captured.length} costKRW=${costKrw.toFixed(1)} spent=${spentKrw.toFixed(1)}`
    );
    if (decision === "incomplete") break;
  }

  writeFileSync(
    join(OUT_DIR, process.env.LIVE_MEASURE_ESTIMATE_ONLY === "1" ? "estimate.json" : "summary.json"),
    JSON.stringify({ startedIso, seedId: SEED_ID, capKrw: CAP_KRW, priorSpentKrw: PRIOR_SPENT_KRW, usdKrwEffective, summary }, null, 2)
  );
  uninstallIsolatedTestDatabase();
  Module._load = originalLoad;
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
