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

const NORMAL_USER_ID = 93001;
const ADMIN_USER_ID = 93002;
let createSession: (userId: number) => string;
let getDb: typeof import("@/lib/db").getDb;
let GET: typeof import("./route").GET;

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

describe("admin finance provider-request lookup route", () => {
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
        GET = route.GET;
      }),
    ]).then(() => {
      insertUser(NORMAL_USER_ID, "normal-finance@example.com", 0);
      insertUser(ADMIN_USER_ID, "admin-finance@example.com", 1);
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
    const response = await GET(
      new Request(
        "http://localhost/api/admin/finance/provider-request?providerRequestId=abc"
      )
    );
    assert.equal(response.status, 403);
  });

  it("returns 400 when providerRequestId is missing", async () => {
    sessionToken = createSession(ADMIN_USER_ID);
    const response = await GET(
      new Request("http://localhost/api/admin/finance/provider-request")
    );
    assert.equal(response.status, 400);
  });

  it("returns found=false for unknown provider request id", async () => {
    sessionToken = createSession(ADMIN_USER_ID);
    const response = await GET(
      new Request(
        "http://localhost/api/admin/finance/provider-request?providerRequestId=00000000-0000-0000-0000-000000000000"
      )
    );
    assert.equal(response.status, 200);
    const body = (await response.json()) as {
      found: boolean;
      event: unknown;
      matchingRowCount: number;
      duplicateDetected: boolean;
    };
    assert.equal(body.found, false);
    assert.equal(body.event, null);
    assert.equal(body.matchingRowCount, 0);
    assert.equal(body.duplicateDetected, false);
  });

  it("returns one canonical event for an exact existing provider request id", async () => {
    const requestId = `route-${randomUUID()}`;
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

    sessionToken = createSession(ADMIN_USER_ID);
    const response = await GET(
      new Request(
        `http://localhost/api/admin/finance/provider-request?providerRequestId=${encodeURIComponent(requestId)}`
      )
    );
    assert.equal(response.status, 200);
    const body = (await response.json()) as {
      found: boolean;
      matchingRowCount: number;
      duplicateDetected: boolean;
      event: {
        providerRequestId: string;
        requestKind: string;
        assistantMessageId: number | null;
        inputTokens: number;
        outputTokens: number;
      };
    };
    assert.equal(body.found, true);
    assert.equal(body.matchingRowCount, 1);
    assert.equal(body.duplicateDetected, false);
    assert.equal(body.event.providerRequestId, requestId);
    assert.equal(body.event.requestKind, "background-prompt-translation");
    assert.equal(body.event.assistantMessageId, null);
    assert.equal(body.event.inputTokens, 8553);
    assert.equal(body.event.outputTokens, 1655);
    for (const key of ["prompt", "messages", "content", "authorization", "apiKey", "rawResponse", "responseBody"]) {
      assert.equal(key in body.event, false, `forbidden key leaked: ${key}`);
    }
  });
});
