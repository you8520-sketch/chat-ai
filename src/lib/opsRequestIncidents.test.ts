import assert from "node:assert/strict";
import { describe, it } from "node:test";
import Database from "better-sqlite3";
import { listAdminOpsIncidents } from "@/lib/adminOpsInbox";
import { ensurePayoutTransferAttemptsSchema } from "@/lib/payoutTransferAttempts";
import { ensurePointChargeRefundAttemptsSchema } from "@/lib/pointChargeRefundAttempts";
import { ensureSchedulerRunRegistrySchema } from "@/lib/schedulerRunRegistry";
import {
  classifyProductionRequestIncident,
  listOpsRequestIncidentRows,
  observeProductionRequestIncident,
} from "@/lib/opsRequestIncidents";

process.env.DISABLE_PAYOUT_SCHEDULER = "1";
process.env.DISABLE_TRAINING_PIPELINE = "1";
delete process.env.ENABLE_TRAINING_PIPELINE;
delete process.env.DISABLE_FINANCE_SCHEDULER;

const NOW = new Date("2026-09-23T09:00:00.000Z");
const SHA_A = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
const SHA_B = "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";

function db(): Database.Database {
  const value = new Database(":memory:");
  ensurePayoutTransferAttemptsSchema(value);
  ensurePointChargeRefundAttemptsSchema(value);
  ensureSchedulerRunRegistrySchema(value);
  value.exec(`
    CREATE TABLE web_push_outbox (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      subscription_id INTEGER NOT NULL,
      user_id INTEGER NOT NULL,
      event_key TEXT NOT NULL,
      payload_json TEXT NOT NULL,
      attempts INTEGER NOT NULL DEFAULT 0,
      available_at TEXT NOT NULL DEFAULT (datetime('now')),
      sent_at TEXT,
      last_error TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      claim_token TEXT,
      claimed_until TEXT,
      UNIQUE(subscription_id, event_key)
    );
  `);
  return value;
}

function withSha(sha: string | undefined, run: () => void): void {
  const previous = process.env.RAILWAY_GIT_COMMIT_SHA;
  if (sha == null) delete process.env.RAILWAY_GIT_COMMIT_SHA;
  else process.env.RAILWAY_GIT_COMMIT_SHA = sha;
  try {
    run();
  } finally {
    if (previous == null) delete process.env.RAILWAY_GIT_COMMIT_SHA;
    else process.env.RAILWAY_GIT_COMMIT_SHA = previous;
  }
}

function requestIncidents(database: Database.Database) {
  return listAdminOpsIncidents(database, NOW).filter((row) => row.source === "request");
}

describe("production request incidents", () => {
  it("projects a known server failure and aggregates the same signature", () => {
    const database = db();
    withSha(SHA_A, () => {
      observeProductionRequestIncident(
        database,
        {
          routeTemplate: "/api/chat",
          subsystem: "provider",
          error: Object.assign(new Error("upstream closed"), {
            primaryFailureClass: "http_502",
            primaryHttpStatus: 502,
          }),
        },
        NOW
      );
      observeProductionRequestIncident(
        database,
        {
          routeTemplate: "/api/chat",
          subsystem: "provider",
          error: Object.assign(new Error("upstream closed again"), {
            primaryFailureClass: "http_502",
            primaryHttpStatus: 502,
          }),
        },
        new Date("2026-09-23T09:05:00.000Z")
      );
    });

    const incidents = requestIncidents(database);
    assert.equal(incidents.length, 1);
    assert.equal(incidents[0]?.id, "request:/api/chat|provider|http_502");
    assert.equal(incidents[0]?.source, "request");
    assert.equal(incidents[0]?.severity, "critical");
    assert.equal(incidents[0]?.state, "OBSERVED");
    assert.match(incidents[0]?.summary ?? "", /2회/);
    assert.match(incidents[0]?.summary ?? "", /aaaaaaa/);
    assert.doesNotMatch(JSON.stringify(incidents), /upstream closed/);

    const rows = listOpsRequestIncidentRows(database);
    assert.equal(rows.length, 1);
    assert.equal(rows[0]?.occurrence_count, 2);
    assert.equal(rows[0]?.first_seen_at, NOW.toISOString());
    assert.equal(rows[0]?.last_seen_at, "2026-09-23T09:05:00.000Z");
    assert.equal(rows[0]?.first_deployment_sha, SHA_A);
    assert.equal(rows[0]?.latest_deployment_sha, SHA_A);
    database.close();
  });

  it("keeps a different route or error class as a separate incident", () => {
    const database = db();
    observeProductionRequestIncident(
      database,
      { routeTemplate: "/api/chat", subsystem: "stream", error: new Error("pipeline broke") },
      NOW
    );
    observeProductionRequestIncident(
      database,
      {
        routeTemplate: "/api/chat/message",
        subsystem: "http",
        httpStatus: 500,
        error: new Error("edit failed"),
      },
      NOW
    );
    observeProductionRequestIncident(
      database,
      {
        routeTemplate: "/api/chat",
        subsystem: "provider",
        error: Object.assign(new Error("malformed provider response envelope"), {
          failureClass: "malformed_provider_response",
        }),
      },
      NOW
    );

    const incidents = requestIncidents(database);
    const ids = incidents.map((row) => row.id).sort();
    assert.deepEqual(ids, [
      "request:/api/chat/message|http|http_500",
      "request:/api/chat|provider|malformed_provider_response",
      "request:/api/chat|stream|sse_pipeline",
    ]);
    database.close();
  });

  it("does not raise expected 4xx or product-path failures as critical incidents", () => {
    const database = db();
    observeProductionRequestIncident(
      database,
      { routeTemplate: "/api/chat", subsystem: "http", httpStatus: 400, error: new Error("bad request") },
      NOW
    );
    observeProductionRequestIncident(
      database,
      { routeTemplate: "/api/auth/google/callback", subsystem: "auth", httpStatus: 401, error: new Error("google_failed") },
      NOW
    );
    observeProductionRequestIncident(
      database,
      {
        routeTemplate: "/api/chat",
        subsystem: "provider",
        error: Object.assign(new Error("invalid prompt"), {
          failureClass: "http_422",
          httpStatus: 422,
        }),
      },
      NOW
    );
    observeProductionRequestIncident(
      database,
      {
        routeTemplate: "/api/chat",
        subsystem: "provider",
        httpStatus: 429,
        error: new Error("rate limited"),
      },
      NOW
    );
    observeProductionRequestIncident(
      database,
      {
        routeTemplate: "/api/chat",
        subsystem: "stream",
        error: Object.assign(new Error("degenerated"), { name: "DegenerationAbortError" }),
      },
      NOW
    );
    observeProductionRequestIncident(
      database,
      {
        routeTemplate: "/api/chat",
        subsystem: "stream",
        error: Object.assign(new Error("traffic"), { name: "GeminiTrafficOverloadError" }),
      },
      NOW
    );
    observeProductionRequestIncident(
      database,
      {
        routeTemplate: "/api/chat/message",
        subsystem: "http",
        httpStatus: 409,
        error: Object.assign(new Error("boundary"), { name: "MemoryCanonicalityEditNotSupportedError" }),
      },
      NOW
    );
    const aborted = new Error("The operation was aborted");
    aborted.name = "AbortError";
    observeProductionRequestIncident(
      database,
      { routeTemplate: "/api/chat", subsystem: "stream", error: aborted },
      NOW
    );

    assert.equal(requestIncidents(database).length, 0);
    assert.equal(listOpsRequestIncidentRows(database).length, 0);
    assert.equal(
      classifyProductionRequestIncident({
        routeTemplate: "/api/chat",
        subsystem: "auth",
        httpStatus: 500,
        error: new Error("oauth token endpoint unavailable"),
      }).record,
      true
    );
    database.close();
  });

  it("keeps the original result when the incident write fails and does not re-enter", () => {
    const database = db();
    let inserts = 0;
    const originalPrepare = database.prepare.bind(database);
    database.prepare = ((sql: string) => {
      if (sql.includes("INSERT INTO ops_request_incidents")) {
        inserts += 1;
        throw new Error("SQLITE_BUSY database is locked");
      }
      return originalPrepare(sql);
    }) as typeof database.prepare;

    const respond = () => {
      observeProductionRequestIncident(
        database,
        {
          routeTemplate: "/api/chat/message",
          subsystem: "db",
          httpStatus: 500,
          error: new Error("SQLITE_BUSY database is locked"),
        },
        NOW
      );
      return { status: 500, body: "메시지 수정 중 오류가 발생했습니다." };
    };

    assert.deepEqual(respond(), {
      status: 500,
      body: "메시지 수정 중 오류가 발생했습니다.",
    });
    assert.equal(inserts, 1);

    const originalExec = database.exec.bind(database);
    database.exec = ((sql: string) => {
      observeProductionRequestIncident(database, {
        routeTemplate: "/api/chat",
        subsystem: "http",
        httpStatus: 500,
      });
      return originalExec(sql);
    }) as typeof database.exec;
    assert.doesNotThrow(() =>
      observeProductionRequestIncident(
        database,
        { routeTemplate: "/api/chat", subsystem: "http", httpStatus: 500 },
        NOW
      )
    );
    database.close();
  });

  it("does not store raw bodies, prompts, query values, or account identifiers", () => {
    const database = db();
    const secret =
      "prompt=private-rp-line user@example.com Bearer super-secret cookie=sessionid body={\"memory\":\"home address\"}";
    observeProductionRequestIncident(
      database,
      {
        routeTemplate: `/api/chat/42?access_token=${secret}&q=hello`,
        subsystem: "stream",
        error: new Error(secret),
      },
      NOW
    );
    observeProductionRequestIncident(
      database,
      {
        routeTemplate: "/api/chat/aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee",
        subsystem: "provider",
        error: Object.assign(new Error(secret), {
          failureClass: "headers_timeout",
        }),
      },
      NOW
    );

    const stored = JSON.stringify(listOpsRequestIncidentRows(database));
    const projected = JSON.stringify(requestIncidents(database));
    for (const blob of [stored, projected]) {
      assert.equal(blob.includes(secret), false);
      assert.equal(blob.includes("private-rp-line"), false);
      assert.equal(blob.includes("user@example.com"), false);
      assert.equal(blob.includes("super-secret"), false);
      assert.equal(blob.includes("sessionid"), false);
      assert.equal(blob.includes("home address"), false);
      assert.equal(blob.includes("access_token"), false);
    }
    assert.match(stored, /\/api\/chat\/:id\|stream\|sse_pipeline/);
    assert.match(stored, /\/api\/chat\/:id\|provider\|headers_timeout/);
    database.close();
  });

  it("correlates a deployment SHA change on the same signature", () => {
    const database = db();
    withSha(SHA_A, () => {
      observeProductionRequestIncident(
        database,
        { routeTemplate: "/api/chat", subsystem: "http", httpStatus: 500 },
        NOW
      );
    });
    withSha("not-a-sha", () => {
      observeProductionRequestIncident(
        database,
        { routeTemplate: "/api/chat", subsystem: "http", httpStatus: 500 },
        new Date("2026-09-23T09:10:00.000Z")
      );
    });
    withSha(SHA_B, () => {
      observeProductionRequestIncident(
        database,
        { routeTemplate: "/api/chat", subsystem: "http", httpStatus: 500 },
        new Date("2026-09-23T09:20:00.000Z")
      );
    });

    const rows = listOpsRequestIncidentRows(database);
    assert.equal(rows.length, 1);
    assert.equal(rows[0]?.occurrence_count, 3);
    assert.equal(rows[0]?.first_deployment_sha, SHA_A);
    assert.equal(rows[0]?.latest_deployment_sha, SHA_B);
    const incident = requestIncidents(database)[0];
    assert.match(incident?.summary ?? "", /aaaaaaa/);
    assert.match(incident?.summary ?? "", /bbbbbbb/);
    assert.equal(incident?.summary.includes(SHA_A), false);
    database.close();
  });

  it("classifies provider timeouts and database failures apart from user validation", () => {
    const timeout = classifyProductionRequestIncident({
      routeTemplate: "/api/chat",
      subsystem: "provider",
      error: new Error("aborted due to timeout"),
    });
    const databaseFailure = classifyProductionRequestIncident({
      routeTemplate: "/api/chat/message",
      subsystem: "db",
      httpStatus: 500,
      error: new Error("SQLITE_BUSY database is locked while updating messages"),
    });
    const validation = classifyProductionRequestIncident({
      routeTemplate: "/api/chat",
      subsystem: "provider",
      httpStatus: 400,
      error: new Error("SQLITE_BUSY should not promote a 400"),
    });
    const malformedOkStatus = classifyProductionRequestIncident({
      routeTemplate: "/api/chat",
      subsystem: "provider",
      error: Object.assign(new Error("malformed provider response envelope"), {
        failureClass: "malformed_provider_response",
        httpStatus: 200,
      }),
    });
    assert.equal(timeout.record, true);
    if (timeout.record) assert.equal(timeout.errorClass, "timeout");
    assert.equal(databaseFailure.record, true);
    if (databaseFailure.record) {
      assert.equal(databaseFailure.subsystem, "db");
      assert.equal(databaseFailure.errorClass, "db_failure");
    }
    assert.equal(validation.record, false);
    assert.equal(malformedOkStatus.record, true);
    if (malformedOkStatus.record) {
      assert.equal(malformedOkStatus.errorClass, "malformed_provider_response");
      assert.equal(malformedOkStatus.httpStatus, null);
    }
  });
});
