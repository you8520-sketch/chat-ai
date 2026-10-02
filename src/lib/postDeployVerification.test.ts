import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import { fetchPostDeployVerificationProjection } from "@/lib/adminAutomationReports";
import { scanScheduledWorkflowDefinitions } from "@/lib/codeHealth/automationHealth";
import {
  gitCommitMatchesDeployment,
  isRailwayProductionSuccessEvent,
  maybeVerifyPublicPages,
  POST_DEPLOY_EVIDENCE_PREFIX,
  POST_DEPLOY_ORIGIN,
  projectPostDeployVerification,
  verifyPublicPages,
  verifyOfficialDeployment,
  type PostDeployEvidence,
  type PublicPagePath,
  type PublicSmokeEvidence,
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

  it("reads annotations for at most two completed post-deploy runs", async () => {
    const seen: string[] = [];
    await fetchPostDeployVerificationProjection(async (input) => {
      const url = String(input);
      seen.push(url);
      if (url.includes("/actions/runs?")) {
        return jsonResponse({
          workflow_runs: [21, 22, 23].map((id) => ({
            id,
            path: ".github/workflows/post-deploy-verification.yml",
            status: "completed",
            conclusion: "success",
            html_url: `https://github.test/runs/${id}`,
            created_at: `2026-10-01T10:${id}:00.000Z`,
            jobs_url: `https://github.test/jobs/${id}`,
          })),
        });
      }
      if (url.includes("/jobs/")) {
        const id = url.split("/").pop();
        return jsonResponse({ jobs: [{ check_run_url: `https://github.test/check/${id}` }] });
      }
      if (url.includes("/annotations")) return jsonResponse([]);
      if (url.includes("/deployments?")) return jsonResponse([]);
      throw new Error(url);
    });
    assert.deepEqual(
      seen.filter((url) => url.includes("/jobs/")).sort(),
      ["https://github.test/jobs/21", "https://github.test/jobs/22"]
    );
    assert.equal(seen.some((url) => url.includes("/jobs/23")), false);
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
    assert.match(text, /--public-smoke/);
    assert.match(text, /if: success\(\)/);
    assert.equal(text.includes("schedule:"), false);
  });
});

const PAGE_COPY: Record<PublicPagePath, string> = {
  "/": "콘텐츠 탐색 취향 설정",
  "/search": "장르 카테고리 캐릭터명 · 제작자명 · 태그",
  "/tab/new": "실시간 신작",
  "/tab/ranking": "최근 6시간 대화 시작 수",
};

function htmlResponse(path: PublicPagePath, body = PAGE_COPY[path]): Response {
  return new Response(`<!doctype html><html><body><main>${body}</main></body></html>`, {
    status: 200,
    headers: { "content-type": "text/html; charset=utf-8" },
  });
}

function smokeFetch(
  mutate: (url: URL, visit: number) => Response | null,
  gitCommits: string[] = ["4707776"]
): { fetchImpl: typeof fetch; urls: string[] } {
  const urls: string[] = [];
  const visits = new Map<string, number>();
  let healthCalls = 0;
  const fetchImpl = (async (input: RequestInfo | URL) => {
    const url = new URL(String(input));
    urls.push(url.toString());
    if (url.origin !== POST_DEPLOY_ORIGIN) throw new Error(`left official origin ${url}`);
    if (url.pathname === "/api/health") {
      const commit = gitCommits[Math.min(healthCalls, gitCommits.length - 1)] ?? "4707776";
      healthCalls += 1;
      return jsonResponse({ ok: true, service: "playai", gitCommit: commit });
    }
    const visit = (visits.get(url.pathname) ?? 0) + 1;
    visits.set(url.pathname, visit);
    const replaced = mutate(url, visit);
    if (replaced) return replaced;
    return htmlResponse(url.pathname as PublicPagePath);
  }) as typeof fetch;
  return { fetchImpl, urls };
}

describe("public page smoke", () => {
  const verified = evidence({ state: "VERIFIED", targetSha: TARGET });

  it("passes the four public pages and keeps a health failure from starting smoke", async () => {
    const ok = smokeFetch(() => null);
    const passed = await verifyPublicPages({
      targetSha: TARGET,
      fetchImpl: ok.fetchImpl,
      sleep: async () => {},
    });
    assert.equal(passed.state, "PASS");
    assert.equal(passed.pages.length, 4);
    assert.deepEqual(passed.pages.map((page) => page.path), ["/", "/search", "/tab/new", "/tab/ranking"]);
    assert.equal(passed.pages.every((page) => page.state === "PASS"), true);

    let calls = 0;
    const skipped = await maybeVerifyPublicPages(
      evidence({ state: "FAILED", targetSha: TARGET, reason: "sha_mismatch" }),
      {
        targetSha: TARGET,
        fetchImpl: (() => {
          calls += 1;
          return htmlResponse("/");
        }) as typeof fetch,
      }
    );
    assert.equal(skipped, null);
    assert.equal(calls, 0);
  });

  it("fails a 404, a server error page, a missing contract, and an external redirect", async () => {
    const missing = smokeFetch((url) =>
      url.pathname === "/tab/new" ? new Response("nope", { status: 404, headers: { "content-type": "text/html" } }) : null
    );
    const notFound = await verifyPublicPages({ targetSha: TARGET, fetchImpl: missing.fetchImpl, sleep: async () => {} });
    assert.equal(notFound.state, "FAIL");
    assert.equal(notFound.pages.find((page) => page.path === "/tab/new")?.reason, "http_404");

    const crashed = smokeFetch((url) =>
      url.pathname === "/"
        ? htmlResponse("/", "Application error: a server-side exception has occurred")
        : null
    );
    const serverError = await verifyPublicPages({ targetSha: TARGET, fetchImpl: crashed.fetchImpl, sleep: async () => {} });
    assert.equal(serverError.state, "FAIL");
    assert.equal(serverError.pages.find((page) => page.path === "/")?.reason, "server_error_page");

    const bare = smokeFetch((url) =>
      url.pathname === "/search"
        ? new Response("<html><main>empty</main></html>", { status: 200, headers: { "content-type": "text/html" } })
        : null
    );
    const contract = await verifyPublicPages({ targetSha: TARGET, fetchImpl: bare.fetchImpl, sleep: async () => {} });
    assert.equal(contract.state, "FAIL");
    assert.equal(contract.pages.find((page) => page.path === "/search")?.reason, "page_contract");

    const redirected = smokeFetch((url) =>
      url.pathname === "/tab/ranking"
        ? new Response(null, { status: 302, headers: { location: "https://example.com/away" } })
        : null
    );
    const external = await verifyPublicPages({
      targetSha: TARGET,
      fetchImpl: redirected.fetchImpl,
      sleep: async () => {},
    });
    assert.equal(external.state, "FAIL");
    assert.equal(external.pages.find((page) => page.path === "/tab/ranking")?.reason, "external_redirect");
    assert.equal(redirected.urls.some((url) => url.includes("example.com")), false);
  });

  it("retries a transient 503 and fails a persistent 503", async () => {
    const transient = smokeFetch((url, visit) =>
      url.pathname === "/search" && visit === 1 ? new Response("busy", { status: 503 }) : null
    );
    const recovered = await verifyPublicPages({
      targetSha: TARGET,
      fetchImpl: transient.fetchImpl,
      sleep: async () => {},
    });
    assert.equal(recovered.state, "PASS");
    assert.equal(recovered.pages.find((page) => page.path === "/search")?.attempts, 2);

    const persistent = smokeFetch(() => new Response("busy", { status: 503 }));
    const down = await verifyPublicPages({
      targetSha: TARGET,
      maxAttempts: 3,
      fetchImpl: persistent.fetchImpl,
      sleep: async () => {},
    });
    assert.equal(down.state, "FAIL");
    assert.equal(down.reason, "page_unavailable");
    assert.equal(down.pages[0]?.attempts, 3);
  });

  it("does not keep a public-page pass when the deployment SHA changes", async () => {
    const moved = smokeFetch(() => null, ["4707776", "c3e0ea7"]);
    const changed = await verifyPublicPages({
      targetSha: TARGET,
      fetchImpl: moved.fetchImpl,
      sleep: async () => {},
    });
    assert.equal(changed.state, "UNVERIFIED");
    assert.equal(changed.reason, "deployment_sha_changed");
    assert.equal(changed.pages.some((page) => page.state === "PASS"), false);

    let pageReads = 0;
    const early = await verifyPublicPages({
      targetSha: TARGET,
      sleep: async () => {},
      fetchImpl: (async (input: RequestInfo | URL) => {
        const url = String(input);
        if (url.endsWith("/api/health")) {
          return jsonResponse({ ok: true, service: "playai", gitCommit: "c3e0ea7" });
        }
        pageReads += 1;
        return htmlResponse("/");
      }) as typeof fetch,
    });
    assert.equal(early.state, "UNVERIFIED");
    assert.equal(early.reason, "deployment_sha_changed");
    assert.equal(pageReads, 0);
  });

  it("keeps SHA verification when smoke evidence is missing or the GitHub read fails", async () => {
    const smoke: PublicSmokeEvidence = {
      state: "FAIL",
      targetSha: TARGET,
      checkedAt: "2026-10-01T10:41:00.000Z",
      reason: "http_404",
      attempts: 2,
      pages: [{ path: "/search", state: "FAIL", reason: "http_404", attempts: 1 }],
    };
    const shown = projectPostDeployVerification({
      runs: [
        {
          runId: 3,
          htmlUrl: "https://github.test/runs/3",
          createdAt: "2026-10-01T10:41:00.000Z",
          evidence: verified,
          publicSmoke: smoke,
        },
      ],
      latestSuccess: { sha: TARGET, createdAt: "2026-10-01T10:32:44Z" },
    });
    assert.equal(shown.latest?.state, "VERIFIED");
    assert.equal(shown.latest?.targetSha, TARGET);
    assert.equal(shown.latest?.publicSmoke.state, "FAIL");
    assert.equal(shown.latest?.publicSmoke.reason, "http_404");

    const healthOnly = `${POST_DEPLOY_EVIDENCE_PREFIX}${JSON.stringify(verified)}`;
    const absent = await fetchPostDeployVerificationProjection(async (input) => {
      const url = String(input);
      if (url.includes("/actions/runs?")) {
        return jsonResponse({
          workflow_runs: [
            {
              id: 11,
              path: ".github/workflows/post-deploy-verification.yml",
              status: "completed",
              conclusion: "success",
              html_url: "https://github.test/runs/11",
              created_at: "2026-10-01T10:41:00.000Z",
              jobs_url: "https://github.test/jobs/11",
            },
          ],
        });
      }
      if (url.endsWith("/jobs/11")) {
        return jsonResponse({ jobs: [{ check_run_url: "https://github.test/check/11" }] });
      }
      if (url.endsWith("/check/11/annotations")) return jsonResponse([{ message: healthOnly }]);
      if (url.endsWith("/deployments?per_page=5")) {
        return jsonResponse([
          {
            sha: TARGET,
            created_at: "2026-10-01T10:32:44Z",
            statuses_url: "https://github.test/statuses/11",
            environment: "enchanting-ambition / production",
            task: "deploy",
          },
        ]);
      }
      if (url.endsWith("/statuses/11")) return jsonResponse([{ state: "success" }]);
      throw new Error(url);
    });
    assert.equal(absent.status, "OK");
    assert.equal(absent.latest?.state, "VERIFIED");
    assert.equal(absent.latest?.publicSmoke.state, "UNVERIFIED");
    assert.equal(absent.latest?.publicSmoke.reason, "no_smoke_evidence");

    const unavailable = await fetchPostDeployVerificationProjection(async () => new Response("nope", { status: 503 }));
    assert.equal(unavailable.status, "UNAVAILABLE");
    assert.equal(unavailable.latest, null);
    assert.notEqual(unavailable.latest?.publicSmoke?.state, "PASS");
  });
});
