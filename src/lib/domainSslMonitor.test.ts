import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";

import { scanScheduledWorkflowDefinitions } from "@/lib/codeHealth/automationHealth";
import { projectGithubAutomationIncidents } from "@/lib/adminOpsInbox";
import {
  classifyCertificateExpiry,
  DOMAIN_SSL_CRITICAL_DAYS,
  DOMAIN_SSL_EVIDENCE_PREFIX,
  DOMAIN_SSL_HOSTNAME,
  DOMAIN_SSL_WARN_DAYS,
  DOMAIN_SSL_WORKFLOW_PATH,
  monitorOfficialDomain,
  parseDomainSslEvidence,
  projectDomainSslMonitor,
  rollupDomainSslState,
  withTimeout,
  type DomainSslPorts,
  type DnsProbe,
  type HealthProbe,
} from "@/lib/domainSslMonitor";
import { fetchDomainSslMonitorProjection } from "@/lib/adminAutomationReports";

const ROOT = path.resolve(__dirname, "../..");
const NOW = new Date("2026-10-01T12:00:00.000Z");

function daysFromNow(days: number): number {
  return NOW.getTime() + days * 86_400_000;
}

function ports(overrides: Partial<DomainSslPorts>): DomainSslPorts {
  return {
    resolveDns: async () => ({ kind: "ok", addressCount: 2 }),
    connectTls: async () => ({
      kind: "connected",
      authorized: true,
      authorizationError: null,
      hostnameOk: true,
      validToMs: daysFromNow(90),
    }),
    fetchHealth: async () => ({ kind: "ok" }),
    ...overrides,
  };
}

async function run(overrides: Partial<DomainSslPorts>, extra?: { sleepCalls?: number[] }) {
  const sleepCalls: number[] = extra?.sleepCalls ?? [];
  return monitorOfficialDomain({
    ports: ports(overrides),
    now: () => NOW,
    sleep: async (ms) => {
      sleepCalls.push(ms);
    },
    budgetMs: 20_000,
    timeoutMs: 50,
    retryDelayMs: 10,
    maxAttempts: 3,
  });
}

describe("domain ssl timeout regression", () => {
  it("rejects a thrown DNS timeout sentinel without crashing the Node timer callback", async () => {
    const pending = new Promise<never>(() => {});
    await assert.rejects(
      withTimeout(pending, 1, () => {
        throw Object.assign(new Error("dns_timeout"), { code: "ETIMEOUT" });
      }),
      (error: unknown) =>
        error instanceof Error &&
        error.message === "dns_timeout" &&
        (error as Error & { code?: string }).code === "ETIMEOUT"
    );
  });

  it("preserves a successfully completed probe result", async () => {
    assert.equal(await withTimeout(Promise.resolve("resolved"), 100, () => "timeout"), "resolved");
  });
});

describe("domain ssl policy", () => {
  it("classifies expiry at the canonical 21-day warning and 7-day critical thresholds", () => {
    assert.equal(classifyCertificateExpiry(30), "OK");
    assert.equal(classifyCertificateExpiry(DOMAIN_SSL_WARN_DAYS), "WARNING");
    assert.equal(classifyCertificateExpiry(21), "WARNING");
    assert.equal(classifyCertificateExpiry(DOMAIN_SSL_CRITICAL_DAYS), "WARNING");
    assert.equal(classifyCertificateExpiry(6.9), "FAIL");
    assert.equal(classifyCertificateExpiry(0), "FAIL");
    assert.equal(classifyCertificateExpiry(-1), "FAIL");
    assert.equal(classifyCertificateExpiry(Number.NaN), "UNVERIFIED");
    assert.equal(rollupDomainSslState(["OK", "WARNING", "UNVERIFIED"]), "UNVERIFIED");
    assert.equal(rollupDomainSslState(["WARNING", "OK"]), "WARNING");
    assert.equal(rollupDomainSslState(["FAIL", "UNVERIFIED"]), "FAIL");
  });
});

describe("domain ssl monitor fixtures", () => {
  it("accepts a normal domain, trusted certificate, and health contract", async () => {
    const evidence = await run({});
    assert.equal(evidence.state, "OK");
    assert.equal(evidence.hostname, DOMAIN_SSL_HOSTNAME);
    assert.equal(evidence.dns.state, "OK");
    assert.equal(evidence.dns.addressCount, 2);
    assert.equal(evidence.tls.state, "OK");
    assert.equal(evidence.tls.hostnameOk, true);
    assert.equal(evidence.tls.authorized, true);
    assert.equal(evidence.health.state, "OK");
    assert.equal(evidence.reason, null);
  });

  it("fails closed on NXDOMAIN", async () => {
    const evidence = await run({
      resolveDns: async () => ({ kind: "not_found" }),
    });
    assert.equal(evidence.state, "FAIL");
    assert.equal(evidence.dns.reason, "dns_not_found");
    assert.equal(evidence.tls.reason, "not_run");
    assert.equal(evidence.health.reason, "not_run");
  });

  it("retries a transient DNS error then succeeds", async () => {
    const probes: DnsProbe[] = [
      { kind: "error", retryable: true, reason: "EAGAIN" },
      { kind: "ok", addressCount: 1 },
    ];
    const sleeps: number[] = [];
    const evidence = await run(
      { resolveDns: async () => probes.shift() ?? { kind: "ok", addressCount: 1 } },
      { sleepCalls: sleeps }
    );
    assert.equal(evidence.state, "OK");
    assert.equal(evidence.dns.state, "OK");
    assert.ok(sleeps.length >= 1);
  });

  it("fails when the certificate hostname does not match", async () => {
    const evidence = await run({
      connectTls: async () => ({
        kind: "connected",
        authorized: false,
        authorizationError: "Hostname/IP does not match certificate's altnames",
        hostnameOk: false,
        validToMs: daysFromNow(90),
      }),
    });
    assert.equal(evidence.state, "FAIL");
    assert.equal(evidence.tls.reason, "tls_hostname_mismatch");
    assert.equal(evidence.health.reason, "not_run");
  });

  it("fails when the certificate chain is not trusted", async () => {
    const evidence = await run({
      connectTls: async () => ({
        kind: "connected",
        authorized: false,
        authorizationError: "self-signed certificate",
        hostnameOk: true,
        validToMs: daysFromNow(90),
      }),
    });
    assert.equal(evidence.state, "FAIL");
    assert.equal(evidence.tls.reason, "self-signed certificate");
    assert.equal(evidence.tls.authorized, false);
  });

  it("warns when the certificate expires in 21 days", async () => {
    const evidence = await run({
      connectTls: async () => ({
        kind: "connected",
        authorized: true,
        authorizationError: null,
        hostnameOk: true,
        validToMs: daysFromNow(21),
      }),
    });
    assert.equal(evidence.state, "WARNING");
    assert.equal(evidence.tls.state, "WARNING");
    assert.equal(evidence.tls.reason, "tls_expiry_warning");
    assert.equal(evidence.health.state, "OK");
  });

  it("fails when the certificate is inside the 7-day critical window", async () => {
    const evidence = await run({
      connectTls: async () => ({
        kind: "connected",
        authorized: true,
        authorizationError: null,
        hostnameOk: true,
        validToMs: daysFromNow(6),
      }),
    });
    assert.equal(evidence.state, "FAIL");
    assert.equal(evidence.tls.reason, "tls_expiry_critical");
  });

  it("fails when the certificate is already expired", async () => {
    const evidence = await run({
      connectTls: async () => ({
        kind: "connected",
        authorized: true,
        authorizationError: null,
        hostnameOk: true,
        validToMs: daysFromNow(-1),
      }),
    });
    assert.equal(evidence.state, "FAIL");
    assert.equal(evidence.tls.reason, "tls_expired");
  });

  it("keeps a 30-day remaining certificate as OK", async () => {
    const evidence = await run({
      connectTls: async () => ({
        kind: "connected",
        authorized: true,
        authorizationError: null,
        hostnameOk: true,
        validToMs: daysFromNow(30),
      }),
    });
    assert.equal(evidence.state, "OK");
    assert.equal(evidence.tls.state, "OK");
  });

  it("marks a handshake timeout unverified", async () => {
    const evidence = await run({
      connectTls: async () => ({ kind: "timeout" }),
    });
    assert.equal(evidence.state, "UNVERIFIED");
    assert.equal(evidence.tls.reason, "tls_timeout");
  });

  it("retries a transient 503 then succeeds", async () => {
    const probes: HealthProbe[] = [
      { kind: "http", status: 503, retryable: true },
      { kind: "ok" },
    ];
    const evidence = await run({
      fetchHealth: async () => probes.shift() ?? { kind: "ok" },
    });
    assert.equal(evidence.state, "OK");
    assert.equal(evidence.health.state, "OK");
  });

  it("fails a persistent 502/503/504 after bounded retries", async () => {
    for (const status of [502, 503, 504]) {
      const evidence = await run({
        fetchHealth: async () => ({ kind: "http", status, retryable: true }),
      });
      assert.equal(evidence.state, "FAIL");
      assert.equal(evidence.health.reason, `health_http_${status}`);
    }
  });

  it("fails an external redirect and a 200 error body", async () => {
    const redirect = await run({
      fetchHealth: async () => ({ kind: "redirect", external: true }),
    });
    assert.equal(redirect.state, "FAIL");
    assert.equal(redirect.health.reason, "external_redirect");

    const badBody = await run({
      fetchHealth: async () => ({ kind: "contract", reason: "health_contract" }),
    });
    assert.equal(badBody.state, "FAIL");
    assert.equal(badBody.health.reason, "health_contract");
  });

  it("marks a health timeout unverified", async () => {
    const evidence = await run({
      fetchHealth: async () => ({ kind: "timeout" }),
    });
    assert.equal(evidence.state, "UNVERIFIED");
    assert.equal(evidence.health.reason, "health_timeout");
  });
});

describe("domain ssl evidence and admin projection", () => {
  it("parses evidence and keeps a warning distinct from a successful job conclusion", () => {
    const json = {
      state: "WARNING",
      hostname: "hav.chat",
      checkedAt: "2026-10-01T12:00:00.000Z",
      attempts: 3,
      reason: "tls_expiry_warning",
      dns: { state: "OK", reason: null, addressCount: 1 },
      tls: {
        state: "WARNING",
        reason: "tls_expiry_warning",
        daysLeft: 21,
        hostnameOk: true,
        authorized: true,
      },
      health: { state: "OK", reason: null },
    };
    const parsed = parseDomainSslEvidence(`${DOMAIN_SSL_EVIDENCE_PREFIX}${JSON.stringify(json)}`);
    assert.equal(parsed?.state, "WARNING");
    const view = projectDomainSslMonitor({
      runs: [
        {
          runId: 9,
          htmlUrl: "https://github.test/runs/9",
          createdAt: "2026-10-01T12:01:00.000Z",
          conclusion: "success",
          evidence: parsed,
        },
      ],
    });
    assert.equal(view.status, "OK");
    assert.equal(view.latest?.state, "WARNING");
    assert.equal(view.latest?.runConclusion, "success");
    assert.notEqual(view.latest?.state, "OK");
  });

  it("treats a completed run without evidence as unverified", () => {
    const view = projectDomainSslMonitor({
      runs: [
        {
          runId: 2,
          htmlUrl: "https://github.test/runs/2",
          createdAt: "2026-10-01T12:01:00.000Z",
          conclusion: "success",
          evidence: null,
        },
      ],
    });
    assert.equal(view.latest?.state, "UNVERIFIED");
    assert.equal(view.latest?.reason, "evidence_missing");
  });

  it("waits for the first live run when no workflow history exists", () => {
    const view = projectDomainSslMonitor({ runs: [] });
    assert.equal(view.latest?.state, "UNVERIFIED");
    assert.equal(view.latest?.reason, "awaiting_live_run");
  });

  it("fails closed when GitHub cannot be read", async () => {
    const view = await fetchDomainSslMonitorProjection(async () => new Response("nope", { status: 503 }));
    assert.equal(view.status, "UNAVAILABLE");
    assert.equal(view.latest, null);
  });

  it("reads workflow-run annotations without treating a warning as healthy", async () => {
    const warning = {
      state: "WARNING",
      hostname: "hav.chat",
      checkedAt: "2026-10-01T12:00:00.000Z",
      attempts: 2,
      reason: "tls_expiry_warning",
      dns: { state: "OK", reason: null, addressCount: 1 },
      tls: {
        state: "WARNING",
        reason: "tls_expiry_warning",
        daysLeft: 21,
        hostnameOk: true,
        authorized: true,
      },
      health: { state: "OK", reason: null },
    };
    const view = await fetchDomainSslMonitorProjection(async (input) => {
      const url = String(input);
      if (url.includes("/actions/workflows/")) {
        return new Response(
          JSON.stringify({
            workflow_runs: [
              {
                id: 44,
                html_url: "https://github.test/runs/44",
                created_at: "2026-10-01T12:01:00Z",
                conclusion: "success",
                status: "completed",
                jobs_url: "https://api.github.test/jobs/44",
              },
            ],
          }),
          { status: 200 }
        );
      }
      if (url.includes("/jobs/44")) {
        return new Response(
          JSON.stringify({ jobs: [{ check_run_url: "https://api.github.test/checks/44" }] }),
          { status: 200 }
        );
      }
      if (url.includes("/annotations")) {
        return new Response(
          JSON.stringify([
            { message: `${DOMAIN_SSL_EVIDENCE_PREFIX}${JSON.stringify(warning)}` },
          ]),
          { status: 200 }
        );
      }
      return new Response("missing", { status: 404 });
    });
    assert.equal(view.status, "OK");
    assert.equal(view.latest?.state, "WARNING");
    assert.equal(view.latest?.runConclusion, "success");
  });
});

describe("domain ssl workflow and existing owners", () => {
  it("registers one scheduled observer with contents:read and no actions:write", () => {
    const text = fs.readFileSync(path.join(ROOT, DOMAIN_SSL_WORKFLOW_PATH), "utf8");
    assert.match(text, /schedule:/);
    assert.match(text, /47 5,17 \* \* \*/);
    assert.match(text, /workflow_dispatch:/);
    assert.match(text, /permissions:\n\s+contents:\s+read/);
    assert.equal(/^[ \t]*actions:[ \t]*["']?write["']?/m.test(text), false);
    assert.equal(text.includes("OPENROUTER_API_KEY"), false);
    assert.match(text, /domainSslMonitor\.ts/);
    const scheduled = scanScheduledWorkflowDefinitions(ROOT).map((row) => row.path);
    assert.equal(scheduled.includes(DOMAIN_SSL_WORKFLOW_PATH), true);
    const inventory = fs.readFileSync(path.join(ROOT, "docs/audit/current-main-autonomy-map.md"), "utf8");
    assert.match(inventory, /domain-ssl-monitor\.yml/);
  });

  it("keeps post-deploy verification event-only and unscheduled", () => {
    const text = fs.readFileSync(
      path.join(ROOT, ".github/workflows/post-deploy-verification.yml"),
      "utf8"
    );
    assert.match(text, /deployment_status:/);
    assert.equal(text.includes("schedule:"), false);
    assert.match(text, /--public-smoke/);
  });

  it("surfaces a failed scheduled monitor run through the existing Ops Inbox owner", () => {
    const incidents = projectGithubAutomationIncidents(
      {
        status: "OK",
        error: null,
        groups: [
          {
            key: "Domain SSL monitor::.github/workflows/domain-ssl-monitor.yml",
            name: "Domain SSL monitor",
            path: DOMAIN_SSL_WORKFLOW_PATH,
            latest: {
              id: 88,
              name: "Domain SSL monitor",
              path: DOMAIN_SSL_WORKFLOW_PATH,
              status: "completed",
              conclusion: "failure",
              runNumber: 3,
              createdAt: "2026-10-01T12:00:00Z",
              updatedAt: "2026-10-01T12:01:00Z",
              htmlUrl: "https://github.test/runs/88",
            },
            history: [],
          },
        ],
      },
      NOW
    );
    assert.equal(incidents.length, 1);
    assert.equal(incidents[0]?.source, "github_automation");
    assert.equal(incidents[0]?.severity, "critical");
    assert.match(incidents[0]?.id ?? "", /domain-ssl-monitor/);
  });

  it("covers the monitor from the ops-inbox path filter", () => {
    const ops = fs.readFileSync(path.join(ROOT, ".github/workflows/validate-ops-inbox.yml"), "utf8");
    assert.match(ops, /src\/lib\/domainSslMonitor\.ts/);
    assert.match(ops, /src\/lib\/domainSslMonitor\.test\.ts/);
    assert.match(ops, /src\/lib\/postDeployVerification\.ts/);
  });
});
