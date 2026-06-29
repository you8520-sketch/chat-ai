/** OOC 지시로만 유저 사칭(공동 서술) 허용 — 기본은 금지 */

export type UserImpersonationSources = {
  personaDescription?: string;
  userNote?: string;
};

/** 명시적 opt-in만 — UI 안내 (OOC: 유저 사칭 허용) 등 */
const IMPERSONATION_ALLOW =
  /(?:유저\s*)?사칭\s*허용|사칭\s*(?:을|를)?\s*(?:허용|해도|해\s*줘|해주|가능|켜|OK|ok)|유저\s*조종\s*허용|co-?narrat(?:ion)?\s*(?:allow(?:ed)?|on|permitted|허용)|possession\s*mode\s*(?:on|허용)/i;

const IMPERSONATION_DENY =
  /사칭\s*(?:금지|하지\s*마|안\s*됨|불가|끄)|(?:유저|내)\s*(?:대사|행동).*?(?:작성|서술).*?(?:금지|하지)|no\s*(?:user\s*)?impersonat/i;

/** RP 텍스트에서 OOC 구간 추출 (순서 유지) */
export function extractOocSnippets(text: string): string[] {
  const trimmed = text.trim();
  if (!trimmed) return [];

  const snippets: string[] = [];

  const parenRe = /[\(（]\s*OOC\s*[:\：]?\s*([\s\S]*?)[\)）]/gi;
  let m: RegExpExecArray | null;
  while ((m = parenRe.exec(trimmed)) !== null) {
    const s = m[1].trim();
    if (s) snippets.push(s);
  }

  const bracketRe = /\[\[\s*OOC\s*[:\：]?\s*([^\]]*)\]\]/gi;
  while ((m = bracketRe.exec(trimmed)) !== null) {
    const s = m[1].trim();
    if (s) snippets.push(s);
  }

  const cornerRe = /【\s*OOC\s*[:\：]?\s*([^】]*)】/gi;
  while ((m = cornerRe.exec(trimmed)) !== null) {
    const s = m[1].trim();
    if (s) snippets.push(s);
  }

  // *[OOC: …]* / _[OOC: …]_ (마크다운 이탤릭 OOC)
  const italicOocRe = /[*_]\s*\[OOC\s*[:\：]?\s*([\s\S]*?)\]\s*[*_]/gi;
  while ((m = italicOocRe.exec(trimmed)) !== null) {
    const s = m[1].trim();
    if (s) snippets.push(s);
  }

  // [OOC: …] 단일 대괄호 (이중 [[OOC]] 제외)
  const singleBracketOocRe = /(?<!\[)\[OOC\s*[:\：]?\s*([\s\S]*?)\](?!\])/gi;
  while ((m = singleBracketOocRe.exec(trimmed)) !== null) {
    const s = m[1].trim();
    if (s) snippets.push(s);
  }

  for (const line of trimmed.split(/\n/)) {
    const lineMatch =
      line.match(/^(?:\/\/|#|\*)\s*OOC\s*[:\：]\s*(.+)$/i) ??
      line.match(/^OOC\s*[:\：]\s*(.+)$/i);
    if (lineMatch?.[1]?.trim()) snippets.push(lineMatch[1].trim());
  }

  return snippets;
}

function resolveFromOocBlocks(blocks: string[]): boolean {
  let state: boolean | null = null;
  for (const block of blocks) {
    for (const snippet of extractOocSnippets(block)) {
      if (IMPERSONATION_DENY.test(snippet)) state = false;
      else if (IMPERSONATION_ALLOW.test(snippet)) state = true;
    }
  }
  return state ?? false;
}

/** 고집중(중요 기억) userNote OOC만 스캔 */
export function resolveUserImpersonationFromNote(focusZoneNote: string): boolean {
  return resolveFromOocBlocks([focusZoneNote ?? ""]);
}

/** 페르소나·노트 OOC — 기본 금지, OOC 허용 지시 시에만 true (후순위 OOC가 우선) */
export function resolveUserImpersonationAllowance(sources: UserImpersonationSources): boolean {
  return resolveFromOocBlocks([sources.personaDescription ?? "", sources.userNote ?? ""]);
}

/** OOC 허용 시 — controlled possession / novel rules가 상세 정의; cross-ref만 */
export function buildOocCoNarrationHint(_personaName: string): string {
  return `[OOC CO-NARRATION]
Follow [USER_PERSONA] and [NO GODMODDING].`;
}
