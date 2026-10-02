import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  GITHUB_SCHEDULED_RUNS_DEFAULT_MAX_PAGES,
  GITHUB_SUPPLY_DRAFT_DEFAULT_MAX_PAGES,
  fetchGithubScheduledAutomationProjection,
  fetchGithubSupplyAutoDraftProjection,
  groupGithubScheduledAutomationRuns,
  projectGithubSupplyAutoDrafts,
} from "@/lib/adminAutomationReports";

describe("admin automation reports projection", () => {
  it("groups scheduled runs by workflow and keeps newest first", () => {
    const groups = groupGithubScheduledAutomationRuns([
      {
        id: 1,
        name: "Monthly cache",
        path: ".github/workflows/cache.yml",
        status: "completed",
        conclusion: "success",
        run_number: 1,
        created_at: "2026-08-02T00:00:00Z",
        updated_at: "2026-08-02T00:01:00Z",
        html_url: "https://github.com/x/y/actions/runs/1",
      },
      {
        id: 2,
        name: "Monthly cache",
        path: ".github/workflows/cache.yml",
        status: "completed",
        conclusion: "failure",
        run_number: 2,
        created_at: "2026-09-02T00:00:00Z",
        updated_at: "2026-09-02T00:01:00Z",
        html_url: "https://github.com/x/y/actions/runs/2",
      },
    ]);
    assert.equal(groups.length, 1);
    assert.equal(groups[0]?.latest.id, 2);
    assert.deepEqual(groups[0]?.history.map((run) => run.id), [2, 1]);
  });

  it("can authenticate scheduled-run reads without changing projection semantics", async () => {
    let authorization = "";
    const projection = await fetchGithubScheduledAutomationProjection(
      async (_input, init) => {
        const headers = new Headers(init?.headers);
        authorization = headers.get("authorization") ?? "";
        return new Response(
          JSON.stringify({
            workflow_runs: [
              {
                id: 7,
                name: "Weekly cache",
                path: ".github/workflows/cache.yml",
                status: "completed",
                conclusion: "success",
                run_number: 7,
                created_at: "2026-09-30T00:00:00Z",
                updated_at: "2026-09-30T00:01:00Z",
                html_url: "https://github.test/runs/7",
              },
            ],
          }),
          { status: 200, headers: { "content-type": "application/json" } }
        );
      },
      { token: "test-token", maxPages: 1 }
    );
    assert.equal(authorization, "Bearer test-token");
    assert.equal(projection.status, "OK");
    assert.equal(projection.groups[0]?.latest.id, 7);
  });

  it("fails closed as UNAVAILABLE without breaking the admin page", async () => {
    const projection = await fetchGithubScheduledAutomationProjection(
      async () => new Response("nope", { status: 503 })
    );
    assert.equal(projection.status, "UNAVAILABLE");
    assert.equal(projection.groups.length, 0);
    assert.equal(projection.error, "GitHub Actions API 503");
    assert.equal((projection.error ?? "").includes("RATE_LIMITED"), false);
  });

  it("classifies exhausted anonymous quota separately from missing permission", async () => {
    const limited = await fetchGithubScheduledAutomationProjection(
      async () =>
        new Response(JSON.stringify({ message: "API rate limit exceeded for 203.0.113.10." }), {
          status: 403,
          headers: {
            "content-type": "application/json",
            "x-ratelimit-remaining": "0",
            "x-ratelimit-reset": "1893456000",
            "x-github-request-id": "RL:1",
          },
        })
    );
    assert.equal(limited.status, "UNAVAILABLE");
    assert.match(limited.error ?? "", /RATE_LIMITED/);
    assert.equal((limited.error ?? "").includes("203.0.113.10"), false);
    assert.equal((limited.error ?? "").includes("Bearer"), false);

    const denied = await fetchGithubScheduledAutomationProjection(
      async () =>
        new Response(JSON.stringify({ message: "Resource not accessible by integration" }), {
          status: 403,
          headers: {
            "content-type": "application/json",
            "x-ratelimit-remaining": "41",
            "x-ratelimit-reset": "1893456000",
          },
        })
    );
    assert.equal(denied.status, "UNAVAILABLE");
    assert.match(denied.error ?? "", /PERMISSION_DENIED/);
    assert.equal((denied.error ?? "").includes("RATE_LIMITED"), false);
  });

  it("reads only the first scheduled-run page by default", async () => {
    const pages: string[] = [];
    const projection = await fetchGithubScheduledAutomationProjection(async (input) => {
      pages.push(String(input));
      return new Response(JSON.stringify({ workflow_runs: [] }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    });
    assert.equal(GITHUB_SCHEDULED_RUNS_DEFAULT_MAX_PAGES, 1);
    assert.equal(pages.length, 1);
    assert.match(pages[0] ?? "", /page=1/);
    assert.equal(projection.status, "OK");
    assert.equal(projection.groups.length, 0);
  });
});


describe("admin automation supply Draft projection", () => {
  it("projects only open PRs carrying the canonical supply auto-Draft marker", () => {
    const drafts = projectGithubSupplyAutoDrafts([
      {
        number: 1401,
        title: "draft: promote gemini-3.7-flash",
        html_url: "https://github.com/example/repo/pull/1401",
        state: "open",
        draft: true,
        created_at: "2026-09-30T10:00:00Z",
        updated_at: "2026-09-30T10:01:00Z",
        body: "<!-- main-rp-supply-auto:gemini-3.7-flash:google-vertex -->\nbody",
      },
      {
        number: 1400,
        title: "unrelated PR",
        html_url: "https://github.com/example/repo/pull/1400",
        state: "open",
        draft: true,
        created_at: "2026-09-30T09:00:00Z",
        updated_at: "2026-09-30T09:01:00Z",
        body: "no marker",
      },
    ]);

    assert.equal(drafts.length, 1);
    assert.equal(drafts[0]?.number, 1401);
    assert.equal(drafts[0]?.modelId, "gemini-3.7-flash");
    assert.equal(drafts[0]?.candidateProviderSlug, "google-vertex");
    assert.equal(drafts[0]?.draft, true);
  });

  it("fails closed without breaking the admin page when pull requests cannot be read", async () => {
    const projection = await fetchGithubSupplyAutoDraftProjection(
      async () => new Response("nope", { status: 503 })
    );
    assert.equal(projection.status, "UNAVAILABLE");
    assert.equal(projection.drafts.length, 0);
    assert.equal(projection.error, "GitHub Pull Requests API 503");
  });

  it("reads only the first pull-request page", async () => {
    const pages: string[] = [];
    await fetchGithubSupplyAutoDraftProjection(async (input) => {
      pages.push(String(input));
      return new Response("[]", { status: 200, headers: { "content-type": "application/json" } });
    });
    assert.equal(GITHUB_SUPPLY_DRAFT_DEFAULT_MAX_PAGES, 1);
    assert.equal(pages.length, 1);
    assert.match(pages[0] ?? "", /page=1/);
  });
});
