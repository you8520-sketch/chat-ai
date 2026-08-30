import { callBackgroundMemory } from "@/lib/ai";
import { buildPlatformAsyncTurnLedgerContext } from "@/lib/providerCostLedger";
import { parseSuggestedRepliesFromModelText } from "./parse";
import {
  SUGGESTED_REPLIES_REQUEST_KIND,
  type SuggestedReplyItem,
} from "./types";

const EXTRACT_SYSTEM = `You write the USER's next roleplay turn as JSON only. No prose, no markdown fences.

Return exactly:
{
  "items": [
    { "kind": "escalate", "text": "..." },
    { "kind": "soften", "text": "..." },
    { "kind": "pivot", "text": "..." }
  ]
}

Rules:
- Exactly 3 objects in "items", one for each kind. Do not repeat a kind.
- Korean only in "text".
- Each "text" MUST be 50–200 characters including spaces and punctuation.
- Mix spoken dialogue AND stage direction in every text. Stage direction uses *...* or (...). Dialogue is the user's spoken lines without a name prefix.
- Write as the USER persona. Match their personality, gender, and speech style (반말 vs 존댓말, quirks, rhythm). If speech examples are given, imitate them.
- Kinds — three DIFFERENT scene directions, not three flavors of the same fight:
  - escalate: confront, refuse, or raise tension.
  - soften: soothe, concede a step, or close distance so the relationship can continue.
  - pivot: change topic, place, or action so the scene can go somewhere else.
- Do not write as the character/NPC. Do not continue the assistant's last line in the NPC's voice.
- If there is no prior user message, the assistant text is the opening greeting. Write the USER's first roleplay turn into that scene.
- No OOC, no meta commentary, no numbering, no titles inside "text".
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
    opts.userMessage.trim()
      ? `[USER MESSAGE]\n${opts.userMessage}`
      : "[OPENING GREETING — no user turn yet. Write the user's first roleplay move into this scene.]",
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
  chatId?: number;
  messageId?: number;
  jobAttemptOrdinal?: number;
}): Promise<SuggestedReplyItem[]> {
  const userBlock = buildExtractUserBlock(opts);
  const ledgerContext =
    opts.chatId != null && opts.messageId != null && opts.jobAttemptOrdinal != null
      ? buildPlatformAsyncTurnLedgerContext({
          chatId: opts.chatId,
          assistantMessageId: opts.messageId,
          family: "suggested_replies_repair",
          jobAttemptOrdinal: opts.jobAttemptOrdinal,
          requestKind: SUGGESTED_REPLIES_REQUEST_KIND,
        })
      : undefined;
  try {
    const { text } = await callBackgroundMemory(
      EXTRACT_SYSTEM,
      [{ role: "user", content: userBlock }],
      undefined,
      SUGGESTED_REPLIES_REQUEST_KIND,
      { temperature: 0.65, ledgerContext }
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
