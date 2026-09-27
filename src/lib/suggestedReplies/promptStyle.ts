import {
  SUGGESTED_REPLY_MAX_CHARS,
  SUGGESTED_REPLY_MIN_CHARS,
} from "./types";

/** Single owner — suggested-reply length policy referenced by all generation prompts. */
export function suggestedReplyLengthPromptClause(): string {
  return `Each text targets ${SUGGESTED_REPLY_MIN_CHARS}–${SUGGESTED_REPLY_MAX_CHARS} characters including spaces and punctuation. Aim for one cohesive user RP turn, not filler padding.`;
}

/**
 * Matches user chat RP input: short *stage* / (aside) beat plus quoted dialogue.
 * Same convention as standalone extract and shared post-turn enrichment.
 */
export function suggestedReplyUserTurnFormatPromptClause(): string {
  return `Each text MUST read like one user RP message the player can send as-is:
- Combine one concise action or narration beat with at least one spoken line in double quotes in the same text.
- Write the action or narration as plain Korean prose, then write the user's spoken line without a name prefix.
- Keep every beat relevant to the current scene and relationship.`;
}

export function suggestedReplyKindDifferentiationPromptClause(): string {
  return `Kinds must differ in intent/action, not just tone:
- natural: the most natural next user turn for this scene, relationship, and persona voice.
- twist: plausible but non-obvious — witty angle, unexpected question, action shift, counter-offer, or negotiation.
- banter: playful, teasing, dry, or sarcastic while staying in persona voice and the current scene.`;
}

/** Shared + standalone suggested-reply generation rules (voice/context lines added separately). */
export function buildSuggestedReplyCoreGenerationRules(): string {
  return [
    suggestedReplyLengthPromptClause(),
    suggestedReplyUserTurnFormatPromptClause(),
    suggestedReplyKindDifferentiationPromptClause(),
    "Write as the USER persona. Do not write as the character/NPC.",
    "Do not continue the assistant's last line in the NPC's voice.",
    "No OOC, no meta commentary, no numbering, no category titles inside text.",
    "Do not invent lore that contradicts the provided scene.",
    "Do not recommend irreversible decisions or actions the user persona has not taken.",
  ].join("\n");
}
