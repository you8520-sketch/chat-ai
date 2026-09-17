import {
  buildCombinedDualWidgetExtractSystem,
  buildCombinedDualWidgetExtractUserBlock,
  buildWidgetExtractSystem,
  buildWidgetExtractUserBlock,
} from "@/lib/statusWidget/extractNormalize";
import { collectWidgetJsonKeys } from "@/lib/statusWidget/prompt";
import type { PostTurnSharedInitialInput, PostTurnSharedInitialMode } from "./types";

const SHARED_SUGGESTIONS_OUTPUT_RULES = `SUGGESTED REPLIES section — write the USER's next roleplay turn options.
Return in suggestedReplies.items exactly 3 objects: escalate, soften, pivot (one each).
Korean only in text; each text 50–200 characters; mix dialogue and *stage direction*.
Write as the USER persona named in [USER] — match voice from [SUGGESTED REPLIES VOICE CONTEXT] when provided.
Do not write as the character/NPC.
Use [SUGGESTED REPLIES VOICE CONTEXT] only for suggestedReplies voice/style — never as evidence for statusWidget field values.`;

const SHARED_RELATIONSHIP_OUTPUT_RULES = `RELATIONSHIP section — durable relationship memory only, from this turn's prose.
Return these arrays; empty arrays are correct when nothing changed:
- items: new/changed possessions only ("name: item1, item2"); gifts/transfers as "from→to: item" or the receiver's updated line.
- itemsRemove: current possession lines that are no longer true (copy the previous line EXACTLY).
- promisesAdd: newly made promises as [{ "text": "...", "deadline": "..." }].
- promisesRemove: active promises now fulfilled/expired (copy the promise text EXACTLY).
Never extract honorifics, nicknames, inner thoughts, emotion, relationship stage, speech style, gender, or current location.`;

const SHARED_RELATIONSHIP_REGEN_RULES = `RELATIONSHIP section — the assistant reply for this turn was REGENERATED.
Compare the rejected assistant draft and the new canonical assistant in the user block.
- itemsRemove: current possession lines no longer true in the new canonical reply (copy the line EXACTLY), including transfers that existed only in the rejected draft.
- items / promisesAdd / promisesRemove: only changes introduced by the NEW canonical reply.
Never extract honorifics, nicknames, inner thoughts, emotion, relationship stage, speech style, gender, or current location.`;

export type SharedWidgetRequiredKeys = {
  characterKeys: readonly string[];
  userKeys: readonly string[];
};

/** Single owner — required dynamic widget keys for the shared output contract. */
export function collectSharedWidgetRequiredKeys(
  input: PostTurnSharedInitialInput
): SharedWidgetRequiredKeys {
  const characterKeys =
    input.mode !== "user" && input.mode !== "relationship_only" && input.characterWidget
      ? collectWidgetJsonKeys(input.characterWidget)
      : [];
  const userKeys =
    input.mode !== "character" && input.mode !== "relationship_only" && input.userWidget
      ? collectWidgetJsonKeys(input.userWidget)
      : [];
  return { characterKeys, userKeys };
}

function buildSharedWidgetKeyContract(input: PostTurnSharedInitialInput): string {
  const { characterKeys, userKeys } = collectSharedWidgetRequiredKeys(input);
  const lines: string[] = [];
  if (characterKeys.length > 0) {
    lines.push(
      `statusWidget.character_values must contain exactly these keys: ${JSON.stringify(characterKeys)}`,
      "Populate every character_values key with one scene-grounded string derived from this turn."
    );
  }
  if (userKeys.length > 0) {
    lines.push(
      `statusWidget.user_values must contain exactly these keys: ${JSON.stringify(userKeys)}`,
      "Populate every user_values key with one scene-grounded string derived from this turn."
    );
  }
  if (lines.length === 0) return "";
  return `WIDGET OUTPUT KEY CONTRACT\n${lines.join("\n")}`;
}

/** Valid JSON structural example — no fake answer values or active empty value maps. */
export function buildValidSharedOutputJsonExample(
  input: PostTurnSharedInitialInput
): Record<string, unknown> {
  const example: Record<string, unknown> = {};
  if (input.mode !== "relationship_only") {
    example.statusWidget = { extracted_facts: [] };
  }
  if (input.includeSuggestions) {
    example.suggestedReplies = { items: [] };
  }
  if (input.includeRelationship) {
    example.relationship = {
      items: [],
      itemsRemove: [],
      promisesAdd: [],
      promisesRemove: [],
    };
  }
  return example;
}

export function buildValidSharedOutputJsonExampleString(input: PostTurnSharedInitialInput): string {
  return JSON.stringify(buildValidSharedOutputJsonExample(input), null, 2);
}

const SHARED_OUTPUT_JSON_EXAMPLE_MARKER =
  "Valid structural JSON example (your response must match this nesting and add the required value objects):";

function buildSharedOutputEnvelope(input: PostTurnSharedInitialInput): string {
  const example = buildValidSharedOutputJsonExample(input);
  const topLevelKeyCount = Object.keys(example).length;
  const countWords = ["zero", "one", "two", "three"] as const;
  const keyCount = countWords[topLevelKeyCount] ?? String(topLevelKeyCount);

  const keyContract = buildSharedWidgetKeyContract(input);
  const rules: string[] = [];
  if (input.includeSuggestions) rules.push(SHARED_SUGGESTIONS_OUTPUT_RULES);
  if (input.includeRelationship) {
    rules.push(
      input.relationshipRegenContext
        ? SHARED_RELATIONSHIP_REGEN_RULES
        : SHARED_RELATIONSHIP_OUTPUT_RULES
    );
  }

  const parts = [`Return exactly one JSON object with ${keyCount} top-level key(s).`];
  if (keyContract) {
    parts.push(
      "",
      keyContract,
      "",
      "Include statusWidget.character_values and/or statusWidget.user_values in your JSON response.",
      "Each required key must map to one scene-grounded string value."
    );
  }
  parts.push(
    "",
    SHARED_OUTPUT_JSON_EXAMPLE_MARKER,
    buildValidSharedOutputJsonExampleString(input),
    "",
    "Do not include markdown fences or prose outside JSON.",
    ...rules
  );
  return parts.join("\n");
}

/** @internal tests — key contract fragment (no JSON braces). */
export function buildSharedStatusWidgetEnvelope(input: PostTurnSharedInitialInput): string | null {
  if (input.mode === "relationship_only") return null;
  const contract = buildSharedWidgetKeyContract(input);
  return contract || null;
}

/** @internal tests */
export const PARSER_INVALID_VALUE_EXEMPLAR_RE =
  /:\s*"\.\.\."|:\s*"…"|:\s*"<scene value>"/;

/** @internal tests — inspect literal structural JSON example only (not semantic rule prose). */
export function sharedOutputJsonExampleUsesParserInvalidValueExemplar(
  system: string
): boolean {
  const example = extractSharedOutputJsonExampleFromSystem(system);
  if (!example) return true;
  return PARSER_INVALID_VALUE_EXEMPLAR_RE.test(JSON.stringify(example));
}

/** @internal tests — active widget value maps must not appear empty in the JSON example. */
export function sharedOutputJsonExampleUsesActiveEmptyMapExemplar(
  system: string,
  input: PostTurnSharedInitialInput
): boolean {
  const example = extractSharedOutputJsonExampleFromSystem(system);
  if (!example) return true;
  const statusWidget = example.statusWidget;
  if (!statusWidget || typeof statusWidget !== "object" || Array.isArray(statusWidget)) {
    return false;
  }
  const widget = statusWidget as Record<string, unknown>;
  const { characterKeys, userKeys } = collectSharedWidgetRequiredKeys(input);
  if (characterKeys.length > 0) {
    const section = widget.character_values;
    if (
      section &&
      typeof section === "object" &&
      !Array.isArray(section) &&
      Object.keys(section as Record<string, unknown>).length === 0
    ) {
      return true;
    }
  }
  if (userKeys.length > 0) {
    const section = widget.user_values;
    if (
      section &&
      typeof section === "object" &&
      !Array.isArray(section) &&
      Object.keys(section as Record<string, unknown>).length === 0
    ) {
      return true;
    }
  }
  return false;
}

function extractBalancedJsonObject(source: string, start: number): string | null {
  if (source[start] !== "{") return null;
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = start; i < source.length; i++) {
    const ch = source[i];
    if (inString) {
      if (escaped) {
        escaped = false;
      } else if (ch === "\\") {
        escaped = true;
      } else if (ch === '"') {
        inString = false;
      }
      continue;
    }
    if (ch === '"') {
      inString = true;
      continue;
    }
    if (ch === "{") depth++;
    else if (ch === "}") {
      depth--;
      if (depth === 0) return source.slice(start, i + 1);
    }
  }
  return null;
}

/** @internal tests — parse the literal structural JSON example from assembled system prompt. */
export function extractSharedOutputJsonExampleFromSystem(
  system: string
): Record<string, unknown> | null {
  const markerIdx = system.indexOf(SHARED_OUTPUT_JSON_EXAMPLE_MARKER);
  if (markerIdx < 0) return null;
  const afterMarker = system.slice(markerIdx + SHARED_OUTPUT_JSON_EXAMPLE_MARKER.length);
  const start = afterMarker.indexOf("{");
  if (start < 0) return null;
  const jsonText = extractBalancedJsonObject(afterMarker, start);
  if (!jsonText) return null;
  try {
    return JSON.parse(jsonText) as Record<string, unknown>;
  } catch {
    return null;
  }
}

/** @internal tests */
export function sharedSystemListsAllRequiredKeys(
  system: string,
  input: PostTurnSharedInitialInput
): boolean {
  const { characterKeys, userKeys } = collectSharedWidgetRequiredKeys(input);
  for (const key of [...characterKeys, ...userKeys]) {
    if (!system.includes(JSON.stringify(key))) return false;
  }
  return characterKeys.length + userKeys.length > 0;
}

function buildSharedSuggestionVoiceContext(input: PostTurnSharedInitialInput): string {
  const lines = [
    input.userPersona?.trim() ? `[USER IDENTITY]\n${input.userPersona.trim()}` : "",
    input.personaDescription?.trim()
      ? `[USER PERSONA PERSONALITY / SPEECH]\n${input.personaDescription.trim()}`
      : "",
    input.personaSpeechExamples?.trim()
      ? `[USER SPEECH EXAMPLES — imitate this voice]\n${input.personaSpeechExamples.trim()}`
      : "",
  ].filter(Boolean);
  if (lines.length === 0) return "";
  return `[SUGGESTED REPLIES VOICE CONTEXT — suggestions only; do NOT use for statusWidget inference]\n${lines.join("\n\n")}`;
}

export function buildPostTurnSharedInitialSystem(input: PostTurnSharedInitialInput): string {
  const widgetSemantic =
    input.mode === "dual" && input.characterWidget && input.userWidget
      ? buildCombinedDualWidgetExtractSystem(input.characterWidget, input.userWidget, false)
      : input.mode === "character" && input.characterWidget
        ? buildWidgetExtractSystem(
            input.characterWidget,
            collectWidgetJsonKeys(input.characterWidget),
            "character",
            false
          )
        : input.mode === "user" && input.userWidget
          ? buildWidgetExtractSystem(
              input.userWidget,
              collectWidgetJsonKeys(input.userWidget),
              "user",
              false
            )
          : "";

  const activeSummary = [
    widgetSemantic ? "status widget values" : "",
    input.includeSuggestions ? "suggested user reply options" : "",
    input.includeRelationship ? "durable relationship memory" : "",
  ]
    .filter(Boolean)
    .join(", ");

  return `${widgetSemantic ? `${widgetSemantic}\n\n` : ""}SHARED POST-TURN ENRICHMENT — produce ${activeSummary} in one response.
${buildSharedOutputEnvelope(input)}`;
}

export function buildPostTurnSharedInitialUserBlock(input: PostTurnSharedInitialInput): string {
  let widgetBlock = "";
  if (input.mode === "dual" && input.characterWidget && input.userWidget) {
    widgetBlock = buildCombinedDualWidgetExtractUserBlock({
      charName: input.charName,
      characterIdentity: input.characterIdentity,
      characterCriticalContext: input.characterCriticalContext,
      personaName: input.personaName,
      userMessage: input.userMessage,
      assistantProse: input.assistantProse,
      previousAssistantProse: input.previousAssistantProse,
      characterWidget: input.characterWidget,
      userWidget: input.userWidget,
      previousCharacterValues: input.previousCharacterValues ?? null,
      previousUserValues: input.previousUserValues ?? null,
    });
  } else if (input.mode === "character" && input.characterWidget) {
    widgetBlock = buildWidgetExtractUserBlock({
      charName: input.charName,
      characterIdentity: input.characterIdentity,
      characterCriticalContext: input.characterCriticalContext,
      personaName: input.personaName,
      userMessage: input.userMessage,
      assistantProse: input.assistantProse,
      previousAssistantProse: input.previousAssistantProse,
      widget: input.characterWidget,
      source: "character",
      previousValues: input.previousCharacterValues ?? null,
    });
  } else if (input.mode === "user" && input.userWidget) {
    widgetBlock = buildWidgetExtractUserBlock({
      charName: input.charName,
      characterIdentity: input.characterIdentity,
      characterCriticalContext: input.characterCriticalContext,
      personaName: input.personaName,
      userMessage: input.userMessage,
      assistantProse: input.assistantProse,
      previousAssistantProse: input.previousAssistantProse,
      widget: input.userWidget,
      source: "user",
      previousValues: input.previousUserValues ?? null,
    });
  }

  const currentTurnBlock = input.relationshipRegenContext
    ? `[REJECTED ASSISTANT DRAFT — DISCARDED]\n${input.relationshipRegenContext.previousAssistantMessage}\n\n[NEW CANONICAL ASSISTANT]\n${input.assistantProse}`
    : `[THIS TURN — USER]\n${input.userMessage}\n\n[THIS TURN — ASSISTANT]\n${input.assistantProse}`;

  const voiceContext = input.includeSuggestions
    ? buildSharedSuggestionVoiceContext(input)
    : "";

  if (widgetBlock) {
    return [widgetBlock, voiceContext].filter(Boolean).join("\n\n");
  }
  // No widget consumer (status OFF). Always include the current turn so
  // suggestions-only work does not depend on the relationship section.
  return [currentTurnBlock, voiceContext].filter(Boolean).join("\n\n");
}

/** @internal tests — count authoritative top-level JSON output contracts. */
export function countAuthoritativeSharedOutputContracts(system: string): number {
  const matches = system.match(/Return exactly one JSON object/gi) ?? [];
  return matches.length;
}

/** @internal tests — standalone combined flat-top contract must not appear in shared system. */
export function sharedSystemHasConflictingWidgetOnlyContract(system: string): boolean {
  return /Return exactly one JSON object with this shape:\s*\{[\s\S]*?"character_values"/.test(
    system
  );
}
