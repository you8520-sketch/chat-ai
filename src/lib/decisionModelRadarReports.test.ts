import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  fetchDecisionRadarAdminProjection,
  fetchDecisionRadarLatestRaw,
} from "./decisionModelRadarReports";
import { DECISION_RADAR_WORKFLOW_PATH } from "./decisionModelRadar";

function response(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

describe("decision model radar admin projection", () => {
  it("treats a missing data branch as an empty first-run state", async () => {
    const result = await fetchDecisionRadarLatestRaw(
      async () => response(404, {}) as Promise<Response>
    );
    assert.equal(result.status, "EMPTY");
    assert.equal(result.raw, null);
  });

  it("reads latest radar result and attaches the scheduled GitHub run", async () => {
    const run = {
      ranAt: "2026-09-29T04:00:00Z",
      mainSha: "abc",
      status: "REVIEW_CANDIDATE",
      discoveredModels: 6,
      changedCandidates: ["candidate/new"],
      benchmarkedCandidates: ["candidate/new"],
      deferredCandidates: [],
      providerCalls: 86,
      baseline: null,
      evaluations: [],
      notes: [],
      githubRunUrl: null,
    };
    const encoded = Buffer.from(JSON.stringify(run), "utf8").toString("base64");
    const projected = await fetchDecisionRadarAdminProjection(
      [
        {
          key: "decision-radar",
          name: "Weekly Decision Model Radar",
          path: DECISION_RADAR_WORKFLOW_PATH,
          latest: {
            id: 1,
            name: "Weekly Decision Model Radar",
            path: DECISION_RADAR_WORKFLOW_PATH,
            status: "completed",
            conclusion: "success",
            runNumber: 1,
            createdAt: "2026-09-29T04:00:00Z",
            updatedAt: "2026-09-29T04:01:00Z",
            htmlUrl: "https://github.com/example/run/1",
          },
          history: [],
        },
      ],
      async () => response(200, { content: encoded }) as Promise<Response>
    );
    assert.equal(projected.status, "OK");
    assert.equal(projected.run?.status, "REVIEW_CANDIDATE");
    assert.equal(projected.githubRunUrl, "https://github.com/example/run/1");
  });
});
