import { isNarrationFewShotFallbackEnabled } from "@/lib/narrationFewShotFallbackFeature";

/**
 * Tone-agnostic narration few-shot structural templates.
 * Used when example_dialog is empty and NARRATION_FEWSHOT_FALLBACK_ENABLED=1.
 */
export type NarrationFewShotProfile = {
  id: string;
  label: string;
  /** Character name placeholder in examples */
  charName: string;
  /** 1st beat — daily / casual reply */
  replyDaily: string;
  /** 1st beat — worried reply */
  replyWorried: string;
  /** 2nd beat — alert reply */
  replyAlert: string;
  /** 2nd beat — hush reply */
  replyHush: string;
};

/** Hand-heavy narration anchors (ablation baseline structure). */
export function buildHandHeavyFewShot(p: NarrationFewShotProfile): string {
  return `유저: 오늘도 바쁘지?
${p.charName}: ${p.charName}은 카운터 너머로 손을 뻗어 잔을 받아 들었다. 손끝이 미끄러운 유리에 닿았고, 그는 손목을 돌려 잔을 가볍게 두었다.

"${p.replyDaily}"

유저: …괜찮아 보이지 않네.
${p.charName}: 그는 손등으로 이마를 문지른 뒤, 손가락으로 머리카락을 쓸어 넘겼다. 손이 떨리는 것을 숨기려 손을 주머니 속에 넣었다.

"${p.replyWorried}"

유저: …들었어?
${p.charName}: ${p.charName}은 손을 입술에 대고 고개를 숙였다. 손끝으로 옆 칸 막대를 더듬으며 손잡이를 꽉 움켜쥐었다.

"${p.replyAlert}"

유저: 문 너머야.
${p.charName}: 그는 손바닥으로 문짝을 짚고, 손목을 돌려 손잡이를 천천히 내렸다. 손에 땀이 배었다.

"${p.replyHush}"`;
}

/** Space / sound / distance narration anchors (ablation treatment structure). */
export function buildSpaceSoundFewShot(p: NarrationFewShotProfile): string {
  return `유저: 오늘도 바쁘지?
${p.charName}: 카페 안 공기가 달큰한 원두 향으로 가득했고, 에스프레소 머신 소음이 카운터 뒤에서 규칙적으로 울렸다. 두 사람 사이 테이블 간격은 손 하나도 채 건너지 못할 만큼 좁았다.

"${p.replyDaily}"

유저: …괜찮아 보이지 않네.
${p.charName}: 형광등 아래 바닥 타일이 차게 반짝였고, 멀리 문 쪽에서 바람 소리가 틈새로 새어 들어왔다. 복도 끝 발소리가 잠시 멎었다.

"${p.replyWorried}"

유저: …들었어?
${p.charName}: 복도 깊은 쪽에서 금속이 긁히는 소리가 짧게 울려 퍼졌다. 불 꺼진 층의 공기가 목에 걸릴 만큼 무거웠다.

"${p.replyAlert}"

유저: 문 너머야.
${p.charName}: 문틈 아래 막혀 있던 바람이 한 줄기 새어 나왔고, 바닥과 문 사이 간격이 어둠으로 메워졌다. 복도 끝 거리감이 갑자기 가까워진 느낌이었다.

"${p.replyHush}"`;
}

/** Cross-validation profiles — dialogue tone only differs; narration structure shared. */
export const NARRATION_FEWSHOT_PROFILES: NarrationFewShotProfile[] = [
  {
    id: "formal",
    label: "냉정 존댓말 (레온형)",
    charName: "레온",
    replyDaily: "조금입니다. 그쪽은요?",
    replyWorried: "…괜찮습니다.",
    replyAlert: "…무슨 소리입니까?",
    replyHush: "…조용히 하십시오.",
  },
  {
    id: "casual",
    label: "일상 카페 (서연형)",
    charName: "서연",
    replyDaily: "조금요. 손님은요?",
    replyWorried: "…괜찮아요.",
    replyAlert: "…무슨 소리예요?",
    replyHush: "…조용히 해요.",
  },
  {
    id: "terse",
    label: "단호 반말 (탐정형)",
    charName: "수아",
    replyDaily: "바빠. 넌?",
    replyWorried: "…괜찮아.",
    replyAlert: "…뭐가?",
    replyHush: "…조용히.",
  },
];

/** Creator text wins; platform few-shot only when NARRATION_FEWSHOT_FALLBACK_ENABLED=1. */
export function resolveExampleDialogForPrompt(
  raw: string | null | undefined,
  charName: string
): string {
  const trimmed = (raw ?? "").trim();
  if (trimmed) return trimmed;
  if (!isNarrationFewShotFallbackEnabled()) return "";
  return defaultPlatformNarrationFewShot(charName);
}

/** Platform default when creator example_dialog is empty (treatment only). */
export function defaultPlatformNarrationFewShot(charName: string): string {
  const profile: NarrationFewShotProfile = {
    id: "platform",
    label: "platform default",
    charName: charName.trim() || "캐릭터",
    replyDaily: "조금요. 그쪽은요?",
    replyWorried: "…괜찮습니다.",
    replyAlert: "…무슨 소리요?",
    replyHush: "…조용히 하세요.",
  };
  return buildSpaceSoundFewShot(profile);
}
