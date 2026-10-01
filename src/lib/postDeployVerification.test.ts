import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import { fetchPostDeployVerificationProjection } from "@/lib/adminAutomationReports";
import { scanScheduledWorkflowDefinitions } from "@/lib/codeHealth/automationHealth";
import {
  gitCommitMatchesDeployment,
  isRailwayProductionSuccessEvent,
  POST_DEPLOY_ORIGIN,
  projectPostDeployVerification,
  verifyOfficialDeployment,
  type PostDeployEvidence,
} from "@/lib/postDeployVerification";

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), "../..");
const TARGET = "4707776cfb641a0e96d5984d164ae4bd98be7226";
const OLDER = "c3e0ea7114b3fabb906716dd0b1fa3af2ed81223";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function okFetch(gitCommit: string): typeof fetch {
  return (async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url === `${POST_DEPLOY_ORIGIN}/health`) return jsonResponse({ status: "ok" });
    if (url === `${POST_DEPLOY_ORIGIN}/api/health`) {
      return jsonResponse({ ok: true, service: "playai", gitCommit });
    }
    throw new Error(`unexpected url ${url}`);
  }) as typeof fetch;
}

const evidence = (patch: Partial<PostDeployEvidence> & Pick<PostDeployEvidence, "state" | "targetSha">): PostDeployEvidence => ({
  observedGitCommit: patch.targetSha.slice(0, 7),
  reason: null,
  checkedAt: "2026-10-01T10:36:00.000Z",
  attempts: 1,
  ...patch,
});

describe("post-deploy verification", () => {
  it("accepts only a Railway production success deployment", () => {
    const accepted = isRailwayProductionSuccessEvent({
      deployment_status: { state: "success" },
      deployment: {
        sha: TARGET,
        ref: TARGET,
        task: "deploy",
        environment: "enchanting-ambition / production",
      },
    });
    assert.equal(accepted.accept, true);
    assert.equal(accepted.sha, TARGET);
    assert.equal(
      isRailwayProductionSuccessEvent({
        deployment_status: { state: "in_progress" },
        deployment: { sha: TARGET, task: "deploy", environment: "enchanting-ambition / production" },
      }).accept,
      false
    );
    assert.equal(
      isRailwayProductionSuccessEvent({
        deployment_status: { state: "success" },
        deployment: { sha: TARGET, task: "deploy", environment: "enchanting-ambition / staging" },
      }).accept,
      false
    );
    assert.equal(gitCommitMatchesDeployment("4707776", TARGET), true);
    assert.equal(gitCommitMatchesDeployment("c3e0ea7", TARGET), false);
  });

  it("verifies a matching health contract and rejects a SHA mismatch", async () => {
    const verified = await verifyOfficialDeployment({
      targetSha: TARGET,
      fetchImpl: okFetch("4707776"),
    });
    assert.equal(verified.state, "VERIFIED");
    assert.equal(verified.observedGitCommit, "4707776");
    assert.equal(verified.reason, null);

    const mismatch = await verifyOfficialDeployment({
      targetSha: TARGET,
      fetchImpl: okFetch("c3e0ea7"),
    });
    assert.equal(mismatch.state, "FAILED");
    assert.equal(mismatch.reason, "sha_mismatch");
    assert.notEqual(mismatch.state, "SUPERSEDED");
  });

  it("retries a transient 503 and fails a persistent 503", async () => {
    let calls = 0;
    const transient = await verifyOfficialDeployment({
      targetSha: TARGET,
      sleep: async () => {},
      fetchImpl: (async (input: RequestInfo | URL) => {
        calls += 1;
        if (calls <= 2) return jsonResponse({ status: "unavailable" }, 503);
        const url = String(input);
        if (url === `${POST_DEPLOY_ORIGIN}/health`) return jsonResponse({ status: "ok" });
        if (url === `${POST_DEPLOY_ORIGIN}/api/health`) {
          return jsonResponse({ ok: true, service: "playai", gitCommit: "4707776" });
        }
        throw new Error(`unexpected url ${url}`);
      }) as typeof fetch,
    });
    assert.equal(transient.state, "VERIFIED");
    assert.equal(transient.attempts, 2);

    const persistent = await verifyOfficialDeployment({
      targetSha: TARGET,
      maxAttempts: 3,
      sleep: async () => {},
      fetchImpl: (async () => jsonResponse({ status: "unavailable" }, 503)) as typeof fetch,
    });
    assert.equal(persistent.state, "FAILED");
    assert.equal(persistent.reason, "health_unavailable");
    assert.equal(persistent.attempts, 3);
  });

  it("distinguishes invalid JSON, a missing SHA, and a timeout", async () => {
    const invalid = await verifyOfficialDeployment({
      targetSha: TARGET,
      fetchImpl: (async () => new Response("not-json", { status: 200 })) as typeof fetch,
    });
    assert.equal(invalid.state, "FAILED");
    assert.equal(invalid.reason, "invalid_json");

    const missing = await verifyOfficialDeployment({
      targetSha: TARGET,
      fetchImpl: (async (input: RequestInfo | URL) => {
        const url = String(input);
        if (url === `${POST_DEPLOY_ORIGIN}/health`) return jsonResponse({ status: "ok" });
        if (url === `${POST_DEPLOY_ORIGIN}/api/health`) {
          return jsonResponse({ ok: true, service: "playai", gitCommit: null });
        }
        throw new Error(`unexpected url ${url}`);
      }) as typeof fetch,
    });
    assert.equal(missing.state, "FAILED");
    assert.equal(missing.reason, "git_commit_missing");

    const timedOut = await verifyOfficialDeployment({
      targetSha: TARGET,
      timeoutMs: 20,
      fetchImpl: ((_input, init) =>
        new Promise((_resolve, reject) => {
          const signal = init?.signal;
          const error = new Error("aborted");
          error.name = "AbortError";
          if (signal?.aborted) reject(error);
          else signal?.addEventListener("abort", () => reject(error));
        })) as typeof fetch,
    });
    assert.equal(timedOut.state, "UNVERIFIED");
    assert.equal(timedOut.reason, "request_timeout");
  });

  it("does not present an older deployment result as the latest one", () => {
    const older = evidence({ state: "VERIFIED", targetSha: OLDER });
    const newer = evidence({
      state: "VERIFIED",
      targetSha: TARGET,
      checkedAt: "2026-10-01T10:40:00.000Z",
    });
    const successive = projectPostDeployVerification({
      runs: [
        { runId: 2, htmlUrl: "https://github.test/runs/2", createdAt: "2026-10-01T10:40:00.000Z", evidence: newer },
        { runId: 1, htmlUrl: "https://github.test/runs/1", createdAt: "2026-10-01T10:20:00.000Z", evidence: older },
      ],
      latestSuccess: { sha: TARGET, createdAt: "2026-10-01T10:32:44Z" },
    });
    assert.equal(successive.latest?.targetSha, TARGET);
    assert.equal(successive.latest?.state, "VERIFIED");
    assert.equal(successive.superseded?.targetSha, OLDER);
    assert.equal(successive.superseded?.state, "SUPERSEDED");

    const waiting = projectPostDeployVerification({
      runs: [
        { runId: 1, htmlUrl: "https://github.test/runs/1", createdAt: "2026-10-01T10:20:00.000Z", evidence: older },
      ],
      latestSuccess: { sha: TARGET, createdAt: "2026-10-01T10:32:44Z" },
    });
    assert.equal(waiting.latest?.state, "UNVERIFIED");
    assert.equal(waiting.latest?.targetSha, TARGET);
    assert.equal(waiting.latest?.reason, "awaiting_verification");
    assert.notEqual(waiting.latest?.targetSha, OLDER);
    assert.equal(waiting.superseded?.state, "SUPERSEDED");
  });

  it("stays UNVERIFIED when GitHub evidence cannot be read", async () => {
    const failed = await fetchPostDeployVerificationProjection(async () => new Response("nope", { status: 503 }));
    assert.equal(failed.status, "UNAVAILABLE");
    assert.equal(failed.latest, null);
    assert.notEqual(failed.latest?.state, "VERIFIED");

    const successWithoutEvidence = await fetchPostDeployVerificationProjection(async (input) => {
      const url = String(input);
      if (url.includes("/actions/runs?")) {
        return jsonResponse({
          workflow_runs: [
            {
              id: 9,
              path: ".github/workflows/post-deploy-verification.yml",
              status: "completed",
              conclusion: "success",
              html_url: "https://github.test/runs/9",
              created_at: "2026-10-01T10:40:00.000Z",
              jobs_url: "https://github.test/jobs/9",
            },
          ],
        });
      }
      if (url.endsWith("/jobs/9")) {
        return jsonResponse({ jobs: [{ check_run_url: "https://github.test/check/9" }] });
      }
      if (url.endsWith("/check/9/annotations")) return jsonResponse([]);
      if (url.endsWith("/deployments?per_page=5")) {
        return jsonResponse([
          {
            sha: TARGET,
            created_at: "2026-10-01T10:32:44Z",
            statuses_url: "https://github.test/statuses/1",
            environment: "enchanting-ambition / production",
            task: "deploy",
          },
        ]);
      }
      if (url.endsWith("/statuses/1")) return jsonResponse([{ state: "success" }]);
      throw new Error(url);
    });
    assert.equal(successWithoutEvidence.status, "OK");
    assert.equal(successWithoutEvidence.latest?.state, "UNVERIFIED");
    assert.equal(successWithoutEvidence.latest?.reason, "awaiting_verification");
    assert.equal(successWithoutEvidence.latest?.targetSha, TARGET);
    assert.notEqual(successWithoutEvidence.latest?.state, "VERIFIED");
  });

  it("keeps the event workflow out of the scheduled inventory", () => {
    const text = fs.readFileSync(path.join(ROOT, ".github/workflows/post-deploy-verification.yml"), "utf8");
    assert.match(text, /deployment_status:/);
    assert.equal(text.includes("schedule:"), false);
    assert.equal(/^[ \t]*actions:[ \t]*["']?write["']?/m.test(text), false);
    assert.match(text, /permissions:\n\s+contents:\s+read/);
    const scheduled = scanScheduledWorkflowDefinitions(ROOT).map((row) => row.path);
    assert.equal(scheduled.includes(".github/workflows/post-deploy-verification.yml"), false);
    const ops = fs.readFileSync(path.join(ROOT, ".github/workflows/validate-ops-inbox.yml"), "utf8");
    assert.match(ops, /"\.github\/workflows\/\*\*"/);
    assert.match(ops, /src\/lib\/postDeployVerification\.ts/);
    assert.match(ops, /src\/lib\/postDeployVerification\.test\.ts/);
  });
});
