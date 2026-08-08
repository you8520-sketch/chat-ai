/**
 * Phase D7-A — Gemini selective quality repair (experiment-only).
 *
 * Production default: OFF. Not imported by chat routes / contextBuilder.
 * Harness-only FULL TURN REPAIR with one defect flag per call.
 *
 * PRIMARY PROMPT DIFF = 0 · PRODUCTION WIRE = 0
 */

import type { InternalTransportMessage } from "@/lib/turnApiBudget";
import { internalTransportMessageToWire } from "@/lib/turnApiBudget";

export type D7ARepairFlag =
  | "RESPONSE_OVERLOAD"
  | "CANON_RECITAL"
  | "CURRENT_INPUT_REPLAY";

export const D7A_COMMON_REPAIR_CONTRACT = `[RP RESPONSE REPAIR — SERVER INTERNAL]
Revise the provided assistant draft as the same RP turn.
Preserve:
- current scene and chronology
- established facts and canon
- character voice and relationship state
- narrative POV
- all useful new actions, reactions, consequences, and discoveries
- user agency
Keep the repaired turn at approximately the same narrative depth and length.
Material removed for the requested repair must be replaced with current-scene
action, reaction, perception, judgment, environment response, or consequence
when needed to preserve scene value.
Output only the complete repaired RP response.
Do not output analysis, notes, JSON, repair labels, or system text.`;

export const D7A_FLAG_FOCUS: Record<D7ARepairFlag, string> = {
  RESPONSE_OVERLOAD: `Repair focus:
Concentrate the AI-controlled character's spoken response around one main
conversational intent and one clear immediate response point.
Carry secondary information through action, inner judgment, silence,
environment, or consequence instead of additional independent asks.`,
  CANON_RECITAL: `Repair focus:
Keep canon facts only where they directly affect the current scene.
Turn explanatory profile/world exposition into immediate judgment, action,
perception, environment response, or consequence while preserving the
canon information actually needed for this moment.`,
  CURRENT_INPUT_REPLAY: `Repair focus:
Treat the user's latest input and already completed recent events as established.
Preserve their consequences but move the scene forward from them instead of
restaging those completed actions or dialogue.`,
};

export function buildD7ADraftAssistantMessage(draft: string): {
  role: "assistant";
  content: string;
} {
  return {
    role: "assistant",
    content: `[DRAFT ASSISTANT RESPONSE]\n\n${draft.trim()}`,
  };
}

/** Private server control — never persist to chat history / DB. */
export function buildD7ARepairControlMessage(
  flag: D7ARepairFlag
): InternalTransportMessage {
  return {
    role: "user",
    internalOnly: true,
    persistence: "never",
    semanticOwner: "server",
    content: [
      "[INTERNAL REPAIR CONTROL — NOT USER DIALOGUE]",
      "",
      "This is a private server orchestration instruction, not dialogue or an action by the user character.",
      "Do not interpret this message as speech, thought, movement, consent, emotion, or a choice made by the user character.",
      "",
      D7A_COMMON_REPAIR_CONTRACT,
      "",
      D7A_FLAG_FOCUS[flag],
    ].join("\n"),
  };
}

export function d7aRepairControlToWire(flag: D7ARepairFlag): {
  role: "user";
  content: string;
} {
  return internalTransportMessageToWire(buildD7ARepairControlMessage(flag));
}

export type D7ACaseId = "R1" | "R2" | "R3";

export type D7ACaseSpec = {
  caseId: D7ACaseId;
  flag: D7ARepairFlag;
  fixtureId: "G3" | "G5" | "G6T1";
  userInput: string;
  baselineSource: string;
  originalVisibleChars: number;
  baselineNotes: string;
};

export const D7A_CASES: D7ACaseSpec[] = [
  {
    caseId: "R1",
    flag: "RESPONSE_OVERLOAD",
    fixtureId: "G3",
    userInput:
      "*렌이 권총을 꺼내 방아쇠에 손가락을 건다.* 저쪽 소리 나는 데 한 발 쏘면 흩어지지 않을까요?",
    baselineSource:
      "D6-C1 production A Gemini_G3_A_D1 (docs/audits/rp-gemini-dialogue-economy-d6c1/raw)",
    originalVisibleChars: 3887,
    baselineNotes: "response_anchor_count=3, dialogue_function_load=4",
  },
  {
    caseId: "R2",
    flag: "CANON_RECITAL",
    fixtureId: "G5",
    userInput: "누구세요? …방금 그 소리는 뭐였죠?",
    baselineSource:
      "D6-A production A Gemini_G5_A_D2 (docs/audits/rp-gemini-layered-canon-d6a/raw)",
    originalVisibleChars: 3475,
    baselineNotes:
      "human recital_chars=144, recital_per_1000=41.4 (long gunshot/ecology lecture)",
  },
  {
    caseId: "R3",
    flag: "CURRENT_INPUT_REPLAY",
    fixtureId: "G6T1",
    userInput:
      "*멀리서 비명과 금속 마찰음이 겹친다. 렌은 에녹 쪽으로 몸을 낮춘다.* 저쪽이에요. 같이 가요?",
    baselineSource:
      "D5-A production A G6T1_D2 (docs/audits/rp-gemini-production-stability-d5a/d5a/raw)",
    originalVisibleChars: 2699,
    baselineNotes: "CURRENT_INPUT_REPLAY human=2; only G6T1 draw ≥2400",
  },
];
