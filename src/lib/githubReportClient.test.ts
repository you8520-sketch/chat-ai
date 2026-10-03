import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";

import {
  GITHUB_REPORT_CACHE_TTL_MS,
  GITHUB_REPORT_MAX_WAIT_MS,
  classifyGithubReportResponse,
  decodeGithubReportContent,
  githubReportBlobUrlFromContents,
  githubReportGetContent,
  githubReportGetJson,
  resetGithubReportClientForTests,
} from "@/lib/githubReportClient";

afterEach(() => {
  resetGithubReportClientForTests();
  delete process.env.GITHUB_REPORTS_TOKEN;
});

function jsonResponse(
  status: number,
  body: unknown,
  headers: Record<string, string> = {}
): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "content-type": "application/json",
      ...headers,
    },
  });
}

describe("classifyGithubReportResponse", () => {
  it("keeps permission 403 distinct from exhausted anonymous quota", () => {
    assert.equal(
      classifyGithubReportResponse({
        status: 403,
        remaining: 0,
        hasRetryAfter: false,
        message: "API rate limit exceeded for 1.2.3.4.",
      }),
      "RATE_LIMITED"
    );
    assert.equal(
      classifyGithubReportResponse({
        status: 403,
        remaining: 41,
        hasRetryAfter: false,
        message: "Resource not accessible by integration",
      }),
      "PERMISSION_DENIED"
    );
    assert.equal(
      classifyGithubReportResponse({
        status: 403,
        remaining: 12,
        hasRetryAfter: true,
        message: "You have exceeded a secondary rate limit.",
      }),
      "RATE_LIMITED"
    );
    assert.equal(
      classifyGithubReportResponse({
        status: 401,
        remaining: 60,
        hasRetryAfter: false,
        message: "Requires authentication",
      }),
      "AUTH_REQUIRED"
    );
    assert.equal(
      classifyGithubReportResponse({
        status: 404,
        remaining: 59,
        hasRetryAfter: false,
        message: "No commit found for the ref",
      }),
      "NOT_FOUND"
    );
    assert.equal(
      classifyGithubReportResponse({
        status: 503,
        remaining: null,
        hasRetryAfter: false,
        message: "nope",
      }),
      "UNAVAILABLE"
    );
  });
});

describe("githubReportGetJson", () => {
  it("returns a successful GitHub JSON body", async () => {
    const result = await githubReportGetJson<{ ok: boolean }>(
      "https://api.github.test/ok",
      async () => jsonResponse(200, { ok: true })
    );
    assert.equal(result.ok, true);
    assert.equal(result.kind, "OK");
    assert.deepEqual(result.json, { ok: true });
    assert.equal(result.error, null);
  });

  it("classifies unauthenticated quota 403 with remaining, reset, retry-after, and request id", async () => {
    const result = await githubReportGetJson(
      "https://api.github.test/quota",
      async () =>
        jsonResponse(
          403,
          { message: "API rate limit exceeded for 203.0.113.10." },
          {
            "x-ratelimit-limit": "60",
            "x-ratelimit-remaining": "0",
            "x-ratelimit-reset": "1893456000",
            "retry-after": "2",
            "x-github-request-id": "ABCD:1:2",
          }
        )
    );
    assert.equal(result.ok, false);
    assert.equal(result.status, 403);
    assert.equal(result.kind, "RATE_LIMITED");
    assert.equal(result.remaining, 0);
    assert.equal(result.requestId, "ABCD:1:2");
    assert.match(result.error ?? "", /RATE_LIMITED/);
    assert.match(result.error ?? "", /reset=/);
    assert.match(result.error ?? "", /request=ABCD:1:2/);
    assert.equal((result.error ?? "").includes("203.0.113.10"), false);
  });

  it("does not treat x-ratelimit-reset alone as a quota failure", async () => {
    const result = await githubReportGetJson(
      "https://api.github.test/permission",
      async () =>
        jsonResponse(
          403,
          { message: "Resource not accessible by integration" },
          {
            "x-ratelimit-limit": "60",
            "x-ratelimit-remaining": "41",
            "x-ratelimit-reset": "1893456000",
            "x-github-request-id": "PERM:1:2",
          }
        )
    );
    assert.equal(result.kind, "PERMISSION_DENIED");
    assert.equal(result.remaining, 41);
    assert.equal(result.retryAt, null);
    assert.match(result.error ?? "", /PERMISSION_DENIED/);
  });

  it("marks missing credentials as AUTH_REQUIRED", async () => {
    const result = await githubReportGetJson(
      "https://api.github.test/auth",
      async () => jsonResponse(401, { message: "Requires authentication" })
    );
    assert.equal(result.kind, "AUTH_REQUIRED");
    assert.match(result.error ?? "", /AUTH_REQUIRED/);
  });

  it("keeps transient 503 as UNAVAILABLE without a classified kind suffix", async () => {
    const result = await githubReportGetJson(
      "https://api.github.test/down",
      async () => jsonResponse(503, { message: "nope" }),
      { label: "GitHub Actions API" }
    );
    assert.equal(result.kind, "UNAVAILABLE");
    assert.equal(result.error, "GitHub Actions API 503");
    assert.equal(result.retryAt, null);
  });

  it("coalesces in-flight identical GETs and caches the success briefly", async () => {
    let calls = 0;
    let release!: (value: Response) => void;
    const first = new Promise<Response>((resolve) => {
      release = resolve;
    });
    const fetchImpl: typeof fetch = async () => {
      calls += 1;
      if (calls === 1) return first;
      return jsonResponse(200, { n: calls });
    };
    const a = githubReportGetJson<{ n: number }>(
      "https://api.github.test/shared",
      fetchImpl,
      { cache: true }
    );
    const b = githubReportGetJson<{ n: number }>(
      "https://api.github.test/shared",
      fetchImpl,
      { cache: true }
    );
    release(jsonResponse(200, { n: 1 }));
    const [firstResult, secondResult] = await Promise.all([a, b]);
    assert.equal(calls, 1);
    assert.deepEqual(firstResult.json, { n: 1 });
    assert.deepEqual(secondResult.json, { n: 1 });

    const cached = await githubReportGetJson<{ n: number }>(
      "https://api.github.test/shared",
      fetchImpl,
      { cache: true }
    );
    assert.equal(calls, 1);
    assert.deepEqual(cached.json, { n: 1 });
  });

  it("does not serve a cached OK after TTL when the next read fails", async () => {
    let nowMs = 1_000;
    let calls = 0;
    const result = async () => {
      calls += 1;
      if (calls === 1) return jsonResponse(200, { ok: true });
      return jsonResponse(
        403,
        { message: "API rate limit exceeded" },
        { "x-ratelimit-remaining": "0", "x-github-request-id": "NEW:1" }
      );
    };
    const first = await githubReportGetJson("https://api.github.test/stale", result, {
      cache: true,
      now: () => nowMs,
    });
    assert.equal(first.kind, "OK");
    nowMs += GITHUB_REPORT_CACHE_TTL_MS + 1;
    const second = await githubReportGetJson("https://api.github.test/stale", result, {
      cache: true,
      now: () => nowMs,
    });
    assert.equal(second.kind, "RATE_LIMITED");
    assert.equal(second.ok, false);
    assert.equal(calls, 2);
  });

  it("waits only when the retry window is inside the bounded max wait", async () => {
    let nowMs = 10_000;
    const slept: number[] = [];
    let calls = 0;
    const short = await githubReportGetJson(
      "https://api.github.test/wait-short",
      async () => {
        calls += 1;
        if (calls === 1) {
          return jsonResponse(
            403,
            { message: "API rate limit exceeded" },
            { "retry-after": "1", "x-ratelimit-remaining": "0" }
          );
        }
        return jsonResponse(200, { recovered: true });
      },
      {
        cache: true,
        now: () => nowMs,
        sleep: async (ms) => {
          slept.push(ms);
          nowMs += ms;
        },
      }
    );
    assert.deepEqual(slept, [1000]);
    assert.equal(short.kind, "OK");
    assert.ok(1000 <= GITHUB_REPORT_MAX_WAIT_MS);

    slept.length = 0;
    calls = 0;
    const long = await githubReportGetJson(
      "https://api.github.test/wait-long",
      async () => {
        calls += 1;
        return jsonResponse(
          403,
          { message: "API rate limit exceeded" },
          {
            "x-ratelimit-remaining": "0",
            "x-ratelimit-reset": String(Math.floor((nowMs + 60_000) / 1000)),
          }
        );
      },
      { cache: true, now: () => nowMs, sleep: async (ms) => slept.push(ms) }
    );
    assert.deepEqual(slept, []);
    assert.equal(long.kind, "RATE_LIMITED");
    assert.equal(calls, 1);
  });

  it("attaches a Bearer token from env and never echoes it in errors", async () => {
    process.env.GITHUB_REPORTS_TOKEN = "super-secret-report-token";
    let authorization = "";
    const result = await githubReportGetJson(
      "https://api.github.test/token",
      async (_input, init) => {
        authorization = new Headers(init?.headers).get("authorization") ?? "";
        return jsonResponse(403, { message: "Resource not accessible by integration" });
      }
    );
    assert.equal(authorization, "Bearer super-secret-report-token");
    assert.equal(result.kind, "PERMISSION_DENIED");
    assert.equal((result.error ?? "").includes("super-secret-report-token"), false);
  });
});

describe("githubReportGetContent", () => {
  it("treats a missing ledger ref as EMPTY rather than a lookup failure", async () => {
    const result = await githubReportGetContent(
      "https://api.github.test/contents/ledger.json",
      async () =>
        jsonResponse(404, { message: "No commit found for the ref code-health-ledger" })
    );
    assert.equal(result.status, "EMPTY");
    assert.equal(result.error, null);
    assert.equal(result.raw, null);
  });

  it("decodes a successful contents payload", async () => {
    const result = await githubReportGetContent(
      "https://api.github.test/contents/latest.json",
      async () =>
        jsonResponse(200, {
          content: Buffer.from('{"ranAt":"2026-10-01T00:00:00Z"}', "utf8").toString("base64"),
        })
    );
    assert.equal(result.status, "OK");
    assert.equal(result.raw, '{"ranAt":"2026-10-01T00:00:00Z"}');
  });

  it("treats a large Contents response with empty inline content as EMPTY before blob fallback", () => {
    const largeContents = {
      sha: "fb347f3251a692bb148024dba79e112316878211",
      size: 11_483_787,
      encoding: "none",
      content: "",
      git_url:
        "https://evil.example/repos/you8520-sketch/chat-ai/git/blobs/fb347f3251a692bb148024dba79e112316878211",
      download_url: "https://evil.example/ledger.json",
    };
    assert.equal(decodeGithubReportContent(largeContents), null);
    assert.equal(
      githubReportBlobUrlFromContents(
        "https://api.github.test/repos/you8520-sketch/chat-ai/contents/ledger.json?ref=code-health-ledger",
        largeContents
      ),
      "https://api.github.test/repos/you8520-sketch/chat-ai/git/blobs/fb347f3251a692bb148024dba79e112316878211"
    );
    assert.equal(
      githubReportBlobUrlFromContents("https://api.github.test/contents/ledger.json", largeContents),
      null
    );
    assert.equal(
      githubReportBlobUrlFromContents(
        "https://api.github.test/repos/you8520-sketch/chat-ai/contents/ledger.json",
        { ...largeContents, size: 0 }
      ),
      null
    );
  });

  it("loads large Contents via the same-origin Git blob instead of EMPTY", async () => {
    const urls: string[] = [];
    const result = await githubReportGetContent(
      "https://api.github.test/repos/you8520-sketch/chat-ai/contents/ledger.json?ref=code-health-ledger",
      async (input) => {
        urls.push(String(input));
        if (String(input).includes("/contents/")) {
          return jsonResponse(200, {
            sha: "fb347f3251a692bb148024dba79e112316878211",
            size: 11_483_787,
            encoding: "none",
            content: "",
            git_url: "https://evil.example/steal",
            download_url: "https://evil.example/ledger.json",
          });
        }
        return jsonResponse(200, {
          sha: "fb347f3251a692bb148024dba79e112316878211",
          encoding: "base64",
          content: Buffer.from(
            JSON.stringify({ version: 1, weekly: [{ kind: "weekly", status: "WARNING" }], monthly: [] }),
            "utf8"
          ).toString("base64"),
        });
      }
    );
    assert.deepEqual(urls, [
      "https://api.github.test/repos/you8520-sketch/chat-ai/contents/ledger.json?ref=code-health-ledger",
      "https://api.github.test/repos/you8520-sketch/chat-ai/git/blobs/fb347f3251a692bb148024dba79e112316878211",
    ]);
    assert.equal(result.status, "OK");
    assert.match(result.raw ?? "", /"status":"WARNING"/);
  });

  it("marks a failed large-file blob follow-up as UNAVAILABLE rather than EMPTY", async () => {
    const result = await githubReportGetContent(
      "https://api.github.test/repos/you8520-sketch/chat-ai/contents/ledger.json?ref=code-health-ledger",
      async (input) => {
        if (String(input).includes("/contents/")) {
          return jsonResponse(200, {
            sha: "fb347f3251a692bb148024dba79e112316878211",
            size: 11_483_787,
            encoding: "none",
            content: "",
          });
        }
        return jsonResponse(403, { message: "Resource not accessible by integration" });
      }
    );
    assert.equal(result.status, "UNAVAILABLE");
    assert.match(result.error ?? "", /PERMISSION_DENIED/);
    assert.equal(result.raw, null);
  });
});
