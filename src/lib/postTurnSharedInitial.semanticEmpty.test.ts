import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { DEFAULT_STATUS_WIDGET } from "@/lib/statusWidget/defaultTemplate";
import { collectWidgetJsonKeys } from "@/lib/statusWidget/prompt";
import { serializeStatusWidget } from "@/lib/statusWidget/serialize";
import type { StatusWidget } from "@/lib/statusWidget/types";
import {
  buildSharedStatusWidgetEnvelope,
  buildPostTurnSharedInitialSystem,
  sharedStatusWidgetEnvelopeUsesPlaceholderExemplar,
} from "@/lib/postTurnSharedInitial/prompt";
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
    relationshipRegenContext: null,
    ...overrides,
  };
}

function placeholderLiteralJson(input: PostTurnSharedInitialInput): string {
  const statusWidget: Record<string, unknown> = { extracted_facts: [] };
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
        { kind: "escalate", text: padReply("*손을 잡으며* \"조금 더 솔직히 말해볼까?\"") },
        { kind: "soften", text: padReply("*미소 지으며* \"괜찮아, 천천히 이야기하자.\"") },
        { kind: "pivot", text: padReply("*창밖을 보며* \"잠깐, 다른 이야기 하나 할게.\"") },
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

function validJson(input: PostTurnSharedInitialInput): string {
  const statusWidget: Record<string, unknown> = { extracted_facts: [] };
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
        { kind: "escalate", text: padReply("*손을 잡으며* \"조금 더 솔직히 말해볼까?\"") },
        { kind: "soften", text: padReply("*미소 지으며* \"괜찮아, 천천히 이야기하자.\"") },
        { kind: "pivot", text: padReply("*창밖을 보며* \"잠깐, 다른 이야기 하나 할게.\"") },
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

function evaluateSemantic(input: PostTurnSharedInitialInput, text: string) {
  const parsed = parsePostTurnSharedInitialResponse(text, input);
  const outcome = evaluatePostTurnSharedInitialWidgetExtraction({
    transportOk: true,
    mode: input.mode === "relationship_only" ? "character" : input.mode,
    parsed,
  });
  return { parsed, outcome };
}

describe("postTurnSharedInitial semantic-empty root cause", () => {
  it("reproduces semantic empty: valid JSON + placeholder literal values dropped by normalize", () => {
    const input = dualInput();
    const text = placeholderLiteralJson(input);
    const parsed = parsePostTurnSharedInitialResponse(text, input);
    assert.equal(parsed.jsonParseOk, true);
    const shape = analyzePostTurnSharedInitialWidgetShape(text, input);
    assert.equal(shape.statusWidgetPresent, true);
    assert.equal(shape.characterValuesPresent, true);
    assert.equal(shape.userValuesPresent, true);
    assert.ok(shape.characterReturnedKeyCount > 0);
    assert.ok(shape.placeholderLikeDroppedCount > 0);
    assert.equal(shape.characterRecognizedKeyCount, 0);
    assert.equal(shape.userRecognizedKeyCount, 0);
    const outcome = evaluatePostTurnSharedInitialWidgetExtraction({
      transportOk: true,
      mode: "dual",
      parsed,
    });
    assert.equal(outcome.succeeded, false);
    assert.equal(outcome.reasonCode, "V3_INITIAL_EMPTY");
  });

  it("authoritative output contract contains no downstream-invalid placeholder exemplar", () => {
    const envelope = buildSharedStatusWidgetEnvelope(dualInput());
    assert.ok(envelope);
    assert.equal(sharedStatusWidgetEnvelopeUsesPlaceholderExemplar(envelope!), false);
    const system = buildPostTurnSharedInitialSystem(dualInput());
    assert.match(system, /Required character_values keys/);
    assert.match(system, /"character_values": \{\}/);
    assert.match(envelope!, /"character_values": \{\}/);
    assert.doesNotMatch(envelope!, /:\s*"\.\.\."/);
  });

  it("valid JSON with recognized values yields semantic ok (dual)", () => {
    const input = dualInput();
    const { parsed, outcome } = evaluateSemantic(input, validJson(input));
    assert.equal(parsed.jsonParseOk, true);
    assert.ok(countRecognizedWidgetKeysForInput(validJson(input), input) > 0);
    assert.equal(outcome.succeeded, true);
    assert.equal(outcome.reasonCode, "OK");
  });

  it("character-only shared parse succeeds with recognized values", () => {
    const input = dualInput({
      mode: "character",
      userWidget: null,
      includeSuggestions: false,
    });
    const { outcome } = evaluateSemantic(input, validJson(input));
    assert.equal(outcome.succeeded, true);
  });

  it("user-only shared parse succeeds with recognized values", () => {
    const input = dualInput({
      mode: "user",
      characterWidget: null,
      includeSuggestions: false,
    });
    const { outcome } = evaluateSemantic(input, validJson(input));
    assert.equal(outcome.succeeded, true);
  });

  it("suggestions coalesced: valid widget + suggestions both preserved", () => {
    const input = dualInput({ includeSuggestions: true });
    const parsed = parsePostTurnSharedInitialResponse(validJson(input), input);
    assert.equal(postTurnSharedInitialSuggestedRepliesOk(parsed), true);
    assert.equal(
      evaluatePostTurnSharedInitialWidgetExtraction({
        transportOk: true,
        mode: "dual",
        parsed,
      }).succeeded,
      true
    );
  });

  it("relationship coalesced: valid widget + relationship section usable", () => {
    const input = dualInput({ includeSuggestions: false, includeRelationship: true });
    const parsed = parsePostTurnSharedInitialResponse(validJson(input), input);
    assert.equal(parsed.relationship.present, true);
    assert.equal(parsed.relationship.valid, true);
    assert.equal(
      evaluatePostTurnSharedInitialWidgetExtraction({
        transportOk: true,
        mode: "dual",
        parsed,
      }).succeeded,
      true
    );
  });

  it("shared initial coalesced turn spends exactly one physical Luna call", async () => {
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
    assert.ok(result.meta.sharedInitialWidgetShape);
    assert.ok(result.meta.sharedInitialWidgetShape!.characterRecognizedKeyCount > 0);
  });
});
