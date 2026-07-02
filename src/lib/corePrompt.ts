import type { BilingualDialoguePolicy } from "@/lib/bilingualDialoguePolicy";
import type { CharacterGender } from "@/lib/characterGender";
import type { ResolvedStatusWindow } from "@/lib/statusWindow";
import { buildLengthInstruction } from "@/lib/responseLength";

export type LengthRuleContext = {
  targetInput?: number | null;
};

function normalizeLengthRuleContext(
  ctx?: LengthRuleContext | number | null
): { targetInput?: number | null } {
  if (typeof ctx === "number" || ctx == null) {
    return { targetInput: ctx ?? undefined };
  }
  return {
    targetInput: ctx.targetInput,
  };
}

export type CoreMasterPromptInput = {
  charName: string;
  userName: string;
  charGender: CharacterGender;
  userGender: CharacterGender;
  nsfwEnabled: boolean;
  impersonationOn: boolean;
  /** 소설 모드 UI 토글 — 전면 co-narration */
  novelModeEnabled?: boolean;
  completedTurns: number;
  hasMindReading: boolean;
  allowsBeard: boolean;
  allowsBodyHair: boolean;
  party?: boolean;
  /** dialogue-format-directive tail 사용 시 core §8 축약 */
  tailFormatActive?: boolean;
  /** status-window 또는 ban 블록이 tail에 있으면 §6 예외 문구 제거 */
  statusWindowTailActive?: boolean;
  /** 일반 자동진행 턴 — length guard가 확장 BOUNDARY와 일치 */
  autoContinueTurn?: boolean;
};

function roleBoundaryLine(i: CoreMasterPromptInput): string {
  if (i.novelModeEnabled) {
    return `ROLE — 소설 모드 ON. [NO GODMODDING — NOVEL MODE] · [NOVEL MODE — USER PERSONA NARRATION RULES] 적용.`;
  }
  return `ROLE — AI는 [A]와 AI가 담당하는 NPC·환경을 연기한다. 필요 시 여러 AI 캐릭터와 NPC를 동시에 연기할 수 있다.\n[B]는 [NO GODMODDING]를 따른다.`;
}

/** Layer 1 — compact core master rules */
export function buildCoreMasterPrompt(i: CoreMasterPromptInput): string {
  const parts: string[] = [
    `[CORE RP] [A]=AI · [B]=user.`,
    roleBoundaryLine(i),
    `INTEGRITY — 캐릭터·관계·세계관을 유지한다.`,
    `CONTINUITY — 같은 장면을 이어간다.`,
  ];

  if (i.party) {
    parts.push(`[PARTY] Multi-user room. Prefix "nickname:" identifies speaker.`);
  }

  return parts.join("\n\n");
}

export function buildCoreMasterEarlyTurnHint(_completedTurns: number): string | null {
  return null;
}

/** OpenRouter cache — exclude per-turn early hint from static block */
export function buildCoreMasterPromptForCache(i: CoreMasterPromptInput): string {
  return buildCoreMasterPrompt({ ...i, completedTurns: 99 });
}

export function buildCompactStatusWindowBlock(_resolved: ResolvedStatusWindow): string | null {
  return null;
}

export function buildCompactLengthRule(ctx?: LengthRuleContext | number | null): string {
  const { targetInput } = normalizeLengthRuleContext(ctx);
  return buildLengthInstruction(targetInput);
}

/** @deprecated style/length 분리 — style은 writingStylePreset, length는 buildLengthTargetPrompt */
export function buildOpenRouterLengthStructureRule(ctx?: LengthRuleContext | number | null): string {
  void ctx;
  return "";
}

/** @deprecated OUTPUT LANG(openRouterProsePolicy)가 문체·언어 단일 출처 — 빈 문자열 */
export function buildOpenRouterOutputFormatBlock(_bilingual?: BilingualDialoguePolicy): string {
  return "";
}

/** @deprecated buildOpenRouterOutputFormatBlock() */
export const OPENROUTER_OUTPUT_FORMAT_BLOCK = "";

/** @deprecated OUTPUT LANG가 문체·언어 단일 출처 */
export function buildOpenRouterOpusCompactTail(_bilingual?: BilingualDialoguePolicy): string {
  return "";
}

/** @deprecated buildOpenRouterOpusCompactTail */
export function buildClaudeOpusNarrativeForcingTail(): string {
  return buildOpenRouterOpusCompactTail();
}

export const IDENTITY_PREAMBLE =
  "The following defines the USER's roleplay persona (the human player character — NOT the AI character you play). Obey [USER_PERSONA] for how the user character speaks and behaves when referenced.";

function buildIdentityPreamble(impersonationOn: boolean, _userName: string, novelMode = false): string {
  if (novelMode) {
    return `The following defines the USER's roleplay persona for novel mode co-narration. [USER_PERSONA] describes [B] — mirror per [NO GODMODDING — NOVEL MODE] and [NOVEL MODE — USER PERSONA NARRATION RULES].`;
  }
  if (impersonationOn) return IDENTITY_PREAMBLE;
  return `The following defines the USER's roleplay persona (NOT the AI character). [USER_PERSONA] describes [B] — involuntary physiological cues OK; voluntary dialogue/action/emotion forbidden per [NO GODMODDING].`;
}

export function buildIdentityAndRulesBlock(
  persona: string | null | undefined,
  mandatoryRules: string | null | undefined,
  opts?: { impersonationOn?: boolean; novelModeEnabled?: boolean; userName?: string }
): string | null {
  const personaText = persona?.trim() ?? "";
  const rulesText = mandatoryRules?.trim() ?? "";
  if (!personaText && !rulesText) return null;

  const parts: string[] = [
    buildIdentityPreamble(
      !!opts?.impersonationOn,
      opts?.userName ?? "",
      !!opts?.novelModeEnabled
    ),
  ];
  if (personaText) parts.push(`[USER_PERSONA]\n${personaText}`);
  if (rulesText) parts.push(`[MANDATORY_RULES]\n${rulesText}`);
  return `[IDENTITY_AND_RULES]\n\n${parts.join("\n\n")}`;
}

/** @deprecated NO INPUT ECHO·[SPEECH PROFILE]로 충분 — 주입 제거 */
export function buildUserPersonaSpeechGuard(
  _charName: string,
  _userName: string,
  _impersonationOn: boolean,
  _novelMode = false
): string {
  return "";
}
