import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { buildPostTurnSharedInitialJsonSchema } from "@/lib/postTurnSharedInitial/schema";
import type { PostTurnSharedInitialInput } from "@/lib/postTurnSharedInitial/types";
import { DEFAULT_STATUS_WIDGET } from "@/lib/statusWidget/defaultTemplate";
import {
  EPISODIC_FACT_SNAKE_CASE_JSON_PATTERN,
  EPISODIC_FACT_VALUE_JSON_PATTERN,
} from "./memory-episodic-types";
import { sanitizeEpisodicExtractedFacts } from "./memory-episodic-normalize";
import { buildSharedEpisodicSectionJsonSchema, parseSharedEpisodicSection } from "./memory-episodic-shared";

const VALID_FACT = {
  category: "character",
  subject: "enoch",
  attribute: "action",
  value: "locked_door",
  importance: "important",
  fact_text: "에녹은 유저가 떠나려 하자 문을 잠그고 남으라고 요구했다.",
  evidence_type: "explicit_scene_event",
  evidence: { source_role: "assistant", source_quote: "에녹이 문을 잠갔다." },
  corrects: "",
};

function episodicItemSchema() {
  const section = buildSharedEpisodicSectionJsonSchema();
  const facts = (section.properties as { extracted_facts: { minItems: number; maxItems: number; items: unknown } })
    .extracted_facts;
  assert.equal(facts.minItems, 0);
  assert.equal(facts.maxItems, 3);
  return facts.items as {
    properties: Record<string, { pattern?: string; maxLength?: number; minLength?: number }>;
  };
}

function statusOnInput(): PostTurnSharedInitialInput {
  return {
    mode: "character",
    charName: "볼프강",
    personaName: "렌",
    userMessage: "test",
    assistantProse: "test",
    primaryModelId: "gpt-6-luna",
    characterWidget: DEFAULT_STATUS_WIDGET,
    includeSuggestions: true,
    includeRelationship: true,
    includeEpisodic: true,
    activePromises: [],
    episodicCorrectionCandidates: [],
  };
}

describe("B29 episodic schema ↔ sanitizer contract", () => {
  it("schema exposes snake_case identifiers and non-whitespace value token", () => {
    const item = episodicItemSchema();
    assert.equal(item.properties.subject?.pattern, EPISODIC_FACT_SNAKE_CASE_JSON_PATTERN);
    assert.equal(item.properties.attribute?.pattern, EPISODIC_FACT_SNAKE_CASE_JSON_PATTERN);
    assert.equal(item.properties.value?.pattern, EPISODIC_FACT_VALUE_JSON_PATTERN);
    assert.equal(item.properties.value?.minLength, 1);
    assert.equal(item.properties.value?.maxLength, 80);
  });

  it("valid ASCII fact passes sanitizer and parse", () => {
    assert.equal(sanitizeEpisodicExtractedFacts([VALID_FACT], { requireEvidence: true }).length, 1);
    const parsed = parseSharedEpisodicSection({ extracted_facts: [VALID_FACT] });
    assert.equal(parsed.valid, true);
    assert.equal(parsed.facts.length, 1);
  });

  it("value may contain punctuation when no whitespace (schema wider than sanitizer trailing-punct gate)", () => {
    const withDot = { ...VALID_FACT, value: "v1.2" };
    assert.equal(sanitizeEpisodicExtractedFacts([withDot], { requireEvidence: true }).length, 1);
  });

  it("sanitizer still drops sentence-like value and Korean identifiers (schema does not retrofit)", () => {
    const koreanId = {
      ...VALID_FACT,
      subject: "볼프강",
      attribute: "진술 전달",
      value: "렌이 허락하기 전까지 진술을 감찰관에게 전달하지 않도록 병사에게 명령했다.",
    };
    assert.equal(sanitizeEpisodicExtractedFacts([koreanId], { requireEvidence: true }).length, 0);
    const parsed = parseSharedEpisodicSection({ extracted_facts: [koreanId] });
    assert.equal(parsed.valid, false);
  });

  it("valid empty array remains semantic empty", () => {
    const parsed = parseSharedEpisodicSection({ extracted_facts: [] });
    assert.deepEqual(parsed, { present: true, valid: true, facts: [], rawFactCount: 0 });
  });

  it("status ON full Shared Initial schema still includes episodic + widget consumers", () => {
    const schema = buildPostTurnSharedInitialJsonSchema(statusOnInput());
    const required = schema.required as string[];
    assert.ok(required.includes("statusWidget"));
    assert.ok(required.includes("suggestedReplies"));
    assert.ok(required.includes("relationship"));
    assert.ok(required.includes("episodic"));
  });

  it("B27 raw fact fixtures remain sanitizer-rejected (not auto-corrected by schema)", () => {
    const rows = JSON.parse(
      readFileSync("docs/pr-evidence/pr-b29-schema-align/b27-raw-facts-deidentified.json", "utf8")
    ) as Array<Record<string, unknown>>;
    assert.ok(rows.length >= 10);
    for (const row of rows) {
      const fact = {
        category: row.category,
        subject: row.subject,
        attribute: row.attribute,
        value: row.value,
        importance: row.importance,
        fact_text: row.fact_text,
        evidence_type: row.evidence_type,
        evidence: { source_role: row.source_role, source_quote: row.source_quote },
        corrects: "",
      };
      assert.equal(
        sanitizeEpisodicExtractedFacts([fact], { requireEvidence: true, requireSourceQuote: true }).length,
        0,
        `expected sanitizer drop for ${row.case}#${row.idx}`
      );
    }
  });
});
