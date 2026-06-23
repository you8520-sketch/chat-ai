export type UserMessagePartKind = "dialogue" | "action" | "thought";

export type UserMessagePart = {
  kind: UserMessagePartKind;
  text: string;
};

const ACTION_OPEN = new Set(["(", "（", "["]);
const ACTION_CLOSE: Record<string, string> = {
  "(": ")",
  "（": "）",
  "[": "]",
};

const QUOTED_SEGMENT_RE = /("[^"]*"|「[^」]*」|『[^』]*』)/g;

/** 지문 — 3인칭 서술·행동 묘사 종결 */
const NARRATIVE_CLOSING_RE =
  /(?:하(?:였|였|았|었|였)?(?:다|며|고|면서|더니|다가|니|자)|(?:였|았|었|렸|였)(?:다|으며|고|면서|더니|다가)|(?:인|한)\s*채(?:로)?|듯(?:이)?|체(?:로)?|겠(?:다|으며|고)|(?:스|시|으)?(?:며|고|면서|더니|다가|자))(?:[.…!?,\s]|$)/;

/** 대사 — 구어·1인칭 말하기 종결 */
const SPEECH_CLOSING_RE =
  /(?:[어아지네야죠]|요|세요|십니까|습니까|구나|군|걸|래|냐|까|지|야|해|함|임|음|움|듯|라)(?:[,.!?…\s]|$)|[?!…]$|[ㅋㅎ]+(?:[.!?…\s]|$)/;

const ACTION_NOUN_RE =
  /(?:고개|눈(?:동자|빛|가|썹)?|손(?:가락|목|끝|바닥)?|입(?:술|가)?|몸(?:을|이|은|는)?|어깨|발(?:걸음|끝)?|시선|표정|미소|미간|뺨|턱|목(?:덜미)?|허리|무릎|팔(?:을|이)?|다리|손길|숨(?:결|을)?|한숨|걸음|발소리|자세|몸짓|몸놀림|표정)/;

const ACTION_VERB_RE =
  /(?:바라보|돌아보|걸어|달려|앉|서(?:다|서)|눕|일어|끄덕|감싸|내밀|맞|흔|떨|밀|당|잡|피|올(?:리|려)|내(?:리|려)|감(?:쌌|싸|아)|웃|속삭|중얼|고개(?:를|를\s*)?(?:끄덕|숙|돌|젖)|미소(?:를|가)?|시선(?:을|이)?|손(?:을|을\s*)?(?:뻗|잡|올|내|떼)|입(?:을|술(?:을)?)\s*(?:다|벌|맞|연))/;

/** ( ) 안 — 속마음 vs 행동 지문 (대사 아님) */
const THOUGHT_MARKER_RE =
  /(?:속(?:으로|마음)|마음(?:속|으로|이|을|에)?|생각(?:하|했|이|을|에)|(?:느껴|느낀|느끼)|(?:궁금|의문|걱정|불안|설레|두려|기대|후회|아쉬|답답)(?:했|한|되는|스러|스럽)?|(?:진짜|설마|아마|혹시|과연|왠지|이상(?:하)?|다행)|(?:하고\s*싶|하려(?:고|는)|해야(?:겠|할))|(?:일까|일\s*것|인\s*걸|인가|일지)\??|(?:왜\s*지|뭐\s*지|어떡하지)\??)/;

function classifyParenthetical(inner: string): "action" | "thought" {
  const t = inner.trim();
  if (!t) return "action";

  if (THOUGHT_MARKER_RE.test(t)) return "thought";

  if (NARRATIVE_CLOSING_RE.test(t)) return "action";
  if (ACTION_NOUN_RE.test(t) && ACTION_VERB_RE.test(t)) return "action";
  if (ACTION_VERB_RE.test(t)) return "action";
  if (ACTION_NOUN_RE.test(t)) return "action";

  // 괄호 안 구어체·짧은 감탄 — 속마음/속뜻 (대사 아님)
  if (SPEECH_CLOSING_RE.test(t) && t.length <= 48 && !ACTION_NOUN_RE.test(t)) {
    return "thought";
  }

  return "action";
}

function stripActionWrapper(text: string): string {
  const t = text.trim();
  if (!t) return t;
  const open = t[0];
  if (ACTION_OPEN.has(open)) {
    const close = ACTION_CLOSE[open];
    if (t.endsWith(close)) return t.slice(1, -1).trim();
  }
  if (t.startsWith("*") && t.endsWith("*") && t.length >= 2) {
    return t.slice(1, -1).trim();
  }
  return t;
}

function mergeAdjacentParts(parts: UserMessagePart[]): UserMessagePart[] {
  if (parts.length <= 1) return parts;
  const merged: UserMessagePart[] = [];
  for (const part of parts) {
    const prev = merged[merged.length - 1];
    if (prev && prev.kind === part.kind) {
      prev.text += part.text;
    } else {
      merged.push({ ...part });
    }
  }
  return merged;
}

function classifyPlainSentence(sentence: string): UserMessagePartKind {
  const t = sentence.trim();
  if (!t) return "dialogue";

  if (/^["]/.test(t) && /["]$/.test(t)) return "dialogue";
  if (/^["「『]/.test(t) && /["」』]$/.test(t)) return "action";

  const inner = t.replace(/^["「『]|["」』]$/g, "").trim();
  const narrative = NARRATIVE_CLOSING_RE.test(inner);
  const speech = SPEECH_CLOSING_RE.test(inner);

  if (narrative && !speech) return "action";
  if (speech && !narrative) return "dialogue";

  if (narrative && speech) {
    if (/(?:말(?:했|하)(?:다|며|고|면서)|(?:속삭|중얼|외치|말하)(?:였|었|았)?(?:다|며|고|면서))/.test(inner)) {
      return "action";
    }
    if (ACTION_NOUN_RE.test(inner) && ACTION_VERB_RE.test(inner)) return "action";
    return "dialogue";
  }

  if (ACTION_NOUN_RE.test(inner) && ACTION_VERB_RE.test(inner)) return "action";
  if (/(?:^|[\s,])?(?:천천히|조용히|가만히|살며시|활짝|살짝|갑자기|잠시)\s/.test(inner) && inner.length >= 8) {
    return "action";
  }

  if (inner.length <= 18 && !narrative) return "dialogue";

  return "dialogue";
}

/** 괄호·별표 없는 구간을 문장 단위로 대사/지문 분류 */
export function splitPlainUserChunk(text: string): UserMessagePart[] {
  const trimmed = text.trim();
  if (!trimmed) return [];

  const parts: UserMessagePart[] = [];
  let cursor = 0;

  const pushSlice = (start: number, end: number) => {
    if (end <= start) return;
    const slice = text.slice(start, end);
    if (!slice.trim()) return;

    const sentences = slice
      .split(/(?<=[.!?…])\s+|\n+/)
      .map((s) => s.trim())
      .filter(Boolean);

    if (sentences.length <= 1) {
      parts.push({ kind: classifyPlainSentence(slice), text: slice });
      return;
    }

    for (const sentence of sentences) {
      parts.push({ kind: classifyPlainSentence(sentence), text: sentence });
    }
  };

  for (const m of trimmed.matchAll(QUOTED_SEGMENT_RE)) {
    const idx = m.index ?? 0;
    pushSlice(cursor, idx);
    const token = m[0];
    parts.push({ kind: token.startsWith('"') ? "dialogue" : "action", text: token });
    cursor = idx + token.length;
  }
  pushSlice(cursor, trimmed.length);

  return mergeAdjacentParts(parts);
}

/** 유저 메시지 → 대사 / (속마음·행동 지문) / *지문* 구간 (표기·자동 분류) */
export function parseUserMessageParts(text: string): UserMessagePart[] {
  const parts: UserMessagePart[] = [];
  let i = 0;

  while (i < text.length) {
    const ch = text[i];

    if (ACTION_OPEN.has(ch)) {
      const close = ACTION_CLOSE[ch];
      const end = text.indexOf(close, i + 1);
      if (end !== -1) {
        const wrapped = text.slice(i, end + 1);
        if (wrapped.trim()) {
          const inner = stripActionWrapper(wrapped);
          parts.push({
            kind: classifyParenthetical(inner),
            text: wrapped,
          });
        }
        i = end + 1;
        continue;
      }
    }

    if (ch === "*") {
      const end = text.indexOf("*", i + 1);
      if (end !== -1) {
        const narration = text.slice(i, end + 1);
        if (narration.trim()) {
          parts.push({ kind: "action", text: narration });
        }
        i = end + 1;
        continue;
      }
    }

    let j = i + 1;
    while (j < text.length) {
      const c = text[j];
      if (ACTION_OPEN.has(c) || c === "*") break;
      j++;
    }
    const chunk = text.slice(i, j);
    if (chunk.trim()) {
      parts.push(...splitPlainUserChunk(chunk));
    }
    i = j;
  }

  return mergeAdjacentParts(parts);
}

export function promptTextForUserPart(part: UserMessagePart): string {
  if (part.kind === "action" || part.kind === "thought") {
    return stripActionWrapper(part.text);
  }
  return part.text.trim();
}

export { stripActionWrapper };
