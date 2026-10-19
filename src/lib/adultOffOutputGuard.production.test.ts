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
type ClassifierMode = "allow" | "by_mark" | "http_error" | "invalid_json" | "contradiction";

let mainScript: MainScript = { text: "" };
let classifierMode: ClassifierMode = "by_mark";
let mainCalls = 0;
let classifierCalls = 0;
let otherCompletionCalls = 0;
let otherLunaCalls = 0;
let providerRequestSerial = 0;
let classifierInputs: string[] = [];
let onClassifierCall: (() => void) | null = null;

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

function classifierResponse(userContent: string): Response {
  classifierCalls += 1;
  classifierInputs.push(userContent);
  onClassifierCall?.();
  if (classifierMode === "http_error") {
    return new Response(JSON.stringify({ error: { message: "upstream unavailable" } }), {
      status: 503,
      headers: { "Content-Type": "application/json" },
    });
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
      id: `classifier-${classifierCalls}`,
      model: "gpt-6-luna",
      choices: [{ index: 0, message: { role: "assistant", content }, finish_reason: "stop" }],
      usage: { prompt_tokens: 1500, completion_tokens: 20, cost: 0.0002 },
      cheaper_inference: {
        request_id: `classifier-${classifierCalls}`,
        billing: { status: "settled", billed_cost_usd: "0.000130", currency: "USD" },
      },
    }),
    {
      status: 200,
      headers: { "Content-Type": "application/json", "x-ci-request-id": `classifier-${classifierCalls}` },
    }
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
  getMessageApi: (messageId: number) => Promise<string>;
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
        if (typeof init?.body === "string") {
          try {
            const body = JSON.parse(init.body) as {
              model?: unknown;
              messages?: Array<{ role?: string; content?: unknown }>;
            };
            model = String(body.model ?? "");
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
          otherLunaCalls += 1;
          return new Response("{}", { status: 500 });
        }
        if (model === "google/gemini-4-argon") {
          mainCalls += 1;
          providerRequestSerial += 1;
          return sseResponse(mainScript.text, 0.01, `prov-req-${providerRequestSerial}`);
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
        return response.text();
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

    const apiBody = await harness.getMessageApi(row!.id);
    assert.ok(!apiBody.includes(RESTRICT_MARK));
    assert.ok(!apiBody.includes("창가의 1번째 호흡"));

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
});
