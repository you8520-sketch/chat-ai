import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  fetchMemoryResearchAdminProjection,
  MEMORY_RESEARCH_WORKFLOW_PATH,
  projectMemoryResearchAdminRun,
} from "@/lib/adminMemoryResearchReports";
import type { GithubScheduledAutomationGroup } from "@/lib/adminAutomationReports";

function githubContent(raw: string): Response {
  return new Response(
    JSON.stringify({
      content: Buffer.from(raw, "utf8").toString("base64"),
    }),
    {
      status: 200,
      headers: { "content-type": "application/json" },
    }
  );
}

const groups: GithubScheduledAutomationGroup[] = [
  {
    key: "Memory research cycle::" + MEMORY_RESEARCH_WORKFLOW_PATH,
    name: "Memory research cycle",
    path: MEMORY_RESEARCH_WORKFLOW_PATH,
    latest: {
      id: 9,
      name: "Memory research cycle",
      path: MEMORY_RESEARCH_WORKFLOW_PATH,
      status: "completed",
      conclusion: "success",
      runNumber: 9,
      createdAt: "2026-09-30T01:17:00Z",
      updatedAt: "2026-09-30T01:18:00Z",
      htmlUrl: "https://github.com/example/repo/actions/runs/9",
    },
    history: [],
  },
];

describe("admin Memory Research reports", () => {
  it("projects current research fields and planner readiness without importing research runtime", () => {
    const run = projectMemoryResearchAdminRun(
      JSON.stringify({
        cycleKey: "weekly-2026-W40",
        mode: "weekly",
        status: "COMPLETED",
        finishedAt: "2026-09-30T01:18:00Z",
        mainSha: "abc123",
        counts: {
          sourcesChecked: 7,
          sourcesFailed: 1,
          observations: 51,
          newCandidates: 4,
          evaluated: 8,
          watch: 5,
          reject: 2,
          benchmarked: 3,
          accept: 1,
          draftPrPackets: 1,
        },
        providerCalls: {
          paidProviderCalls: 0,
          httpCalls: 42,
          httpBudget: 56,
        },
        estimatedCostUsd: 0,
        productionTouched: false,
        baselinePromotionGate: {
          status: "PASS",
          blocked: false,
        },
        companionExperimentProposals: [{}, {}],
        benchmarkAdoptionProposals: [{}],
        benchmarkCasePortPlans: [
          {
            readiness: "MIXED_OWNER_PLAN",
            subplans: [
              { readiness: "READY_DURABLE_LEDGER_FIXTURE" },
              { readiness: "HARNESS_EXTENSION_REQUIRED" },
            ],
          },
          { readiness: "READY_MUTATION_LIFECYCLE_FIXTURE" },
        ],
        benchmarkHarnessFeasibility: [{}, {}],
        localGoldAuthoringPackets: [{}],
        persistentMemoryGaps: [{}, {}, {}],
        decisions: [
          {
            candidateKey: "github:fixture/accepted",
            decision: "ACCEPTED_QUALITY_GAIN",
            reason: "gain",
          },
          {
            candidateKey: "github:fixture/rejected",
            decision: "REJECTED_OWNER_CONFLICT",
            reason: "owner",
          },
          {
            candidateKey: "github:fixture/watch",
            decision: "WATCH_NO_EXPERIMENT_ADAPTER",
            reason: "adapter",
          },
        ],
      })
    );

    assert.ok(run);
    assert.equal(run.cycleKey, "weekly-2026-W40");
    assert.equal(run.counts.accept, 1);
    assert.equal(run.paidProviderCalls, 0);
    assert.equal(run.companionExperimentProposals, 2);
    assert.equal(run.benchmarkAdoptionProposals, 1);
    assert.equal(run.benchmarkCasePortPlans, 2);
    assert.equal(run.readiness.mixedOwner, 1);
    assert.equal(run.readiness.readyDurableLedger, 1);
    assert.equal(run.readiness.readyMutationLifecycle, 1);
    assert.equal(run.readiness.harnessExtensionRequired, 1);
    assert.equal(run.persistentMemoryGaps, 3);
    assert.deepEqual(
      run.decisions.map((row) => row.candidateKey),
      ["github:fixture/accepted", "github:fixture/watch"]
    );
  });

  it("stays backward compatible with older cycle JSON that lacks newer research fields", () => {
    const run = projectMemoryResearchAdminRun(
      JSON.stringify({
        cycleKey: "weekly-2026-W39",
        mode: "weekly",
        status: "COMPLETED",
        finishedAt: "2026-09-28T06:54:40.569Z",
        mainSha: "old",
        counts: {
          sourcesChecked: 3,
          observations: 47,
          evaluated: 47,
          watch: 36,
          reject: 11,
        },
        providerCalls: {
          paidProviderCalls: 0,
          httpCalls: 38,
          httpBudget: 48,
        },
        estimatedCostUsd: 0,
        productionTouched: false,
        decisions: [],
      })
    );

    assert.ok(run);
    assert.equal(run.benchmarkCasePortPlans, 0);
    assert.equal(run.readiness.harnessExtensionRequired, 0);
    assert.equal(run.baselinePromotionGateStatus, null);
  });

  it("reads the newest persisted cycle and attaches the scheduled workflow run", async () => {
    const ledger = JSON.stringify({
      schemaVersion: 1,
      candidates: {},
      cycles: [
        {
          cycleKey: "weekly-2026-W39",
          finishedAt: "2026-09-21T01:18:00Z",
        },
        {
          cycleKey: "weekly-2026-W40",
          finishedAt: "2026-09-28T01:18:00Z",
        },
      ],
    });
    const cycle = JSON.stringify({
      cycleKey: "weekly-2026-W40",
      mode: "weekly",
      status: "COMPLETED",
      finishedAt: "2026-09-28T01:18:00Z",
      mainSha: "abc",
      counts: {},
      providerCalls: {},
      estimatedCostUsd: 0,
      productionTouched: false,
      decisions: [],
    });
    const seen: string[] = [];
    const projection = await fetchMemoryResearchAdminProjection(
      groups,
      async (input) => {
        const url = String(input);
        seen.push(url);
        if (url.includes("/ledger.json")) return githubContent(ledger);
        if (url.includes("/cycles/weekly-2026-W40.json")) {
          return githubContent(cycle);
        }
        return new Response("missing", { status: 404 });
      },
      "example/repo"
    );

    assert.equal(projection.status, "OK");
    assert.equal(projection.run?.cycleKey, "weekly-2026-W40");
    assert.equal(
      projection.githubRunUrl,
      "https://github.com/example/repo/actions/runs/9"
    );
    assert.match(
      projection.persistedReportUrl ?? "",
      /memory-research-ledger\/cycles\/weekly-2026-W40\.json/
    );
    assert.equal(seen.length, 2);
  });

  it("fails closed when the durable research ledger cannot be read", async () => {
    const projection = await fetchMemoryResearchAdminProjection(
      groups,
      async () => new Response("nope", { status: 503 }),
      "example/repo"
    );
    assert.equal(projection.status, "UNAVAILABLE");
    assert.equal(projection.run, null);
    assert.match(projection.error ?? "", /503/);
  });
});
