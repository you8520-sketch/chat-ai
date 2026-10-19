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

const USER_ID = 88111;
const CHARACTER_ID = 88112;

const REFUSAL_CORE =
  "죄송합니다. 요청하신 장면은 안전 가이드라인에 위배되어 작성할 수 없습니다. 다른 방향의 이야기라면 이어서 도와드리겠습니다.";

function longRefusal(): string {
  return [
    REFUSAL_CORE,
    ...Array.from({ length: 28 }, (_, index) => {
      const n = index + 1;
      return `${n}번째 안내로, 이번 요청의 장면 생성은 여기서 멈추고 새로운 상황 번호 ${n * 17}만 남깁니다.`;
    }),
  ].join(" ");
}

function longProse(seed: string): string {
  return Array.from({ length: 8 }, (_, index) => {
    const n = index + 1;
    return `${seed} 창가의 ${n}번째 호흡에서 번호 ${n * 13}의 고요만 남겼다.`;
  }).join(" ");
}

type Script =
  | { kind: "refusal"; transport: "openrouter" | "cheaperinference"; model: string; cost: number }
  | { kind: "native"; model: string; cost: number }
  | { kind: "prose"; text: string; model: string };

let script: Script = {
  kind: "refusal",
  transport: "openrouter",
  model: "google/gemini-4-argon",
  cost: 0.0123,
};
let completionCalls = 0;
let requestSerial = 0;

function sseResponse(text: string, terminal: Record<string, unknown>, headers: Record<string, string>): Response {
  const parts: string[] = [];
  for (let i = 0; i < text.length; i += 220) {
    parts.push(
      `data: ${JSON.stringify({
        choices: [{ index: 0, delta: { content: text.slice(i, i + 220) }, finish_reason: null }],
      })}\n\n`
    );
  }
  parts.push(`data: ${JSON.stringify(terminal)}\n\n`);
  parts.push("data: [DONE]\n\n");
  return new Response(parts.join(""), {
    status: 200,
    headers: { "Content-Type": "text/event-stream", ...headers },
  });
}

function scriptedResponse(): Response {
  completionCalls += 1;
  const id = `prov-req-${completionCalls}`;
  if (script.kind === "prose") {
    return sseResponse(
      script.text,
      {
        model: script.model,
        choices: [{ delta: {}, finish_reason: "stop", native_finish_reason: "STOP" }],
        usage: {
          prompt_tokens: 900,
          completion_tokens: 280,
          cost: 0.01,
          cost_details: { upstream_inference_cost: 0.01 },
        },
      },
      { "x-request-id": id }
    );
  }
  if (script.kind === "native") {
    return sseResponse(
      "I cannot fulfill this request. The generation stops here.",
      {
        model: script.model,
        choices: [{ delta: {}, finish_reason: "stop", native_finish_reason: "refusal" }],
        usage: {
          prompt_tokens: 700,
          completion_tokens: 40,
          cost: script.cost,
          cost_details: { upstream_inference_cost: script.cost },
        },
      },
      { "x-request-id": id }
    );
  }
  const text = longRefusal();
  if (script.transport === "cheaperinference") {
    return sseResponse(
      text,
      {
        id,
        model: script.model,
        choices: [{ delta: {}, finish_reason: "stop" }],
        stop_reason: "end_turn",
        usage: { prompt_tokens: 1100, completion_tokens: 400, cost: script.cost },
        cheaper_inference: {
          request_id: id,
          billing: { status: "settled", billed_cost_usd: script.cost.toFixed(6), currency: "USD" },
        },
      },
      { "x-ci-request-id": id }
    );
  }
  return sseResponse(
    text,
    {
      model: script.model,
      choices: [{ delta: {}, finish_reason: "stop", native_finish_reason: "STOP" }],
      usage: {
        prompt_tokens: 1200,
        completion_tokens: 420,
        cost: script.cost,
        cost_details: { upstream_inference_cost: script.cost },
      },
    },
    { "x-request-id": id }
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
};

let harness: Harness;
let previousNodeTestContext: string | undefined;

describe("production chat refusal settlement", () => {
  before(async () => {
    previousNodeTestContext = process.env.NODE_TEST_CONTEXT;
    delete process.env.NODE_TEST_CONTEXT;
    installIsolatedTestDatabase();
    process.env.OPENROUTER_API_KEY = "test-openrouter-fixture";
    process.env.CHEAPER_INFERENCE_API_KEY = "test-cheaper-fixture";
    delete process.env.MOCK_MODE;
    delete process.env.SPEECH_LOCK_NARRATION_LEXICON;

    const auth = await import("@/lib/auth");
    const dbMod = await import("@/lib/db");
    const points = await import("@/lib/points");
    const selected = await import("@/lib/userSelectedAI");
    const session = await import("@/lib/chatSessionCreate");
    const models = await import("@/lib/chatModels");
    const route = await import("@/app/api/chat/route");
    const db = dbMod.getDb();
    db.prepare("INSERT INTO users (id, email, nickname, pw_hash) VALUES (?,?,?,?)").run(
      USER_ID,
      "refusal-zero@example.com",
      "정산",
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
    globalThis.fetch = (async (input: RequestInfo | URL) => {
      const url =
        typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
      if (url.includes("/chat/completions")) return scriptedResponse();
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
    };
  });

  after(() => {
    uninstallIsolatedTestDatabase();
    Module._load = originalLoad;
    delete process.env.OPENROUTER_API_KEY;
    delete process.env.CHEAPER_INFERENCE_API_KEY;
    if (previousNodeTestContext == null) delete process.env.NODE_TEST_CONTEXT;
    else process.env.NODE_TEST_CONTEXT = previousNodeTestContext;
  });

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

  function ledgerFor(messageId: number) {
    return harness.db()
      .prepare(
        `SELECT request_kind, model, actual_cost_usd, actual_cost_source, event_status, input_tokens, output_tokens
         FROM api_cost_ledger WHERE assistant_message_id=? ORDER BY id ASC`
      )
      .all(messageId) as Array<{
      request_kind: string;
      model: string;
      actual_cost_usd: number | null;
      actual_cost_source: string | null;
      event_status: string | null;
      input_tokens: number | null;
      output_tokens: number | null;
    }>;
  }

  it("long stop refusal charges 0P, keeps provider cost, and skips follow-up calls", async () => {
    const before = harness.balance();
    const callsBefore = completionCalls;
    script = {
      kind: "refusal",
      transport: "openrouter",
      model: "google/gemini-4-argon",
      cost: 0.0123,
    };
    const chatId = harness.newChat();
    const requestId = `refusal-stop-${++requestSerial}`;
    const result = await harness.post({
      characterId: CHARACTER_ID,
      chatId,
      message: "창가에서 손을 잡고 잠시 머물자.",
      clientRequestId: requestId,
    });
    const after = harness.balance();
    const row = assistantRow(chatId);
    const error = result.events.find((event) => event.type === "error");
    const ledger = row ? ledgerFor(row.id) : [];
    const underRecovered = harness.db()
      .prepare(
        "SELECT COUNT(*) AS n FROM chat_billing_settlements WHERE outcome='under_recovered'"
      )
      .get() as { n: number };
    const refunds = harness.db()
      .prepare("SELECT COUNT(*) AS n FROM point_logs WHERE user_id=? AND delta<0")
      .get(USER_ID) as { n: number };

    assert.equal(result.status, 200);
    assert.equal(error?.error, "이번 응답은 생성되지 않았으며 포인트는 차감되지 않았습니다.");
    assert.equal(after.free, before.free);
    assert.equal(after.paid, before.paid);
    assert.equal(after.total, before.total);
    assert.equal(row?.generation_status, "failed");
    assert.equal(row?.content ?? "", "");
    assert.equal(completionCalls - callsBefore, 1);
    assert.equal(underRecovered.n, 0);
    assert.equal(refunds.n, 0);
    assert.equal(ledger.length, 1);
    assert.equal(ledger[0]?.request_kind, "main-rp");
    assert.equal(ledger[0]?.event_status, "failed_with_usage");
    assert.equal(ledger[0]?.actual_cost_source, "provider_reported");
    assert.ok((ledger[0]?.actual_cost_usd ?? 0) > 0);
    assert.equal(ledger[0]?.input_tokens, 1200);
    assert.equal(ledger[0]?.output_tokens, 420);
    const usage = JSON.parse(row?.usage ?? "{}") as { generationFailure?: string; model?: string };
    assert.equal(usage.generationFailure, "model_refusal");
    assert.match(usage.model ?? "", /gemini-4-argon/);
    assert.doesNotMatch(JSON.stringify(usage), /시스템 프롬프트|system prompt/i);

    const replayCalls = completionCalls;
    const replay = await harness.post({
      characterId: CHARACTER_ID,
      chatId,
      message: "창가에서 손을 잡고 잠시 머물자.",
      clientRequestId: requestId,
    });
    const replayError = replay.events.find((event) => event.type === "error");
    assert.equal(replayError?.error, "이번 응답은 생성되지 않았으며 포인트는 차감되지 않았습니다.");
    assert.equal(completionCalls, replayCalls);
    assert.deepEqual(harness.balance(), after);
    assert.equal(ledgerFor(row!.id).length, 1);
  });

  it("native refusal stays 0P and preserves provider cost", async () => {
    const models = await import("@/lib/chatModels");
    const selected = await import("@/lib/userSelectedAI");
    selected.setUserSelectedAI(harness.db(), USER_ID, models.GEMINI_38_FLASH_MODEL);
    const before = harness.balance();
    const callsBefore = completionCalls;
    script = { kind: "native", model: "google/gemini-3.8-flash", cost: 0.004 };
    const chatId = harness.newChat();
    const result = await harness.post({
      characterId: CHARACTER_ID,
      chatId,
      message: "가볍게 손을 잡아 보자.",
      clientRequestId: `native-refusal-${++requestSerial}`,
    });
    const after = harness.balance();
    const row = assistantRow(chatId);
    const ledger = row ? ledgerFor(row.id) : [];
    assert.equal(result.events.find((event) => event.type === "error")?.error,
      "이번 응답은 생성되지 않았으며 포인트는 차감되지 않았습니다.");
    assert.equal(after.total, before.total);
    assert.equal(after.free, before.free);
    assert.equal(after.paid, before.paid);
    assert.equal(completionCalls - callsBefore, 1);
    assert.equal(ledger[0]?.event_status, "failed_with_usage");
    assert.ok((ledger[0]?.actual_cost_usd ?? 0) > 0);
    assert.notEqual(row?.generation_status, "completed");
  });

  it("cheaper-inference stop refusal keeps billed provider cost and charges 0P", async () => {
    const models = await import("@/lib/chatModels");
    const selected = await import("@/lib/userSelectedAI");
    selected.setUserSelectedAI(harness.db(), USER_ID, models.CHEAPER_INFERENCE_CLAUDE_OPUS_55_MODEL);
    const before = harness.balance();
    script = {
      kind: "refusal",
      transport: "cheaperinference",
      model: models.CHEAPER_INFERENCE_CLAUDE_OPUS_55_MODEL,
      cost: 0.021,
    };
    const chatId = harness.newChat();
    const result = await harness.post({
      characterId: CHARACTER_ID,
      chatId,
      message: "오늘 대화만 이어가자.",
      clientRequestId: `opus-refusal-${++requestSerial}`,
    });
    const row = assistantRow(chatId);
    const ledger = row ? ledgerFor(row.id) : [];
    assert.equal(result.events.find((event) => event.type === "error")?.error,
      "이번 응답은 생성되지 않았으며 포인트는 차감되지 않았습니다.");
    assert.deepEqual(harness.balance(), before);
    assert.equal(row?.content, "");
    assert.equal(ledger[0]?.actual_cost_source, "cheaper_inference_billed");
    assert.equal(ledger[0]?.actual_cost_usd, 0.021);
    assert.equal(ledger[0]?.event_status, "failed_with_usage");
  });

  it("normal prose, in-character refusal, and a 15+ transition still settle", async () => {
    const models = await import("@/lib/chatModels");
    const selected = await import("@/lib/userSelectedAI");
    selected.setUserSelectedAI(harness.db(), USER_ID, models.GEMINI_4_ARGON_MODEL);
    const samples = [
      longProse("두 사람은 창가에 남아 이야기를 이어갔다."),
      longProse("「싫어. 하지 마.」 그녀가 고개를 저었다."),
      longProse("그는 그녀의 손을 잡고 가벼운 입맞춤 뒤 감정만 이어가자고 말했다."),
    ];
    for (const text of samples) {
      const before = harness.balance();
      script = { kind: "prose", text, model: "google/gemini-4-argon" };
      const chatId = harness.newChat();
      const result = await harness.post({
        characterId: CHARACTER_ID,
        chatId,
        message: "장면을 이어 가자.",
        clientRequestId: `prose-${++requestSerial}`,
      });
      const after = harness.balance();
      const row = assistantRow(chatId);
      assert.equal(result.events.some((event) => event.type === "done"), true, text.slice(0, 24));
      assert.equal(row?.generation_status, "completed");
      assert.match(row?.content ?? "", /창가/);
      assert.ok(after.total < before.total);
      assert.ok(after.paid <= before.paid);
      assert.ok(after.free <= before.free);
    }
  });

  it("failed regeneration keeps the previous reply and does not refund or recharge", async () => {
    const before = harness.balance();
    const good = longProse("이전의 정상적인 대답이 창가에 남아 있다.");
    script = { kind: "prose", text: good, model: "google/gemini-4-argon" };
    const chatId = harness.newChat();
    const first = await harness.post({
      characterId: CHARACTER_ID,
      chatId,
      message: "처음 장면을 이어 가자.",
      clientRequestId: `regen-base-${++requestSerial}`,
    });
    assert.equal(first.events.some((event) => event.type === "done"), true);
    const charged = harness.balance();
    assert.ok(charged.total < before.total);
    const saved = assistantRow(chatId);
    assert.ok(saved);
    script = {
      kind: "refusal",
      transport: "openrouter",
      model: "google/gemini-4-argon",
      cost: 0.0123,
    };
    const regen = await harness.post({
      characterId: CHARACTER_ID,
      chatId,
      regenerate: true,
      targetAssistantMessageId: saved!.id,
      clientRequestId: `regen-refusal-${++requestSerial}`,
    });
    const restored = assistantRow(chatId);
    assert.equal(regen.events.find((event) => event.type === "error")?.error,
      "이번 응답은 생성되지 않았으며 포인트는 차감되지 않았습니다.");
    assert.equal(restored?.content, saved!.content);
    assert.equal(restored?.generation_status, "completed");
    assert.deepEqual(harness.balance(), charged);
    const refunds = harness.db()
      .prepare("SELECT COUNT(*) AS n FROM point_logs WHERE user_id=? AND delta<0 AND reason LIKE '%환불%'")
      .get(USER_ID) as { n: number };
    assert.equal(refunds.n, 0);
  });
});
