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
import { after, before, beforeEach, describe, it } from "node:test";
import {
  installIsolatedTestDatabase,
  uninstallIsolatedTestDatabase,
} from "@/lib/test/isolatedTestDatabase";
import { RECONCILIATION_ROOT_CAUSE_UNCONFIRMED } from "@/lib/adminFinanceReconciliationDiagnose";
import { RECONCILIATION_REMOTE_UNVERIFIED } from "@/lib/adminFinanceReconciliationRemoteCompare";

const NORMAL_USER_ID = 94001;
const ADMIN_USER_ID = 94002;
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

describe("admin finance GET reconciliation diagnose", () => {
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
      insertUser(NORMAL_USER_ID, "normal-finance-diag@example.com", 0);
      insertUser(ADMIN_USER_ID, "admin-finance-diag@example.com", 1);
    });
  });

  beforeEach(() => {
    sessionToken = "";
  });

  after(() => {
    global.__db?.close();
    global.__db = undefined;
    uninstallIsolatedTestDatabase();
    Module._load = originalLoad;
  });

  it("forbids non-admin users", async () => {
    sessionToken = createSession(NORMAL_USER_ID);
    const response = await GET(new Request("http://localhost/api/admin/finance"));
    assert.equal(response.status, 403);
  });

  it("omits reconciliationDiagnosis unless diagnose=reconciliation is requested", async () => {
    sessionToken = createSession(ADMIN_USER_ID);
    const response = await GET(
      new Request("http://localhost/api/admin/finance?month=2026-10")
    );
    assert.equal(response.status, 200);
    const body = (await response.json()) as {
      summary: { monthKey: string };
      reconciliationDiagnosis?: unknown;
    };
    assert.equal(body.summary.monthKey, "2026-10");
    assert.equal("reconciliationDiagnosis" in body, false);
  });

  it("rejects an unknown diagnose value without running a write path", async () => {
    sessionToken = createSession(ADMIN_USER_ID);
    const before = (
      getDb().prepare("SELECT COUNT(*) AS c FROM api_cost_ledger").get() as { c: number }
    ).c;
    const response = await GET(
      new Request("http://localhost/api/admin/finance?month=2026-10&diagnose=rewrite")
    );
    assert.equal(response.status, 400);
    const after = (
      getDb().prepare("SELECT COUNT(*) AS c FROM api_cost_ledger").get() as { c: number }
    ).c;
    assert.equal(after, before);
  });

  it("returns aggregate-only diagnosis when explicitly requested", async () => {
    sessionToken = createSession(ADMIN_USER_ID);
    const response = await GET(
      new Request(
        "http://localhost/api/admin/finance?month=2026-10&diagnose=reconciliation"
      )
    );
    assert.equal(response.status, 200);
    const body = (await response.json()) as {
      summary: { monthKey: string };
      reconciliationDiagnosis: {
        evidence: { classification: string; remotePerRequestDataAvailable: boolean };
        ledgerInWindow: { rows: number };
      };
    };
    assert.equal(body.summary.monthKey, "2026-10");
    assert.equal(
      body.reconciliationDiagnosis.evidence.classification,
      RECONCILIATION_ROOT_CAUSE_UNCONFIRMED
    );
    assert.equal(body.reconciliationDiagnosis.evidence.remotePerRequestDataAvailable, false);
    assert.equal(typeof body.reconciliationDiagnosis.ledgerInWindow.rows, "number");
    assert.equal("providerRequestId" in body.reconciliationDiagnosis, false);
    assert.equal("user_id" in body.reconciliationDiagnosis, false);
  });

  it("keeps the local diagnosis path unchanged when remote compare is not requested", async () => {
    sessionToken = createSession(ADMIN_USER_ID);
    const response = await GET(
      new Request(
        "http://localhost/api/admin/finance?month=2026-10&diagnose=reconciliation"
      )
    );
    const body = (await response.json()) as {
      reconciliationDiagnosis?: unknown;
      reconciliationRemoteCompare?: unknown;
    };
    assert.equal("reconciliationDiagnosis" in body, true);
    assert.equal("reconciliationRemoteCompare" in body, false);
  });

  it("returns remote-compare aggregates only when explicitly requested", async () => {
    sessionToken = createSession(ADMIN_USER_ID);
    const before = (
      getDb().prepare("SELECT COUNT(*) AS c FROM api_cost_ledger").get() as { c: number }
    ).c;
    const response = await GET(
      new Request(
        "http://localhost/api/admin/finance?month=2026-10&diagnose=reconciliation-remote"
      )
    );
    assert.equal(response.status, 200);
    const body = (await response.json()) as {
      summary: { monthKey: string };
      reconciliationDiagnosis?: unknown;
      reconciliationRemoteCompare: {
        evidence: { classification: string };
        remote: { fetchStatus: string };
      };
    };
    assert.equal(body.summary.monthKey, "2026-10");
    assert.equal("reconciliationDiagnosis" in body, false);
    assert.equal(
      body.reconciliationRemoteCompare.evidence.classification,
      RECONCILIATION_REMOTE_UNVERIFIED
    );
    assert.equal(body.reconciliationRemoteCompare.remote.fetchStatus, "no_key");
    assert.equal("apiKeyGroups" in body.reconciliationRemoteCompare, false);
    const after = (
      getDb().prepare("SELECT COUNT(*) AS c FROM api_cost_ledger").get() as { c: number }
    ).c;
    assert.equal(after, before);
  });

  it("adds anonymous API-key groups only when keyGroups=1 is requested", async () => {
    sessionToken = createSession(ADMIN_USER_ID);
    const before = (
      getDb().prepare("SELECT COUNT(*) AS c FROM api_cost_ledger").get() as { c: number }
    ).c;
    const response = await GET(
      new Request(
        "http://localhost/api/admin/finance?month=2026-10&diagnose=reconciliation-remote&keyGroups=1"
      )
    );
    assert.equal(response.status, 200);
    const body = (await response.json()) as {
      reconciliationRemoteCompare: {
        apiKeyGroups?: {
          productionKeyMapping: string;
          totalsMatchRemoteSettled: boolean;
        };
      };
    };
    // A no-key remote read is unverified, not a successful empty grouping.
    assert.equal(body.reconciliationRemoteCompare.apiKeyGroups, undefined);
    const raw = JSON.stringify(body.reconciliationRemoteCompare);
    assert.equal(raw.includes("api_key_name"), false);
    assert.equal(raw.includes("api_key_id"), false);
    const after = (
      getDb().prepare("SELECT COUNT(*) AS c FROM api_cost_ledger").get() as { c: number }
    ).c;
    assert.equal(after, before);
  });
});
