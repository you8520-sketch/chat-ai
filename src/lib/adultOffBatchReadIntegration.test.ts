import Module from "node:module";

type ModuleLoader = {
  _load(this: unknown, request: string, parent: unknown, isMain: boolean): unknown;
};
const moduleLoader = Module as unknown as ModuleLoader;

let sessionToken = "";
const originalLoad = moduleLoader._load;
moduleLoader._load = function (this: unknown, request: string, parent: unknown, isMain: boolean) {
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
};

import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, before, describe, it } from "node:test";
import Database from "better-sqlite3";
import type { Database as DatabaseType } from "better-sqlite3";
import {
  assertIsolatedTestDatabaseActive,
  installIsolatedTestDatabase,
  uninstallIsolatedTestDatabase,
} from "@/lib/test/isolatedTestDatabase";
import {
  executeAdultOffBatchPaidRun,
  parseAdultOffBatchPaidRunConfig,
} from "@/lib/adultOffBatchPaidRun";
import type {
  AdultOffClassify,
  AdultOffClassifierResult,
} from "@/lib/adultOffOutputGuard";
import type { AdultOffClassifierTurnScope } from "@/lib/adultOffOutputClassifier";
import { ensureProviderCostLedgerSchema } from "@/lib/providerCostLedger";

const USER_ID = 77331;
const CHARACTER_ID = 77332;
const CHAT_ID = 77333;
const RESTRICTED = "ZZ_BATCH_READ_RESTRICTED";

type ClientMessage = {
  id: number;
  content: string;
  statusMeta?: { location?: string } | null;
  statusWidgetValues?: { character?: Record<string, string> | null } | null;
  suggestedReplies?: Array<{ text?: string }>;
  variants?: Array<{ content?: string }>;
};

describe("adult-off batch commits on the real read and variant-selection paths", { concurrency: 1 }, () => {
  let db: DatabaseType;
  let messagesGet: typeof import("@/app/api/chat/messages/route").GET;
  let variantPatch: typeof import("@/app/api/chat/message/variant/route").PATCH;
  let workRoot: string;
  let previousGuardFlag: string | undefined;
  let nextId = 77_500;
  const chatByMessage = new Map<number, number>();

  before(async () => {
    previousGuardFlag = process.env.ADULT_OFF_OUTPUT_GUARD_ENABLED;
    process.env.ADULT_OFF_OUTPUT_GUARD_ENABLED = "1";
    installIsolatedTestDatabase();
    const auth = await import("@/lib/auth");
    const dbMod = await import("@/lib/db");
    const finance = await import("@/lib/adminFinance");
    const messagesRoute = await import("@/app/api/chat/messages/route");
    const variantRoute = await import("@/app/api/chat/message/variant/route");
    db = dbMod.getDb();
    assertIsolatedTestDatabaseActive();
    finance.ensureAdminFinanceTables(db);
    ensureProviderCostLedgerSchema(db);
    messagesGet = messagesRoute.GET;
    variantPatch = variantRoute.PATCH;
    db.prepare("INSERT INTO users (id, email, nickname, pw_hash) VALUES (?,?,?,?)").run(
      USER_ID,
      "batch-read@example.com",
      "배치",
      "x"
    );
    db.prepare("INSERT INTO characters (id, name) VALUES (?,?)").run(CHARACTER_ID, "유나");
    db.prepare(
      "INSERT INTO chats (id, user_id, character_id, adult_handoff_enabled) VALUES (?,?,?,0)"
    ).run(CHAT_ID, USER_ID, CHARACTER_ID);
    sessionToken = auth.createSession(USER_ID);
    workRoot = fs.mkdtempSync(path.join(os.tmpdir(), "c3d-read-"));
  });

  after(() => {
    uninstallIsolatedTestDatabase();
    moduleLoader._load = originalLoad;
    if (previousGuardFlag === undefined) delete process.env.ADULT_OFF_OUTPUT_GUARD_ENABLED;
    else process.env.ADULT_OFF_OUTPUT_GUARD_ENABLED = previousGuardFlag;
    fs.rmSync(workRoot, { recursive: true, force: true });
  });

  function seed(input: {
    content: string;
    alternates?: unknown;
    activeVariant?: number;
    widgetJson?: string;
    statusMeta?: unknown;
    replies?: unknown;
  }): number {
    nextId += 1;
    const chatId = CHAT_ID + nextId;
    db.prepare(
      "INSERT INTO chats (id, user_id, character_id, adult_handoff_enabled) VALUES (?,?,?,0)"
    ).run(chatId, USER_ID, CHARACTER_ID);
    chatByMessage.set(nextId, chatId);
    db.prepare(
      `INSERT INTO messages (id, chat_id, role, content, model, usage, alternates, active_variant,
         generation_status, request_id, status_meta, suggested_replies_json, status_widget_values_json)
       VALUES (?, ?, 'assistant', ?, 'test', ?, ?, ?, 'completed', ?, ?, ?, ?)`
    ).run(
      nextId,
      chatId,
      input.content,
      JSON.stringify({ cost: 1 }),
      input.alternates === undefined ? "[]" : JSON.stringify(input.alternates),
      input.activeVariant ?? 0,
      `req-read-${nextId}`,
      input.statusMeta === undefined ? null : JSON.stringify(input.statusMeta),
      input.replies === undefined ? null : JSON.stringify(input.replies),
      input.widgetJson ?? ""
    );
    return nextId;
  }

  async function readMessage(messageId: number): Promise<ClientMessage> {
    const chatId = chatByMessage.get(messageId);
    const cursorId = messageId + 5001;
    if (!db.prepare("SELECT 1 FROM messages WHERE id=?").get(cursorId)) {
      db.prepare(
        `INSERT INTO messages (id, chat_id, role, content, generation_status, alternates, active_variant, model, request_id)
         VALUES (?, ?, 'assistant', '', 'completed', '[]', 0, 'test', ?)`
      ).run(cursorId, chatId, `req-cursor-${cursorId}`);
    }
    const response = await messagesGet(
      new Request(`http://localhost/api/chat/messages?chatId=${chatId}&beforeMessageId=${cursorId}`)
    );
    const json = JSON.parse(await response.text()) as { messages: ClientMessage[] };
    const found = json.messages.find((message) => message.id === messageId);
    assert.ok(found, `message ${messageId} in read response`);
    return found!;
  }

  async function patchVariant(messageId: number, variantIndex: number): Promise<Response> {
    return variantPatch(
      new Request("http://localhost/api/chat/message/variant", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messageId, variantIndex }),
      })
    );
  }

  function classifier(calls: string[]) {
    return (scope: AdultOffClassifierTurnScope): AdultOffClassify =>
      async (windowText): Promise<AdultOffClassifierResult> => {
        calls.push(windowText);
        const batch = new Database(path.join(process.env.DATA_DIR!, "app.db"));
        try {
          batch.pragma("busy_timeout = 5000");
          batch
            .prepare(
              `INSERT INTO api_cost_ledger (
                 event_key, chat_id, assistant_message_id, generation_sequence, family, funding_class,
                 execution_phase, attempt_ordinal, requested_provider, requested_model, provider, model,
                 request_kind, generation_request_id, event_status, exchange_rate_krw_per_usd, cost_krw,
                 estimated, actual_cost_usd, actual_cost_source, created_at
               ) VALUES (?, 1, ?, 0, 'background', 'platform_funded', 'sync_post_turn', 1, 'cheaperinference',
                 'gpt-6-luna', 'cheaperinference', 'gpt-6-luna', 'adult-off-output-moderation', ?, 'settled',
                 1450, 0, 0, 0.0001, 'cheaper_inference_billed', datetime('now'))`
            )
            .run(`evt-${calls.length}-${Date.now()}`, scope.assistantMessageId, scope.generationRequestId);
        } finally {
          batch.close();
        }
        const restrict = windowText.includes(RESTRICTED);
        return {
          verdict: restrict
            ? { decision: "restrict", category: "sexual_act", confidence: "high", firstParagraph: 0 }
            : { decision: "allow", category: "none", confidence: "high", firstParagraph: -1 },
          usage: {
            model: "mock",
            inputTokens: 1,
            outputTokens: 1,
            costUsd: 0.0001,
            providerRequestId: null,
            latencyMs: 1,
            outcome: "ok",
            httpStatus: null,
          },
        };
      };
  }

  it("shows unreviewed rows as hidden, then reveals exactly what the batch approved", async () => {
    const replies = [
      { kind: "natural", text: "첫 번째 추천 답장입니다. 지금 장면의 분위기를 유지하면서 자연스럽게 이어갑니다." },
      { kind: "twist", text: "두 번째 추천 답장입니다. 예상 밖의 각도로 반응하되 개연성은 지킵니다." },
      { kind: "banter", text: "세 번째 추천 답장입니다. 페르소나 말투로 가볍게 장난치는 반응입니다." },
    ];
    const legacy = seed({
      content: "레거시 위젯 본문",
      widgetJson: JSON.stringify({ character: { location: "교실 복도" }, user: null }),
      statusMeta: {
        meta: { location: "비 오는 골목" },
        extractedAt: "",
        source: "background-deepseek",
        generationSequence: 0,
        generationRequestId: "req-read-legacy",
      },
      replies: {
        items: replies,
        extractedAt: "",
        source: "post-turn-shared",
        generationSequence: 0,
        generationRequestId: "req-read-legacy",
      },
    });
    db.prepare("UPDATE messages SET request_id='req-read-legacy' WHERE id=?").run(legacy);
    const restrictedWidget = seed({
      content: "위젯만 제한된 본문",
      widgetJson: JSON.stringify({ character: { location: `${RESTRICTED} 장소` }, user: null }),
    });

    const hidden = await readMessage(legacy);
    assert.equal(hidden.content, "");
    assert.equal(hidden.statusWidgetValues?.character ?? null, null);
    assert.equal(hidden.statusMeta ?? null, null);
    assert.deepEqual(hidden.suggestedReplies ?? [], []);

    const calls: string[] = [];
    const config = parseAdultOffBatchPaidRunConfig(
      {
        ADULT_OFF_BATCH_MODE: "execute",
        ADULT_OFF_BATCH_RUN_ID: "run-read-path",
        ADULT_OFF_BATCH_CAP_KRW: "100",
        ADULT_OFF_BATCH_APPROVE_PAID: "1",
        ADULT_OFF_BATCH_ALLOW_ISOLATED_PAID: "1",
        ADULT_OFF_BATCH_USD_KRW: "1450",
        ADULT_OFF_BATCH_APPROVED_RATES: "0.07/0.35",
        CHEAPER_INFERENCE_API_KEY: "dummy-not-a-real-key",
      },
      path.join(process.env.DATA_DIR!, "app.db"),
      { stateDir: path.join(workRoot, `state-${randomUUID()}`) }
    );
    const report = await executeAdultOffBatchPaidRun({
      config,
      openDatabase: () => new Database(config.dbPath, { fileMustExist: true }),
      createClassifier: classifier(calls),
    });
    assert.equal(report.stopReason, "completed");
    assert.ok(report.aux.written >= 3);

    const shown = await readMessage(legacy);
    assert.equal(shown.content, "레거시 위젯 본문");
    assert.equal(shown.statusWidgetValues?.character?.location, "교실 복도");
    assert.equal(shown.statusMeta?.location, "비 오는 골목");
    assert.deepEqual(
      shown.suggestedReplies?.map((reply) => reply.text),
      replies.map((reply) => reply.text)
    );
    const restrictedView = await readMessage(restrictedWidget);
    assert.equal(restrictedView.content, "위젯만 제한된 본문");
    assert.equal(restrictedView.statusWidgetValues?.character ?? null, null);
    assert.equal(JSON.stringify(restrictedView).includes(RESTRICTED), false);
  });

  it("switches only to a variant whose body and widget the batch approved", async () => {
    const approvedBody = "승인될 활성 본문";
    const approvedNext = "승인될 다음 변종 본문";
    const restrictedNext = `${RESTRICTED} 다음 변종 본문`;
    const widgetRestrictedNext = "위젯이 제한될 변종 본문";
    const variant = (content: string, widget?: Record<string, string>) => ({
      content,
      model: "test",
      usage: { cost: 1 },
      created_at: "",
      ...(widget ? { statusWidgetValues: { character: widget, user: null } } : {}),
    });
    const okMessage = seed({
      content: approvedBody,
      alternates: [variant(approvedBody), variant(approvedNext, { location: "안전한 장소" })],
      activeVariant: 0,
    });
    const restrictedMessage = seed({
      content: approvedBody,
      alternates: [variant(approvedBody), variant(restrictedNext)],
      activeVariant: 0,
    });
    const widgetMessage = seed({
      content: approvedBody,
      alternates: [
        variant(approvedBody),
        variant(widgetRestrictedNext, { location: `${RESTRICTED} 위젯 장소` }),
      ],
      activeVariant: 0,
    });

    for (const id of [okMessage, restrictedMessage, widgetMessage]) {
      const before = await patchVariant(id, 1);
      assert.equal(before.status, 409, `before batch ${id}`);
      assert.equal(
        (db.prepare("SELECT active_variant FROM messages WHERE id=?").get(id) as { active_variant: number })
          .active_variant,
        0
      );
    }

    const calls: string[] = [];
    const config = parseAdultOffBatchPaidRunConfig(
      {
        ADULT_OFF_BATCH_MODE: "execute",
        ADULT_OFF_BATCH_RUN_ID: "run-variant-path",
        ADULT_OFF_BATCH_CAP_KRW: "100",
        ADULT_OFF_BATCH_APPROVE_PAID: "1",
        ADULT_OFF_BATCH_ALLOW_ISOLATED_PAID: "1",
        ADULT_OFF_BATCH_USD_KRW: "1450",
        ADULT_OFF_BATCH_APPROVED_RATES: "0.07/0.35",
        CHEAPER_INFERENCE_API_KEY: "dummy-not-a-real-key",
      },
      path.join(process.env.DATA_DIR!, "app.db"),
      { stateDir: path.join(workRoot, `state-${randomUUID()}`) }
    );
    const report = await executeAdultOffBatchPaidRun({
      config,
      openDatabase: () => new Database(config.dbPath, { fileMustExist: true }),
      createClassifier: classifier(calls),
    });
    assert.equal(report.stopReason, "completed");

    const allowed = await patchVariant(okMessage, 1);
    assert.equal(allowed.status, 200, await allowed.clone().text());
    const refusedRestricted = await patchVariant(restrictedMessage, 1);
    assert.equal(refusedRestricted.status, 409);
    assert.equal((await refusedRestricted.text()).includes(RESTRICTED), false);
    const refusedWidget = await patchVariant(widgetMessage, 1);
    assert.equal(refusedWidget.status, 409);
    assert.equal((await refusedWidget.text()).includes(RESTRICTED), false);

    const row = db
      .prepare("SELECT content, active_variant FROM messages WHERE id=?")
      .get(okMessage) as { content: string; active_variant: number };
    assert.equal(row.active_variant, 1);
    assert.equal(row.content, approvedNext);
    assert.equal(
      (db.prepare("SELECT active_variant FROM messages WHERE id=?").get(restrictedMessage) as { active_variant: number })
        .active_variant,
      0
    );
    const shown = await readMessage(okMessage);
    assert.equal(shown.content, approvedNext);
    assert.equal(shown.statusWidgetValues?.character?.location, "안전한 장소");
  });
});
