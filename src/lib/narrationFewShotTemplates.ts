import { isNarrationFewShotFallbackEnabled } from "@/lib/narrationFewShotFallbackFeature";

/**
 * Tone-agnostic narration few-shot structural templates.
 * Used when example_dialog is empty and NARRATION_FEWSHOT_FALLBACK_ENABLED=1.
 *
 * Production fallback must stay style-neutral (no character names, no implied
 * short-honorific dialogue). Research profiles below are for ablation scripts only.
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

/** @deprecated Step 7.5 — hand anchors replaced; use buildSpaceSoundFewShot */
export function buildHandHeavyFewShot(p: NarrationFewShotProfile): string {
  return buildSpaceSoundFewShot(p);
}

/** Space / sound / distance narration anchors (ablation treatment structure). */
export function buildSpaceSoundFewShot(p: NarrationFewShotProfile): string {
  return `유저: 오늘도 바쁘지?
${p.charName}: 카페 안 공기가 달큰한 원두 향으로 가득했고, 에스프레소 머신 소음이 카운터 뒤에서 규칙적으로 울렸다. 두 사람 사이 테이블 간격은 한 걸음도 여유 없을 만큼 좁았다.

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

/**
 * Research / ablation profiles only — generic labels, no production character names.
 * Not used by defaultPlatformNarrationFewShot.
 */
export const NARRATION_FEWSHOT_PROFILES: NarrationFewShotProfile[] = [
  {
    id: "formal",
    label: "formal register (research)",
    charName: "CharacterA",
    replyDaily: "[reply in CharacterA register — daily beat]",
    replyWorried: "[reply in CharacterA register — worried beat]",
    replyAlert: "[reply in CharacterA register — alert beat]",
    replyHush: "[reply in CharacterA register — hush beat]",
  },
  {
    id: "casual",
    label: "casual register (research)",
    charName: "CharacterB",
    replyDaily: "[reply in CharacterB register — daily beat]",
    replyWorried: "[reply in CharacterB register — worried beat]",
    replyAlert: "[reply in CharacterB register — alert beat]",
    replyHush: "[reply in CharacterB register — hush beat]",
  },
  {
    id: "terse",
    label: "terse register (research)",
    charName: "CharacterC",
    replyDaily: "[reply in CharacterC register — daily beat]",
    replyWorried: "[reply in CharacterC register — worried beat]",
    replyAlert: "[reply in CharacterC register — alert beat]",
    replyHush: "[reply in CharacterC register — hush beat]",
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

/**
 * Platform default when creator example_dialog is empty (opt-in env only).
 * Structure / format anchors only — no implied wording, endings, verbosity, or tone.
 */
export function defaultPlatformNarrationFewShot(charName: string): string {
  const name = charName.trim() || "[A]";
  return `[PLATFORM NARRATION STRUCTURE — STYLE-NEUTRAL]
Format reference only. Not shared dialogue personality for all characters.

유저: [user line]
${name}: [narration using space / sound / distance as needed — follow CHARACTER CANON]
"[quoted dialogue in THIS character's established speech only]"

Rules:
- Narration may use space, sound, and distance anchors.
- Quoted dialogue must follow CHARACTER CANON / creator speech examples for THIS character.
- Do not copy placeholder wording, endings, register, brevity, or emotional restraint from this block.`;
}
