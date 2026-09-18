import { buildSharedInitialEpisodicSectionInstructions } from "@/lib/memory/memory-episodic-prompt";
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

function buildSharedOutputEnvelope(input: PostTurnSharedInitialInput): string {
  const rules: string[] = [];
  if (input.includeSuggestions) rules.push(SHARED_SUGGESTIONS_OUTPUT_RULES);
  if (input.includeRelationship) {
    rules.push(
      input.relationshipRegenContext
        ? SHARED_RELATIONSHIP_REGEN_RULES
        : SHARED_RELATIONSHIP_OUTPUT_RULES
    );
  }
  if (input.includeEpisodic) {
    rules.push(
      buildSharedInitialEpisodicSectionInstructions(Boolean(input.relationshipRegenContext)),
      "Episodic current-turn evidence: current USER message + current canonical ASSISTANT prose only.",
      "Character identity / critical context = canon reference, NOT new episodic evidence.",
      "[PREVIOUS TURN ASSISTANT] blocks = status continuity only, NOT episodic evidence."
    );
  }

  const semanticWidgetLines: string[] = [];
  if (input.mode !== "relationship_only") {
    semanticWidgetLines.push(
      "Populate every required statusWidget field with one scene-grounded string derived from this turn.",
      "Never copy placeholder tokens from examples (\"...\", \"…\", \"<scene value>\")."
    );
  }

  const parts = [
    "Required sections and dynamic widget keys are enforced by the provider JSON schema on the wire.",
    "This prompt supplies semantic meaning only.",
    ...semanticWidgetLines,
    "",
    "Do not include markdown fences or prose outside JSON.",
    ...rules,
  ];
  return parts.join("\n");
}

/** @internal tests — widget semantic envelope fragment (structural keys live in schema.ts). */
export function buildSharedStatusWidgetEnvelope(input: PostTurnSharedInitialInput): string | null {
  if (input.mode === "relationship_only") return null;
  return "statusWidget: populate every required field with one scene-grounded string derived from this turn.";
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
      ? buildCombinedDualWidgetExtractSystem(
          input.characterWidget,
          input.userWidget,
          false,
          "shared_initial"
        )
      : input.mode === "character" && input.characterWidget
        ? buildWidgetExtractSystem(
            input.characterWidget,
            collectWidgetJsonKeys(input.characterWidget),
            "character",
            false,
            "shared_initial"
          )
        : input.mode === "user" && input.userWidget
          ? buildWidgetExtractSystem(
              input.userWidget,
              collectWidgetJsonKeys(input.userWidget),
              "user",
              false,
              "shared_initial"
            )
          : "";

  const activeSummary = [
    widgetSemantic ? "status widget values" : "",
    input.includeSuggestions ? "suggested user reply options" : "",
    input.includeRelationship ? "durable relationship memory" : "",
    input.includeEpisodic ? "durable episodic memory facts" : "",
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
      promptOwner: "shared_initial",
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
      promptOwner: "shared_initial",
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
      promptOwner: "shared_initial",
    });
  }

  const currentTurnBlock = input.relationshipRegenContext
    ? `[THIS TURN — USER]\n${input.userMessage}\n\n[REJECTED ASSISTANT DRAFT — RELATIONSHIP COMPARISON ONLY; NOT EPISODIC EVIDENCE]\n${input.relationshipRegenContext.previousAssistantMessage}\n\n[NEW CANONICAL ASSISTANT — CURRENT TURN]\n${input.assistantProse}`
    : `[THIS TURN — USER]\n${input.userMessage}\n\n[THIS TURN — ASSISTANT]\n${input.assistantProse}`;

  const voiceContext = input.includeSuggestions
    ? buildSharedSuggestionVoiceContext(input)
    : "";

  if (widgetBlock) {
    const rejectedDraftBlock =
      input.relationshipRegenContext?.previousAssistantMessage?.trim()
        ? `[REJECTED ASSISTANT DRAFT — RELATIONSHIP COMPARISON ONLY; NOT EPISODIC EVIDENCE]\n${input.relationshipRegenContext.previousAssistantMessage}`
        : "";
    return [widgetBlock, rejectedDraftBlock, voiceContext].filter(Boolean).join("\n\n");
  }
  // No widget consumer (status OFF). Always include the current turn so
  // suggestions-only work does not depend on the relationship section.
  return [currentTurnBlock, voiceContext].filter(Boolean).join("\n\n");
}

/** @internal tests — standalone combined flat-top contract must not appear in shared system. */
export function sharedSystemHasConflictingWidgetOnlyContract(system: string): boolean {
  return /Return exactly one JSON object with this shape:\s*\{[\s\S]*?"character_values"/.test(
    system
  );
}
