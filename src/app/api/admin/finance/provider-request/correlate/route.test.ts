import Module from "module";

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
import { randomUUID } from "node:crypto";
import { after, before, beforeEach, describe, it } from "node:test";
import {
  installIsolatedTestDatabase,
  uninstallIsolatedTestDatabase,
} from "@/lib/test/isolatedTestDatabase";
import { ensureAdminFinanceTables } from "@/lib/adminFinance";
import {
  ensureProviderCostLedgerSchema,
  recordBackgroundProviderCost,
} from "@/lib/providerCostLedger";

const NORMAL_USER_ID = 94001;
const ADMIN_USER_ID = 94002;
let createSession: (userId: number) => string;
let getDb: typeof import("@/lib/db").getDb;
let POST: typeof import("./route").POST;

function insertUser(id: number, email: string, isAdmin: number) {
  const db = getDb();
  db.prepare("INSERT INTO users (id, email, nickname, pw_hash) VALUES (?, ?, ?, ?)").run(
    id,
    email,
    `user-${id}`,
    "test"
  );
  db.prepare("UPDATE users SET is_admin=? WHERE id=?").run(isAdmin, id);
}

function insertCorrelationRow(
  createdAt: string,
  inputTokens: number,
  outputTokens: number
) {
  getDb()
    .prepare(
      `INSERT INTO api_cost_ledger
        (event_key, provider, model, request_kind, input_tokens, output_tokens,
         exchange_rate_krw_per_usd, cost_krw, estimated, actual_cost_usd,
         actual_cost_source, event_status, provider_request_id, family,
         execution_phase, funding_class, created_at)
       VALUES (?, 'cheaperinference', 'gpt-5.6-luna', 'background-prompt-translation', ?, ?,
         1500, 1.5, 0, 0.0017, 'cheaper_inference_billed', 'settled', NULL,
         'background', 'async_post_turn', 'platform_funded', ?)`
    )
    .run(randomUUID(), inputTokens, outputTokens, createdAt);
}

describe("admin finance provider-request correlate route", () => {
  before(() => {
    installIsolatedTestDatabase();
    return Promise.all([
      import("@/lib/auth").then((auth) => {
        createSession = auth.createSession;
      }),
      import("@/lib/db").then((db) => {
        getDb = db.getDb;
      }),
      import("./route").then((route) => {
        POST = route.POST;
      }),
    ]).then(() => {
      insertUser(NORMAL_USER_ID, "normal-correlate@example.com", 0);
      insertUser(ADMIN_USER_ID, "admin-correlate@example.com", 1);
      ensureAdminFinanceTables(getDb());
      ensureProviderCostLedgerSchema(getDb());
    });
  });

  beforeEach(() => {
    sessionToken = "";
    getDb().exec("DELETE FROM api_cost_ledger");
  });

  after(() => {
    global.__db?.close();
    global.__db = undefined;
    uninstallIsolatedTestDatabase();
    Module._load = originalLoad;
  });

  it("forbids non-admin users", async () => {
    sessionToken = createSession(NORMAL_USER_ID);
    const response = await POST(
      new Request("http://localhost/api/admin/finance/provider-request/correlate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model: "gpt-5.6-luna",
          requestedAtUtc: "2026-09-19T13:42:44.316Z",
          durationMs: 12970,
          originalInputTokens: 6564,
          sentToModelTokens: 8553,
          outputTokens: 1655,
        }),
      })
    );
    assert.equal(response.status, 403);
  });

  it("returns 400 when required fields are missing", async () => {
    sessionToken = createSession(ADMIN_USER_ID);
    const response = await POST(
      new Request("http://localhost/api/admin/finance/provider-request/correlate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ model: "gpt-5.6-luna" }),
      })
    );
    assert.equal(response.status, 400);
  });

  it("returns NO_CANDIDATE when no matching ledger row exists", async () => {
    sessionToken = createSession(ADMIN_USER_ID);
    const response = await POST(
      new Request("http://localhost/api/admin/finance/provider-request/correlate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model: "gpt-5.6-luna",
          requestedAtUtc: "2026-09-19T13:42:44.316Z",
          durationMs: 12970,
          originalInputTokens: 6564,
          sentToModelTokens: 8553,
          outputTokens: 1655,
        }),
      })
    );
    assert.equal(response.status, 200);
    const body = (await response.json()) as { state: string; candidates: unknown[] };
    assert.equal(body.state, "NO_CANDIDATE");
    assert.equal(body.candidates.length, 0);
  });

  it("returns EXACT_SINGLE_CANDIDATE for NULL provider_request_id background row", async () => {
    insertCorrelationRow("2026-09-19 13:42:57", 8553, 1655);
    sessionToken = createSession(ADMIN_USER_ID);
    const response = await POST(
      new Request("http://localhost/api/admin/finance/provider-request/correlate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model: "gpt-5.6-luna",
          requestedAtUtc: "2026-09-19T13:42:44.316Z",
          durationMs: 12970,
          originalInputTokens: 6564,
          sentToModelTokens: 8553,
          outputTokens: 1655,
        }),
      })
    );
    assert.equal(response.status, 200);
    const body = (await response.json()) as {
      state: string;
      candidates: Array<{
        event: Record<string, unknown>;
        evidence: Record<string, unknown>;
      }>;
    };
    assert.equal(body.state, "EXACT_SINGLE_CANDIDATE");
    assert.equal(body.candidates.length, 1);
    for (const key of ["prompt", "messages", "content", "authorization", "apiKey", "rawResponse", "responseBody"]) {
      assert.equal(key in body.candidates[0]!.event, false, `forbidden key leaked: ${key}`);
    }
  });

  it("leaves exact provider request id lookup behavior unchanged", async () => {
    const requestId = `route-exact-${randomUUID()}`;
    recordBackgroundProviderCost(
      {
        provider: "cheaperinference",
        model: "gpt-5.6-luna",
        requestKind: "background-prompt-translation",
        inputTokens: 8553,
        outputTokens: 1655,
        cheaperInferenceBilledCostUsd: 0.0017,
        providerRequestId: requestId,
        persistInTests: true,
      },
      getDb()
    );

    const { GET } = await import("../route");
    sessionToken = createSession(ADMIN_USER_ID);
    const response = await GET(
      new Request(
        `http://localhost/api/admin/finance/provider-request?providerRequestId=${encodeURIComponent(requestId)}`
      )
    );
    assert.equal(response.status, 200);
    const body = (await response.json()) as { found: boolean; event: { providerRequestId: string } };
    assert.equal(body.found, true);
    assert.equal(body.event.providerRequestId, requestId);
  });
});
