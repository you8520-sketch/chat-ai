/** AI 출력 — 마크다own/RP 표기(형식) vs 문단 레이아웃(OUTPUT LAYOUT recency) 분리 */

/** 마크다own·RP 표기 금지 — 문단 줄바꿈/대사 분리는 [OUTPUT LAYOUT] 단일 출처 */
export const WEBNOVEL_OUTPUT_FORMAT_BLOCK = `[WEBNOVEL OUTPUT FORMAT]
Never wrap narration or actions in markdown or roleplay markers:
*
**
( )
[ ]
{ }

「 」: in-world proper nouns only (skills, spells, system labels) — never for thoughts or dialogue.`;

/** 시스템 말미 recency — Length → **여기(유일)** → Terminal length */
export function buildWebnovelOutputLayoutRecencyBlock(): string {
  return `[OUTPUT LAYOUT]
[SEMANTIC PARAGRAPHING]
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
These symbols describe how to READ the user's message. Never use them in your output.`;

/** 유저 입력 해석 전용 — 출력 포맷·레이아웃 아님 */
export function buildUserInputParsingBlock(hasMindReading: boolean): string {
  const lines = [
    USER_INPUT_PARSING_HEADER,
    '" " = user dialogue',
    "* … * = user-described observable action (interpret only — do not echo this wrapper in output)",
    "( ) = user action or inner thought (interpret only — do not echo parentheses in output)",
    "「 」 = proper nouns in user input only",
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
