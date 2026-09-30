import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  RP_EXAMPLE_LITERAL_AB_ARMS,
  RP_EXAMPLE_LITERAL_AB_MAX_CALLS,
  buildRpExampleLiteralBoundaryAbPlan,
  runRpExampleLiteralBoundaryAb,
} from "./rpExampleLiteralBoundaryAb";

describe("rpExampleLiteralBoundaryAb", () => {
  it("uses exactly 3 models × 2 arms × 1 production case", () => {
    const plan = buildRpExampleLiteralBoundaryAbPlan();
    assert.equal(plan.length, RP_EXAMPLE_LITERAL_AB_MAX_CALLS);
    assert.equal(plan.length, 6);
    assert.deepEqual(
      [...new Set(plan.map((row) => row.arm))],
      [...RP_EXAMPLE_LITERAL_AB_ARMS]
    );
    assert.ok(plan.every((row) => row.caseData.id === "production_midchat_t1"));
  });

  it("passes raw/strip arm into the real request evidence", async () => {
    const seenBodies: unknown[] = [];
    const fetchImpl: typeof fetch = async (_input, init) => {
      seenBodies.push(JSON.parse(String(init?.body ?? "{}")));
      const body = [
        'data: {"id":"gen-test","choices":[{"delta":{"content":"테스트 출력"},"finish_reason":null}]}',
        'data: {"id":"gen-test","choices":[{"delta":{},"finish_reason":"stop"}],"usage":{"prompt_tokens":100,"completion_tokens":20}}',
        "data: [DONE]",
        "",
      ].join("\n");
      return new Response(body, {
        status: 200,
        headers: { "Content-Type": "text/event-stream" },
      });
    };

    const report = await runRpExampleLiteralBoundaryAb({
      credentials: {
        cheaperinference: "ci-key",
        openrouter: "or-key",
      },
      runId: "unit",
      fetchImpl,
    });

    assert.equal(report.providerCalls, 6);
    assert.equal(seenBodies.length, 6);
    assert.equal(report.productionMutationEnabled, false);
    for (const arm of RP_EXAMPLE_LITERAL_AB_ARMS) {
      const rows = report.rows.filter((row) => row.arm === arm);
      assert.equal(rows.length, 3);
      assert.ok(rows.every((row) => row.requestEvidence.exampleLiteralMode === arm));
    }
  });
});
