import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  buildCompanionExperimentProposals,
  renderCompanionExperimentBridgeMarkdown,
  type CompanionExperimentProposal,
} from "@/lib/memoryResearch/companionExperimentBridge";
import {
  BENCHMARK_HOOKED_OWNERS,
  isBenchmarkOwnerHooked,
  MEMORY_OWNER_MAP,
} from "@/lib/memoryResearch/ownerMap";
import type { ResearchObservation } from "@/lib/memoryResearch/types";

function officialObservation(input: {
  key: string;
  summary: string;
  claimedAdvantage?: string;
}): ResearchObservation {
  return {
    candidateKey: input.key,
    sourceKind: "official_companion_docs",
    sourceUrl: `https://official.example/${input.key}`,
    title: `${input.key} official memory docs`,
    version: "docs-fixture",
    publishedAt: null,
    summary: input.summary,
    claimedAdvantage: input.claimedAdvantage ?? input.summary,
    category: "companion_roleplay_memory",
    evidence: {
      hasReproducibleCode: false,
      hasPublishedBenchmark: false,
      archived: false,
      lastActivityAt: null,
    },
    infraRequirements: ["none"],
    privacyImplications: ["none"],
    migrationRequirement: "none",
    riskFlags: [],
  };
}

function byTechnique(
  proposals: readonly CompanionExperimentProposal[],
  technique: CompanionExperimentProposal["technique"]
): CompanionExperimentProposal {
  const found = proposals.find((proposal) => proposal.technique === technique);
  assert.ok(found, `missing proposal for ${technique}`);
  return found;
}

describe("Companion Memory Experiment Bridge", () => {
  it("registers actual packing/selection/reranking hooks without overclaiming Global or durable owners", () => {
    assert.deepEqual(BENCHMARK_HOOKED_OWNERS, [
      "semantic_retrieval",
      "embedding_index",
      "prompt_packing",
      "episodic_selection",
      "reranking_scoring",
    ]);
    assert.equal(isBenchmarkOwnerHooked("prompt_packing"), true);
    assert.equal(isBenchmarkOwnerHooked("episodic_selection"), true);
    assert.equal(isBenchmarkOwnerHooked("reranking_scoring"), true);
    assert.equal(isBenchmarkOwnerHooked("global_current_memory"), false);
    assert.equal(isBenchmarkOwnerHooked("relationship_durable"), false);
    assert.equal(isBenchmarkOwnerHooked("episodic_facts"), false);
  });

  it("maps Nomi Identity Core to existing owners and flags wholesale Mind Map as an owner conflict", () => {
    const proposals = buildCompanionExperimentProposals(
      officialObservation({
        key: "nomi",
        summary:
          "Identity Core refines a dynamic sense of self. Mind Map connects memories about people, places, topics, and goals.",
      })
    );

    const identity = byTechnique(proposals, "identity_core");
    assert.equal(identity.classification, "BENCHMARK_WORTHY");
    assert.deepEqual(identity.targetOwners, [
      "global_current_memory",
      "relationship_durable",
    ]);
    assert.equal(identity.benchmarkHookReady, false);
    assert.match(identity.nextAction, /existing Global\/Relationship owners/);

    const mindMap = byTechnique(proposals, "mind_map");
    assert.equal(mindMap.classification, "OWNER_CONFLICT");
    assert.equal(mindMap.benchmarkHookReady, false);
    assert.match(mindMap.nextAction, /Do not add a graph DB or second writable memory owner/);
  });

  it("separates Kindroid-style cascaded history from bounded long-term recall", () => {
    const proposals = buildCompanionExperimentProposals(
      officialObservation({
        key: "kindroid",
        summary:
          "Cascaded summarized history keeps older conversation context. Long-term memory recalls up to nine journal entries when relevant.",
      })
    );

    const cascaded = byTechnique(proposals, "cascaded_summary_history");
    assert.equal(cascaded.classification, "ALREADY_HAVE");
    assert.deepEqual(cascaded.targetOwners, [
      "rolling_summary",
      "medium_term",
      "global_current_memory",
    ]);
    assert.match(cascaded.localCoverage, /5-turn rolling summaries/);

    const recall = byTechnique(proposals, "bounded_long_term_recall");
    assert.equal(recall.classification, "BENCHMARK_WORTHY");
    assert.deepEqual(recall.targetOwners, [
      "episodic_facts",
      "episodic_selection",
      "prompt_packing",
    ]);
    assert.equal(recall.benchmarkHookReady, true);
    assert.match(recall.hypothesis ?? "", /precision|prompt tokens/);
  });

  it("keeps pinned memory as product-semantics follow-up instead of auto-implementing it", () => {
    const proposals = buildCompanionExperimentProposals(
      officialObservation({
        key: "character-ai",
        summary:
          "Pinned Memories let a user pin important messages. Chat Memory provides a fixed user-authored memory field.",
      })
    );
    const pinned = byTechnique(proposals, "pinned_memory");
    assert.equal(pinned.classification, "FOLLOW_UP");
    assert.deepEqual(pinned.targetOwners, ["prompt_packing"]);
    assert.equal(pinned.benchmarkHookReady, false);
    assert.match(pinned.nextAction, /user-authored lore\/persona owner/);
  });

  it("marks automatic memory responsibility as already owned rather than creating a parallel subsystem", () => {
    const proposals = buildCompanionExperimentProposals(
      officialObservation({
        key: "auto-memory",
        summary: "Automatic memory stores important details from conversations for later recall.",
      })
    );
    const automatic = byTechnique(proposals, "automatic_memory");
    assert.equal(automatic.classification, "ALREADY_HAVE");
    assert.deepEqual(automatic.targetOwners, [
      "episodic_facts",
      "rolling_summary",
      "global_current_memory",
    ]);
    assert.match(automatic.nextAction, /Do not create another auto-memory subsystem/);
  });

  it("uses insufficient evidence when official text has no deterministic technique mapping", () => {
    const proposals = buildCompanionExperimentProposals(
      officialObservation({
        key: "vague",
        summary: "Our companion feels closer and more natural over time.",
      })
    );
    assert.equal(proposals.length, 1);
    assert.equal(proposals[0]!.technique, "unclassified");
    assert.equal(proposals[0]!.classification, "INSUFFICIENT_EVIDENCE");
    assert.equal(proposals[0]!.targetOwners.length, 0);
  });

  it("ignores non-official observations so GitHub/arXiv screening remains the canonical lane", () => {
    const obs = officialObservation({
      key: "paper",
      summary: "Identity Core memory benchmark",
    });
    const nonOfficial: ResearchObservation = {
      ...obs,
      sourceKind: "arxiv",
      sourceUrl: "https://arxiv.org/abs/0000.00000",
    };
    assert.deepEqual(buildCompanionExperimentProposals(nonOfficial), []);
  });

  it("only emits target owners that already exist in the canonical owner map", () => {
    const samples = [
      officialObservation({
        key: "nomi",
        summary: "Identity Core and Mind Map connect long-term memories.",
      }),
      officialObservation({
        key: "kindroid",
        summary: "Cascaded history and long-term memory recall journal entries.",
      }),
      officialObservation({
        key: "character-ai",
        summary: "Pinned Memories and automatic memory help remember important messages.",
      }),
    ];

    for (const proposal of samples.flatMap(buildCompanionExperimentProposals)) {
      for (const owner of proposal.targetOwners) {
        assert.ok(MEMORY_OWNER_MAP[owner], `unknown owner ${owner}`);
      }
      assert.equal(proposal.evidenceLevel, "OFFICIAL_PRODUCT_DOC_CLAIM_ONLY");
    }
  });

  it("renders evidence as neutral experiment-routing data, never as a performance score", () => {
    const proposals = buildCompanionExperimentProposals(
      officialObservation({
        key: "kindroid",
        summary:
          "Cascaded summarized history. Long-term memory recalls up to nine journal entries.",
      })
    );
    const markdown = renderCompanionExperimentBridgeMarkdown(proposals);
    assert.match(markdown, /Companion Memory Experiment Bridge/);
    assert.match(markdown, /ALREADY_HAVE/);
    assert.match(markdown, /BENCHMARK_WORTHY/);
    assert.match(markdown, /Official product documentation is hypothesis evidence only/);
    assert.doesNotMatch(markdown, /score|winner|best/i);
  });
});
