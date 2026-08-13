import { callBackgroundMemory } from "@/lib/ai";
import { parseSuggestedRepliesFromModelText } from "./parse";
import { SUGGESTED_REPLIES_REQUEST_KIND } from "./types";

const EXTRACT_SYSTEM = `You write the USER's next roleplay turn as JSON only. No prose, no markdown fences, no labels.

Return exactly:
{ "replies": ["...", "...", "..."] }

Rules:
- Exactly 3 strings in "replies".
- Korean only.
- Each reply MUST be 50–200 characters including spaces and punctuation.
- Mix spoken dialogue AND stage direction in every reply. Stage direction uses *...* or (...). Dialogue is the user's spoken lines without a name prefix.
- Write as the USER persona. Match their personality, gender, and speech style (반말 vs 존댓말, quirks, rhythm). If speech examples are given, imitate them.
- The three replies must be DISTINCT directions that escalate conflict, raise stakes, or push the scene forward. Do not resolve the fight; heighten it.
- Do not write as the character/NPC. Do not continue the assistant's last line in the NPC's voice.
- No OOC, no meta commentary, no numbering, no titles like "방향 1".
- Do not invent lore that contradicts the provided scene.`;

function buildExtractUserBlock(opts: {
  charName: string;
  personaName: string;
  personaDescription?: string | null;
  personaSpeechExamples?: string | null;
  userPersona?: string | null;
  userMessage: string;
  assistantProse: string;
}): string {
  return [
    `[CHARACTER] ${opts.charName}`,
    `[USER] ${opts.personaName}`,
    opts.userPersona?.trim() ? `[USER IDENTITY]\n${opts.userPersona.trim()}` : "",
    opts.personaDescription?.trim()
      ? `[USER PERSONA PERSONALITY / SPEECH]\n${opts.personaDescription.trim()}`
      : "",
    opts.personaSpeechExamples?.trim()
      ? `[USER SPEECH EXAMPLES — imitate this voice]\n${opts.personaSpeechExamples.trim()}`
      : "",
    `[USER MESSAGE]\n${opts.userMessage}`,
    `[ASSISTANT REPLY — read this turn's prose, then write the user's next move]\n${opts.assistantProse.slice(0, 6000)}`,
  ]
    .filter(Boolean)
    .join("\n\n");
}

export async function extractSuggestedRepliesFromTurn(opts: {
  charName: string;
  personaName: string;
  personaDescription?: string | null;
  personaSpeechExamples?: string | null;
  userPersona?: string | null;
  userMessage: string;
  assistantProse: string;
}): Promise<string[]> {
  const userBlock = buildExtractUserBlock(opts);
  try {
    const { text } = await callBackgroundMemory(
      EXTRACT_SYSTEM,
      [{ role: "user", content: userBlock }],
      undefined,
      SUGGESTED_REPLIES_REQUEST_KIND,
      { temperature: 0.65 }
    );
    return parseSuggestedRepliesFromModelText(text);
  } catch (e) {
    console.error("[SUGGESTED-REPLIES-ERROR] extract call failed", (e as Error).message);
    return [];
  }
}

/** @internal tests */
export function buildSuggestedRepliesExtractUserBlockForTest(
  opts: Parameters<typeof buildExtractUserBlock>[0]
): string {
  return buildExtractUserBlock(opts);
}

export function suggestedRepliesExtractSystemForTest(): string {
  return EXTRACT_SYSTEM;
}
