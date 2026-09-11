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

function buildSharedOutputEnvelope(
  mode: PostTurnSharedInitialMode,
  includeRelationship: boolean
): string {
  const widgetShape =
    mode === "dual"
      ? `"statusWidget": { "character_values": { ... }, "user_values": { ... }, "extracted_facts": [] }`
      : mode === "character"
        ? `"statusWidget": { "character_values": { ... }, "extracted_facts": [] }`
        : `"statusWidget": { "user_values": { ... }, "extracted_facts": [] }`;
  const relationshipShape = includeRelationship
    ? `,
  "relationship": {
    "items": [],
    "itemsRemove": [],
    "promisesAdd": [],
    "promisesRemove": []
  }`
    : "";
  const keyCount = includeRelationship ? "three" : "two";
  return `Return exactly one JSON object with ${keyCount} top-level keys:
{
  ${widgetShape},
  "suggestedReplies": {
    "items": [
      { "kind": "escalate", "text": "..." },
      { "kind": "soften", "text": "..." },
      { "kind": "pivot", "text": "..." }
    ]
  }${relationshipShape}
}
Do not include markdown fences or prose outside JSON.
${SHARED_SUGGESTIONS_OUTPUT_RULES}${includeRelationship ? `\n${SHARED_RELATIONSHIP_OUTPUT_RULES}` : ""}`;
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

  return `${widgetSemantic}

SHARED POST-TURN ENRICHMENT — produce status widget values${input.includeRelationship ? ", durable relationship memory," : ""} and suggested user reply options in one response.
${buildSharedOutputEnvelope(input.mode, input.includeRelationship === true)}`;
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
  const voiceContext = buildSharedSuggestionVoiceContext(input);
  return [widgetBlock, voiceContext].filter(Boolean).join("\n\n");
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
