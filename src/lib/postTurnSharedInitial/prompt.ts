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
Write as the USER persona named in [USER] — match their voice from the scene (no separate persona secret block is provided in this shared call).
Do not write as the character/NPC.`;

function buildSharedOutputEnvelope(mode: PostTurnSharedInitialMode): string {
  const widgetShape =
    mode === "dual"
      ? `"statusWidget": { "character_values": { ... }, "user_values": { ... }, "extracted_facts": [] }`
      : mode === "character"
        ? `"statusWidget": { "character_values": { ... }, "extracted_facts": [] }`
        : `"statusWidget": { "user_values": { ... }, "extracted_facts": [] }`;
  return `Return exactly one JSON object with two top-level keys:
{
  ${widgetShape},
  "suggestedReplies": {
    "items": [
      { "kind": "escalate", "text": "..." },
      { "kind": "soften", "text": "..." },
      { "kind": "pivot", "text": "..." }
    ]
  }
}
Do not include markdown fences or prose outside JSON.
${SHARED_SUGGESTIONS_OUTPUT_RULES}`;
}

export function buildPostTurnSharedInitialSystem(input: PostTurnSharedInitialInput): string {
  const widgetSystem =
    input.mode === "dual" && input.characterWidget && input.userWidget
      ? buildCombinedDualWidgetExtractSystem(input.characterWidget, input.userWidget)
      : input.mode === "character" && input.characterWidget
        ? buildWidgetExtractSystem(
            input.characterWidget,
            collectWidgetJsonKeys(input.characterWidget),
            "character"
          )
        : input.mode === "user" && input.userWidget
          ? buildWidgetExtractSystem(
              input.userWidget,
              collectWidgetJsonKeys(input.userWidget),
              "user"
            )
          : "";

  return `${widgetSystem}

SHARED POST-TURN ENRICHMENT — also produce suggested user reply options in the same JSON response.
${buildSharedOutputEnvelope(input.mode)}`;
}

export function buildPostTurnSharedInitialUserBlock(input: PostTurnSharedInitialInput): string {
  if (input.mode === "dual" && input.characterWidget && input.userWidget) {
    return buildCombinedDualWidgetExtractUserBlock({
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
  }
  if (input.mode === "character" && input.characterWidget) {
    return buildWidgetExtractUserBlock({
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
  }
  if (input.mode === "user" && input.userWidget) {
    return buildWidgetExtractUserBlock({
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
  return "";
}
