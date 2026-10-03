import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { fetchCodeHealthAdminProjection, formatCodeHealthDeltaLines, projectCodeHealthAdmin } from "@/lib/codeHealth/reports";
import type { WeeklyCodeHealthReport } from "@/lib/codeHealth/types";
import { CODE_HEALTH_WEEKLY_WORKFLOW_PATH, emptyCodeHealthCounts } from "@/lib/codeHealth/types";

const weekly: WeeklyCodeHealthReport = {
  kind: "weekly",
  version: 1,
  ranAt: "2026-09-28T00:00:00.000Z",
  mainSha: "abc",
  status: "SUCCESS",
  counts: {
    ...emptyCodeHealthCounts(),
    newFindings: 2,
    safeToDelete: 1,
    followUp: 3,
    unusedFiles: 22,
    duplicateOwners: 2,
    obsoleteFlagsEnvs: 6,
    runtimeCiAnomalies: 0,
  },
  previousCounts: {
    ...emptyCodeHealthCounts(),
    unusedFiles: 31,
    duplicateOwners: 4,
    obsoleteFlagsEnvs: 7,
    runtimeCiAnomalies: 1,
  },
  delta: {
    unusedCandidates: { previous: 31, current: 22 },
    duplicateOwners: { previous: 4, current: 2 },
    obsoleteEnvs: { previous: 7, current: 6 },
    flakyCiCandidates: { previous: 1, current: 0 },
  },
  candidates: [],
  criticalBugfixCandidates: [],
  knipReview: {
    considered: true,
    adoptedAsOwner: false,
    adoptedAsDeletionProof: false,
    reason: "reviewed",
  },
  productionMutated: false,
  githubRunUrl: "https://github.com/you8520-sketch/chat-ai/actions/runs/9",
  notes: ["read-only"],
};

describe("code health admin projection", () => {
  it("renders delta-centered trend lines", () => {
    assert.deepEqual(formatCodeHealthDeltaLines(weekly.delta), [
      "unused candidates 31 → 22",
      "duplicate owner 4 → 2",
      "obsolete env 7 → 6",
      "flaky CI candidate 1 → 0",
    ]);
  });

  it("projects ledger JSON onto Weekly / Monthly admin cards", () => {
    const projection = projectCodeHealthAdmin(
      JSON.stringify({ version: 1, weekly: [weekly], monthly: [] }),
      [
        {
          key: "w",
          name: "Weekly Code Health audit",
          path: CODE_HEALTH_WEEKLY_WORKFLOW_PATH,
          latest: {
            id: 9,
            name: "Weekly Code Health audit",
            path: CODE_HEALTH_WEEKLY_WORKFLOW_PATH,
            status: "completed",
            conclusion: "success",
            runNumber: 1,
            createdAt: weekly.ranAt,
            updatedAt: weekly.ranAt,
            htmlUrl: "https://github.com/you8520-sketch/chat-ai/actions/runs/9",
          },
          history: [],
        },
      ],
      "OK",
      null
    );
    assert.equal(projection.status, "OK");
    assert.equal(projection.weekly.status, "SUCCESS");
    assert.equal(projection.weekly.counts?.safeToDelete, 1);
    assert.equal(projection.weekly.githubRunUrl?.includes("/actions/runs/9"), true);
    assert.equal(projection.monthly.status, "EMPTY");
  });

  it("fails closed as UNAVAILABLE without throwing", async () => {
    const projection = await fetchCodeHealthAdminProjection([], async () => new Response("nope", { status: 503 }));
    assert.equal(projection.status, "UNAVAILABLE");
    assert.equal(projection.weekly.status, "UNAVAILABLE");
  });

  it("does not treat a large GitHub Contents body as 기록 없음 when the blob is readable", async () => {
    const ledger = {
      version: 1,
      weekly: [weekly],
      monthly: [
        {
          kind: "monthly",
          version: 1,
          ranAt: "2026-10-03T09:55:33.611Z",
          mainSha: "def",
          status: "SUCCESS",
          counts: emptyCodeHealthCounts(),
          previousCounts: emptyCodeHealthCounts(),
          delta: null,
          eligibleIds: [],
          draftPr: { created: false, url: null, reason: "none", selectedIds: [] },
          notes: ["no delete candidates"],
        },
      ],
    };
    const projection = await fetchCodeHealthAdminProjection([], async (input) => {
      const url = String(input);
      if (url.includes("/contents/ledger.json")) {
        return new Response(
          JSON.stringify({
            sha: "fb347f3251a692bb148024dba79e112316878211",
            size: 11_483_787,
            encoding: "none",
            content: "",
          }),
          { status: 200, headers: { "content-type": "application/json" } }
        );
      }
      if (url.includes("/git/blobs/")) {
        return new Response(
          JSON.stringify({
            sha: "fb347f3251a692bb148024dba79e112316878211",
            encoding: "base64",
            content: Buffer.from(JSON.stringify(ledger), "utf8").toString("base64"),
          }),
          { status: 200, headers: { "content-type": "application/json" } }
        );
      }
      return new Response("nope", { status: 404 });
    });
    assert.equal(projection.status, "OK");
    assert.equal(projection.weekly.status, "SUCCESS");
    assert.equal(projection.monthly.status, "SUCCESS");
    assert.equal(projection.monthly.eligibleCount, 0);
  });
});
