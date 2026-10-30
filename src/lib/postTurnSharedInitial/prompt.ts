import { buildSharedInitialEpisodicSectionInstructions } from "@/lib/memory/memory-episodic-prompt";
import { formatEpisodicCorrectionCandidatesBlock } from "@/lib/memory/memory-episodic-correction";
import {
  buildCombinedDualWidgetExtractSystem,
  buildCombinedDualWidgetExtractUserBlock,
  buildWidgetExtractSystem,
  buildWidgetExtractUserBlock,
} from "@/lib/statusWidget/extractNormalize";
import { collectWidgetJsonKeys } from "@/lib/statusWidget/prompt";
import type { PostTurnSharedInitialInput, PostTurnSharedInitialMode } from "./types";
import { buildSuggestedReplyCoreGenerationRules } from "@/lib/suggestedReplies/promptStyle";

const SHARED_SUGGESTIONS_OUTPUT_RULES = `SUGGESTED REPLIES section — write the USER's next roleplay turn options.
Return in suggestedReplies.items exactly 3 objects: natural, twist, banter (one each).
Korean only in text.
Write as the USER persona named in [USER] — match voice from [SUGGESTED REPLIES VOICE CONTEXT] when provided.
${buildSuggestedReplyCoreGenerationRules()}
Use [SUGGESTED REPLIES VOICE CONTEXT] only for suggestedReplies voice/style — never as evidence for statusWidget field values.`;

const SHARED_PROMISES_REMOVE_RULE = `- promisesRemove: copy EXACTLY the [ACTIVE PROMISES] string(s) this turn's prose explicitly cancels, withdraws, fulfils, or expires. Unclear or several possible targets → []. Never remove another promise; a cancellation is never a promisesAdd.`;

const SHARED_RELATIONSHIP_FACT_RULES = `- items: one line per person whose possessions changed ("name: item1, item2"). A give, take, or handoff is "from→to: item"; do not omit it. Wearing shows who has that object on their body at that moment and does not erase another person's same-named object unless this prose says that object was given, taken, or lost. Skip ordinary clothes, uniforms, and furniture.
- itemsRemove: current possession lines that are no longer true (copy the previous line EXACTLY).
- promisesAdd: an explicit promise that stays binding after this turn, as [{ "text": "...", "deadline": "..." }]. deadline is the stated scope, or "" if none. A promise made only for the current treatment uses that treatment as deadline. Do not add a conditional offer the other party does not accept, and do not record agreement, fulfillment, cancellation, or a completed release unless this turn's prose shows it.
${SHARED_PROMISES_REMOVE_RULE}
Never extract honorifics, nicknames, inner thoughts, emotion, relationship stage, speech style, gender, or current location.`;

const SHARED_RELATIONSHIP_OUTPUT_RULES = `RELATIONSHIP section — possessions and promises from this turn's prose.
Return these arrays; empty arrays are correct when this turn has no possession change and no explicit promise.
${SHARED_RELATIONSHIP_FACT_RULES}`;

const SHARED_RELATIONSHIP_REGEN_RULES = `RELATIONSHIP section — the assistant reply for this turn was REGENERATED.
Compare the rejected assistant draft and the new canonical assistant in the user block.
items, promisesAdd, and promisesRemove record only what the NEW canonical reply introduces. itemsRemove also drops transfers that existed only in the rejected draft.
${SHARED_RELATIONSHIP_FACT_RULES}`;

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
  if (input.includeRelationship) {
    rules.push(
      input.relationshipRegenContext
        ? SHARED_RELATIONSHIP_REGEN_RULES
        : SHARED_RELATIONSHIP_OUTPUT_RULES
    );
  }
  if (input.includeSuggestions) rules.push(SHARED_SUGGESTIONS_OUTPUT_RULES);
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

function buildActivePromisesBlock(input: PostTurnSharedInitialInput): string {
  if (!input.includeRelationship) return "";
  const promises = (input.activePromises ?? []).map((text) => text.trim()).filter(Boolean);
  const header = "[ACTIVE PROMISES — promisesRemove may only copy these]";
  return promises.length
    ? `${header}\n${promises.map((text) => `- ${text}`).join("\n")}`
    : `${header}\n(none → promisesRemove [])`;
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
  const activePromisesBlock = buildActivePromisesBlock(input);
  const correctionCandidatesBlock = input.includeEpisodic
    ? formatEpisodicCorrectionCandidatesBlock(input.episodicCorrectionCandidates)
    : "";

  if (widgetBlock) {
    const rejectedDraftBlock =
      input.relationshipRegenContext?.previousAssistantMessage?.trim()
        ? `[REJECTED ASSISTANT DRAFT — RELATIONSHIP COMPARISON ONLY; NOT EPISODIC EVIDENCE]\n${input.relationshipRegenContext.previousAssistantMessage}`
        : "";
    return [widgetBlock, rejectedDraftBlock, activePromisesBlock, correctionCandidatesBlock, voiceContext]
      .filter(Boolean)
      .join("\n\n");
  }
  // No widget consumer (status OFF). Always include the current turn so
  // suggestions-only work does not depend on the relationship section.
  return [currentTurnBlock, activePromisesBlock, correctionCandidatesBlock, voiceContext]
    .filter(Boolean)
    .join("\n\n");
}

/** @internal tests — standalone combined flat-top contract must not appear in shared system. */
export function sharedSystemHasConflictingWidgetOnlyContract(system: string): boolean {
  return /Return exactly one JSON object with this shape:\s*\{[\s\S]*?"character_values"/.test(
    system
  );
}
