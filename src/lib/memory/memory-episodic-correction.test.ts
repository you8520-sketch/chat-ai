import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  EPISODIC_CORRECTION_HANDLES,
  readValidEpisodicCorrectionLink,
  type EpisodicCorrectionCandidate,
} from "./memory-episodic-correction";
import { buildSharedInitialEpisodicSectionInstructions } from "./memory-episodic-prompt";
import { buildSharedEpisodicSectionJsonSchema } from "./memory-episodic-shared";
import {
  buildPostTurnSharedInitialSystem,
  buildPostTurnSharedInitialUserBlock,
} from "@/lib/postTurnSharedInitial/prompt";
import { parsePostTurnSharedInitialResponse } from "@/lib/postTurnSharedInitial/parse";
import {
  assertProductionStrictJsonSchemaValid,
  buildPostTurnSharedInitialJsonSchema,
} from "@/lib/postTurnSharedInitial/schema";
import type { PostTurnSharedInitialInput } from "@/lib/postTurnSharedInitial/types";

const CANDIDATES: EpisodicCorrectionCandidate[] = [
  { handle: "C1", factId: 412, sourceTurn: 30, factText: "에녹은 늑대에게 물려 왼팔을 크게 다쳤다.", quote: "늑대가 에녹의 왼팔을 깊이 물어뜯었다." },
  { handle: "C2", factId: 977, sourceTurn: 80, factText: "에녹의 왼팔 부상은 치료 후 회복했다.", quote: null },
];

function input(overrides: Partial<PostTurnSharedInitialInput> = {}): PostTurnSharedInitialInput {
  return {
    mode: "relationship_only",
    charName: "에녹",
    personaName: "렌",
    userMessage: "아까 그 부상 장면 정정할게. 늑대에게 물린 게 아니라 문에 팔이 끼인 거야.",
    assistantProse: "에녹은 잠시 생각하다 고개를 끄덕였다.",
    primaryModelId: "gpt-6-luna",
    includeSuggestions: false,
    includeRelationship: false,
    includeEpisodic: true,
    activePromises: [],
    episodicCorrectionCandidates: CANDIDATES,
    ...overrides,
  };
}

function modelFact(corrects: string, extra: Record<string, unknown> = {}) {
  return {
    category: "character",
    subject: "enoch",
    attribute: "injury_cause",
    value: "door",
    importance: "important",
    fact_text: "에녹의 왼팔 부상은 문에 팔이 끼여서 생긴 것이다.",
    evidence_type: "explicit_user_statement",
    evidence: { source_role: "user", source_quote: "늑대에게 물린 게 아니라 문에 팔이 끼인 거야." },
    corrects,
    ...extra,
  };
}

function parseWith(corrects: string, candidates = CANDIDATES, extra: Record<string, unknown> = {}) {
  const text = JSON.stringify({ episodic: { extracted_facts: [modelFact(corrects, extra)] } });
  return parsePostTurnSharedInitialResponse(text, input({ episodicCorrectionCandidates: candidates })).episodic;
}

describe("episodic correction contract — wire schema", () => {
  it("every fact must carry corrects, restricted to the fixed handle enum", () => {
    const item = (
      (buildSharedEpisodicSectionJsonSchema().properties as Record<string, { items: Record<string, unknown> }>)
        .extracted_facts.items
    ) as { required: string[]; properties: Record<string, { enum?: string[] }>; additionalProperties: boolean };
    assert.ok(item.required.includes("corrects"));
    assert.deepEqual(item.properties.corrects?.enum, ["", "C1", "C2", "C3", "C4", "C5", "C6"]);
    assert.deepEqual([...EPISODIC_CORRECTION_HANDLES], item.properties.corrects?.enum);
    assert.equal(item.additionalProperties, false);
    assertProductionStrictJsonSchemaValid(buildPostTurnSharedInitialJsonSchema(input()));
  });

  it("the schema does not vary with the offered candidates", () => {
    assert.deepEqual(
      buildPostTurnSharedInitialJsonSchema(input()),
      buildPostTurnSharedInitialJsonSchema(input({ episodicCorrectionCandidates: [] }))
    );
  });
});

describe("episodic correction contract — prompt", () => {
  it("the user block lists the offered records under their handles; the system prompt never does", () => {
    const user = buildPostTurnSharedInitialUserBlock(input());
    assert.match(user, /\[CORRECTABLE PAST RECORDS — episodic corrects may only copy one of these handles\]/);
    assert.ok(user.includes("- C1 [T30] 에녹은 늑대에게 물려 왼팔을 크게 다쳤다. (source: “늑대가 에녹의 왼팔을 깊이 물어뜯었다.”)"));
    assert.ok(user.includes("- C2 [T80] 에녹의 왼팔 부상은 치료 후 회복했다."));
    assert.equal(user.includes("412"), false);
    assert.equal(
      buildPostTurnSharedInitialSystem(input()),
      buildPostTurnSharedInitialSystem(input({ episodicCorrectionCandidates: [] }))
    );
  });

  it("no candidates says so; no episodic section shows no list", () => {
    assert.match(buildPostTurnSharedInitialUserBlock(input({ episodicCorrectionCandidates: [] })), /\(none → corrects ""\)/);
    assert.equal(
      buildPostTurnSharedInitialUserBlock(input({ includeEpisodic: false, includeRelationship: true })).includes(
        "CORRECTABLE PAST RECORDS"
      ),
      false
    );
  });

  it("the corrects rule replaces the id/timestamp line instead of adding a second one", () => {
    const section = buildSharedInitialEpisodicSectionInstructions(false);
    assert.equal((section.match(/corrects/g) ?? []).length, 1);
    assert.equal(section.includes("NEVER generate source_turn"), false);
    assert.match(section, /NEVER output an unlisted handle, source_turn, id, uuid, or timestamp\./);
  });
});

describe("episodic correction contract — server-side handle mapping", () => {
  it("an offered handle maps to the record id the server offered", () => {
    assert.equal(parseWith("C1").facts[0]?.correction_target_fact_id, 412);
    assert.equal(parseWith("C2").facts[0]?.correction_target_fact_id, 977);
  });

  it("\"\" (new event, recovery, unclear target) or an unoffered handle maps to nothing", () => {
    assert.equal(parseWith("").facts[0]?.correction_target_fact_id, undefined);
    assert.equal(parseWith("C3").facts[0]?.correction_target_fact_id, undefined);
    assert.equal(parseWith("C1", []).facts[0]?.correction_target_fact_id, undefined);
    assert.equal(parseWith("412").facts[0]?.correction_target_fact_id, undefined);
  });

  it("a fact id written by the model itself is ignored", () => {
    assert.equal(parseWith("", CANDIDATES, { correction_target_fact_id: 412 }).facts[0]?.correction_target_fact_id, undefined);
  });

  it("the fact itself is kept either way", () => {
    for (const corrects of ["", "C1", "C3"]) {
      const parsed = parseWith(corrects);
      assert.equal(parsed.valid, true);
      assert.equal(parsed.facts.length, 1);
    }
  });
});

describe("episodic correction contract — stored link reading", () => {
  const userEvidence = { role: "user", message_id: 1201, quote: "늑대에게 물린 게 아니라 문에 팔이 끼인 거야.", authority: "USER_EXPLICIT", match: "normalized_exact" };
  const link = { target_fact_id: 412, target_source_turn: 30, root_fact_id: 380, root_source_turn: 12 };

  it("counts only with a verified user quote and an earlier target", () => {
    assert.deepEqual(
      readValidEpisodicCorrectionLink({ source_turn: 120, metadata: JSON.stringify({ evidence: userEvidence, correction: link }) }),
      link
    );
    assert.equal(
      readValidEpisodicCorrectionLink({ source_turn: 120, metadata: JSON.stringify({ correction: link }) }),
      null
    );
    assert.equal(
      readValidEpisodicCorrectionLink({
        source_turn: 120,
        metadata: JSON.stringify({ evidence: { ...userEvidence, role: "assistant", authority: "CURRENT_SCENE" }, correction: link }),
      }),
      null
    );
    assert.equal(
      readValidEpisodicCorrectionLink({ source_turn: 30, metadata: JSON.stringify({ evidence: userEvidence, correction: link }) }),
      null
    );
    assert.equal(
      readValidEpisodicCorrectionLink({ source_turn: 120, metadata: JSON.stringify({ evidence: userEvidence, correction: { target_fact_id: "x" } }) }),
      null
    );
  });

  it("a link without a root roots at its target; a root later than the target is not a link", () => {
    const read = (correction: Record<string, unknown>) =>
      readValidEpisodicCorrectionLink({ source_turn: 120, metadata: JSON.stringify({ evidence: userEvidence, correction }) });
    assert.deepEqual(read({ target_fact_id: 412, target_source_turn: 30 }), {
      target_fact_id: 412,
      target_source_turn: 30,
      root_fact_id: 412,
      root_source_turn: 30,
    });
    assert.equal(read({ ...link, root_source_turn: 31 }), null);
  });
});
