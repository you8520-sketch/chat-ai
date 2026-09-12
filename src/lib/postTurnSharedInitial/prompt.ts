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

function widgetShapeForMode(mode: PostTurnSharedInitialMode): string | null {
  if (mode === "relationship_only") return null;
  if (mode === "dual") {
    return `"statusWidget": { "character_values": { ... }, "user_values": { ... }, "extracted_facts": [] }`;
  }
  if (mode === "character") {
    return `"statusWidget": { "character_values": { ... }, "extracted_facts": [] }`;
  }
  return `"statusWidget": { "user_values": { ... }, "extracted_facts": [] }`;
}

function buildSharedOutputEnvelope(input: PostTurnSharedInitialInput): string {
  const shapes: string[] = [];
  const widget = widgetShapeForMode(input.mode);
  if (widget) shapes.push(widget);
  if (input.includeSuggestions) {
    shapes.push(`"suggestedReplies": {
    "items": [
      { "kind": "escalate", "text": "..." },
      { "kind": "soften", "text": "..." },
      { "kind": "pivot", "text": "..." }
    ]
  }`);
  }
  if (input.includeRelationship) {
    shapes.push(`"relationship": {
    "items": [],
    "itemsRemove": [],
    "promisesAdd": [],
    "promisesRemove": []
  }`);
  }
  const countWords = ["zero", "one", "two", "three"] as const;
  const keyCount = countWords[shapes.length] ?? String(shapes.length);

  const rules: string[] = [];
  if (input.includeSuggestions) rules.push(SHARED_SUGGESTIONS_OUTPUT_RULES);
  if (input.includeRelationship) {
    rules.push(
      input.relationshipRegenContext
        ? SHARED_RELATIONSHIP_REGEN_RULES
        : SHARED_RELATIONSHIP_OUTPUT_RULES
    );
  }
  return `Return exactly one JSON object with ${keyCount} top-level key(s):
{
  ${shapes.join(",\n  ")}
}
Do not include markdown fences or prose outside JSON.
${rules.join("\n")}`;
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

/** @internal tests — widget-only flat top-level contract must not appear in shared system. */
export function sharedSystemHasConflictingWidgetOnlyContract(system: string): boolean {
  return /"character_values"\s*:\s*\{[^}]+\}\s*,\s*\n\s*"user_values"\s*:/.test(system);
}
