import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  fetchGithubScheduledAutomationProjection,
  groupGithubScheduledAutomationRuns,
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

  it("fails closed as UNAVAILABLE without breaking the admin page", async () => {
    const projection = await fetchGithubScheduledAutomationProjection(
      async () => new Response("nope", { status: 503 })
    );
    assert.equal(projection.status, "UNAVAILABLE");
    assert.equal(projection.groups.length, 0);
  });
});
