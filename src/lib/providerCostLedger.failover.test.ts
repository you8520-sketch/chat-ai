import assert from "node:assert/strict";
import Database from "better-sqlite3";
import { describe, it } from "node:test";
import { ensureAdminFinanceTables } from "./adminFinance";
import {
  buildPlatformAsyncTurnLedgerContext,
  ensureProviderCostLedgerSchema,
  finalizeProviderCostAttempt,
  listProviderCostEventsForAssistantMessage,
  startProviderCostAttempt,
} from "./providerCostLedger";
import { executeDeepSeekWithProviderFailover } from "./deepseekProviderFailover";
import { OPENROUTER_DEEPSEEK_V4_FLASH_0731_BACKUP_MODEL } from "./chatModels";

function createLedgerTestDb(): Database.Database {
  const db = new Database(":memory:");
  db.exec(`
    CREATE TABLE IF NOT EXISTS point_gifts (id INTEGER PRIMARY KEY);
    CREATE TABLE IF NOT EXISTS chat_image_generations (id INTEGER PRIMARY KEY);
  `);
  ensureAdminFinanceTables(db);
  ensureProviderCostLedgerSchema(db);
  return db;
}

describe("providerCostLedger failover integration", () => {
  it("R5 — CI primary fail + OpenRouter backup success creates two ledger events", async () => {
    const db = createLedgerTestDb();
    const ledgerBase = {
      ...buildPlatformAsyncTurnLedgerContext({
        chatId: 5,
        assistantMessageId: 88,
        generationSequence: 0,
        family: "suggested_replies_repair",
        jobAttemptOrdinal: 1,
        requestedModel: "deepseek-v4-flash",
      }),
      persistInTests: true,
    };
    const handles = new Map<number, ReturnType<typeof startProviderCostAttempt>>();

    let fetchCount = 0;
    const fetchFn = async (_url: string, _init?: RequestInit) => {
      fetchCount += 1;
      if (fetchCount === 1) {
        return new Response(JSON.stringify({ error: "upstream unavailable" }), {
          status: 503,
          headers: { "content-type": "application/json" },
        });
      }
      return new Response(
        JSON.stringify({
          choices: [{ message: { content: "ok" }, finish_reason: "stop" }],
          usage: {
            prompt_tokens: 10,
            completion_tokens: 5,
            cost: 0.001,
          },
        }),
        { status: 200, headers: { "content-type": "application/json" } }
      );
    };

    await executeDeepSeekWithProviderFailover({
      routeKind: "background_flash",
      logicalModel: "flash",
      primary: {
        endpoint: "https://ci.example/v1/chat/completions",
        headers: { authorization: "Bearer test" },
        body: { model: "deepseek-v4-flash", messages: [], stream: false },
      },
      backupBody: {
        model: OPENROUTER_DEEPSEEK_V4_FLASH_0731_BACKUP_MODEL,
        messages: [],
        stream: false,
      },
      stream: false,
      hooks: {
        fetchFn: fetchFn as typeof fetch,
        onPhysicalAttemptStart: (info) => {
          handles.set(
            info.physicalAttemptOrdinal,
            startProviderCostAttempt(
              {
                ...ledgerBase,
                physicalAttemptOrdinal: info.physicalAttemptOrdinal,
                requestedProvider: info.provider,
                requestedModel: info.model,
              },
              db
            )
          );
        },
        onPhysicalAttemptFinish: (info) => {
          if (info.success) return;
          const handle = handles.get(info.physicalAttemptOrdinal);
          if (!handle) return;
          finalizeProviderCostAttempt(
            handle,
            {
              actualProvider: info.provider,
              actualModel: info.model,
              outcome: "failed_without_usage",
            },
            db
          );
        },
      },
    });

    const backupHandle = handles.get(2);
    assert.ok(backupHandle);
    finalizeProviderCostAttempt(
      backupHandle!,
      {
        actualProvider: "openrouter",
        actualModel: OPENROUTER_DEEPSEEK_V4_FLASH_0731_BACKUP_MODEL,
        upstreamCostUsd: 0.001,
        usageEstimated: false,
        outcome: "success",
      },
      db
    );

    const rows = listProviderCostEventsForAssistantMessage(88, db);
    assert.equal(rows.length, 2);
    assert.equal(rows[0]?.actual_provider, "cheaperinference");
    assert.equal(rows[1]?.actual_provider, "openrouter");
    assert.notEqual(rows[0]?.event_key, rows[1]?.event_key);
    assert.equal(fetchCount, 2);
  });
});
