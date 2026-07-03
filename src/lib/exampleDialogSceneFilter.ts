/**
 * Step 7.6b — Filter tagged example_dialog lines by inferred scene register context.
 * Rewrites [예시 대화] at assembly time; untagged legacy blocks pass through unchanged.
 */

/** Bracket-only context tags — `[공적]`/`[사적]`/`[침대]` (card prose `공적:` must NOT match).
 *  Step 4 decision: bracket form is the only accepted tag syntax; paren `(공적)` was dropped. */
export const SPEECH_CONTEXT_TAG_RE =
  /^\[(공적|사적|둘만|침대|private|public|formal|bed|intimate)\]\s*/i;

const ALLOWED_BRACKET_TAGS = new Set(["공적", "사적", "침대", "둘만", "private", "public", "formal", "bed", "intimate"]);

const UNBRACKETED_CARD_PROSE_RE =
  /^(공적|사적|침대|공적인\s*자리|유저와\s*둘만)\s*[:：]/;

export type TaggedExampleValidationResult = {
  valid: boolean;
  errors: string[];
  bracketTagLineCount: number;
  unbracketedContextLines: string[];
  invalidTagLines: string[];
};

/** Gate before staging: every context tag must be `[…]` bracket form; no card-prose `공적:` lines. */
export function validateBracketTaggedExampleDialog(raw: string): TaggedExampleValidationResult {
  const errors: string[] = [];
  const unbracketedContextLines: string[] = [];
  const invalidTagLines: string[] = [];
  let bracketTagLineCount = 0;

  for (const rawLine of raw.replace(/\r\n/g, "\n").split("\n")) {
    const line = rawLine.trim();
    if (!line) continue;

    if (UNBRACKETED_CARD_PROSE_RE.test(line)) {
      unbracketedContextLines.push(line);
      errors.push(`Card-prose line in example block (must use [tag] bracket): ${line.slice(0, 72)}`);
      continue;
    }

    const bracketM = line.match(SPEECH_CONTEXT_TAG_RE);
    if (bracketM?.[1]) {
      bracketTagLineCount++;
      continue;
    }

    if (/^(공적|사적|침대|public|private|bed)\s*[:：]/i.test(line) && !line.startsWith("[")) {
      unbracketedContextLines.push(line);
      errors.push(`Unbracketed tag prefix (Step 4 risk): ${line.slice(0, 72)}`);
    }
  }

  if (bracketTagLineCount === 0 && raw.trim()) {
    errors.push("No bracket context tags found — expected [공적]/[사적]/[침대] lines");
  }

  return {
    valid: errors.length === 0,
    errors,
    bracketTagLineCount,
    unbracketedContextLines,
    invalidTagLines,
  };
}


const PUBLIC_CUE_RE =
  /적|전장|전하|부대|병영|성벽|회의|명령|보고|각오|십시오|하라|하십|전투|군|기사단|대장|왕/i;
const PRIVATE_CUE_RE = /괜찮|둘만|둘뿐|솔직|편|우리|고백|손|산책|우산|친|말해봐/i;
const BED_CUE_RE = /침대|불\s*끌|가까이|속삭|밤|안아|누워|이불|키스|스킨십/i;

export type SceneRegisterContext = "public" | "private" | "bed" | "unknown";

export type ExampleDialogFilterInput = {
  userMessage?: string;
  recentHistory?: string;
};

export function isExampleDialogSceneFilterEnabled(): boolean {
  const raw = process.env.EXAMPLE_DIALOG_SCENE_FILTER?.trim().toLowerCase();
  return raw === "1" || raw === "true" || raw === "yes";
}

export function normalizeSpeechContextTag(raw: string): SceneRegisterContext | null {
  const t = raw.trim().toLowerCase();
  if (t === "공적" || t === "public" || t === "formal") return "public";
  if (t === "사적" || t === "private" || t === "둘만") return "private";
  if (t === "침대" || t === "bed" || t === "intimate") return "bed";
  return null;
}

export function stripLeadingContextTag(line: string): { tag: string | null; rest: string } {
  const bracket = line.match(SPEECH_CONTEXT_TAG_RE);
  if (bracket?.[1]) {
    return { tag: bracket[1].trim(), rest: line.slice(bracket[0].length).trim() };
  }
  return { tag: null, rest: line };
}

export function inferSceneRegisterContext(input: ExampleDialogFilterInput): SceneRegisterContext {
  const corpus = [input.userMessage ?? "", input.recentHistory ?? ""].join("\n").trim();
  if (!corpus) return "unknown";
  if (BED_CUE_RE.test(corpus)) return "bed";
  if (PUBLIC_CUE_RE.test(corpus)) return "public";
  if (PRIVATE_CUE_RE.test(corpus)) return "private";
  return "unknown";
}

function contextMatchesTag(tag: string, scene: SceneRegisterContext): boolean {
  const bucket = normalizeSpeechContextTag(tag);
  if (!bucket) return false;
  if (scene === "unknown") return true;
  return bucket === scene;
}

type TaggedExamplePair = { tag: string | null; lines: string[] };

function isUserLine(line: string): boolean {
  return /^(?:유저|user|나|당신)\s*[:：]/i.test(line);
}

function isCharacterLine(line: string): boolean {
  return /^(?:[^\s:：]{1,16})\s*[:：]/.test(line) && !isUserLine(line);
}

/** Non-context bracket section header ([예시 대사], [SPEECH CONSISTENCY], [말투 — 특징] …). */
function isSectionHeaderLine(line: string): boolean {
  return /^\[[^\]]+\]\s*$/.test(line) && !SPEECH_CONTEXT_TAG_RE.test(line);
}

function parseTaggedExamplePairs(body: string): TaggedExamplePair[] {
  const pairs: TaggedExamplePair[] = [];
  let pendingTag: string | null = null;
  let current: TaggedExamplePair | null = null;

  const flush = () => {
    if (current?.lines.length) pairs.push(current);
    current = null;
  };

  for (const raw of body.replace(/\r\n/g, "\n").split("\n")) {
    let line = raw.trim();
    if (!line) {
      // Paragraph boundary — composed creator blocks separate sections with
      // blank lines; keep sections from gluing onto the previous tagged pair.
      flush();
      continue;
    }

    if (isSectionHeaderLine(line)) {
      flush();
      pairs.push({ tag: null, lines: [line] });
      pendingTag = null;
      continue;
    }

    const stripped = stripLeadingContextTag(line);
    if (stripped.tag) {
      // A new tag always starts a new pair (line-tagged composed blocks have
      // no user lines to delimit pairs).
      flush();
      pendingTag = stripped.tag;
      line = stripped.rest;
      if (!line) continue;
    }

    if (isUserLine(line)) {
      if (current?.lines.length) pairs.push(current);
      current = { tag: pendingTag, lines: [line] };
      pendingTag = null;
      continue;
    }

    if (isCharacterLine(line)) {
      if (current) {
        current.lines.push(line);
        pairs.push(current);
        current = null;
      } else if (pairs.length > 0 && pendingTag === null) {
        // Consecutive character line (multi-line response) — stays with its pair.
        pairs[pairs.length - 1]!.lines.push(line);
      } else {
        pairs.push({ tag: pendingTag, lines: [line] });
      }
      pendingTag = null;
      continue;
    }

    if (!current) current = { tag: pendingTag, lines: [] };
    current.lines.push(line);
    pendingTag = null;
  }

  if (current?.lines.length) pairs.push(current);
  return pairs;
}

function serializeExamplePairs(pairs: TaggedExamplePair[]): string {
  return pairs.flatMap((p) => p.lines).join("\n");
}

/** Filter example block body; strips context tags from injected lines.
 *  Untagged pairs are ALWAYS preserved — composed creator blocks carry
 *  metadata sections ([SPEECH CONSISTENCY], [말투 — 특징] …) and legacy
 *  dialogue lines without tags; dropping them would corrupt the prompt. */
export function filterTaggedExampleDialogBody(
  body: string,
  scene: SceneRegisterContext
): { filtered: string; hadTags: boolean; injectedCount: number } {
  const pairs = parseTaggedExamplePairs(body);
  const taggedPairs = pairs.filter((p) => p.tag);
  if (taggedPairs.length === 0) {
    return { filtered: body.trim(), hadTags: false, injectedCount: pairs.length };
  }

  let selectedTagged = taggedPairs.filter((p) => contextMatchesTag(p.tag!, scene));
  if (selectedTagged.length === 0 && (scene === "bed" || scene === "private")) {
    selectedTagged = taggedPairs.filter((p) => normalizeSpeechContextTag(p.tag!) === "private");
  }
  if (selectedTagged.length === 0 && scene === "public") {
    selectedTagged = taggedPairs.filter((p) => normalizeSpeechContextTag(p.tag!) === "public");
  }
  if (selectedTagged.length === 0) {
    selectedTagged = taggedPairs;
  }

  const keep = new Set(selectedTagged);
  const selected = pairs.filter((p) => !p.tag || keep.has(p));

  return {
    filtered: serializeExamplePairs(selected),
    hadTags: true,
    injectedCount: selected.length,
  };
}

export function filterExampleDialogInSetting(
  combinedSetting: string,
  input: ExampleDialogFilterInput
): string {
  if (!isExampleDialogSceneFilterEnabled()) return combinedSetting;

  const body = extractExampleDialogSectionBody(combinedSetting);
  if (!body) return combinedSetting;

  const scene = inferSceneRegisterContext(input);
  const { filtered, hadTags } = filterTaggedExampleDialogBody(body, scene);
  if (!hadTags) return combinedSetting;

  return replaceExampleDialogSectionBody(combinedSetting, filtered);
}

/** Last [예시 대화] section header. Must NOT match the inner [예시 대사]
 *  header that composed creator blocks embed inside the section body. */
function lastExampleDialogHeaderIndex(combinedSetting: string): number {
  const re = /\[예시\s*대화\]\s*\n/gi;
  let idx = -1;
  let m: RegExpExecArray | null;
  while ((m = re.exec(combinedSetting)) !== null) idx = m.index;
  return idx;
}

/** Last [예시 대화] block — take through EOF (inline [공적]/[사적]/[침대] tags are not section headers). */
export function extractExampleDialogSectionBody(combinedSetting: string): string | null {
  const idx = lastExampleDialogHeaderIndex(combinedSetting);
  if (idx < 0) return null;
  const slice = combinedSetting.slice(idx);
  const m = slice.match(/^\[예시\s*대화\]\s*\n([\s\S]*)$/i);
  return m?.[1]?.trim() ?? null;
}

export function replaceExampleDialogSectionBody(combinedSetting: string, newBody: string): string {
  const idx = lastExampleDialogHeaderIndex(combinedSetting);
  if (idx < 0) return combinedSetting;
  const head = combinedSetting.slice(0, idx);
  return `${head}[예시 대화]\n${newBody.trim()}\n`;
}
