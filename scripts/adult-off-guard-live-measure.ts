/**
 * 성인 OFF 출력 검사 — 15+ 품질 실측(수동 live 프로브). 상시 실행 대상이 아니다.
 *
 * 격리 DB에서 실제 `POST /api/chat` 핸들러를 검사 ON 상태로 호출한다.
 * 모델당 1회, 재시도·자동 대체 호출 없음. 호출 직전에 현재 조건으로 견적을 다시 계산하고
 * 누적 한도를 넘길 것으로 예상되는 호출은 건너뛴다. 출력 목표·상한은 바꾸지 않는다.
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
  installIsolatedTestDatabase,
  uninstallIsolatedTestDatabase,
} from "../src/lib/test/isolatedTestDatabase";
import {
  CANONICAL_RP_QUALIFICATION_SOURCE,
  COMMON_PROSE_BODY_CUE_REVIEW_SCENE_SEEDS,
  loadCanonicalRpQualificationFixture,
} from "./lib/rpModelQualificationFixture";

const USER_ID = 91001;
const CHARACTER_ID = 91002;
const SEED_ID = "relationship_turn_safe";
const OUT_DIR = process.env.LIVE_MEASURE_OUT_DIR?.trim() || "docs/audits/adult-off-output-guard/live";
const PRIOR_SPENT_KRW = Number(process.env.LIVE_MEASURE_PRIOR_SPENT_KRW ?? "62");
const CAP_KRW = Number(process.env.LIVE_MEASURE_CAP_KRW ?? "1000");

type Mode = "dry" | "live";
let mode: Mode = "dry";
let lastDryBodyChars = 0;
const teeJobs: Array<Promise<void>> = [];
type Captured = {
  kind: "main" | "classifier" | "other";
  model: string;
  url: string;
  requestBodyChars: number;
  status: number;
  startedAtMs: number;
  endedAtMs: number | null;
  responseText: string;
};
let captured: Captured[] = [];
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
    const kind: Captured["kind"] =
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
    const entry: Captured = {
      kind,
      model,
      url,
      requestBodyChars: bodyText.length,
      status: 0,
      startedAtMs: Date.now(),
      endedAtMs: null,
      responseText: "",
    };
    captured.push(entry);
    const res = await realFetch(input, init);
    entry.status = res.status;
    const clone = res.clone();
    teeJobs.push(
      clone
        .text()
        .then((text) => {
          entry.responseText = text;
          entry.endedAtMs = Date.now();
        })
        .catch(() => {
          entry.endedAtMs = Date.now();
        })
    );
    return res;
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

  for (const modelId of modelOrder) {
    selected.setUserSelectedAI(db, USER_ID, modelId as never);

    mode = "dry";
    lastDryBodyChars = 0;
    const dryChat = newChat();
    const dryResponse = await post(dryChat, `dry-${modelId}`);
    await readSse(dryResponse, Date.now());
    await new Promise((resolve) => setTimeout(resolve, 150));
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
    captured = [];
    teeJobs.length = 0;
    const balanceBefore = points.getPointBalance(USER_ID);
    const chatId = newChat();
    const requestId = `live-${modelId}-${Date.now()}`;
    const t0 = Date.now();
    const response = await post(chatId, requestId);
    const events = await readSse(response, t0);
    const totalMs = Date.now() - t0;
    await Promise.all(teeJobs);
    await new Promise((resolve) => setTimeout(resolve, 400));
    mode = "dry";

    const row = db
      .prepare(
        `SELECT id, content, generation_status, usage, model FROM messages
         WHERE chat_id=? AND role='assistant' AND IFNULL(model,'')!='greeting'
         ORDER BY id DESC LIMIT 1`
      )
      .get(chatId) as
      | { id: number; content: string; generation_status: string | null; usage: string | null; model: string | null }
      | undefined;
    const apiBody = row
      ? await (await messageRoute.GET(new Request(`http://localhost/api/chat/message?messageId=${row.id}`))).text()
      : null;
    const ledger = db
      .prepare(
        `SELECT request_kind, model, actual_cost_usd, actual_cost_source, event_status, input_tokens, output_tokens
         FROM api_cost_ledger ORDER BY id ASC`
      )
      .all() as Array<{ request_kind: string; model: string; actual_cost_usd: number | null; actual_cost_source: string | null; event_status: string | null; input_tokens: number | null; output_tokens: number | null }>;
    const ledgerUsd = ledger.reduce((sum, r) => sum + (r.actual_cost_usd ?? 0), 0);
    db.prepare("DELETE FROM api_cost_ledger").run();

    const main = captured.find((c) => c.kind === "main");
    const classifier = captured.filter((c) => c.kind === "classifier");
    const rawMain = main ? sseToRaw(main.responseText) : null;
    const textEvents = events.filter((e) =>
      ["text", "delta", "content", "finalContent"].some((k) => typeof e.event[k] === "string")
    );
    const deliveredText = textEvents
      .map((e) => String(e.event.text ?? e.event.delta ?? e.event.content ?? e.event.finalContent ?? ""))
      .join("");
    const classifierDone = classifier.at(-1)?.endedAtMs ?? null;
    const firstTextAbs = textEvents[0] ? t0 + textEvents[0].atMs : null;
    const usageJson = row?.usage ? (JSON.parse(row.usage) as Record<string, unknown>) : null;
    const balanceAfter = points.getPointBalance(USER_ID);
    const costKrw = ledgerUsd * usdKrwEffective;
    spentKrw += costKrw;

    Object.assign(entry, {
      decision: "called",
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
      },
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
        sseTextChars: deliveredText.length,
        sseText: deliveredText,
        persistedChars: row?.content.length ?? 0,
        persistedText: row?.content ?? "",
        messageApiContainsPersisted: apiBody != null && row != null && row.content.length > 0 ? apiBody.includes(row.content.slice(0, 40)) : null,
      },
      usageJson,
      billing: {
        pointsBefore: balanceBefore,
        pointsAfter: balanceAfter,
        chargedTotalPoints: balanceBefore.total - balanceAfter.total,
      },
      cost: {
        ledger,
        ledgerUsd,
        ledgerKrwEffective: costKrw,
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
      `[called] ${modelId} status=${row?.generation_status} raw=${rawMain?.content.length}chars guard=${JSON.stringify(usageJson?.adultOffGuard ?? null)?.slice(0, 120)} costKRW=${costKrw.toFixed(1)} spent=${spentKrw.toFixed(1)}`
    );
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
