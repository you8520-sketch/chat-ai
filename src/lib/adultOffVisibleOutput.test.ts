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
import {
  ADULT_OFF_GUARD_POLICY_VERSION,
  adultOffApprovedTextHash,
} from "@/lib/adultOffOutputGuard";
import { resolveSuggestedRepliesPollSnapshot } from "@/lib/suggestedReplies/parse";
import { statusMetaHasDisplayContent } from "@/lib/statusMeta/render";
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
  let messageGet: typeof import("@/app/api/chat/message/route").GET;
  let messagesGet: typeof import("@/app/api/chat/messages/route").GET;
  let variantPatch: typeof import("@/app/api/chat/message/variant/route").PATCH;
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
    const messageRoute = await import("@/app/api/chat/message/route");
    const messagesRoute = await import("@/app/api/chat/messages/route");
    const variantRoute = await import("@/app/api/chat/message/variant/route");
    db = dbMod.getDb();
    finance.ensureAdminFinanceTables(db);
    ledger.ensureProviderCostLedgerSchema(db);
    scheduleReplies = repliesJob.scheduleSuggestedRepliesExtraction;
    scheduleMeta = metaJob.scheduleStatusMetaExtraction;
    repliesGet = repliesRoute.GET;
    metaGet = metaRoute.GET;
    messageGet = messageRoute.GET;
    messagesGet = messagesRoute.GET;
    variantPatch = variantRoute.PATCH;
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
    const storedApproved = db
      .prepare("SELECT suggested_replies_json FROM messages WHERE id=?")
      .get(ok.messageId) as { suggested_replies_json: string };
    assert.match(storedApproved.suggested_replies_json, /"policyVersion":2/);
    const refreshedPoll = await pollReplies(ok.messageId);
    assert.equal(refreshedPoll.json.replies?.[0]?.text, approved[0].text);
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

  const STORED_SECRET = "ZZ_STORED_AUX_SECRET";
  const VARIANT_SECRET = "ZZ_VARIANT_SECRET";
  const ROW_SECRET = "ZZ_ROW_CONTENT_SECRET";

  function proofFor(texts: string[], policyVersion = ADULT_OFF_GUARD_POLICY_VERSION) {
    return {
      policyVersion,
      approvedTextHashes: texts.map((text) => adultOffApprovedTextHash(text)),
    };
  }

  function replyTrio(first: string): SuggestedReplyItem[] {
    return [
      { kind: "natural", text: first },
      { kind: "twist", text: "그녀는 창가에서 한 걸음 물러섰다." },
      { kind: "banter", text: "빗소리가 둘의 침묵을 메웠다." },
    ];
  }

  function writeStoredAux(
    messageId: number,
    input: {
      replies?: SuggestedReplyItem[];
      location?: string;
      repliesProof?: ReturnType<typeof proofFor> | null;
      metaProof?: ReturnType<typeof proofFor> | null;
    }
  ) {
    const scope = scopeOf(messageId);
    if (input.replies) {
      db.prepare("UPDATE messages SET suggested_replies_json=? WHERE id=?").run(
        JSON.stringify({
          replies: input.replies,
          extractedAt: "2026-01-01T00:00:00.000Z",
          source: "standalone-extract",
          pending: false,
          failed: false,
          generationSequence: scope.generationSequence,
          generationRequestId: scope.generationRequestId,
          ...(input.repliesProof ? { adultOffGuard: input.repliesProof } : {}),
        }),
        messageId
      );
    }
    if (input.location != null) {
      db.prepare("UPDATE messages SET status_meta=? WHERE id=?").run(
        JSON.stringify({
          meta: {
            tableMarkdown: "",
            datetime: "",
            location: input.location,
            relationship: "",
            npcEmotion: "",
            npcIntent: "",
            nextObjective: "",
            hiddenThought: "",
            sceneSummary: "",
          },
          extractedAt: "2026-01-01T00:00:00.000Z",
          source: "background-deepseek",
          pending: false,
          failed: false,
          formatSpec: null,
          generationSequence: scope.generationSequence,
          generationRequestId: scope.generationRequestId,
          ...(input.metaProof ? { adultOffGuard: input.metaProof } : {}),
        }),
        messageId
      );
    }
  }

  function consumeSuggestedPoll(json: { pending?: boolean; replies?: unknown; failed?: boolean }) {
    const resolution = resolveSuggestedRepliesPollSnapshot(json);
    if (resolution.state === "pending") return { shown: [] as string[], failed: false, pending: true };
    if (resolution.state === "ready") {
      return { shown: resolution.replies.map((reply) => reply.text), failed: false, pending: false };
    }
    return { shown: [] as string[], failed: true, pending: false };
  }

  function consumeStatusPoll(json: {
    pending?: boolean;
    failed?: boolean;
    meta?: StatusMeta | null;
    formatSpec?: string | null;
  }) {
    if (json.pending) return { shown: null as StatusMeta | null, failed: false, pending: true };
    const meta = json.meta ?? null;
    if (statusMetaHasDisplayContent(meta, json.formatSpec ?? null)) {
      return { shown: meta, failed: false, pending: false };
    }
    return { shown: null as StatusMeta | null, failed: true, pending: false };
  }

  function consumeVariantSwitch(
    response: Response,
    body: { error?: string; content?: string; activeVariant?: number },
    previous: { content: string; activeVariant: number }
  ) {
    if (!response.ok) {
      return {
        content: previous.content,
        activeVariant: previous.activeVariant,
        toast: body.error || "버전 전환에 실패했습니다.",
        replaced: false,
      };
    }
    return {
      content: body.content ?? "",
      activeVariant: body.activeVariant ?? previous.activeVariant,
      toast: null as string | null,
      replaced: true,
    };
  }

  async function readJson(response: Response) {
    return JSON.parse(await response.text()) as Record<string, unknown>;
  }

  it("hides stored aux without approval and keeps an async-approved record across poll and refresh", async () => {
    const callsBefore = classifierCalls;
    const hidden = seedMessage("그는 창가에 기대 섰다.");
    const hiddenReplies = replyTrio(`창가의 ${STORED_SECRET}`);
    writeStoredAux(hidden.messageId, {
      replies: hiddenReplies,
      location: `골목 ${STORED_SECRET}`,
    });
    const hiddenRepliesResponse = await repliesGet(
      new Request(`http://localhost/api/chat/suggested-replies?messageId=${hidden.messageId}`)
    );
    const hiddenRepliesJson = await readJson(hiddenRepliesResponse);
    const hiddenRepliesView = consumeSuggestedPoll(hiddenRepliesJson);
    assert.equal(hiddenRepliesView.failed, true);
    assert.equal(hiddenRepliesView.shown.length, 0);
    assert.equal(JSON.stringify(hiddenRepliesJson).includes(STORED_SECRET), false);

    const hiddenMetaResponse = await metaGet(
      new Request(`http://localhost/api/chat/status-meta?messageId=${hidden.messageId}`)
    );
    const hiddenMetaJson = await readJson(hiddenMetaResponse);
    const hiddenMetaView = consumeStatusPoll(hiddenMetaJson);
    assert.equal(hiddenMetaView.failed, true);
    assert.equal(hiddenMetaView.shown, null);
    assert.equal(JSON.stringify(hiddenMetaJson).includes(STORED_SECRET), false);
    const stillStored = db
      .prepare("SELECT status_meta, suggested_replies_json FROM messages WHERE id=?")
      .get(hidden.messageId) as { status_meta: string; suggested_replies_json: string };
    assert.equal(stillStored.status_meta.includes(STORED_SECRET), true);
    assert.equal(stillStored.suggested_replies_json.includes(STORED_SECRET), true);

    const oldPolicy = seedMessage("그는 창가에 기대 섰다.");
    const oldLocation = `오래된 ${STORED_SECRET}`;
    writeStoredAux(oldPolicy.messageId, {
      location: oldLocation,
      metaProof: proofFor([oldLocation], 1),
    });
    const oldPolicyJson = await readJson(
      await metaGet(new Request(`http://localhost/api/chat/status-meta?messageId=${oldPolicy.messageId}`))
    );
    assert.equal(JSON.stringify(oldPolicyJson).includes(STORED_SECRET), false);
    assert.equal(consumeStatusPoll(oldPolicyJson).shown, null);

    const approvedReplies = replyTrio("그의 소매를 가볍게 잡아 창가로 이끌었다.");
    const approvedLocation = "비 오는 창가";
    const approved = seedMessage("그는 그녀의 손을 잡았다.");
    writeStoredAux(approved.messageId, {
      replies: approvedReplies,
      location: approvedLocation,
      repliesProof: proofFor(approvedReplies.map((reply) => reply.text)),
      metaProof: proofFor([approvedLocation]),
    });
    const firstReplies = consumeSuggestedPoll(
      await readJson(
        await repliesGet(
          new Request(`http://localhost/api/chat/suggested-replies?messageId=${approved.messageId}`)
        )
      )
    );
    const secondReplies = consumeSuggestedPoll(
      await readJson(
        await repliesGet(
          new Request(`http://localhost/api/chat/suggested-replies?messageId=${approved.messageId}`)
        )
      )
    );
    assert.deepEqual(firstReplies.shown, approvedReplies.map((reply) => reply.text));
    assert.deepEqual(secondReplies.shown, firstReplies.shown);
    const firstMeta = consumeStatusPoll(
      await readJson(await metaGet(new Request(`http://localhost/api/chat/status-meta?messageId=${approved.messageId}`)))
    );
    const secondMeta = consumeStatusPoll(
      await readJson(await metaGet(new Request(`http://localhost/api/chat/status-meta?messageId=${approved.messageId}`)))
    );
    assert.equal(firstMeta.shown?.location, approvedLocation);
    assert.equal(secondMeta.shown?.location, approvedLocation);

    const cursorId = approved.messageId + 5001;
    db.prepare(
      `INSERT INTO messages (id, chat_id, role, content, generation_status, alternates, active_variant, model, request_id)
       VALUES (?, ?, 'assistant', ?, 'completed', '[]', 0, 'test', ?)`
    ).run(cursorId, approved.chatId, "이후 커서", `req-cursor-${cursorId}`);
    const refresh = await readJson(
      await messagesGet(
        new Request(
          `http://localhost/api/chat/messages?chatId=${approved.chatId}&beforeMessageId=${cursorId}`
        )
      )
    );
    const refreshed = (refresh.messages as Array<{ id: number; statusMeta?: { location?: string }; suggestedReplies?: Array<{ text?: string }> }>)
      .find((message) => message.id === approved.messageId);
    assert.equal(refreshed?.statusMeta?.location, approvedLocation);
    assert.equal(refreshed?.suggestedReplies?.[0]?.text, approvedReplies[0].text);
    const messageRefresh = await readJson(
      await messageGet(new Request(`http://localhost/api/chat/message?messageId=${approved.messageId}`))
    );
    assert.equal(
      (messageRefresh.suggestedReplies as Array<{ text?: string }>)[0]?.text,
      approvedReplies[0].text
    );

    const usageOnly = seedMessage("그는 그녀의 손을 잡았다.");
    const usageReplies = replyTrio("손끝만 스치고 창가에 섰다.");
    writeStoredAux(usageOnly.messageId, { replies: usageReplies, location: "복도 끝" });
    db.prepare("UPDATE messages SET usage=? WHERE id=?").run(
      JSON.stringify({
        adultOffGuard: proofFor([
          ...usageReplies.map((reply) => reply.text),
          "복도 끝",
        ]),
      }),
      usageOnly.messageId
    );
    const usageRepliesView = consumeSuggestedPoll(
      await readJson(
        await repliesGet(
          new Request(`http://localhost/api/chat/suggested-replies?messageId=${usageOnly.messageId}`)
        )
      )
    );
    const usageMetaView = consumeStatusPoll(
      await readJson(
        await metaGet(new Request(`http://localhost/api/chat/status-meta?messageId=${usageOnly.messageId}`))
      )
    );
    assert.deepEqual(usageRepliesView.shown, usageReplies.map((reply) => reply.text));
    assert.equal(usageMetaView.shown?.location, "복도 끝");
    assert.equal(classifierCalls, callsBefore);
  });

  it("keeps guard-off and adult-on stored aux that has no approval proof", async () => {
    const replies = replyTrio(`가드 밖 ${STORED_SECRET}`);
    const location = `보관 ${STORED_SECRET}`;
    process.env.ADULT_OFF_OUTPUT_GUARD_ENABLED = "0";
    try {
      const off = seedMessage("가벼운 인사.");
      writeStoredAux(off.messageId, { replies, location });
      const offJson = await readJson(
        await repliesGet(new Request(`http://localhost/api/chat/suggested-replies?messageId=${off.messageId}`))
      );
      assert.equal(consumeSuggestedPoll(offJson).shown[0], replies[0].text);
      const offMeta = await readJson(
        await metaGet(new Request(`http://localhost/api/chat/status-meta?messageId=${off.messageId}`))
      );
      assert.equal(consumeStatusPoll(offMeta).shown?.location, location);
    } finally {
      process.env.ADULT_OFF_OUTPUT_GUARD_ENABLED = "1";
    }

    db.prepare("UPDATE users SET is_admin=1 WHERE id=?").run(USER_ID);
    try {
      const on = seedMessage("가벼운 인사.");
      db.prepare("UPDATE chats SET adult_handoff_enabled=1 WHERE id=?").run(on.chatId);
      writeStoredAux(on.messageId, { replies, location });
      const onJson = await readJson(
        await repliesGet(new Request(`http://localhost/api/chat/suggested-replies?messageId=${on.messageId}`))
      );
      assert.equal(consumeSuggestedPoll(onJson).shown[0], replies[0].text);
    } finally {
      db.prepare("UPDATE users SET is_admin=0 WHERE id=?").run(USER_ID);
    }
  });

  it("does not commit an unapproved variant and still switches an approved one", async () => {
    const callsBefore = classifierCalls;
    db.prepare("UPDATE users SET points=2000 WHERE id=?").run(USER_ID);
    const approvedText = "그는 우산 아래로 한 걸음 다가왔다.";
    const seeded = seedMessage(approvedText);
    const approvedUsage = {
      adultOffGuard: {
        policyVersion: ADULT_OFF_GUARD_POLICY_VERSION,
        approvedTextHashes: [adultOffApprovedTextHash(approvedText)],
        restrictedTextHashes: [],
      },
    };
    const restrictedUsage = {
      adultOffGuard: {
        policyVersion: ADULT_OFF_GUARD_POLICY_VERSION,
        approvedTextHashes: [],
        restrictedTextHashes: [adultOffApprovedTextHash(VARIANT_SECRET)],
      },
    };
    const variants = [
      { content: approvedText, model: "test", usage: approvedUsage, created_at: "" },
      { content: VARIANT_SECRET, model: "test", usage: restrictedUsage, created_at: "" },
    ];
    db.prepare(
      "UPDATE messages SET content=?, alternates=?, active_variant=0, usage=? WHERE id=?"
    ).run(approvedText, JSON.stringify(variants), JSON.stringify(approvedUsage), seeded.messageId);
    const previous = { content: approvedText, activeVariant: 0 };
    const refusedResponse = await variantPatch(
      new Request("http://localhost/api/chat/message/variant", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messageId: seeded.messageId, variantIndex: 1 }),
      })
    );
    const refusedBody = await readJson(refusedResponse);
    const refusedView = consumeVariantSwitch(refusedResponse, refusedBody, previous);
    assert.equal(refusedResponse.status, 409);
    assert.equal(refusedView.replaced, false);
    assert.equal(refusedView.content, approvedText);
    assert.equal(refusedView.activeVariant, 0);
    assert.equal(JSON.stringify(refusedBody).includes(VARIANT_SECRET), false);
    const afterRefuse = db
      .prepare("SELECT content, active_variant, alternates FROM messages WHERE id=?")
      .get(seeded.messageId) as { content: string; active_variant: number; alternates: string };
    assert.equal(afterRefuse.content, approvedText);
    assert.equal(afterRefuse.active_variant, 0);
    assert.equal(afterRefuse.alternates.includes(VARIANT_SECRET), true);
    assert.equal(
      (db.prepare("SELECT points FROM users WHERE id=?").get(USER_ID) as { points: number }).points,
      2000
    );

    const unreviewed = seedMessage(approvedText);
    db.prepare(
      "UPDATE messages SET content=?, alternates=?, active_variant=0, usage=? WHERE id=?"
    ).run(
      approvedText,
      JSON.stringify([
        variants[0],
        { content: `미확정 ${VARIANT_SECRET}`, model: "test", usage: null, created_at: "" },
      ]),
      JSON.stringify(approvedUsage),
      unreviewed.messageId
    );
    const unreviewedResponse = await variantPatch(
      new Request("http://localhost/api/chat/message/variant", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messageId: unreviewed.messageId, variantIndex: 1 }),
      })
    );
    assert.equal(unreviewedResponse.status, 409);
    assert.equal((await unreviewedResponse.text()).includes(VARIANT_SECRET), false);
    const afterUnreviewed = db
      .prepare("SELECT content, active_variant FROM messages WHERE id=?")
      .get(unreviewed.messageId) as { content: string; active_variant: number };
    assert.equal(afterUnreviewed.content, approvedText);
    assert.equal(afterUnreviewed.active_variant, 0);

    const widgetSecret = `위젯 ${VARIANT_SECRET}`;
    const widgetMessage = seedMessage(approvedText);
    db.prepare(
      "UPDATE messages SET content=?, alternates=?, active_variant=0, usage=? WHERE id=?"
    ).run(
      approvedText,
      JSON.stringify([
        variants[0],
        {
          content: approvedText,
          model: "test",
          usage: approvedUsage,
          created_at: "",
          statusWidgetValues: { character: { mood: widgetSecret }, user: null },
        },
      ]),
      JSON.stringify(approvedUsage),
      widgetMessage.messageId
    );
    const widgetResponse = await variantPatch(
      new Request("http://localhost/api/chat/message/variant", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messageId: widgetMessage.messageId, variantIndex: 1 }),
      })
    );
    assert.equal(widgetResponse.status, 409);
    assert.equal((await widgetResponse.text()).includes(VARIANT_SECRET), false);
    assert.equal(
      (db.prepare("SELECT active_variant, content FROM messages WHERE id=?").get(widgetMessage.messageId) as {
        active_variant: number;
        content: string;
      }).active_variant,
      0
    );

    const nextText = "그녀는 우산 손잡이를 나누어 쥐었다.";
    const nextUsage = {
      adultOffGuard: {
        policyVersion: ADULT_OFF_GUARD_POLICY_VERSION,
        approvedTextHashes: [adultOffApprovedTextHash(nextText)],
        restrictedTextHashes: [],
      },
    };
    const switchable = [
      variants[0],
      { content: nextText, model: "test", usage: nextUsage, created_at: "" },
    ];
    db.prepare("UPDATE messages SET alternates=? WHERE id=?").run(
      JSON.stringify(switchable),
      seeded.messageId
    );
    const allowedResponse = await variantPatch(
      new Request("http://localhost/api/chat/message/variant", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messageId: seeded.messageId, variantIndex: 1 }),
      })
    );
    const allowedBody = await readJson(allowedResponse);
    const allowedView = consumeVariantSwitch(allowedResponse, allowedBody, previous);
    assert.equal(allowedResponse.status, 200);
    assert.equal(allowedView.replaced, true);
    assert.equal(allowedView.content, nextText);
    assert.equal(allowedView.activeVariant, 1);
    const afterAllow = db
      .prepare("SELECT content, active_variant FROM messages WHERE id=?")
      .get(seeded.messageId) as { content: string; active_variant: number };
    assert.equal(afterAllow.content, nextText);
    assert.equal(afterAllow.active_variant, 1);
    assert.equal(allowedView.content, afterAllow.content);

    const rowLeak = seedMessage("보이는 문장.");
    db.prepare("UPDATE messages SET content=?, alternates=?, active_variant=0, usage=? WHERE id=?").run(
      ROW_SECRET,
      JSON.stringify([
        { content: "", model: "test", usage: null, created_at: "" },
      ]),
      null,
      rowLeak.messageId
    );
    const rowRead = await readJson(
      await messageGet(new Request(`http://localhost/api/chat/message?messageId=${rowLeak.messageId}`))
    );
    assert.equal(String(rowRead.content ?? "").includes(ROW_SECRET), false);
    assert.equal(
      (db.prepare("SELECT content FROM messages WHERE id=?").get(rowLeak.messageId) as { content: string }).content,
      ROW_SECRET
    );

    const otherId = 88399;
    db.prepare("INSERT INTO users (id, email, nickname, pw_hash) VALUES (?,?,?,?)").run(
      otherId,
      "other-aux@example.com",
      "다른",
      "x"
    );
    const otherChat = 88990;
    const otherMessage = 88991;
    db.prepare("INSERT INTO chats (id, user_id, character_id, adult_handoff_enabled) VALUES (?,?,?,0)").run(
      otherChat,
      otherId,
      CHARACTER_ID
    );
    db.prepare(
      `INSERT INTO messages (id, chat_id, role, content, generation_status, alternates, active_variant, model, request_id, status_meta)
       VALUES (?, ?, 'assistant', ?, 'completed', '[]', 0, 'test', 'req-other', ?)`
    ).run(otherMessage, otherChat, VARIANT_SECRET, JSON.stringify({ meta: { location: VARIANT_SECRET } }));
    const otherMeta = await metaGet(
      new Request(`http://localhost/api/chat/status-meta?messageId=${otherMessage}`)
    );
    const otherVariant = await variantPatch(
      new Request("http://localhost/api/chat/message/variant", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messageId: otherMessage, variantIndex: 0 }),
      })
    );
    assert.equal(otherMeta.status, 404);
    assert.equal(otherVariant.status, 404);
    assert.equal((await otherMeta.text()).includes(VARIANT_SECRET), false);

    process.env.ADULT_OFF_OUTPUT_GUARD_ENABLED = "0";
    try {
      const off = seedMessage(approvedText);
      db.prepare(
        "UPDATE messages SET content=?, alternates=?, active_variant=0, usage=NULL WHERE id=?"
      ).run(
        approvedText,
        JSON.stringify([
          { content: approvedText, model: "test", usage: null, created_at: "" },
          { content: VARIANT_SECRET, model: "test", usage: null, created_at: "" },
        ]),
        off.messageId
      );
      const offResponse = await variantPatch(
        new Request("http://localhost/api/chat/message/variant", {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ messageId: off.messageId, variantIndex: 1 }),
        })
      );
      const offBody = await readJson(offResponse);
      assert.equal(offResponse.status, 200);
      assert.equal(offBody.content, VARIANT_SECRET);
      assert.equal(
        (db.prepare("SELECT content, active_variant FROM messages WHERE id=?").get(off.messageId) as {
          content: string;
          active_variant: number;
        }).active_variant,
        1
      );
    } finally {
      process.env.ADULT_OFF_OUTPUT_GUARD_ENABLED = "1";
    }
    assert.equal(classifierCalls, callsBefore);
  });
});
