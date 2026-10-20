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

import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import {
  installIsolatedTestDatabase,
  uninstallIsolatedTestDatabase,
} from "@/lib/test/isolatedTestDatabase";
import {
  reconstructScreenText,
  reconstructScreenTimeline,
  screenBeforeAndAfter,
} from "../../scripts/lib/adultOffGuardEvidence";

/**
 * 합성 공급자 응답 + 분류기 스텁으로 노출·저장·정산 경로를 검증한다.
 * 분류 정확도는 검증하지 않는다. 제한 판정은 본문에 넣은 표식으로만 결정하는 스텁이다.
 */

const USER_ID = 88211;
const CHARACTER_ID = 88212;
const RESTRICT_MARK = "ZZ_SYNTHETIC_RESTRICTED_MARK";
const BLOCKED_MESSAGE =
  "이번 응답은 현재 방의 수위 기준을 넘어 전달하지 않았으며 포인트는 차감되지 않았습니다. 장면의 방향을 바꿔 다시 시도해 주세요.";
const CHECK_FAILED_MESSAGE =
  "이번 응답은 수위 확인을 마치지 못해 전달하지 않았으며 포인트는 차감되지 않았습니다. 잠시 후 다시 시도해 주세요.";
const PROVIDER_REFUSAL_MESSAGE = "이번 응답은 생성되지 않았으며 포인트는 차감되지 않았습니다.";

function longProse(seed: string): string {
  return Array.from({ length: 8 }, (_, index) => {
    const n = index + 1;
    return `${seed} 창가의 ${n}번째 호흡에서 번호 ${n * 13}의 고요만 남겼다.`;
  }).join(" ");
}

function longRefusal(): string {
  return [
    "죄송합니다. 요청하신 장면은 안전 가이드라인에 위배되어 작성할 수 없습니다. 다른 방향의 이야기라면 이어서 도와드리겠습니다.",
    ...Array.from({ length: 28 }, (_, index) => {
      const n = index + 1;
      return `${n}번째 안내로, 이번 요청의 장면 생성은 여기서 멈추고 새로운 상황 번호 ${n * 17}만 남깁니다.`;
    }),
  ].join(" ");
}

type MainScript = { text: string };
type ClassifierMode =
  | "allow"
  | "by_mark"
  | "http_error"
  | "invalid_json"
  | "contradiction"
  | "allow_with_paragraph"
  | "extra_field"
  | "low_confidence"
  | "timeout"
  | "unreadable_body";
type AuxHandler = (input: { model: string; system: string; user: string }) => string | null;

let mainScript: MainScript = { text: "" };
let classifierMode: ClassifierMode = "by_mark";
let mainCalls = 0;
let classifierCalls = 0;
let otherCompletionCalls = 0;
let otherLunaCalls = 0;
let providerRequestSerial = 0;
let classifierInputs: string[] = [];
let onClassifierCall: (() => void) | null = null;
let auxHandler: AuxHandler | null = null;
let auxCalls = 0;
let auxModels: string[] = [];
let classifierDelayFromCall: { fromCall: number; ms: number } | null = null;
let lastClassifierRequestIds: string[] = [];
let classifierRequestSerial = 0;

function sseResponse(text: string, cost: number, id: string): Response {
  const parts: string[] = [];
  for (let i = 0; i < text.length; i += 220) {
    parts.push(
      `data: ${JSON.stringify({
        choices: [{ index: 0, delta: { content: text.slice(i, i + 220) }, finish_reason: null }],
      })}\n\n`
    );
  }
  parts.push(
    `data: ${JSON.stringify({
      model: "google/gemini-4-argon",
      choices: [{ delta: {}, finish_reason: "stop", native_finish_reason: "STOP" }],
      usage: {
        prompt_tokens: 900,
        completion_tokens: 280,
        cost,
        cost_details: { upstream_inference_cost: cost },
      },
    })}\n\n`
  );
  parts.push("data: [DONE]\n\n");
  return new Response(parts.join(""), {
    status: 200,
    headers: { "Content-Type": "text/event-stream", "x-request-id": id },
  });
}

let currentClassifierRequestId = "";

async function classifierResponse(userContent: string): Promise<Response> {
  classifierCalls += 1;
  classifierRequestSerial += 1;
  const callNumber = classifierRequestSerial;
  currentClassifierRequestId = `classifier-${callNumber}`;
  classifierInputs.push(userContent);
  onClassifierCall?.();
  if (classifierDelayFromCall && classifierInputs.length >= classifierDelayFromCall.fromCall) {
    await new Promise((resolve) => setTimeout(resolve, classifierDelayFromCall!.ms));
  }
  if (classifierMode === "timeout") {
    throw new DOMException("The operation timed out.", "TimeoutError");
  }
  lastClassifierRequestIds.push(currentClassifierRequestId);
  const idHeaders = {
    "Content-Type": "application/json",
    "x-ci-request-id": currentClassifierRequestId,
  };
  if (classifierMode === "http_error") {
    return new Response(JSON.stringify({ error: { message: "upstream unavailable" } }), {
      status: 503,
      headers: idHeaders,
    });
  }
  if (classifierMode === "unreadable_body") {
    return new Response("<<< not json at all", { status: 200, headers: idHeaders });
  }
  let content: string;
  if (classifierMode === "invalid_json") {
    content = "이 응답은 안전합니다";
  } else if (classifierMode === "contradiction") {
    content = JSON.stringify({
      decision: "allow",
      category: "sexual_act",
      confidence: "high",
      first_paragraph: -1,
    });
  } else if (classifierMode === "allow_with_paragraph") {
    content = JSON.stringify({
      decision: "allow",
      category: "none",
      confidence: "high",
      first_paragraph: 3,
    });
  } else if (classifierMode === "extra_field") {
    content = JSON.stringify({
      decision: "allow",
      category: "none",
      confidence: "high",
      first_paragraph: -1,
      note: "looks fine",
    });
  } else if (classifierMode === "low_confidence") {
    content = JSON.stringify({
      decision: "allow",
      category: "none",
      confidence: "low",
      first_paragraph: -1,
    });
  } else {
    const restrict = classifierMode === "by_mark" && userContent.includes(RESTRICT_MARK);
    content = JSON.stringify(
      restrict
        ? { decision: "restrict", category: "sexual_act", confidence: "high", first_paragraph: 0 }
        : { decision: "allow", category: "none", confidence: "high", first_paragraph: -1 }
    );
  }
  return new Response(
    JSON.stringify({
      id: `classifier-${callNumber}`,
      model: "gpt-6-luna",
      choices: [{ index: 0, message: { role: "assistant", content }, finish_reason: "stop" }],
      usage: { prompt_tokens: 1500, completion_tokens: 20, cost: 0.0002 },
      cheaper_inference: {
        request_id: `classifier-${callNumber}`,
        billing: { status: "settled", billed_cost_usd: "0.000130", currency: "USD" },
      },
    }),
    { status: 200, headers: idHeaders }
  );
}

function auxCompletionResponse(text: string, id: string): Response {
  return new Response(
    JSON.stringify({
      id,
      model: "google/gemini-4-argon",
      choices: [{ index: 0, message: { role: "assistant", content: text }, finish_reason: "stop" }],
      usage: { prompt_tokens: 800, completion_tokens: 300, cost: 0.004 },
    }),
    { status: 200, headers: { "Content-Type": "application/json", "x-request-id": id } }
  );
}

async function readSse(response: Response): Promise<Array<Record<string, unknown>>> {
  const raw = await response.text();
  const events: Array<Record<string, unknown>> = [];
  for (const block of raw.split("\n\n")) {
    const line = block
      .split("\n")
      .map((part) => part.trim())
      .find((part) => part.startsWith("data:"));
    if (!line) continue;
    const json = line.slice(5).trim();
    if (!json || json === "[DONE]") continue;
    events.push(JSON.parse(json) as Record<string, unknown>);
  }
  return events;
}

type Harness = {
  post: (body: Record<string, unknown>) => Promise<{
    status: number;
    events: Array<Record<string, unknown>>;
  }>;
  balance: () => { total: number; paid: number; free: number };
  db: () => import("better-sqlite3").Database;
  newChat: () => number;
  getMessageApi: (messageId: number) => Promise<{
    status: number;
    raw: string;
    json: { content?: string; generationStatus?: string; usage?: Record<string, unknown> | null };
  }>;
};

let harness: Harness;
let previousNodeTestContext: string | undefined;
let requestSerial = 0;

function textBearingEvents(events: Array<Record<string, unknown>>) {
  return events.filter(
    (event) =>
      typeof event.text === "string" ||
      typeof event.delta === "string" ||
      typeof event.content === "string" ||
      typeof event.finalContent === "string"
  );
}

describe("adult-OFF output guard — production chat handler (synthetic provider + classifier stub)", () => {
  before(async () => {
    previousNodeTestContext = process.env.NODE_TEST_CONTEXT;
    delete process.env.NODE_TEST_CONTEXT;
    installIsolatedTestDatabase();
    process.env.OPENROUTER_API_KEY = "test-openrouter-fixture";
    process.env.CHEAPER_INFERENCE_API_KEY = "test-cheaper-fixture";
    process.env.ADULT_OFF_OUTPUT_GUARD_ENABLED = "1";
    delete process.env.MOCK_MODE;
    delete process.env.SPEECH_LOCK_NARRATION_LEXICON;

    const auth = await import("@/lib/auth");
    const dbMod = await import("@/lib/db");
    const points = await import("@/lib/points");
    const selected = await import("@/lib/userSelectedAI");
    const session = await import("@/lib/chatSessionCreate");
    const models = await import("@/lib/chatModels");
    const route = await import("@/app/api/chat/route");
    const messageRoute = await import("@/app/api/chat/message/route");
    const db = dbMod.getDb();
    db.prepare("INSERT INTO users (id, email, nickname, pw_hash) VALUES (?,?,?,?)").run(
      USER_ID,
      "adult-off-guard@example.com",
      "수위검사",
      "x"
    );
    db.prepare(
      `INSERT INTO characters (id, name, greeting, nsfw, visibility, moderation_status, official, description, system_prompt)
       VALUES (?,?,?,?,?,?,?,?,?)`
    ).run(
      CHARACTER_ID,
      "유나",
      "창가에서 천천히 고개를 돌렸다.",
      0,
      "public",
      "approved",
      0,
      "조용한 사람.",
      "한국어로 장면을 이어 쓴다."
    );
    points.creditPoints(USER_ID, 20000, "FREE", "fixture free");
    points.creditPoints(USER_ID, 20000, "PAID", "fixture paid");
    selected.setUserSelectedAI(db, USER_ID, models.GEMINI_4_ARGON_MODEL);
    sessionToken = auth.createSession(USER_ID);
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url =
        typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
      if (url.includes("/chat/completions")) {
        let model = "";
        let userContent = "";
        let systemContent = "";
        let streaming = false;
        if (typeof init?.body === "string") {
          try {
            const body = JSON.parse(init.body) as {
              model?: unknown;
              stream?: unknown;
              messages?: Array<{ role?: string; content?: unknown }>;
            };
            model = String(body.model ?? "");
            streaming = body.stream === true;
            const system = body.messages?.find((m) => m.role === "system");
            systemContent =
              typeof system?.content === "string" ? system.content : JSON.stringify(system?.content ?? "");
            const last = body.messages?.filter((m) => m.role === "user").at(-1);
            userContent = typeof last?.content === "string" ? last.content : JSON.stringify(last?.content ?? "");
          } catch {
            model = "";
          }
        }
        if (model === models.CHEAPER_INFERENCE_GPT_6_LUNA_MODEL) {
          if (systemContent.includes("독립 검수기")) return classifierResponse(userContent);
          const lunaAuxText =
            auxHandler?.({ model, system: systemContent, user: userContent }) ?? null;
          if (lunaAuxText != null) {
            auxCalls += 1;
            auxModels.push(model);
            providerRequestSerial += 1;
            return auxCompletionResponse(lunaAuxText, `aux-req-${providerRequestSerial}`);
          }
          otherLunaCalls += 1;
          return new Response("{}", { status: 500 });
        }
        if (model === "google/gemini-4-argon" && streaming) {
          mainCalls += 1;
          providerRequestSerial += 1;
          return sseResponse(mainScript.text, 0.01, `prov-req-${providerRequestSerial}`);
        }
        const auxText = auxHandler?.({ model, system: systemContent, user: userContent }) ?? null;
        if (auxText != null) {
          auxCalls += 1;
          auxModels.push(model);
          providerRequestSerial += 1;
          return auxCompletionResponse(auxText, `aux-req-${providerRequestSerial}`);
        }
        otherCompletionCalls += 1;
        return new Response("{}", { status: 500 });
      }
      return new Response("{}", {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }) as typeof fetch;

    harness = {
      db: () => db,
      balance: () => points.getPointBalance(USER_ID),
      newChat: () =>
        session.createChatSession({
          userId: USER_ID,
          characterId: CHARACTER_ID,
          greeting: "창가에서 천천히 고개를 돌렸다.",
          __testOnGreetingSchedule: () => {},
        }),
      post: async (body) => {
        const response = await route.POST(
          new Request("http://localhost/api/chat", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(body),
          })
        );
        const events = response.body ? await readSse(response) : [];
        await new Promise((resolve) => setTimeout(resolve, 200));
        return { status: response.status, events };
      },
      getMessageApi: async (messageId) => {
        const response = await messageRoute.GET(
          new Request(`http://localhost/api/chat/message?messageId=${messageId}`)
        );
        const raw = await response.text();
        return { status: response.status, raw, json: JSON.parse(raw) };
      },
    };
  });

  after(() => {
    uninstallIsolatedTestDatabase();
    Module._load = originalLoad;
    delete process.env.OPENROUTER_API_KEY;
    delete process.env.CHEAPER_INFERENCE_API_KEY;
    delete process.env.ADULT_OFF_OUTPUT_GUARD_ENABLED;
    if (previousNodeTestContext == null) delete process.env.NODE_TEST_CONTEXT;
    else process.env.NODE_TEST_CONTEXT = previousNodeTestContext;
  });

  function resetCounters() {
    mainCalls = 0;
    classifierCalls = 0;
    otherCompletionCalls = 0;
    otherLunaCalls = 0;
    classifierInputs = [];
    onClassifierCall = null;
    auxHandler = null;
    auxCalls = 0;
    auxModels = [];
    classifierDelayFromCall = null;
    lastClassifierRequestIds = [];
  }

  function assistantRow(chatId: number) {
    return harness.db()
      .prepare(
        `SELECT id, content, generation_status, usage FROM messages
         WHERE chat_id=? AND role='assistant' AND IFNULL(model,'')!='greeting'
         ORDER BY id DESC LIMIT 1`
      )
      .get(chatId) as
      | { id: number; content: string; generation_status: string | null; usage: string | null }
      | undefined;
  }

  function mainLedger(messageId: number) {
    return harness.db()
      .prepare(
        `SELECT request_kind, actual_cost_usd, event_status FROM api_cost_ledger
         WHERE assistant_message_id=? AND request_kind='main-rp' ORDER BY id ASC`
      )
      .all(messageId) as Array<{
      request_kind: string;
      actual_cost_usd: number | null;
      event_status: string | null;
    }>;
  }

  function moderationLedger() {
    return harness.db()
      .prepare(
        `SELECT request_kind, actual_cost_usd, event_status FROM api_cost_ledger
         WHERE request_kind='adult-off-output-moderation' ORDER BY id ASC`
      )
      .all() as Array<{ request_kind: string; actual_cost_usd: number | null; event_status: string | null }>;
  }

  type ModerationRow = {
    chat_id: number | null;
    assistant_message_id: number | null;
    generation_sequence: number | null;
    generation_request_id: string | null;
    family: string | null;
    funding_class: string | null;
    execution_phase: string | null;
    cost_center: string | null;
    provider_request_id: string | null;
    event_status: string | null;
    actual_cost_usd: number | null;
  };

  function moderationRows(messageId: number): ModerationRow[] {
    return harness.db()
      .prepare(
        `SELECT chat_id, assistant_message_id, generation_sequence, generation_request_id, family,
                funding_class, execution_phase, cost_center, provider_request_id, event_status,
                actual_cost_usd
           FROM api_cost_ledger
          WHERE assistant_message_id=? AND request_kind='adult-off-output-moderation'
          ORDER BY id ASC`
      )
      .all(messageId) as ModerationRow[];
  }

  type GuardEvidence = {
    finalStatus?: string;
    classifierCalls?: number;
    moderationCostUsd?: number;
    lowConfidenceAllow?: boolean;
    checks?: Array<{
      stage: string;
      status: string;
      reason?: string;
      calls: Array<{
        outcome: string;
        httpStatus: number | null;
        providerRequestId: string | null;
        costUsd: number | null;
      }>;
    }>;
  };

  function guardEvidence(row: { usage: string | null } | undefined): GuardEvidence | undefined {
    return (JSON.parse(row?.usage ?? "{}") as { adultOffGuard?: GuardEvidence }).adultOffGuard;
  }

  /** SSE 의 replace/delta/append 의미대로 최종 화면 본문을 재구성한다(단순 연결 금지). */
  async function runBlockedLikeTurn(input: {
    mode: ClassifierMode;
    expectedMessage: string;
    expectedFailure: "adult_output_blocked" | "adult_output_check_failed";
    expectedGuardStatus: "blocked" | "check_failed";
  }) {
    const marked = `${longProse("두 사람은 창가에 남아 이야기를 이어갔다.")} ${RESTRICT_MARK}`;
    classifierMode = input.mode;
    mainScript = { text: marked };
    resetCounters();
    const before = harness.balance();
    const chatId = harness.newChat();
    let rowDuringCheck: { content: string; generation_status: string | null } | undefined;
    onClassifierCall = () => {
      const row = assistantRow(chatId);
      rowDuringCheck = row ? { content: row.content, generation_status: row.generation_status } : undefined;
    };
    const requestId = `adult-off-${input.expectedGuardStatus}-${++requestSerial}`;
    const result = await harness.post({
      characterId: CHARACTER_ID,
      chatId,
      message: "창가에서 손을 잡고 잠시 머물자.",
      clientRequestId: requestId,
    });
    const after = harness.balance();
    const row = assistantRow(chatId);
    const error = result.events.find((event) => event.type === "error");

    assert.equal(result.status, 200);
    assert.equal(error?.error, input.expectedMessage);
    assert.deepEqual(textBearingEvents(result.events).filter((e) => e.type !== "error" && e.type !== "turn_persisted").map((e) => e.type), []);
    assert.ok(!JSON.stringify(result.events).includes(RESTRICT_MARK));
    assert.ok(!JSON.stringify(result.events).includes("창가의 1번째 호흡"));
    assert.equal(mainCalls, 1);
    assert.equal(otherCompletionCalls, 0);
    assert.equal(otherLunaCalls, 0);
    assert.ok(classifierCalls >= 1);

    assert.ok(rowDuringCheck, "assistant placeholder must exist while the check is running");
    assert.equal(rowDuringCheck?.content ?? "", "");
    assert.notEqual(rowDuringCheck?.generation_status, "completed");

    assert.equal(row?.content ?? "", "");
    assert.equal(row?.generation_status, "failed");
    const usage = JSON.parse(row?.usage ?? "{}") as {
      generationFailure?: string;
      adultOffGuard?: { finalStatus?: string; classifierCalls?: number };
    };
    assert.equal(usage.generationFailure, input.expectedFailure);
    assert.equal(usage.adultOffGuard?.finalStatus, input.expectedGuardStatus);
    assert.doesNotMatch(row?.usage ?? "", new RegExp(RESTRICT_MARK));

    const api = await harness.getMessageApi(row!.id);
    assert.equal(api.status, 200);
    assert.equal(api.json.content ?? "", "");
    assert.ok(!api.raw.includes(RESTRICT_MARK));
    assert.ok(!api.raw.includes("창가의 1번째 호흡"));

    assert.deepEqual(after, before);
    const ledger = mainLedger(row!.id);
    assert.equal(ledger.length, 1);
    assert.equal(ledger[0]?.event_status, "failed_with_usage");
    assert.ok((ledger[0]?.actual_cost_usd ?? 0) > 0);
    const underRecovered = harness.db()
      .prepare("SELECT COUNT(*) AS n FROM chat_billing_settlements WHERE outcome='under_recovered'")
      .get() as { n: number };
    assert.equal(underRecovered.n, 0);
    const waived = harness.db()
      .prepare("SELECT COUNT(*) AS n FROM chat_billing_settlements WHERE outcome='waived'")
      .get() as { n: number };
    assert.ok(waived.n >= 1);

    const callsAfterTurn = { main: mainCalls, classifier: classifierCalls };
    const replay = await harness.post({
      characterId: CHARACTER_ID,
      chatId,
      message: "창가에서 손을 잡고 잠시 머물자.",
      clientRequestId: requestId,
    });
    assert.equal(replay.events.find((event) => event.type === "error")?.error, input.expectedMessage);
    assert.equal(mainCalls, callsAfterTurn.main);
    assert.equal(classifierCalls, callsAfterTurn.classifier);
    assert.deepEqual(harness.balance(), before);
    assert.equal(mainLedger(row!.id).length, 1);
    return { chatId, row: row! };
  }

  it("blocks restricted output: nothing delivered or stored, 0P, provider cost kept, no follow-ups", async () => {
    await runBlockedLikeTurn({
      mode: "by_mark",
      expectedMessage: BLOCKED_MESSAGE,
      expectedFailure: "adult_output_blocked",
      expectedGuardStatus: "blocked",
    });
    assert.ok(moderationLedger().length >= 1);
  });

  it("fails closed when the classifier errors, returns invalid JSON, or contradicts itself", async () => {
    for (const mode of ["http_error", "invalid_json", "contradiction"] as const) {
      await runBlockedLikeTurn({
        mode,
        expectedMessage: CHECK_FAILED_MESSAGE,
        expectedFailure: "adult_output_check_failed",
        expectedGuardStatus: "check_failed",
      });
      assert.equal(classifierCalls, 1, `${mode}: single attempt, no automatic retry`);
    }
  });

  it("approves normal romance: text is released only after the check, saved, and billed", async () => {
    const text = longProse("그는 그녀의 손을 잡고 가벼운 입맞춤 뒤 감정만 이어가자고 말했다.");
    classifierMode = "by_mark";
    mainScript = { text };
    resetCounters();
    const before = harness.balance();
    const chatId = harness.newChat();
    let contentAtCheck: string | undefined;
    onClassifierCall = () => {
      contentAtCheck = assistantRow(chatId)?.content ?? "";
    };
    const result = await harness.post({
      characterId: CHARACTER_ID,
      chatId,
      message: "장면을 이어 가자.",
      clientRequestId: `adult-off-approved-${++requestSerial}`,
    });
    const row = assistantRow(chatId);
    assert.equal(result.events.some((event) => event.type === "done"), true);
    assert.equal(row?.generation_status, "completed");
    assert.match(row?.content ?? "", /입맞춤/);
    assert.equal(contentAtCheck, "", "no body persisted before approval");
    assert.equal(classifierCalls, 1);
    assert.equal(mainCalls, 1);
    assert.ok(harness.balance().total < before.total);
    const delivered = textBearingEvents(result.events)
      .map((event) => String(event.text ?? event.delta ?? event.content ?? ""))
      .join("\n");
    assert.match(delivered, /입맞춤/);
    const usage = JSON.parse(row?.usage ?? "{}") as { generationFailure?: string };
    assert.equal(usage.generationFailure, undefined);
    assert.equal(
      classifierInputs.every((input) => input.startsWith("<reply_under_review>")),
      true
    );
  });

  it("provider refusal under the guard keeps its own cause and never reaches the classifier", async () => {
    classifierMode = "allow";
    mainScript = { text: longRefusal() };
    resetCounters();
    const before = harness.balance();
    const chatId = harness.newChat();
    const result = await harness.post({
      characterId: CHARACTER_ID,
      chatId,
      message: "오늘 대화만 이어가자.",
      clientRequestId: `adult-off-refusal-${++requestSerial}`,
    });
    const row = assistantRow(chatId);
    const usage = JSON.parse(row?.usage ?? "{}") as { generationFailure?: string };
    assert.equal(result.events.find((event) => event.type === "error")?.error, PROVIDER_REFUSAL_MESSAGE);
    assert.equal(usage.generationFailure, "model_refusal");
    assert.equal(classifierCalls, 0);
    assert.equal(mainCalls, 1);
    assert.deepEqual(harness.balance(), before);
    assert.equal(row?.content ?? "", "");
  });

  it("guard OFF leaves the turn untouched (no classifier call, normal streaming)", async () => {
    process.env.ADULT_OFF_OUTPUT_GUARD_ENABLED = "0";
    try {
      classifierMode = "by_mark";
      mainScript = { text: `${longProse("창가에 남은 두 사람.")} ${RESTRICT_MARK}` };
      resetCounters();
      const chatId = harness.newChat();
      const result = await harness.post({
        characterId: CHARACTER_ID,
        chatId,
        message: "장면을 이어 가자.",
        clientRequestId: `adult-off-disabled-${++requestSerial}`,
      });
      const row = assistantRow(chatId);
      assert.equal(classifierCalls, 0);
      assert.equal(result.events.some((event) => event.type === "done"), true);
      assert.equal(row?.generation_status, "completed");
    } finally {
      process.env.ADULT_OFF_OUTPUT_GUARD_ENABLED = "1";
    }
  });

  it("links every classifier call to the turn ledger and records evidence on approved turns", async () => {
    const text = longProse("그는 그녀의 손을 잡고 가벼운 입맞춤 뒤 감정만 이어가자고 말했다.");
    classifierMode = "by_mark";
    mainScript = { text };
    resetCounters();
    const before = harness.balance();
    const chatId = harness.newChat();
    const result = await harness.post({
      characterId: CHARACTER_ID,
      chatId,
      message: "장면을 이어 가자.",
      clientRequestId: `adult-off-evidence-${++requestSerial}`,
    });
    const row = assistantRow(chatId)!;
    assert.equal(row.generation_status, "completed");

    const rows = moderationRows(row.id);
    assert.equal(rows.length, 1);
    const main = harness.db()
      .prepare(
        `SELECT generation_sequence, generation_request_id FROM api_cost_ledger
          WHERE assistant_message_id=? AND request_kind='main-rp' ORDER BY id DESC LIMIT 1`
      )
      .get(row.id) as { generation_sequence: number; generation_request_id: string | null } | undefined;
    assert.ok(main, "main-rp ledger row exists for the turn");
    assert.equal(rows[0].chat_id, chatId);
    assert.equal(rows[0].assistant_message_id, row.id);
    assert.equal(rows[0].generation_sequence, main.generation_sequence);
    assert.equal(rows[0].generation_request_id, main.generation_request_id);
    assert.equal(rows[0].cost_center, "moderation");
    assert.equal(rows[0].funding_class, "platform_funded");
    assert.equal(rows[0].event_status, "settled");
    assert.equal(rows[0].provider_request_id, lastClassifierRequestIds[0]);
    assert.ok((rows[0].actual_cost_usd ?? 0) > 0);

    const evidence = guardEvidence(row);
    assert.equal(evidence?.finalStatus, "approved");
    assert.equal(evidence?.classifierCalls, 1);
    assert.ok((evidence?.moderationCostUsd ?? 0) > 0);
    assert.deepEqual(
      evidence?.checks?.map((check) => [check.stage, check.status]),
      [
        ["pre_postprocess", "approved"],
        ["final", "reused_approval"],
      ]
    );
    assert.equal(evidence?.checks?.[0].calls[0].providerRequestId, rows[0].provider_request_id);

    const api = await harness.getMessageApi(row.id);
    assert.equal(api.status, 200);
    assert.equal(api.json.content, row.content, "message API content equals the stored body");
    assert.equal(api.json.generationStatus, "completed");
    assert.ok(!api.raw.includes("adultOffGuard"), "internal evidence never reaches the message API");
    const done = result.events.find((event) => event.type === "done");
    assert.ok(!JSON.stringify(done).includes("adultOffGuard"), "internal evidence never reaches SSE");

    assert.equal(
      reconstructScreenText(result.events),
      row.content,
      "final on-screen body equals the stored body"
    );
    const screenView = screenBeforeAndAfter(
      reconstructScreenTimeline(result.events.map((event, index) => ({ atMs: index, event })))
    );
    assert.equal(screenView.charsBeforeFirstBodyEvent, 0, "screen is empty before approval");
    assert.equal(screenView.charsAtEnd, row.content.length, "screen shows the full body after approval");
    assert.ok(
      result.events.findIndex((event) => event.type === "status" || event.type === "stream_heartbeat") <
        result.events.findIndex((event) => event.type === "replace"),
      "only notices precede the approved body"
    );
    assert.ok(harness.balance().total < before.total, "approved turn is billed as before");
  });

  it("keeps ids, usage and ledger rows when the classifier call fails in each way", async () => {
    const cases: Array<{
      mode: ClassifierMode;
      outcome: string;
      ledgerStatus: string;
      hasProviderId: boolean;
      hasCost: boolean;
      httpStatus: number | null;
    }> = [
      { mode: "http_error", outcome: "http_error", ledgerStatus: "failed_without_usage", hasProviderId: true, hasCost: false, httpStatus: 503 },
      { mode: "timeout", outcome: "timeout", ledgerStatus: "failed_without_usage", hasProviderId: false, hasCost: false, httpStatus: null },
      { mode: "unreadable_body", outcome: "invalid_response_json", ledgerStatus: "failed_without_usage", hasProviderId: true, hasCost: false, httpStatus: 200 },
      { mode: "invalid_json", outcome: "invalid_output", ledgerStatus: "settled", hasProviderId: true, hasCost: true, httpStatus: null },
    ];
    for (const item of cases) {
      const { row } = await runBlockedLikeTurn({
        mode: item.mode,
        expectedMessage: CHECK_FAILED_MESSAGE,
        expectedFailure: "adult_output_check_failed",
        expectedGuardStatus: "check_failed",
      });
      const rows = moderationRows(row.id);
      assert.equal(rows.length, 1, `${item.mode}: one ledger row, no retry`);
      assert.equal(rows[0].event_status, item.ledgerStatus, item.mode);
      assert.equal(rows[0].assistant_message_id, row.id, item.mode);
      assert.equal(rows[0].cost_center, "moderation", item.mode);
      assert.equal(rows[0].provider_request_id != null, item.hasProviderId, item.mode);
      assert.equal((rows[0].actual_cost_usd ?? 0) > 0, item.hasCost, item.mode);
      const call = guardEvidence(row)?.checks?.[0].calls[0];
      assert.ok(call, `${item.mode}: failed call usage is preserved in the turn evidence`);
      assert.equal(call.outcome, item.outcome, item.mode);
      assert.equal(call.httpStatus, item.httpStatus, item.mode);
      assert.equal(call.providerRequestId, rows[0].provider_request_id, item.mode);
      assert.equal(call.costUsd != null && call.costUsd > 0, item.hasCost, item.mode);
    }
  });

  it("does not approve contradictory, extra-field or low-confidence verdicts and never re-calls", async () => {
    for (const mode of ["allow_with_paragraph", "extra_field", "low_confidence"] as const) {
      const { row } = await runBlockedLikeTurn({
        mode,
        expectedMessage: CHECK_FAILED_MESSAGE,
        expectedFailure: "adult_output_check_failed",
        expectedGuardStatus: "check_failed",
      });
      assert.equal(classifierCalls, 1, `${mode}: single attempt`);
      const evidence = guardEvidence(row);
      assert.equal(evidence?.lowConfidenceAllow, mode === "low_confidence", mode);
      assert.equal(
        evidence?.checks?.[0].reason,
        mode === "low_confidence" ? "low_confidence_allow" : "invalid_classifier_output",
        mode
      );
    }
  });

  describe("text-changing steps after the first check", () => {
    const REWRITE_CLEAN = longProse("그는 낮은 목소리로 이야기를 이어갔다.");
    const REWRITE_SENTINEL = "REWRITE_ONLY_SENTINEL_TEXT";

    function lexiconRaw(): string {
      return `${longProse("두 사람은 창가에 남아 이야기를 이어갔다.")} 그는 반말로 속삭였다.`;
    }

    const isLexiconRewriteRequest = (user: string) => user.includes("[NARRATION LEXICON REWRITE]");
    let restoreBudget: (() => void) | null = null;

    // 현재 main 은 Main RP 1회 호출 불변식 때문에 어휘 재작성이 항상 예산 초과로 건너뛰어진다.
    // 이 경로가 되살아나도(불변식 변경) 최종 게이트가 막는지 보려고 이 describe 안에서만 예산을 연다.
    before(async () => {
      process.env.SPEECH_LOCK_NARRATION_LEXICON = "1";
      process.env.SPEECH_LOCK_NARRATION_LEXICON_LEON_ONLY = "0";
      const { TurnApiBudget } = await import("@/lib/turnApiBudget");
      const originalCanSubCall = TurnApiBudget.prototype.canSubCall;
      const originalBeforeFetch = TurnApiBudget.prototype.beforeFetch;
      TurnApiBudget.prototype.canSubCall = () => true;
      TurnApiBudget.prototype.beforeFetch = () => {};
      restoreBudget = () => {
        TurnApiBudget.prototype.canSubCall = originalCanSubCall;
        TurnApiBudget.prototype.beforeFetch = originalBeforeFetch;
      };
    });
    after(() => {
      restoreBudget?.();
      delete process.env.SPEECH_LOCK_NARRATION_LEXICON;
      delete process.env.SPEECH_LOCK_NARRATION_LEXICON_LEON_ONLY;
    });

    it("re-checks a lexicon rewrite and delivers it only after the second approval", async () => {
      classifierMode = "by_mark";
      mainScript = { text: lexiconRaw() };
      resetCounters();
      auxHandler = ({ user }) =>
        isLexiconRewriteRequest(user) ? `${REWRITE_CLEAN} ${REWRITE_SENTINEL}` : null;
      const chatId = harness.newChat();
      const result = await harness.post({
        characterId: CHARACTER_ID,
        chatId,
        message: "장면을 이어 가자.",
        clientRequestId: `adult-off-lexicon-ok-${++requestSerial}`,
      });
      const row = assistantRow(chatId)!;
      assert.equal(auxCalls, 1, "the lexicon rewrite ran once");
      assert.equal(classifierCalls, 2, "raw text and the rewritten text were each checked");
      assert.equal(row.generation_status, "completed");
      assert.match(row.content, new RegExp(REWRITE_SENTINEL));
      assert.equal(reconstructScreenText(result.events), row.content);
      const evidence = guardEvidence(row);
      assert.deepEqual(
        evidence?.checks?.map((check) => [check.stage, check.status]),
        [
          ["pre_postprocess", "approved"],
          ["final", "approved"],
        ]
      );
      assert.equal(evidence?.classifierCalls, 2);
      assert.equal(moderationRows(row.id).length, 2);
    });

    it("never reuses the earlier approval for a rewrite that introduces restricted text", async () => {
      classifierMode = "by_mark";
      mainScript = { text: lexiconRaw() };
      resetCounters();
      auxHandler = ({ user }) =>
        isLexiconRewriteRequest(user)
          ? `${REWRITE_CLEAN} ${REWRITE_SENTINEL} ${RESTRICT_MARK}`
          : null;
      classifierDelayFromCall = { fromCall: 2, ms: 1100 };
      const before = harness.balance();
      const chatId = harness.newChat();
      const contentAtCall: string[] = [];
      onClassifierCall = () => {
        contentAtCall.push(assistantRow(chatId)?.content ?? "");
      };
      const result = await harness.post({
        characterId: CHARACTER_ID,
        chatId,
        message: "장면을 이어 가자.",
        clientRequestId: `adult-off-lexicon-block-${++requestSerial}`,
      });
      const row = assistantRow(chatId)!;
      assert.equal(classifierCalls, 2);
      assert.equal(auxCalls, 1);
      assert.equal(
        contentAtCall[1].includes(REWRITE_SENTINEL),
        false,
        "the unreviewed rewrite is not persisted (partial timer included) while the second check runs"
      );
      assert.equal(row.generation_status, "failed");
      assert.equal(row.content, "");
      assert.ok(!JSON.stringify(result.events).includes(REWRITE_SENTINEL));
      assert.ok(!JSON.stringify(result.events).includes(RESTRICT_MARK));
      assert.equal(
        result.events.find((event) => event.type === "error")?.error,
        BLOCKED_MESSAGE
      );
      const api = await harness.getMessageApi(row.id);
      assert.equal(api.status, 200);
      assert.equal(api.json.content ?? "", "");
      assert.ok(!api.raw.includes(REWRITE_SENTINEL));
      assert.deepEqual(harness.balance(), before, "blocked turn costs the user 0P");
      assert.equal(guardEvidence(row)?.finalStatus, "blocked");
      assert.equal(moderationRows(row.id).length, 2);
      const mainRow = mainLedger(row.id);
      assert.equal(mainRow.length, 1);
      assert.equal(mainRow[0].event_status, "failed_with_usage");
    });
  });

  describe("HTML / flash-only turns", () => {
    const FLASH_MESSAGE = "HTML 카드로 입력한 내용만 띄워줘: 오늘의 안부를 전합니다.";
    const FLASH_HTML_CLEAN = `\`\`\`html\n<div class="card"><p>${longProse("오늘도 조용한 하루였습니다.")}</p></div>\n\`\`\``;
    const FLASH_HTML_BLOCKED = `\`\`\`html\n<div class="card"><p>${longProse("오늘도 조용한 하루였습니다.")} ${RESTRICT_MARK}</p></div>\n\`\`\``;

    it("checks the generated HTML card text; restricted card text is never delivered or stored", async () => {
      classifierMode = "by_mark";
      mainScript = { text: "should not be called" };
      resetCounters();
      auxHandler = () => FLASH_HTML_BLOCKED;
      const before = harness.balance();
      const chatId = harness.newChat();
      const result = await harness.post({
        characterId: CHARACTER_ID,
        chatId,
        message: FLASH_MESSAGE,
        clientRequestId: `adult-off-flash-block-${++requestSerial}`,
      });
      const row = assistantRow(chatId)!;
      assert.equal(mainCalls, 0, "flash-only turn skips the main provider");
      assert.ok(auxCalls >= 1, "the flash HTML generation ran");
      assert.ok(classifierCalls >= 1, "flash-only output is inside the approval scope");
      assert.ok(!JSON.stringify(result.events).includes(RESTRICT_MARK));
      assert.ok(!JSON.stringify(result.events).includes("조용한 하루"));
      assert.equal(row.content ?? "", "");
      assert.equal(row.generation_status, "failed");
      assert.equal(result.events.find((event) => event.type === "error")?.error, BLOCKED_MESSAGE);
      assert.deepEqual(harness.balance(), before);
      const api = await harness.getMessageApi(row.id);
      assert.equal(api.status, 200);
      assert.ok(!api.raw.includes(RESTRICT_MARK));
      assert.equal(guardEvidence(row)?.finalStatus, "blocked");
    });

    it("delivers an approved HTML card only after the check, equal to the stored body", async () => {
      classifierMode = "by_mark";
      mainScript = { text: "should not be called" };
      resetCounters();
      auxHandler = () => FLASH_HTML_CLEAN;
      const chatId = harness.newChat();
      let contentAtCheck: string | undefined;
      onClassifierCall = () => {
        contentAtCheck = assistantRow(chatId)?.content ?? "";
      };
      const result = await harness.post({
        characterId: CHARACTER_ID,
        chatId,
        message: FLASH_MESSAGE,
        clientRequestId: `adult-off-flash-ok-${++requestSerial}`,
      });
      const row = assistantRow(chatId)!;
      assert.equal(mainCalls, 0);
      assert.ok(classifierCalls >= 1);
      assert.equal(contentAtCheck, "", "nothing persisted before the HTML card is approved");
      assert.equal(row.generation_status, "completed");
      assert.match(row.content, /오늘도 조용한 하루였습니다/);
      const screen = reconstructScreenText(result.events);
      assert.equal(screen, row.content);
      const api = await harness.getMessageApi(row.id);
      assert.equal(api.status, 200);
      assert.equal(api.json.content, row.content);
      assert.equal(guardEvidence(row)?.finalStatus, "approved");
    });
  });

  describe("user-visible status widget values", () => {
    const widgetJson = JSON.stringify({
      version: 1,
      name: "장면",
      placement: "bottom",
      htmlTemplate: "{{장소}}",
      fields: [{ id: "장소", label: "장소", instruction: "현재 장소" }],
    });
    const body = longProse("그는 가볍게 입을 맞추고 그녀를 안았다.");

    function widgetPayload(place: string): string {
      return JSON.stringify({
        character_values: { 장소: place },
        user_values: {},
        extracted_facts: [{ summary: "INTERNAL_MEMORY_SENTINEL" }],
      });
    }

    before(() => {
      harness.db().prepare("UPDATE characters SET status_widget_json=? WHERE id=?").run(
        widgetJson,
        CHARACTER_ID
      );
    });

    after(() => {
      harness.db().prepare("UPDATE characters SET status_widget_json='' WHERE id=?").run(CHARACTER_ID);
    });

    it("keeps approved romance and an approved widget value, and withholds only a restricted value", async () => {
      classifierMode = "by_mark";
      mainScript = { text: body };
      resetCounters();
      auxHandler = () => widgetPayload("창가 앞");
      const cleanBefore = harness.balance();
      const cleanChat = harness.newChat();
      const clean = await harness.post({
        characterId: CHARACTER_ID,
        chatId: cleanChat,
        message: "장면을 이어 가자.",
        clientRequestId: `adult-off-widget-ok-${++requestSerial}`,
      });
      const cleanRow = assistantRow(cleanChat)!;
      const cleanDelta = cleanBefore.total - harness.balance().total;
      const cleanDone = clean.events.find((event) => event.type === "done");
      assert.equal(cleanRow.generation_status, "completed");
      assert.match(cleanRow.content, /입을 맞추고/);
      assert.match(cleanRow.content, /안았다/);
      assert.equal(
        (cleanDone?.statusWidgetValues as { character?: { 장소?: string } } | null)?.character?.장소,
        "창가 앞"
      );
      assert.ok(!JSON.stringify(clean.events).includes("INTERNAL_MEMORY_SENTINEL"));
      assert.ok(!classifierInputs.some((input) => input.includes("INTERNAL_MEMORY_SENTINEL")));
      const cleanEvidence = guardEvidence(cleanRow);
      const widgetCheck = cleanEvidence?.checks?.find((check) => check.stage === "status_widget");
      assert.equal(widgetCheck?.status, "approved");
      assert.equal(widgetCheck?.classifierCalls, 1);
      assert.ok((widgetCheck?.checkMs ?? -1) >= 0);
      assert.equal(moderationRows(cleanRow.id).length, classifierCalls);
      assert.ok(cleanDelta > 0);

      resetCounters();
      auxHandler = () => widgetPayload(`창가 앞 ${RESTRICT_MARK}`);
      const auxBefore = harness.balance();
      const auxChat = harness.newChat();
      const aux = await harness.post({
        characterId: CHARACTER_ID,
        chatId: auxChat,
        message: "장면을 이어 가자.",
        clientRequestId: `adult-off-widget-block-${++requestSerial}`,
      });
      const auxRow = assistantRow(auxChat)!;
      const auxDelta = auxBefore.total - harness.balance().total;
      const stored = harness.db()
        .prepare("SELECT status_widget_values_json FROM messages WHERE id=?")
        .get(auxRow.id) as { status_widget_values_json: string | null };
      const api = await harness.getMessageApi(auxRow.id);
      assert.equal(auxRow.generation_status, "completed");
      assert.equal(auxRow.content, cleanRow.content);
      assert.equal(auxDelta, cleanDelta, "withholding the widget does not change body settlement");
      assert.ok(!JSON.stringify(aux.events).includes(RESTRICT_MARK));
      assert.ok(!(stored.status_widget_values_json ?? "").includes(RESTRICT_MARK));
      assert.ok(!api.raw.includes(RESTRICT_MARK));
      assert.match(api.json.content ?? "", /안았다/);
      const auxEvidence = guardEvidence(auxRow);
      assert.equal(auxEvidence?.finalStatus, "approved");
      assert.equal(
        auxEvidence?.checks?.find((check) => check.stage === "status_widget")?.status,
        "blocked"
      );
      assert.equal(moderationRows(auxRow.id).length, classifierCalls);
      assert.ok(moderationRows(auxRow.id).every((row) => (row.actual_cost_usd ?? 0) > 0));
      const callsAtEnd = classifierCalls;
      await new Promise((resolve) => setTimeout(resolve, 250));
      assert.equal(classifierCalls, callsAtEnd, "no automatic re-check after the widget is withheld");
    });

    it("does not start widget extraction after the body block is confirmed", async () => {
      classifierMode = "by_mark";
      mainScript = { text: `${body} ${RESTRICT_MARK}` };
      resetCounters();
      auxHandler = () => widgetPayload("창가 앞");
      const before = harness.balance();
      const chatId = harness.newChat();
      const result = await harness.post({
        characterId: CHARACTER_ID,
        chatId,
        message: "장면을 이어 가자.",
        clientRequestId: `adult-off-widget-body-block-${++requestSerial}`,
      });
      const row = assistantRow(chatId)!;
      assert.equal(classifierCalls, 1, "the blocked body is not checked again and the widget is not checked");
      assert.equal(auxCalls, 0, "widget extraction does not start after the body block");
      assert.equal(otherCompletionCalls, 0);
      assert.equal(otherLunaCalls, 0);
      assert.equal(row.content, "");
      assert.equal(row.generation_status, "failed");
      assert.ok(!JSON.stringify(result.events).includes(RESTRICT_MARK));
      assert.deepEqual(harness.balance(), before);
      assert.equal(moderationRows(row.id).length, 1);
    });
  });
});
