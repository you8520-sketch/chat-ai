import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { evaluateEpisodicFactEvidence } from "./memory-episodic-evidence";
import { EPISODIC_FACTS_EXTRACT_INSTRUCTIONS } from "./memory-episodic-prompt";
import type { EpisodicExtractedFact } from "./memory-episodic-types";

function allowedExampleFacts(): EpisodicExtractedFact[] {
  const section = EPISODIC_FACTS_EXTRACT_INSTRUCTIONS.split("- Allowed examples:")[1]?.split("\n- If uncertain")[0];
  assert.ok(section, "Allowed examples section exists");
  return section
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.startsWith("- {"))
    .map((line) => JSON.parse(line.slice(2)) as EpisodicExtractedFact);
}

describe("episodic prompt Allowed examples obey the evidence contract", () => {
  const facts = allowedExampleFacts();

  it("every Allowed example is accepted by the live evidence verifier against its own quote", () => {
    assert.ok(facts.length >= 5);
    for (const fact of facts) {
      const role = fact.evidence?.source_role;
      const quote = fact.evidence?.source_quote ?? "";
      const decision = evaluateEpisodicFactEvidence(
        fact,
        {
          user: role === "user" ? { id: 1, text: quote } : { id: 1, text: "..." },
          assistant: role === "assistant" ? { id: 2, text: quote } : { id: 2, text: "..." },
        },
        {}
      );
      assert.equal(decision.accepted, true, `${fact.attribute}/${fact.value}: ${JSON.stringify(decision)}`);
    }
  });

  it("a relationship example with a user-role quote never carries an agreement/acceptance/lovers claim (proposal != acceptance)", () => {
    for (const fact of facts) {
      if (fact.category !== "relationship" || fact.evidence?.source_role !== "user") continue;
      assert.doesNotMatch(
        `${fact.value} ${fact.fact_text}`,
        /lovers|accepted|합의|수락/u,
        `user-quote example claims agreement: ${fact.fact_text}`
      );
    }
  });

  it("relationship examples keep a proposal (user) and an acceptance (character) as separate sourced events", () => {
    const relationship = facts.filter((fact) => fact.category === "relationship");
    assert.ok(
      relationship.some((fact) => fact.evidence?.source_role === "user" && /제안/u.test(fact.fact_text)),
      "proposal example quotes the user"
    );
    assert.ok(
      relationship.some((fact) => fact.evidence?.source_role === "assistant" && /수락/u.test(fact.fact_text)),
      "acceptance example quotes the character"
    );
  });

  it("a character claim example verifies as CHARACTER_CLAIM, never as an objective scene fact", () => {
    const claims = facts.filter((fact) => fact.evidence_type === "explicit_character_claim");
    assert.ok(claims.length >= 1, "an attributed character-claim example exists");
    for (const fact of claims) {
      const quote = fact.evidence?.source_quote ?? "";
      const decision = evaluateEpisodicFactEvidence(
        fact,
        { user: { id: 1, text: "..." }, assistant: { id: 2, text: quote } },
        {}
      );
      assert.ok(decision.accepted);
      assert.equal(decision.evidence.authority, "CHARACTER_CLAIM");
      assert.match(fact.fact_text, /주장했|말했|밝혔/u);
    }
  });
});
