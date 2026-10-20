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
import { resolveActiveAssistantGenerationScope } from "@/lib/assistantGenerationScope";
import type { SuggestedReplyItem } from "@/lib/suggestedReplies/types";
import type { StatusMeta } from "@/lib/statusMeta/types";

const USER_ID = 88331;
const CHARACTER_ID = 88332;
const MARK = "ZZ_SYNTHETIC_RESTRICTED_MARK";

let classifierCalls = 0;
let classifierSerial = 0;

function allowVerdict(restrict: boolean): string {
  return JSON.stringify(
    restrict
      ? { decision: "restrict", category: "sexual_act", confidence: "high", first_paragraph: 0 }
      : { decision: "allow", category: "none", confidence: "high", first_paragraph: -1 }
  );
}

describe("adult-off visible auxiliary writes", { concurrency: 1 }, () => {
  let db: import("better-sqlite3").Database;
  let scheduleReplies: typeof import("@/lib/suggestedReplies/job").scheduleSuggestedRepliesExtraction;
  let scheduleMeta: typeof import("@/lib/statusMeta/job").scheduleStatusMetaExtraction;
  let repliesGet: typeof import("@/app/api/chat/suggested-replies/route").GET;
  let metaGet: typeof import("@/app/api/chat/status-meta/route").GET;
  let messageSerial = 0;

  let previousNodeTestContext: string | undefined;

  before(async () => {
    previousNodeTestContext = process.env.NODE_TEST_CONTEXT;
    delete process.env.NODE_TEST_CONTEXT;
    installIsolatedTestDatabase();
    process.env.OPENROUTER_API_KEY = "test-openrouter-fixture";
    process.env.CHEAPER_INFERENCE_API_KEY = "test-cheaper-fixture";
    process.env.ADULT_OFF_OUTPUT_GUARD_ENABLED = "1";
    const auth = await import("@/lib/auth");
    const dbMod = await import("@/lib/db");
    const finance = await import("@/lib/adminFinance");
    const ledger = await import("@/lib/providerCostLedger");
    const models = await import("@/lib/chatModels");
    const repliesJob = await import("@/lib/suggestedReplies/job");
    const metaJob = await import("@/lib/statusMeta/job");
    const repliesRoute = await import("@/app/api/chat/suggested-replies/route");
    const metaRoute = await import("@/app/api/chat/status-meta/route");
    db = dbMod.getDb();
    finance.ensureAdminFinanceTables(db);
    ledger.ensureProviderCostLedgerSchema(db);
    scheduleReplies = repliesJob.scheduleSuggestedRepliesExtraction;
    scheduleMeta = metaJob.scheduleStatusMetaExtraction;
    repliesGet = repliesRoute.GET;
    metaGet = metaRoute.GET;
    db.prepare("INSERT INTO users (id, email, nickname, pw_hash) VALUES (?,?,?,?)").run(
      USER_ID,
      "aux-guard@example.com",
      "보조",
      "x"
    );
    db.prepare("INSERT INTO characters (id, name) VALUES (?,?)").run(CHARACTER_ID, "유나");
    sessionToken = auth.createSession(USER_ID);
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url =
        typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
      if (!url.includes("/chat/completions")) {
        return new Response("{}", { status: 200, headers: { "Content-Type": "application/json" } });
      }
      let system = "";
      let user = "";
      if (typeof init?.body === "string") {
        const body = JSON.parse(init.body) as {
          model?: string;
          messages?: Array<{ role?: string; content?: unknown }>;
        };
        if (body.model === models.CHEAPER_INFERENCE_GPT_6_LUNA_MODEL) {
          system = String(body.messages?.find((message) => message.role === "system")?.content ?? "");
          user = String(body.messages?.filter((message) => message.role === "user").at(-1)?.content ?? "");
        }
      }
      if (!system.includes("독립 검수기")) {
        return new Response("{}", { status: 500, headers: { "Content-Type": "application/json" } });
      }
      classifierCalls += 1;
      classifierSerial += 1;
      const requestId = `classifier-visible-${classifierSerial}`;
      const content = allowVerdict(user.includes(MARK));
      return new Response(
        JSON.stringify({
          id: requestId,
          model: models.CHEAPER_INFERENCE_GPT_6_LUNA_MODEL,
          choices: [{ index: 0, message: { role: "assistant", content }, finish_reason: "stop" }],
          usage: { prompt_tokens: 20, completion_tokens: 8, cost: 0.0002 },
          cheaper_inference: {
            request_id: requestId,
            billing: { status: "settled", billed_cost_usd: "0.000130", currency: "USD" },
          },
        }),
        {
          status: 200,
          headers: {
            "Content-Type": "application/json",
            "x-ci-request-id": requestId,
          },
        }
      );
    }) as typeof fetch;
  });

  after(() => {
    uninstallIsolatedTestDatabase();
    Module._load = originalLoad;
    delete process.env.ADULT_OFF_OUTPUT_GUARD_ENABLED;
    delete process.env.OPENROUTER_API_KEY;
    delete process.env.CHEAPER_INFERENCE_API_KEY;
    if (previousNodeTestContext == null) delete process.env.NODE_TEST_CONTEXT;
    else process.env.NODE_TEST_CONTEXT = previousNodeTestContext;
  });

  function seedMessage(content: string): { chatId: number; messageId: number } {
    messageSerial += 1;
    const chatId = 88400 + messageSerial;
    const messageId = 88500 + messageSerial;
    db.prepare(
      "INSERT INTO chats (id, user_id, character_id, adult_handoff_enabled) VALUES (?,?,?,0)"
    ).run(chatId, USER_ID, CHARACTER_ID);
    db.prepare(
      `INSERT INTO messages (id, chat_id, role, content, generation_status, alternates, active_variant, model, request_id)
       VALUES (?, ?, 'assistant', ?, 'completed', '[]', 0, 'test', ?)`
    ).run(messageId, chatId, content, `req-visible-${messageSerial}`);
    return { chatId, messageId };
  }

  function scopeOf(messageId: number) {
    const scope = resolveActiveAssistantGenerationScope(messageId, db);
    assert.ok(scope);
    return scope;
  }

  async function pollReplies(messageId: number): Promise<{ raw: string; json: { replies?: Array<{ text?: string }>; pending?: boolean } }> {
    for (let attempt = 0; attempt < 20; attempt += 1) {
      const response = await repliesGet(
        new Request(`http://localhost/api/chat/suggested-replies?messageId=${messageId}`)
      );
      const raw = await response.text();
      const json = JSON.parse(raw) as { replies?: Array<{ text?: string }>; pending?: boolean };
      if (!json.pending) return { raw, json };
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    throw new Error("suggested replies stayed pending");
  }

  async function pollMeta(messageId: number): Promise<{ raw: string; json: { meta?: { location?: string; hiddenThought?: string } | null; pending?: boolean } }> {
    for (let attempt = 0; attempt < 20; attempt += 1) {
      const response = await metaGet(
        new Request(`http://localhost/api/chat/status-meta?messageId=${messageId}`)
      );
      const raw = await response.text();
      const json = JSON.parse(raw) as {
        meta?: { location?: string; hiddenThought?: string } | null;
        pending?: boolean;
      };
      if (!json.pending) return { raw, json };
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    throw new Error("status meta stayed pending");
  }

  it("stores an approved suggested reply and hides a restricted one from DB and the poll", async () => {
    const trio = (first: string): SuggestedReplyItem[] => [
      { kind: "natural", text: first },
      { kind: "twist", text: "그녀는 웃으며 그의 소매를 가볍게 당겼다." },
      { kind: "banter", text: "창밖 빗소리에 맞춰 목소리를 낮췄다." },
    ];
    const approved = trio("그의 어깨에 기대며 창가의 숨을 골랐다.");
    const restricted = trio(`그의 어깨에 기대며 ${MARK}`);
    classifierCalls = 0;
    const ok = seedMessage("그는 가볍게 입을 맞추고 그녀를 안았다.");
    scheduleReplies({
      messageId: ok.messageId,
      chatId: ok.chatId,
      generationScope: scopeOf(ok.messageId),
      charName: "유나",
      personaName: "렌",
      userMessage: "장면을 이어 가자.",
      assistantProse: "그는 가볍게 입을 맞추고 그녀를 안았다.",
      __testExtract: async () => approved,
    });
    const okPoll = await pollReplies(ok.messageId);
    assert.equal(okPoll.json.replies?.[0]?.text, approved[0].text);
    assert.equal(classifierCalls, 3, "each visible reply string is checked once");

    const callsAfterApproved = classifierCalls;
    const blocked = seedMessage("그는 가볍게 입을 맞추고 그녀를 안았다.");
    scheduleReplies({
      messageId: blocked.messageId,
      chatId: blocked.chatId,
      generationScope: scopeOf(blocked.messageId),
      charName: "유나",
      personaName: "렌",
      userMessage: "장면을 이어 가자.",
      assistantProse: "그는 가볍게 입을 맞추고 그녀를 안았다.",
      __testExtract: async () => restricted,
    });
    const blockedPoll = await pollReplies(blocked.messageId);
    const stored = db
      .prepare("SELECT suggested_replies_json, content FROM messages WHERE id=?")
      .get(blocked.messageId) as { suggested_replies_json: string | null; content: string };
    assert.equal(stored.content.includes("안았다"), true);
    assert.equal((stored.suggested_replies_json ?? "").includes(MARK), false);
    assert.equal(blockedPoll.raw.includes(MARK), false);
    assert.equal(blockedPoll.json.replies?.some((reply) => reply.text?.includes(MARK)) ?? false, false);
    assert.equal(classifierCalls, callsAfterApproved + 1, "one review, no automatic rewrite");
  });

  it("stores approved status meta and hides restricted meta from DB and the poll", async () => {
    const approved: StatusMeta = {
      tableMarkdown: "",
      datetime: "",
      location: "창가",
      relationship: "",
      npcEmotion: "",
      npcIntent: "",
      nextObjective: "",
      hiddenThought: "",
      sceneSummary: "",
    };
    const restricted: StatusMeta = { ...approved, location: `창가 ${MARK}` };
    classifierCalls = 0;
    const ok = seedMessage("그는 그녀의 손을 잡았다.");
    scheduleMeta({
      messageId: ok.messageId,
      chatId: ok.chatId,
      generationScope: scopeOf(ok.messageId),
      charName: "유나",
      personaName: "렌",
      userMessage: "장면을 이어 가자.",
      assistantProse: "그는 그녀의 손을 잡았다.",
      __testExtract: async () => approved,
    });
    const okPoll = await pollMeta(ok.messageId);
    assert.equal(okPoll.json.meta?.location, "창가");
    assert.ok(classifierCalls >= 1);

    const callsAfterApproved = classifierCalls;
    const blocked = seedMessage("그는 그녀의 손을 잡았다.");
    scheduleMeta({
      messageId: blocked.messageId,
      chatId: blocked.chatId,
      generationScope: scopeOf(blocked.messageId),
      charName: "유나",
      personaName: "렌",
      userMessage: "장면을 이어 가자.",
      assistantProse: "그는 그녀의 손을 잡았다.",
      __testExtract: async () => restricted,
    });
    const blockedPoll = await pollMeta(blocked.messageId);
    const stored = db.prepare("SELECT status_meta, content FROM messages WHERE id=?").get(blocked.messageId) as {
      status_meta: string | null;
      content: string;
    };
    assert.match(stored.content, /손을 잡았다/);
    assert.equal((stored.status_meta ?? "").includes(MARK), false);
    assert.equal(blockedPoll.raw.includes(MARK), false);
    assert.equal(blockedPoll.json.meta?.location ?? "", "");
    assert.equal(classifierCalls, callsAfterApproved + 1);
    const moderation = db
      .prepare(
        `SELECT event_key, provider_request_id, actual_cost_usd, event_status, request_kind
           FROM api_cost_ledger
          WHERE assistant_message_id=?`
      )
      .all(blocked.messageId) as Array<{
      event_key: string | null;
      provider_request_id: string | null;
      actual_cost_usd: number | null;
      event_status: string;
      request_kind: string;
    }>;
    assert.equal(moderation.length, 1);
    assert.equal(moderation[0].event_status, "settled");
    assert.ok((moderation[0].actual_cost_usd ?? 0) > 0);
    assert.equal(moderation[0].provider_request_id?.startsWith("classifier-visible-"), true);
  });

  it("guard OFF and adult ON still store the auxiliary text", async () => {
    const replies: SuggestedReplyItem[] = [
      { kind: "natural", text: `포옹 뒤에 ${MARK}` },
      { kind: "twist", text: "그녀는 웃으며 창가로 돌아섰다." },
      { kind: "banter", text: "빗소리가 둘 사이의 말을 대신했다." },
    ];
    process.env.ADULT_OFF_OUTPUT_GUARD_ENABLED = "0";
    classifierCalls = 0;
    try {
      const off = seedMessage("가벼운 포옹.");
      scheduleReplies({
        messageId: off.messageId,
        chatId: off.chatId,
        generationScope: scopeOf(off.messageId),
        charName: "유나",
        personaName: "렌",
        userMessage: "",
        assistantProse: "가벼운 포옹.",
        __testExtract: async () => replies,
      });
      const offPoll = await pollReplies(off.messageId);
      assert.equal(offPoll.json.replies?.[0]?.text, replies[0].text);
      assert.equal(classifierCalls, 0);
    } finally {
      process.env.ADULT_OFF_OUTPUT_GUARD_ENABLED = "1";
    }

    db.prepare("UPDATE users SET is_admin=1 WHERE id=?").run(USER_ID);
    classifierCalls = 0;
    try {
      const on = seedMessage("가벼운 키스.");
      db.prepare("UPDATE chats SET adult_handoff_enabled=1 WHERE id=?").run(on.chatId);
      scheduleReplies({
        messageId: on.messageId,
        chatId: on.chatId,
        generationScope: scopeOf(on.messageId),
        charName: "유나",
        personaName: "렌",
        userMessage: "",
        assistantProse: "가벼운 키스.",
        __testExtract: async () => replies,
      });
      const onPoll = await pollReplies(on.messageId);
      assert.equal(onPoll.json.replies?.[0]?.text, replies[0].text);
      assert.equal(classifierCalls, 0);
    } finally {
      db.prepare("UPDATE users SET is_admin=0 WHERE id=?").run(USER_ID);
    }
  });
});
