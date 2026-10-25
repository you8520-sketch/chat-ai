/**
 * Turn Ownership Track T1 — experiment-only candidate.
 * Production chat must not import or enable this owner.
 */

export const DEEPSEEK_HANDOFF_TURN_OWNERSHIP_HEADER =
  "[DEEPSEEK HANDOFF — TURN OWNERSHIP]";

export const DEEPSEEK_HANDOFF_TURN_OWNERSHIP = `${DEEPSEEK_HANDOFF_TURN_OWNERSHIP_HEADER}
현재 user 입력에 이미 명시된 행동·의사·요청은 확정된 것으로 받아들이고 불필요하게 다시 확인하지 않는다. 그 입력에 직접 이어지는 캐릭터의 행동과 자연스러운 결과·반응은 진행한다.
그러나 현재 user 입력에 없는 새로운 의미 있는 user 대사·의도·결정·동의·거절·관계 결정을 대신 만들지 않는다. user의 침묵·시선·표정·반사적인 신체 반응이나 assistant가 새로 서술한 user 반응을 새로운 선택의 근거로 확정하지 않는다.
현재 user가 시작한 상호작용의 직접적인 결과까지는 진행하되, 입력에서 정해지지 않은 새로운 상호작용 단계로 임의로 넘어가지 않는다.`;

export const DEEPSEEK_TURN_OWNERSHIP_T1_PRODUCTION = {
  applyTurnOwnership: false,
} as const;

export const DEEPSEEK_TURN_OWNERSHIP_T1_CHALLENGER = {
  applyTurnOwnership: true,
} as const;

export function countPromptOccurrences(haystack: string, needle: string): number {
  if (!needle) return 0;
  return haystack.split(needle).length - 1;
}

export function stripDeepSeekTurnOwnershipBlock(text: string): string {
  return text
    .split(DEEPSEEK_HANDOFF_TURN_OWNERSHIP)
    .join("")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/** Experiment helper only. Production must keep applyTurnOwnership=false. */
export function appendDeepSeekTurnOwnershipBlock(
  userTurnContent: string,
  applyTurnOwnership: boolean
): string {
  if (!applyTurnOwnership) return userTurnContent;
  const body = stripDeepSeekTurnOwnershipBlock(userTurnContent);
  if (!body) return DEEPSEEK_HANDOFF_TURN_OWNERSHIP;
  if (body.includes(DEEPSEEK_HANDOFF_TURN_OWNERSHIP_HEADER)) {
    return body;
  }
  return `${body}\n\n${DEEPSEEK_HANDOFF_TURN_OWNERSHIP}`;
}
