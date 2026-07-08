/**
 * Universal platform few-shot — genre/character neutral.
 * Embodies Style DNA from reference corpus; harness-only (not production).
 *
 * Single template for all characters: only {charName} and dialogue tone slots vary.
 */

export type UniversalFewShotOpts = {
  charName: string;
  /** short replies — inherit from character speech if known; else neutral polite */
  replyA?: string;
  replyB?: string;
  replyC?: string;
  replyD?: string;
};

const DEFAULT_REPLIES = {
  replyA: "……들었어.",
  replyB: "괜찮아.",
  replyC: "멈춰.",
  replyD: "……아직은.",
};

/**
 * 4-beat universal few-shot — demonstrates full Style DNA in one mini-turn.
 * Setting: neutral indoor corridor (any genre maps onto this rhythm).
 */
export function buildUniversalWebnovelFewShot(opts: UniversalFewShotOpts): string {
  const name = opts.charName.trim() || "캐릭터";
  const r = { ...DEFAULT_REPLIES, ...opts };

  return `유저: …방금 소리, 들었어?
${name}: 복도 끝 형광등이 한 번 깜빡였다.

"${r.replyA}"

발소리가 끊긴 자리, 바람 소리만 남았다. ${name}은 이름을 부르려다 입술을 닫았다.

"${r.replyB}"

괜찮지 않았다. 숨이 평소보다 얕았고, 시선은 문틈에 고정돼 있었다.

유저: 뭐가?
${name}: 한 걸음.

또 한 걸음.

"${r.replyC}"

목소리가 짧았다. 그 짧음이 더 무거웠다. ${name}은 숫자를 말하지 않았다. 대신 시계를 가리켰다.

"${r.replyD}"`;
}

/** Style DNA → what this few-shot demonstrates (for docs) */
export const UNIVERSAL_FEWSHOT_DNA_MAP = [
  { dna: "문장 길이 변화", demo: "긴 지문 → 1문장 단락(한 걸음.) → 짧은 대사" },
  { dna: "정보 공개 타이밍", demo: "이름 withhold → '괜찮아' 거짓 → 숫자 말하지 않음 → …아직은" },
  { dna: "감정 전환", demo: "소리→시선→숨→공기 (라벨 없음)" },
  { dna: "긴장감", demo: "한 걸음/또 한 걸음/멈춰 — 문장 축소" },
  { dna: "여백", demo: "빈 박자 단락, … 대사, 침묵이 대답" },
  { dna: "대사·지문 호흡", demo: "지문2→대사→지문2→대사 alternation" },
  { dna: "다음 문장 pull", demo: "turn 끝 …아직은 / 유저 질문 미해소" },
] as const;

/** PROSE sections this few-shot can replace (positive imitation vs rules) */
export const PROSE_REPLACEMENT_MAP = [
  {
    proseSection: "[RHYTHM]",
    proseToday: "긴장↑ 문장 짧게 · 같은 길이 연속 금지 (규칙 4줄)",
    replacedBy: "Few-shot이 short/mid/long 혼합·1문장 단락을 직접 시연",
    keepInProse: "REGISTER 해체·말줄임 남용 금지만 유지",
  },
  {
    proseSection: "[EMOTION]",
    proseToday: "감정 라벨 금지 · 몸짓 금지 반복 (규칙 4줄)",
    replacedBy: "Few-shot: 숨·시선·침묵으로 감정, '괜찮지 않았다'는 서술 1줄",
    keepInProse: "직접 감정명('슬프다') 금지 1줄",
  },
  {
    proseSection: "[SENSATION]",
    proseToday: "채널 1–2개 · 손 연속 금지 (규칙 3줄)",
    replacedBy: "Few-shot: 소리·공기·형광등 — 손 anchor 없음",
    keepInProse: "NSFW 촉각 채널 허용 시 19+ 블록 SoT",
  },
  {
    proseSection: "[WEBNOVEL BREATH]",
    proseToday: "전환·여운 지문 한 겹 (규칙 3줄)",
    replacedBy: "Few-shot: … 대사, 1문장 단락, withhold 후 pause",
    keepInProse: "(none — breath는 예시로 충분)",
  },
  {
    proseSection: "[MOVEMENT & SPACE]",
    proseToday: "위치·거리·방향 서술 (규칙 4줄)",
    replacedBy: "Few-shot: 복도·문틈·한 걸음 — 공간 갱신",
    keepInProse: "슬로모션 남용 금지 1줄",
  },
  {
    proseSection: "[REGISTER]",
    proseToday: "해체·번역투 금지",
    replacedBy: "(대체 불가 — 형식 규칙)",
    keepInProse: "전부 유지",
  },
] as const;
