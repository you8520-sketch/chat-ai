import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { DEFAULT_STATUS_WIDGET } from "@/lib/statusWidget/defaultTemplate";
import { collectWidgetJsonKeys } from "@/lib/statusWidget/prompt";
import type { StatusWidget } from "@/lib/statusWidget/types";
import {
  buildPostTurnSharedInitialSystem,
  collectSharedWidgetRequiredKeys,
  sharedSystemHasConflictingWidgetOnlyContract,
} from "@/lib/postTurnSharedInitial/prompt";
import {
  assertProductionStrictJsonSchemaValid,
  buildPostTurnSharedInitialJsonSchema,
  sharedSchemaListsAllRequiredKeys,
} from "@/lib/postTurnSharedInitial/schema";
import { parsePostTurnSharedInitialResponse } from "@/lib/postTurnSharedInitial/parse";
import {
  evaluatePostTurnSharedInitialWidgetExtraction,
  postTurnSharedInitialSuggestedRepliesOk,
} from "@/lib/postTurnSharedInitialWidgetOutcome";
import {
  analyzePostTurnSharedInitialWidgetShape,
  countRecognizedWidgetKeysForInput,
} from "@/lib/postTurnSharedInitial/widgetShapeDiagnostics";
import type { PostTurnSharedInitialInput } from "@/lib/postTurnSharedInitial/types";
import {
  extractStatusWidgetValuesForTurn,
  type StatusWidgetExtractCaller,
} from "@/lib/statusWidget/extract";
import {
  logStatusWidgetTurnTelemetry,
  type StatusWidgetTurnTelemetry,
} from "@/lib/statusWidget/telemetry";
import { POST_TURN_SHARED_INITIAL_REQUEST_KIND } from "@/lib/postTurnSharedInitial/types";
import type { TokenUsage } from "@/lib/ai";
import type { ResolvedStatusWidgetTurn } from "@/lib/statusWidget/types";

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

function placeholderLiteralJson(input: PostTurnSharedInitialInput): string {
  const statusWidget: Record<string, unknown> = {};
  if (input.characterWidget) {
    statusWidget.character_values = Object.fromEntries(
      collectWidgetJsonKeys(input.characterWidget).map((key) => [key, "..."])
    );
  }
  if (input.userWidget) {
    statusWidget.user_values = Object.fromEntries(
      collectWidgetJsonKeys(input.userWidget).map((key) => [key, "..."])
    );
  }
  const root: Record<string, unknown> = { statusWidget };
  if (input.includeSuggestions) {
    root.suggestedReplies = {
      items: [
        { kind: "natural", text: padReply("*손을 잡으며* \"조금 더 솔직히 말해볼까?\"") },
        { kind: "twist", text: padReply("*미소 지으며* \"괜찮아, 천천히 이야기하자.\"") },
        { kind: "banter", text: padReply("*창밖을 보며* \"잠깐, 다른 이야기 하나 할게.\"") },
      ],
    };
  }
  if (input.includeRelationship) {
    root.relationship = {
      items: [],
      itemsRemove: [],
      promisesAdd: [],
      promisesRemove: [],
    };
  }
  return JSON.stringify(root);
}

function emptyMapLiteralJson(input: PostTurnSharedInitialInput): string {
  const statusWidget: Record<string, unknown> = {
    character_values: {},
    user_values: {},
  };
  return JSON.stringify({ statusWidget });
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
  if (input.includeSuggestions) {
    root.suggestedReplies = {
      items: [
        { kind: "natural", text: padReply("*손을 잡으며* \"조금 더 솔직히 말해볼까?\"") },
        { kind: "twist", text: padReply("*미소 지으며* \"괜찮아, 천천히 이야기하자.\"") },
        { kind: "banter", text: padReply("*창밖을 보며* \"잠깐, 다른 이야기 하나 할게.\"") },
      ],
    };
  }
  if (input.includeRelationship) {
    root.relationship = {
      items: ["렌: 반지"],
      itemsRemove: [],
      promisesAdd: [],
      promisesRemove: [],
    };
  }
  return JSON.stringify(root);
}

function assertFinalPromptContract(system: string, input: PostTurnSharedInitialInput): void {
  assert.doesNotMatch(system, /Valid structural JSON example/);
  assert.doesNotMatch(system, /WIDGET OUTPUT KEY CONTRACT/);
  assert.match(system, /provider JSON schema/);
  assert.equal(sharedSystemHasConflictingWidgetOnlyContract(system), false);
  assert.equal(sharedSchemaListsAllRequiredKeys(input), true);
  assertProductionStrictJsonSchemaValid(buildPostTurnSharedInitialJsonSchema(input));
}

describe("postTurnSharedInitial semantic-empty root cause", () => {
  it("R1: placeholder-literal response → serialization ok → semantic empty", () => {
    const input = dualInput();
    const text = placeholderLiteralJson(input);
    const parsed = parsePostTurnSharedInitialResponse(text, input);
    assert.equal(parsed.jsonParseOk, true);
    const shape = analyzePostTurnSharedInitialWidgetShape(text, input);
    assert.ok(shape.placeholderLikeDroppedCount > 0);
    assert.equal(shape.characterRecognizedKeyCount, 0);
    const outcome = evaluatePostTurnSharedInitialWidgetExtraction({
      transportOk: true,
      mode: "dual",
      parsed,
    });
    assert.equal(outcome.succeeded, false);
    assert.equal(outcome.reasonCode, "V3_INITIAL_EMPTY");
  });

  it("R2/R3/E: dual final prompt — no fake values, no empty-map exemplar, valid JSON example", () => {
    const input = dualInput({ includeSuggestions: true, includeRelationship: true });
    const system = buildPostTurnSharedInitialSystem(input);
    assertFinalPromptContract(system, input);
    assert.match(system, /provider JSON schema/);
    assert.doesNotMatch(system, /WIDGET OUTPUT KEY CONTRACT/);
  });

  it("R5: character-only final prompt contract", () => {
    const input = dualInput({ mode: "character", userWidget: null, includeSuggestions: false });
    const system = buildPostTurnSharedInitialSystem(input);
    assertFinalPromptContract(system, input);
    assert.doesNotMatch(system, /statusWidget\.user_values must contain exactly these keys:/);
  });

  it("R6: user-only final prompt contract", () => {
    const input = dualInput({ mode: "user", characterWidget: null, includeSuggestions: false });
    const system = buildPostTurnSharedInitialSystem(input);
    assertFinalPromptContract(system, input);
    assert.doesNotMatch(system, /statusWidget\.character_values must contain exactly these keys:/);
  });

  it("R4/R7: valid model response with all required keys → semantic ok (dual)", () => {
    const input = dualInput();
    const text = validJson(input);
    const parsed = parsePostTurnSharedInitialResponse(text, input);
    assert.equal(parsed.jsonParseOk, true);
    assert.ok(countRecognizedWidgetKeysForInput(text, input) > 0);
    const outcome = evaluatePostTurnSharedInitialWidgetExtraction({
      transportOk: true,
      mode: "dual",
      parsed,
    });
    assert.equal(outcome.succeeded, true);
    assert.equal(outcome.reasonCode, "OK");
  });

  it("R8: suggestions coalesced", () => {
    const input = dualInput({ includeSuggestions: true });
    const parsed = parsePostTurnSharedInitialResponse(validJson(input), input);
    assert.equal(postTurnSharedInitialSuggestedRepliesOk(parsed), true);
  });

  it("R9: relationship coalesced", () => {
    const input = dualInput({ includeSuggestions: false, includeRelationship: true });
    const parsed = parsePostTurnSharedInitialResponse(validJson(input), input);
    assert.equal(parsed.relationship.present, true);
    assert.equal(parsed.relationship.valid, true);
  });

  it("R10: physical shared Luna calls === 1", async () => {
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
    assert.equal(result.meta.sharedInitialSemanticStatus, "ok");
  });

  it("empty-map model copy still reproduces semantic empty (R1 class)", () => {
    const input = dualInput();
    const parsed = parsePostTurnSharedInitialResponse(emptyMapLiteralJson(input), input);
    assert.equal(parsed.jsonParseOk, true);
    const outcome = evaluatePostTurnSharedInitialWidgetExtraction({
      transportOk: true,
      mode: "dual",
      parsed,
    });
    assert.equal(outcome.succeeded, false);
    assert.equal(outcome.reasonCode, "V3_INITIAL_EMPTY");
  });

  it("R12: unknown output keys increment count only — telemetry never logs arbitrary key strings", () => {
    const input = dualInput();
    const text = JSON.stringify({
      statusWidget: {
        character_values: { ...buildValues(DEFAULT_STATUS_WIDGET), "유저가_쓴_임의키": "값" },
        user_values: buildValues(USER_WIDGET),
      },
    });
    const shape = analyzePostTurnSharedInitialWidgetShape(text, input);
    assert.ok(shape.unknownKeyCount >= 1);
    assert.equal("unknownReturnedKeys" in shape, false);

    const lines: string[] = [];
    const prevInfo = console.info;
    console.info = (...args: unknown[]) => {
      lines.push(args.map(String).join(" "));
    };
    try {
      const telemetry: StatusWidgetTurnTelemetry = {
        event: "status_widget_turn",
        chatId: 1,
        modelId: "gpt-5.6-luna",
        modelFamily: "openai",
        parserMode: "standard",
        streamCaptureHit: false,
        splitSavedHit: false,
        splitRawHit: false,
        inferHit: false,
        backfillAttempted: true,
        backfillSuccess: false,
        backfillSkippedReason: "v3_extract_empty",
        jsonParseSuccess: false,
        resolutionSource: "none",
        finalHasContent: false,
        finalCorruptBeforeBackfill: false,
        regenerate: false,
        transportStatus: "success",
        serializationStatus: "ok",
        semanticStatus: "empty",
        unknownKeyCount: shape.unknownKeyCount,
      };
      logStatusWidgetTurnTelemetry(telemetry);
    } finally {
      console.info = prevInfo;
    }
    const logged = lines.join("\n");
    assert.match(logged, /"unknownKeyCount":\d+/);
    assert.doesNotMatch(logged, /unknownReturnedKeys/);
    assert.doesNotMatch(logged, /유저가_쓴_임의키/);
  });

  it("required keys generated once from collectWidgetJsonKeys", () => {
    const input = dualInput();
    const fromContract = collectSharedWidgetRequiredKeys(input);
    assert.deepEqual(fromContract.characterKeys, collectWidgetJsonKeys(DEFAULT_STATUS_WIDGET));
    assert.deepEqual(fromContract.userKeys, collectWidgetJsonKeys(USER_WIDGET));
  });
});
