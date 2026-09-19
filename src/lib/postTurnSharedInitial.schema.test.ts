import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { DEFAULT_STATUS_WIDGET } from "@/lib/statusWidget/defaultTemplate";
import { collectWidgetJsonKeys } from "@/lib/statusWidget/prompt";
import type { StatusWidget } from "@/lib/statusWidget/types";
import { extractJsonObjectFromWidgetText } from "@/lib/statusWidget/extractNormalize";
import { parsePostTurnSharedInitialResponse } from "@/lib/postTurnSharedInitial/parse";
import {
  evaluatePostTurnSharedInitialWidgetExtraction,
  postTurnSharedInitialSuggestedRepliesOk,
} from "@/lib/postTurnSharedInitialWidgetOutcome";
import {
  analyzePostTurnSharedInitialWidgetShape,
} from "@/lib/postTurnSharedInitial/widgetShapeDiagnostics";
import {
  assertProductionStrictJsonSchemaValid,
  buildPostTurnSharedInitialJsonSchema,
  buildPostTurnSharedInitialResponseFormat,
  collectStrictJsonSchemaIssues,
  POST_TURN_SHARED_INITIAL_SCHEMA_NAME,
  sharedSchemaListsAllRequiredKeys,
  validatePostTurnSharedInitialStructure,
} from "@/lib/postTurnSharedInitial/schema";
import {
  buildPostTurnSharedInitialSystem,
  collectSharedWidgetRequiredKeys,
} from "@/lib/postTurnSharedInitial/prompt";
import type { PostTurnSharedInitialInput } from "@/lib/postTurnSharedInitial/types";
import {
  extractStatusWidgetValuesForTurn,
  type StatusWidgetExtractCaller,
} from "@/lib/statusWidget/extract";
import { POST_TURN_SHARED_INITIAL_REQUEST_KIND } from "@/lib/postTurnSharedInitial/types";
import type { TokenUsage } from "@/lib/ai";
import type { ResolvedStatusWidgetTurn } from "@/lib/statusWidget/types";
import { adaptCheaperInferenceChatBody } from "@/lib/cheaperInferenceConfig";
import { CHEAPER_INFERENCE_GPT_56_LUNA_MODEL } from "@/lib/chatModels";

const USER_WIDGET: StatusWidget = {
  ...DEFAULT_STATUS_WIDGET,
  name: "내 커스텀",
  fields: [{ id: "my_note", label: "메모", instruction: "표시용 메모" }],
};

function padValue(key: string): string {
  return `${key}-장면값`.padEnd(10, "가");
}

function padReply(seed: string, length = 72): string {
  const filler = "가".repeat(Math.max(0, length - seed.length));
  return `${seed}${filler}`.slice(0, length);
}

function buildValues(widget: StatusWidget, overrides: Record<string, string> = {}): Record<string, string> {
  const out: Record<string, string> = {};
  for (const key of collectWidgetJsonKeys(widget)) {
    out[key] = overrides[key] ?? padValue(key);
  }
  return out;
}

function dualInput(overrides: Partial<PostTurnSharedInitialInput> = {}): PostTurnSharedInitialInput {
  return {
    mode: "dual",
    charName: "레온",
    characterIdentity: null,
    characterCriticalContext: null,
    personaName: "렌",
    userMessage: "안녕",
    assistantProse: "본문",
    characterWidget: DEFAULT_STATUS_WIDGET,
    userWidget: USER_WIDGET,
    primaryModelId: "gpt-5.6-luna",
    includeSuggestions: true,
    includeRelationship: false,
    includeEpisodic: false,
    relationshipRegenContext: null,
    ...overrides,
  };
}

function validSuggestions() {
  return {
    items: [
      { kind: "natural", text: padReply("*손을 잡으며* \"조금 더 솔직히 말해볼까?\"") },
      { kind: "twist", text: padReply("*미소 지으며* \"괜찮아, 천천히 이야기하자.\"") },
      { kind: "banter", text: padReply("*창밖을 보며* \"잠깐, 다른 이야기 하나 할게.\"") },
    ],
  };
}

function validEpisodicFacts() {
  return {
    extracted_facts: [
      {
        category: "preference",
        subject: "user",
        attribute: "favorite_drink",
        value: "syrup_coffee",
        importance: "important",
        fact_text: "사용자는 커피에 시럽을 두 번 넣어 마신다.",
        evidence_type: "explicit_user_statement",
      },
    ],
  };
}

function validJson(input: PostTurnSharedInitialInput): string {
  const statusWidget: Record<string, unknown> = {};
  if (input.characterWidget) {
    statusWidget.character_values = buildValues(input.characterWidget);
  }
  if (input.userWidget) {
    statusWidget.user_values = buildValues(input.userWidget);
  }
  const root: Record<string, unknown> = { statusWidget };
  if (input.includeSuggestions) root.suggestedReplies = validSuggestions();
  if (input.includeRelationship) {
    root.relationship = {
      items: [],
      itemsRemove: [],
      promisesAdd: [],
      promisesRemove: [],
    };
  }
  if (input.includeEpisodic) {
    root.episodic = validEpisodicFacts();
  }
  return JSON.stringify(root);
}

function schemaStatusForText(text: string, input: PostTurnSharedInitialInput) {
  const root = extractJsonObjectFromWidgetText(text);
  return validatePostTurnSharedInitialStructure(root, input);
}

describe("postTurnSharedInitial schema owner (S1–S12)", () => {
  it("S1: whole statusWidget missing → schema missing_required_section", () => {
    const input = dualInput();
    const text = JSON.stringify({
      suggestedReplies: validSuggestions(),
      relationship: { items: [], itemsRemove: [], promisesAdd: [], promisesRemove: [] },
    });
    const parsed = parsePostTurnSharedInitialResponse(text, input);
    assert.equal(parsed.jsonParseOk, true);
    assert.equal(schemaStatusForText(text, input), "missing_required_section");
    const shape = analyzePostTurnSharedInitialWidgetShape(text, input);
    assert.equal(shape.statusWidgetPresent, false);
    const outcome = evaluatePostTurnSharedInitialWidgetExtraction({
      transportOk: true,
      mode: "dual",
      parsed,
    });
    assert.equal(outcome.succeeded, false);
    assert.equal(outcome.reasonCode, "V3_INITIAL_EMPTY");
  });

  it("S2: character_values missing → schema missing_required_section", () => {
    const input = dualInput({ includeSuggestions: false });
    const text = JSON.stringify({
      statusWidget: {
        user_values: buildValues(USER_WIDGET),
      },
    });
    assert.equal(schemaStatusForText(text, input), "missing_required_section");
  });

  it("S3: one required dynamic key missing → schema missing_required_key", () => {
    const input = dualInput({ includeSuggestions: false });
    const partial = buildValues(DEFAULT_STATUS_WIDGET);
    const keys = collectWidgetJsonKeys(DEFAULT_STATUS_WIDGET);
    delete partial[keys[0]!];
    const text = JSON.stringify({
      statusWidget: {
        character_values: partial,
        user_values: buildValues(USER_WIDGET),
      },
    });
    assert.equal(schemaStatusForText(text, input), "missing_required_key");
  });

  it("S4: exact required keys → schema ok + semantic ok", () => {
    const input = dualInput({ includeSuggestions: false });
    const text = validJson(input);
    assert.equal(schemaStatusForText(text, input), "ok");
    const parsed = parsePostTurnSharedInitialResponse(text, input);
    const outcome = evaluatePostTurnSharedInitialWidgetExtraction({
      transportOk: true,
      mode: "dual",
      parsed,
    });
    assert.equal(outcome.succeeded, true);
    assert.equal(outcome.reasonCode, "OK");
  });

  it("S5: placeholders → schema ok + semantic empty", () => {
    const input = dualInput({ includeSuggestions: false });
    const statusWidget: Record<string, unknown> = { extracted_facts: [] };
    statusWidget.character_values = Object.fromEntries(
      collectWidgetJsonKeys(DEFAULT_STATUS_WIDGET).map((key) => [key, "..."])
    );
    statusWidget.user_values = Object.fromEntries(
      collectWidgetJsonKeys(USER_WIDGET).map((key) => [key, "..."])
    );
    const text = JSON.stringify({ statusWidget });
    assert.equal(schemaStatusForText(text, input), "ok");
    const parsed = parsePostTurnSharedInitialResponse(text, input);
    const outcome = evaluatePostTurnSharedInitialWidgetExtraction({
      transportOk: true,
      mode: "dual",
      parsed,
    });
    assert.equal(outcome.succeeded, false);
    assert.equal(outcome.reasonCode, "V3_INITIAL_EMPTY");
  });

  it("S6b: includeEpisodic adds top-level episodic section without statusWidget extracted_facts", () => {
    const input = dualInput({
      mode: "relationship_only",
      includeSuggestions: false,
      includeRelationship: true,
      includeEpisodic: true,
    });
    const schema = buildPostTurnSharedInitialJsonSchema(input);
    assert.deepEqual(schema.required, ["relationship", "episodic"]);
    const schemaText = JSON.stringify(schema);
    assert.doesNotMatch(schemaText, /statusWidget/);
    assert.match(schemaText, /explicit_user_statement/);
  });

  it("S6: widget OFF (relationship_only) → statusWidget not required", () => {
    const input = dualInput({
      mode: "relationship_only",
      includeSuggestions: false,
      includeRelationship: true,
    });
    const text = JSON.stringify({
      relationship: { items: [], itemsRemove: [], promisesAdd: [], promisesRemove: [] },
    });
    assert.equal(schemaStatusForText(text, input), "ok");
    const schema = buildPostTurnSharedInitialJsonSchema(input);
    assert.deepEqual(schema.required, ["relationship"]);
  });

  it("S7: character-only schema requires character_values only", () => {
    const input = dualInput({ mode: "character", userWidget: null, includeSuggestions: false });
    const schema = buildPostTurnSharedInitialJsonSchema(input);
    const statusWidget = (schema.properties as Record<string, unknown>).statusWidget as Record<
      string,
      unknown
    >;
    assert.deepEqual(statusWidget.required, ["character_values"]);
    assert.equal("user_values" in (statusWidget.properties as object), false);
  });

  it("S8: user-only schema requires user_values only", () => {
    const input = dualInput({ mode: "user", characterWidget: null, includeSuggestions: false });
    const schema = buildPostTurnSharedInitialJsonSchema(input);
    const statusWidget = (schema.properties as Record<string, unknown>).statusWidget as Record<
      string,
      unknown
    >;
    assert.deepEqual(statusWidget.required, ["user_values"]);
  });

  it("S9: dual schema requires both value maps", () => {
    const input = dualInput({ includeSuggestions: false });
    const schema = buildPostTurnSharedInitialJsonSchema(input);
    const statusWidget = (schema.properties as Record<string, unknown>).statusWidget as Record<
      string,
      unknown
    >;
    assert.deepEqual(statusWidget.required, ["character_values", "user_values"]);
  });

  it("S10: regen input keeps widget schema + relationship section", () => {
    const input = dualInput({
      includeSuggestions: false,
      includeRelationship: true,
      relationshipRegenContext: { previousAssistantMessage: "old draft" },
    });
    const schema = buildPostTurnSharedInitialJsonSchema(input);
    assert.deepEqual(schema.required, ["statusWidget", "relationship"]);
    const system = buildPostTurnSharedInitialSystem(input);
    assert.match(system, /REGENERATED/);
  });

  it("S11: dynamic keys with JSON-special chars appear in wire schema", () => {
    const widget: StatusWidget = {
      ...DEFAULT_STATUS_WIDGET,
      fields: [{ id: 'key"quote', label: "라벨\n줄", instruction: "값" }],
    };
    const input = dualInput({
      mode: "character",
      userWidget: null,
      characterWidget: widget,
      includeSuggestions: false,
    });
    assert.equal(sharedSchemaListsAllRequiredKeys(input), true);
    const format = buildPostTurnSharedInitialResponseFormat(input);
    const schemaText = JSON.stringify(format.json_schema.schema);
    assert.match(schemaText, /key\\"quote/);
    assert.match(schemaText, /라벨_줄/);
  });

  it("S12: physical shared Luna calls === 1", async () => {
    const invocations: string[] = [];
    const caller: StatusWidgetExtractCaller = async (_system, _history, opts) => {
      invocations.push(opts.requestKind);
      const input = dualInput({ includeSuggestions: true, includeRelationship: true });
      return {
        text: validJson(input),
        usage: { inputTokens: 100, outputTokens: 50, estimated: true } satisfies TokenUsage,
      };
    };
    const resolved: ResolvedStatusWidgetTurn = {
      active: true,
      requestedMode: "dual",
      mode: "dual",
      displayMode: "both",
      stackOrder: "character_first",
      characterWidget: DEFAULT_STATUS_WIDGET,
      userWidget: USER_WIDGET,
      needsCharacterValues: true,
      needsUserValues: true,
    };
    const result = await extractStatusWidgetValuesForTurn({
      charName: "레온",
      personaName: "렌",
      userMessage: "안녕",
      assistantProse: "본문",
      resolved,
      previousValues: null,
      caller,
      coalesceSuggestedReplies: { enabled: true },
      shareRelationshipDelta: true,
    });
    assert.equal(invocations.filter((k) => k === POST_TURN_SHARED_INITIAL_REQUEST_KIND).length, 1);
    assert.equal(result.meta.actualCallCount, 1);
    assert.equal(result.meta.sharedInitialSchemaStatus, "ok");
    assert.equal(result.meta.sharedInitialSemanticStatus, "ok");
  });

  it("wire: Luna sends json_schema strict response_format", () => {
    const input = dualInput({ includeSuggestions: false });
    const format = buildPostTurnSharedInitialResponseFormat(input);
    const adapted = adaptCheaperInferenceChatBody({
      model: CHEAPER_INFERENCE_GPT_56_LUNA_MODEL,
      messages: [{ role: "user", content: "x" }],
      stream: false,
      temperature: 0.4,
      max_tokens: 4096,
      response_format: format,
    });
    assert.equal(adapted.response_format.type, "json_schema");
    assert.equal(adapted.response_format.json_schema.strict, true);
    const { characterKeys, userKeys } = collectSharedWidgetRequiredKeys(input);
    assert.ok(characterKeys.length > 0);
    assert.ok(userKeys.length > 0);
  });

  it("prompt does not duplicate structural key contract (schema-owned)", () => {
    const input = dualInput();
    const system = buildPostTurnSharedInitialSystem(input);
    assert.doesNotMatch(system, /WIDGET OUTPUT KEY CONTRACT/);
    assert.doesNotMatch(system, /must contain exactly these keys:/);
    assert.doesNotMatch(system, /Valid structural JSON example/);
    assert.match(system, /provider JSON schema/);
  });

  it("exact relationship strict schema: promisesAdd deadline is required", () => {
    const input = dualInput({ includeSuggestions: false, includeRelationship: true });
    const schema = buildPostTurnSharedInitialJsonSchema(input);
    assertProductionStrictJsonSchemaValid(schema);
    const relationship = (schema.properties as Record<string, unknown>).relationship as Record<
      string,
      unknown
    >;
    const promisesAdd = (relationship.properties as Record<string, unknown>).promisesAdd as Record<
      string,
      unknown
    >;
    const item = promisesAdd.items as Record<string, unknown>;
    assert.deepEqual(item.required, ["text", "deadline"]);
    assert.equal(collectStrictJsonSchemaIssues(schema).length, 0);
  });

  it("production schema variants are strict-valid locally", () => {
    const scenarios: Array<{ label: string; input: PostTurnSharedInitialInput }> = [
      {
        label: "character+suggestions+relationship",
        input: dualInput({
          mode: "character",
          userWidget: null,
          includeSuggestions: true,
          includeRelationship: true,
        }),
      },
      {
        label: "dual+suggestions+relationship",
        input: dualInput({ includeSuggestions: true, includeRelationship: true }),
      },
      {
        label: "relationship_only",
        input: dualInput({
          mode: "relationship_only",
          includeSuggestions: false,
          includeRelationship: true,
        }),
      },
      {
        label: "regen+relationship",
        input: dualInput({
          includeSuggestions: false,
          includeRelationship: true,
          relationshipRegenContext: { previousAssistantMessage: "rejected draft" },
        }),
      },
    ];
    for (const scenario of scenarios) {
      const format = buildPostTurnSharedInitialResponseFormat(scenario.input);
      assert.equal(format.type, "json_schema");
      assert.equal(format.json_schema.name, POST_TURN_SHARED_INITIAL_SCHEMA_NAME);
      assert.equal(format.json_schema.strict, true);
      assertProductionStrictJsonSchemaValid(format.json_schema.schema);
      assert.equal(collectStrictJsonSchemaIssues(format.json_schema.schema).length, 0, scenario.label);
    }
  });

  it("structural owner exactly one: schema.ts wire format, prompt has no structural JSON", () => {
    const input = dualInput({ includeSuggestions: true, includeRelationship: true });
    const system = buildPostTurnSharedInitialSystem(input);
    assert.doesNotMatch(system, /Valid structural JSON example/);
    assert.doesNotMatch(system, /"statusWidget"\s*:/);
    const format = buildPostTurnSharedInitialResponseFormat(input);
    assert.equal(format.json_schema.name, POST_TURN_SHARED_INITIAL_SCHEMA_NAME);
    assert.ok(JSON.stringify(format.json_schema.schema).includes('"statusWidget"'));
  });
});
