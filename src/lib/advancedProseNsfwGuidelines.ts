/** Merged shared prose + NSFW writing rules — replaces SHARED_PROSE, 고급 작법, 퇴폐적 관능, tail duplicates. */

const NSFW_LITERARY_ENHANCED_BLOCK = `=== Literary tension (19+ · OpenRouter) ===
1. 진부한 클리셰 비유 금지 — 냄새, 빛·그림자, 피부 온도로 건조하고 독창적으로.
2. 기싸움·권력 격돌: 짓누르는 공기, 목구멍의 건조, 미세한 근육 경련을 **문단 서술**로.`;

/** @deprecated NSFW_LITERARY_ENHANCED_BLOCK */
const NSFW_CLAUDE_LITERARY_BLOCK = NSFW_LITERARY_ENHANCED_BLOCK;

export type AdvancedProseNsfwOpts = {
  nsfwEnabled: boolean;
  /** OpenRouter 19+ — literary tension add-on (all OR models when NSFW) */
  literaryEnhanced?: boolean;
  /** @deprecated use literaryEnhanced */
  claudeEnhanced?: boolean;
};

const ABSOLUTE_PROHIBITION_RULES = `=== 절대 금지 규칙 ===

1. 내면 해설·설명형 감각 금지
감정·의도는 행동·시선·감각 반응(현상)으로만 표현. 직접 감정 라벨·속내 해설 금지. 감각 원인 설명·동일 감각어 반복 금지.

2. 설정 나열 금지
현재 장면과 무관한 직업·등급·과거사 설명 금지.

3. 나열식 문장 금지
동작을 접속사로 길게 연결하지 말고 마침표로 분리할 것.`;

/** Test-only placement-isolation variants P1/P2 — not in production default. */
export const DENSE_NARRATION_LIGHTWEIGHT_RULE =
  "When writing narration, prefer developing an action, observation, or sensory event through additional connected sentences before creating a paragraph break. Avoid resolving a narration block after the first sentence when further immediate consequences, observations, or environmental reactions naturally follow.";

const DENSE_NARRATION_LIGHTWEIGHT_BULLET = `- ${DENSE_NARRATION_LIGHTWEIGHT_RULE}`;

const DIALOGUE_NARRATION_STRUCTURE_RULE = `[DIALOGUE & NARRATION]

- 하나의 발화는 하나의 인용문으로 유지할 것.
- 대사 중간에 지문을 끼워 넣어 발화를 분절하지 말 것.
- 지문은 2~8문장의 밀도 있는 단락으로 작성할 것.
- 대사 사이 지문은 최소 3문장.`;

/** P2 — dense rule inside [DIALOGUE & NARRATION] (formatting-adjacent placement). */
export const DIALOGUE_NARRATION_P2_WITH_DENSE = `${DIALOGUE_NARRATION_STRUCTURE_RULE}
${DENSE_NARRATION_LIGHTWEIGHT_BULLET}`;

/** Remove dense narration rule if present (audit baseline scrub). */
export function stripDenseNarrationRule(system: string): string {
  return system
    .replace(DENSE_NARRATION_LIGHTWEIGHT_BULLET, "")
    .replace(DENSE_NARRATION_LIGHTWEIGHT_RULE, "")
    .replace(/\n{3,}/g, "\n\n");
}

/** P1 — dense rule in [KOREAN_WEBNOVEL_STYLE] (prose placement). */
export function applyDenseNarrationPlacementP1(system: string): string {
  const scrubbed = stripDenseNarrationRule(system);
  if (scrubbed.includes(DENSE_NARRATION_LIGHTWEIGHT_RULE)) return scrubbed;
  return scrubbed.replace(
    /(\[KOREAN_WEBNOVEL_STYLE\]\n)/,
    `$1${DENSE_NARRATION_LIGHTWEIGHT_BULLET}\n`
  );
}

/** P2 — dense rule in [DIALOGUE & NARRATION] (current candidate placement). */
export function applyDenseNarrationPlacementP2(system: string): string {
  const scrubbed = stripDenseNarrationRule(system);
  if (scrubbed.includes(DENSE_NARRATION_LIGHTWEIGHT_RULE)) return scrubbed;
  return scrubbed.replace(
    /(대사 사이 지문은 최소 3문장\.)/,
    `$1\n${DENSE_NARRATION_LIGHTWEIGHT_BULLET}`
  );
}

/** Mechanical NSFW prose constraints only — scene-variety lives in [DYNAMIC PROSE STYLING]. */
export const NSFW_EXPLICIT_SENSORY_WRITING_BLOCK = `[WRITING STYLE: 19+ Korean Web Novel — Explicit Sensory Mode]

Format: [KOREAN_WEBNOVEL_STYLE].

[INTIMATE/NSFW SCENE DYNAMICS & IN-CHARACTER RULES]
High-intimacy or NSFW scenes: apply the rules below with top priority.

1. 직관·명확 (Directness over Euphemism)
- 행위·신체는 시적 비유·완곡 은유 극도로 제한. '그곳'·대명사 뭉개기 금지.
- 성기·귀두·음경·내벽·질口·항문 등 lore·register에 맞는 해부학적 명칭을 직접 사용하고, 물리 접촉·행동을 직설적·감각적·노골적인 웹소설 문체로 서술.

2. 감각·의도 결합
- 피스톤·기계적 나열 금지. 탐미적 이미지로 — 임상 나열 금지.
- 확장 방식은 [DYNAMIC PROSE STYLING] Mode B 준수.

3. 캐붕 방지 (Strict Anti-OOC in NSFW)
- 씬 고조 시에도 [CORE RP] §3 [SPEECH]·관계 단계·말투 유지. OOC 순종·천박·멜로드rama 금지.
- 일방적 행위 나열 금지 — 상호작용·티키타카로 전개. 발화·지문: [KOREAN_WEBNOVEL_STYLE]·[DIALOGUE & NARRATION] 준수.`;

export function buildAdvancedProseNsfwGuidelines(opts: AdvancedProseNsfwOpts): string {
  const lines: string[] = [
    "[ADVANCED PROSE & NSFW GUIDELINES]",
    "",
    ABSOLUTE_PROHIBITION_RULES,
    "",
    DIALOGUE_NARRATION_STRUCTURE_RULE,
  ];

  if (!opts.nsfwEnabled) {
    return lines.join("\n");
  }

  lines.push("", NSFW_EXPLICIT_SENSORY_WRITING_BLOCK);

  const literary = opts.literaryEnhanced ?? opts.claudeEnhanced;
  if (literary) {
    lines.push("", NSFW_LITERARY_ENHANCED_BLOCK);
  }

  return lines.join("\n");
}

/** @deprecated Use buildAdvancedProseNsfwGuidelines */
export const SHARED_PROSE_RULES_BLOCK = buildAdvancedProseNsfwGuidelines({ nsfwEnabled: false });
