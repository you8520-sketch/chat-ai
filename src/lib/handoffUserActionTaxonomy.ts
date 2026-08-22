/**
 * Test/live judge for adult-handoff user-action continuation.
 * Not injected into production prompts.
 */

export type FlagValue = boolean | "UNCERTAIN";

export type TaxonomyFlag = {
  value: FlagValue;
  evidence: string | null;
};

function firstMatch(text: string, re: RegExp): string | null {
  const m = text.match(re);
  if (!m || m.index == null) return null;
  const start = Math.max(0, m.index - 16);
  const end = Math.min(text.length, m.index + Math.max(64, m[0].length + 24));
  return text.slice(start, end).replace(/\s+/g, " ").trim();
}

const SAME_BEAT_RE =
  /재킷|후드티|후드|옷을\s*(?:천천히\s*)?(?:벗|걷어|끌어올|밀어)|키스|입술|고개를\s*(?:기울|숙|들)|몸을\s*(?:기울|기대)|가까이|숨이|숨을|떨렸|소름|심장|맥박|체온/;

const NEW_RELOCATION_RE =
  /(?:렌(?:을|의\s*(?:몸|등|허리))[을를]?\s*(?:벽|탁자|테이블|회의)|렌을\s*(?:밀어붙|밀어\s*올|끌어가|끌고)|자리를\s*옮|숙소로|침대를\s*쓸|회의실로|회의용\s*탁자)/;

const NEW_TARGET_RE =
  /(?:렌이\s*(?:전자\s*)?(?:초커|목걸이|버클)[을를]?\s*(?:만지|건드|잡|잡아당)|렌의\s*(?:손목을\s*(?:잡|붙잡|낚아)|목에\s*이빨|하반신|바지를\s*(?:내리|끌어)|벨트\s*버클))/;

const NEW_ANSWER_RE =
  /렌이\s*(?:대답|고개를\s*(?:끄덕|저)|입술을\s*열어)|렌(?:이|은|가)?[^「“"\n]{0,20}(?:말했다|답했다)\s*[「“"]/;

const NEW_CHOICE_RE =
  /렌(?:이|은|가|도)?[^.\n]{0,24}(?:동의했|거절했|원했|허락했|선택한)/;

const MAJOR_REWIND_RE =
  /문을\s*연다|아직\s*복도에서|키스를\s*(?:하지\s*않|시작하지\s*않)|옷을\s*벗기지\s*않/;

export function classifySameBeatMicroContinuation(text: string): TaxonomyFlag {
  const evidence = firstMatch(text, SAME_BEAT_RE);
  return { value: Boolean(evidence), evidence };
}

export function classifyNewUserActionBeat(text: string): TaxonomyFlag {
  const evidence =
    firstMatch(text, NEW_RELOCATION_RE) ??
    firstMatch(text, NEW_TARGET_RE) ??
    firstMatch(text, NEW_ANSWER_RE) ??
    firstMatch(text, NEW_CHOICE_RE);
  return { value: Boolean(evidence), evidence };
}

export function classifyCurrentUserMajorRewind(text: string): TaxonomyFlag {
  const evidence = firstMatch(text, MAJOR_REWIND_RE);
  return { value: Boolean(evidence), evidence };
}
