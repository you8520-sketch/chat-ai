import assert from "node:assert/strict";
import { it } from "node:test";
import { screenCandidate } from "@/lib/memoryResearch/screening";
import { observation, wideSyntheticAdapter } from "@/lib/memoryResearch/labFixtures.test";

const now = new Date("2026-09-28T00:00:00Z");

function decision(obs: ReturnType<typeof observation>, withAdapter = false) {
  const r = screenCandidate(obs, withAdapter ? wideSyntheticAdapter(obs.candidateKey) : undefined, now);
  return r.outcome === "STOP" ? r.decision : r.outcome;
}

it("screening STOP rules (owner conflict, destructive, privacy, boundary, billing, unmaintained, infra, evidence)", () => {
  const k = "github:a/b";
  assert.equal(decision(observation({ candidateKey: k, riskFlags: ["duplicates_canonical_owner"] })), "REJECTED_OWNER_CONFLICT");
  assert.equal(decision(observation({ candidateKey: k, migrationRequirement: "destructive" })), "REJECTED_DESTRUCTIVE_MIGRATION");
  assert.equal(decision(observation({ candidateKey: k, privacyImplications: ["sends_rp_text_to_new_external_service"] })), "REJECTED_PRIVACY_EXPOSURE");
  assert.equal(decision(observation({ candidateKey: k, riskFlags: ["changes_auth_safety_adult_boundary"] })), "REJECTED_BOUNDARY_CHANGE");
  assert.equal(decision(observation({ candidateKey: k, riskFlags: ["changes_provider_billing"] })), "REJECTED_BILLING_CHANGE");
  assert.equal(
    decision(observation({ candidateKey: k, evidence: { hasReproducibleCode: true, hasPublishedBenchmark: true, archived: true, lastActivityAt: null } })),
    "REJECTED_UNMAINTAINED"
  );
  assert.equal(
    decision(observation({ candidateKey: k, evidence: { hasReproducibleCode: true, hasPublishedBenchmark: true, archived: false, lastActivityAt: "2024-01-01T00:00:00Z" } })),
    "REJECTED_UNMAINTAINED"
  );
  assert.equal(decision(observation({ candidateKey: k, infraRequirements: ["graph_database", "python_runtime"] })), "REJECTED_INFRA_COMPLEXITY");
  assert.equal(
    decision(observation({ candidateKey: "arxiv:2609.00001", sourceKind: "arxiv", evidence: { hasReproducibleCode: false, hasPublishedBenchmark: false, archived: false, lastActivityAt: null } })),
    "WATCH_INSUFFICIENT_EVIDENCE"
  );
});

it("screening routes benchmarkable candidates by hook/adapter availability", () => {
  assert.equal(decision(observation({ candidateKey: "github:c/d", category: "graph_memory" })), "WATCH_NO_BENCHMARK_HOOK");
  assert.equal(decision(observation({ candidateKey: "github:c/d", category: "embedding_model" })), "WATCH_NO_EXPERIMENT_ADAPTER");
  assert.equal(decision(observation({ candidateKey: "github:c/d", category: "embedding_model" }), true), "EXPERIMENT_ELIGIBLE");
  assert.equal(
    decision(observation({ candidateKey: "github:c/d", category: "embedding_model", infraRequirements: ["python_runtime"] }), true),
    "EXPERIMENT_ELIGIBLE",
    "a TypeScript-native adapter removes the wholesale-infra objection"
  );
  assert.equal(
    decision(observation({ candidateKey: "github:c/d", privacyImplications: ["stores_rp_text_in_new_external_store"] }), true),
    "REJECTED_PRIVACY_EXPOSURE",
    "an adapter never bypasses privacy/boundary rules"
  );
});
