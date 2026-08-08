/** AI 출력 — 마크다운/RP 표기(형식) vs 문단 레이아웃(OUTPUT LAYOUT recency) 분리 */

/** Semantic paragraphing body — layout Owner (recency block only). */
export const OUTPUT_LAYOUT_SEMANTIC_CORE = `[SEMANTIC PARAGRAPHING]
같은 인물, 같은 장소, 같은 순간, 같은 중심 반응에 속하는 연속 지문은 행동·감각·생각·기억·판단 사이에서 초점이 조금 바뀌더라도 한 문단 안에서 자연스럽게 연결한다.

지문 한 문장이 완결됐다는 이유만으로 새 문단을 시작하지 않는다.
한 문장짜리 지문 문단은 충격·반전·장면 전환·결정적 발견·의도적 정적·강한 마지막 여운처럼 명확한 강조가 있을 때만 선택적으로 사용한다.

화자 변경, 뚜렷한 시간·장소 전환, 장면의 중심 상황 변경이 있을 때 새 문단을 시작한다.
문장 수를 절대 수치로 강제하지 않되, 같은 서술 비트의 문장을 습관적으로 각각 별도 문단으로 분리하지 않는다.

"…" spoken dialogue = always its own paragraph, separated by a blank line (\\n\\n) from narration.
Never append dialogue to the end of a narration line or paragraph.
한 줄 한 화법 = 화자가 바뀌면 문단을 나눈다는 뜻이며, 지문 한 문장마다 새 문단을 만들라는 뜻이 아니다.

Wrong: 그는 고개를 들었다. "대사."
Right:
그는 고개를 들었다.

"대사."`;

/** Dialogue formatting owner only — concentration lives in Luna adapter / common RP. */
export const DIALOGUE_NARRATION_STRUCTURE_RULE = `[DIALOGUE & NARRATION]
대사는 독립 문단으로 표시한다.
화자가 바뀌면 새 대사 문단을 사용한다.
- 대사 중간에 지문을 끼워 넣어 발화를 분절하지 말 것.`;

/** 마크다운·RP 표기 금지 — 출력 규칙만 (입력 해석은 USER INPUT PARSING). */
export const WEBNOVEL_OUTPUT_FORMAT_BLOCK = `[WEBNOVEL OUTPUT FORMAT]
서술·행동에 마크다운/RP 표기(*, **, (), [], {})를 쓰지 않는다. 「」는 세계 내 고유명사·스킬·시스템 라벨만(속마음·대사 금지).`;

export type WebnovelOutputLayoutOptions = {
  /** Terra prompt canary variant=dialogue_intent_unit — replaces dialogue layout owner only. */
  dialogueIntentUnit?: boolean;
};

/** Keep in sync with terraPromptCanary DIALOGUE_LAYOUT_OWNER_*_CANARY. */
const DIALOGUE_LAYOUT_OWNER_KO_PRODUCTION = "대사는 독립 문단으로 표시한다.";
const DIALOGUE_LAYOUT_OWNER_KO_CANARY =
  "대사는 화자의 발화 의도 단위로 독립 문단에 둔다. 같은 화자가 같은 순간에 이어서 전달하는 판단·설명·반응·농담은 짧은 동작이나 시선 묘사 때문에 여러 대사 문단으로 다시 시작하지 않는다.";
const DIALOGUE_LAYOUT_OWNER_EN_PRODUCTION =
  '"…" spoken dialogue = always its own paragraph, separated by a blank line (\\n\\n) from narration.';
const DIALOGUE_LAYOUT_OWNER_EN_CANARY =
  '"…" spoken dialogue occupies its own paragraph by speaker utterance intent. Do not restart multiple dialogue paragraphs when the same speaker continues the same judgment, explanation, reaction, or joke across only a brief gesture or gaze.';

function buildSemanticCore(opts?: WebnovelOutputLayoutOptions): string {
  if (!opts?.dialogueIntentUnit) return OUTPUT_LAYOUT_SEMANTIC_CORE;
  return OUTPUT_LAYOUT_SEMANTIC_CORE.replace(
    DIALOGUE_LAYOUT_OWNER_EN_PRODUCTION,
    DIALOGUE_LAYOUT_OWNER_EN_CANARY
  );
}

function buildDialogueNarrationRule(opts?: WebnovelOutputLayoutOptions): string {
  if (!opts?.dialogueIntentUnit) return DIALOGUE_NARRATION_STRUCTURE_RULE;
  return DIALOGUE_NARRATION_STRUCTURE_RULE.replace(
    DIALOGUE_LAYOUT_OWNER_KO_PRODUCTION,
    DIALOGUE_LAYOUT_OWNER_KO_CANARY
  );
}

/** 시스템 말미 recency — Length → **여기(유일)** → Terminal length */
export function buildWebnovelOutputLayoutRecencyBlock(
  opts?: WebnovelOutputLayoutOptions
): string {
  return `[OUTPUT LAYOUT]
${buildSemanticCore(opts)}

${buildDialogueNarrationRule(opts)}`;
}

/**
 * STEP C1 compact layout candidate — A/B only.
 * Must NOT be wired into production `buildWebnovelOutputLayoutRecencyBlock`
 * until human ACCEPT + explicit replace approval.
 *
 * Preserves current layout meaning; removes duplicate owners + Wrong/Right example.
 * User-turn `buildCompactTerminalLayoutRecencyLine()` remains the recency echo.
 */
export const OUTPUT_LAYOUT_SEMANTIC_COMPACT_CANDIDATE = `[OUTPUT LAYOUT]
같은 인물·장소·순간의 하나의 연속 서술 비트는 행동·감각·생각·기억·판단 사이에서 초점이 조금 바뀌더라도 한 문단 안에서 자연스럽게 연결한다. 지문 한 문장이 끝났다는 이유만으로 습관적으로 새 문단을 만들지 않는다.
새 문단은 화자 변경, 뚜렷한 시간·장소 또는 중심 상황 전환, 혹은 충격·반전·결정적 발견·의도적 정적처럼 실제 강조가 필요할 때 시작한다.
대사는 화자별 독립 문단으로 두며 지문과 빈 줄(\\n\\n)로 분리한다. 지문 끝에 대사를 붙이지 않고, 대사 중간에 지문을 끼워 같은 발화를 불필요하게 분절하지 않는다.`;

/** Marker — must appear only on compact candidate path. */
export const OUTPUT_LAYOUT_SEMANTIC_COMPACT_CANDIDATE_MARKER =
  "하나의 연속 서술 비트는 행동·감각·생각·기억·판단";

/** user-turn bottom — layout recency (paired with length tail in contextBuilder) */
export function buildCompactTerminalLayoutRecencyLine(): string {
  return `레이아웃: 지문과 "…" 대사 사이 빈 줄(\\n\\n) 필수 — 지문 줄 끝에 대사 붙이지 말 것.`;
}

/** Swap production layout block for compact candidate (A/B harness only). */
export function replaceOutputLayoutSystemBlockWithCompactCandidate(
  systemPrompt: string
): string {
  const production = buildWebnovelOutputLayoutRecencyBlock();
  if (!systemPrompt.includes(production)) {
    throw new Error("production OUTPUT LAYOUT block missing from system prompt");
  }
  if (systemPrompt.includes(OUTPUT_LAYOUT_SEMANTIC_COMPACT_CANDIDATE_MARKER)) {
    throw new Error("compact layout already present");
  }
  return systemPrompt.split(production).join(OUTPUT_LAYOUT_SEMANTIC_COMPACT_CANDIDATE);
}

/** @deprecated buildWebnovelOutputLayoutRecencyBlock() */
export const WEBNOVEL_PARAGRAPH_LAYOUT_BLOCK = buildWebnovelOutputLayoutRecencyBlock();

/** @deprecated WEBNOVEL_OUTPUT_FORMAT_BLOCK */
export const WEBNOVEL_OUTPUT_RULES_BLOCK = WEBNOVEL_OUTPUT_FORMAT_BLOCK;

export const USER_INPUT_PARSING_HEADER = `[USER INPUT PARSING — INTERPRET [B] ONLY]
유저 메시지 해석용 기호이며 출력에 쓰지 않는다.`;

/** 유저 입력 해석 전용 — 출력 포맷·레이아웃 아님 */
export function buildUserInputParsingBlock(hasMindReading: boolean): string {
  const lines = [
    USER_INPUT_PARSING_HEADER,
    `" " 대사 · *…* 관찰 가능 행동 · ( ) 행동/속마음 · 「」 고유명사(입력).`,
  ];

  if (hasMindReading) {
    lines.push(
      "When telepathy exists in character settings, ( ) thoughts may be perceived only within that ability — never quote or paraphrase them back."
    );
  } else {
    lines.push("Unless telepathy exists in character settings, user thoughts in ( ) are never observable.");
  }

  return lines.join("\n");
}

/** 프롬프트 히스토리용 — *지문* RP 마크다운을 일반 지문으로 풀기 */
export function unwrapRoleplayMarkdownInText(text: string): string {
  let out = text;
  out = out.replace(/\*\*([^*\n]+)\*\*/g, "$1");
  out = out.replace(/\*([^*\n]+)\*/g, "$1");
  return out;
}

/** 감사·테스트 — prose bundle 등에 레이아웃 규칙이 섞였는지 */
export function containsParagraphLayoutInstructions(text: string): boolean {
  return (
    /\[SEMANTIC PARAGRAPHING\]/i.test(text) ||
    /\[OUTPUT LAYOUT\]\s*\n/i.test(text) ||
    /지문 뒤에 대사를 이어 붙이지 않는다/i.test(text) ||
    /대사는 항상 새 단락/i.test(text) ||
    /NEVER append spoken dialogue/i.test(text) ||
    /Never append dialogue to the end of a narration line/i.test(text) ||
    /ALWAYS starts a new paragraph/i.test(text) ||
    /Start a new paragraph when:/i.test(text) ||
    /Incorrect:\s*\n[^\n]+\. "[^"]+"/.test(text) ||
    /Wrong:\s*그는 고개를 들었다/i.test(text)
  );
}
