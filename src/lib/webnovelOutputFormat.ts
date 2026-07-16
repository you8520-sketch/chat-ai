/** AI 출력 — 마크다운/RP 표기(형식) vs 문단 레이아웃(OUTPUT LAYOUT recency) 분리 */

/** Frozen semantic paragraphing body — identity checked in static-dedup validation. */
export const OUTPUT_LAYOUT_SEMANTIC_CORE = `[SEMANTIC PARAGRAPHING]
한 문단에는 하나의 중심 행동·반응·감정 또는 관찰 초점만 둔다.

같은 주체의 연속된 행동과 즉각적인 결과는 한 문단으로 이어가되,
행동 주체, 감정 방향, 내면과 외부의 초점, 공간적 관찰 대상, 장면 단계가 바뀌면 새 문단을 시작한다.

문단을 글자 수나 문장 수에 맞춰 기계적으로 쪼개지 말고,
서로 다른 여러 비트를 하나의 거대한 문단으로 합치지도 않는다.

대사는 화자별 독립 문단으로 출력한다.
"…" spoken dialogue = always its own paragraph, separated by a blank line (\\n\\n) from narration.
Never append dialogue to the end of a narration line or paragraph.
한 줄 한 화법 = 화자가 바뀌면 문단을 나눈다는 뜻이며, 지문 한 문장마다 새 문단을 만들라는 뜻이 아니다.
같은 서술 초점이 유지되는 지문은 2~5문장 정도 자연스럽게 묶을 수 있다(문장 수 강제 아님).

Wrong: 그는 고개를 들었다. "대사."
Right:
그는 고개를 들었다.

"대사."`;

/** Moved from advanced prose — dialogue utterance integrity (static dedup item 7). */
export const DIALOGUE_NARRATION_STRUCTURE_RULE = `[DIALOGUE & NARRATION]
- 하나의 발화는 하나의 인용문으로 유지할 것.
- 대사 중간에 지문을 끼워 넣어 발화를 분절하지 말 것.`;

/** 마크다운·RP 표기 금지 — 출력 규칙만 (입력 해석은 USER INPUT PARSING). */
export const WEBNOVEL_OUTPUT_FORMAT_BLOCK = `[WEBNOVEL OUTPUT FORMAT]
서술·행동에 마크다운/RP 표기(*, **, (), [], {})를 쓰지 않는다. 「」는 세계 내 고유명사·스킬·시스템 라벨만(속마음·대사 금지).`;

/** 시스템 말미 recency — Length → **여기(유일)** → Terminal length */
export function buildWebnovelOutputLayoutRecencyBlock(): string {
  return `[OUTPUT LAYOUT]
${OUTPUT_LAYOUT_SEMANTIC_CORE}

${DIALOGUE_NARRATION_STRUCTURE_RULE}`;
}

/** user-turn bottom — layout recency (paired with length tail in contextBuilder) */
export function buildCompactTerminalLayoutRecencyLine(): string {
  return `레이아웃: 지문과 "…" 대사 사이 빈 줄(\\n\\n) 필수 — 지문 줄 끝에 대사 붙이지 말 것.`;
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
