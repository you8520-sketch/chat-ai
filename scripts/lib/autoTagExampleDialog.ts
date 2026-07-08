/**
 * Auto-tag example_dialog pipeline — tagging-only rewrite (tone preserved).
 *
 * Adds [공적]/[사적]/[침대] bracket tags to existing example_dialog pairs.
 * Dialogue text is NEVER modified — only tags are prepended, so character
 * tone is preserved by construction.
 *
 * Classification per pair (in priority order):
 *   1. Existing bracket tag → kept as-is
 *   2. User-cue regex (bed > public > private) — same cue families as the
 *      production scene filter
 *   3. Character-line register vs card register map (danakka/formal → public,
 *      haeyo → private) when the card declares a context split
 *   4. Fallback: [사적] (safe for single-register characters — filter then
 *      injects all pairs in private/bed scenes and falls back to all pairs
 *      in public scenes)
 */

import {
  validateBracketTaggedExampleDialog,
  stripLeadingContextTag,
  normalizeSpeechContextTag,
} from "@/lib/exampleDialogSceneFilter";
import { classifyLineRegister, type ExpectedRegister } from "@/lib/characterRegisterCompliance";

export type ExamplePairContext = "public" | "private" | "bed";

const PAIR_BED_CUE_RE = /침대|불\s*끌|가까이\s*와|속삭|안아|누워|이불|키스|스킨십|기대도/i;
const PAIR_PUBLIC_CUE_RE =
  /적이다|전장|전하|부대|병영|성벽|회의|명령|보고|각오|전투|기사단|대장|폐하|교수님|발표|과제|손님|고객|근무|업무/i;
const PAIR_PRIVATE_CUE_RE = /괜찮|둘만|둘뿐|솔직|고백|산책|우산|말해봐|피곤|힘들|같이\s*(?:밥|걸)/i;

/** Card speech section → register-per-context map (Leon-style split detection). */
export type CardRegisterMap = {
  hasContextSplit: boolean;
  publicRegister: ExpectedRegister | null;
  privateRegister: ExpectedRegister | null;
};

export function parseCardRegisterMap(speechSectionText: string): CardRegisterMap {
  const t = speechSectionText;
  const publicM = /(?:공적|공식|근무|전장|강의|공개)[^\n]*[:：]([^\n]+)/.exec(t);
  const privateM = /(?:사적|둘만|평소|친구|연인|침대)[^\n]*[:：]([^\n]+)/.exec(t);

  const toRegister = (s: string | undefined): ExpectedRegister | null => {
    if (!s) return null;
    if (/다나까|하십시오|군대식/.test(s)) return "danakka";
    if (/합니다|입니다|격식/.test(s)) return "formal";
    if (/해요|존댓말|~요/.test(s)) return "haeyo";
    if (/반말/.test(s)) return "banmal";
    return null;
  };

  const pub = toRegister(publicM?.[1]);
  const priv = toRegister(privateM?.[1]);
  return {
    hasContextSplit: pub !== null && priv !== null && pub !== priv,
    publicRegister: pub,
    privateRegister: priv,
  };
}

type ParsedPair = {
  existingTag: ExamplePairContext | null;
  userLine: string | null;
  charLines: string[];
  rawLines: string[];
};

function isUserLine(line: string): boolean {
  return /^(?:유저|user|나|당신)\s*[:：]/i.test(line);
}

function isSpeakerLine(line: string): boolean {
  return /^(?:[^\s:：]{1,16})\s*[:：]/.test(line);
}

export function parseExamplePairs(body: string): ParsedPair[] {
  const pairs: ParsedPair[] = [];
  let pendingTag: ExamplePairContext | null = null;
  let current: ParsedPair | null = null;

  const flush = () => {
    if (current && current.rawLines.length) pairs.push(current);
    current = null;
  };

  for (const raw of body.replace(/\r\n/g, "\n").split("\n")) {
    let line = raw.trim();
    if (!line) continue;

    const stripped = stripLeadingContextTag(line);
    if (stripped.tag) {
      pendingTag = (normalizeSpeechContextTag(stripped.tag) ?? null) as ExamplePairContext | null;
      line = stripped.rest;
      if (!line) continue;
    }

    if (isUserLine(line)) {
      flush();
      current = { existingTag: pendingTag, userLine: line, charLines: [], rawLines: [line] };
      pendingTag = null;
      continue;
    }

    if (isSpeakerLine(line)) {
      if (!current) current = { existingTag: pendingTag, userLine: null, charLines: [], rawLines: [] };
      current.charLines.push(line);
      current.rawLines.push(line);
      pendingTag = null;
      continue;
    }

    if (!current) current = { existingTag: pendingTag, userLine: null, charLines: [], rawLines: [] };
    current.rawLines.push(line);
    pendingTag = null;
  }
  flush();
  return pairs;
}

export type TaggedPairResult = {
  tag: ExamplePairContext;
  source: "existing" | "user_cue" | "register_map" | "default_private";
  lines: string[];
};

export function classifyPair(pair: ParsedPair, cardMap: CardRegisterMap): TaggedPairResult {
  if (pair.existingTag) {
    return { tag: pair.existingTag, source: "existing", lines: pair.rawLines };
  }

  const cue = pair.userLine ?? "";
  if (PAIR_BED_CUE_RE.test(cue)) return { tag: "bed", source: "user_cue", lines: pair.rawLines };
  if (PAIR_PUBLIC_CUE_RE.test(cue)) return { tag: "public", source: "user_cue", lines: pair.rawLines };
  if (PAIR_PRIVATE_CUE_RE.test(cue)) return { tag: "private", source: "user_cue", lines: pair.rawLines };

  if (cardMap.hasContextSplit) {
    // danakka and formal endings are interchangeable in practice (…습니다 / …하십시오)
    const registerMatches = (got: ExpectedRegister, want: ExpectedRegister | null): boolean => {
      if (!want) return false;
      if (got === want) return true;
      const formalFamily = new Set<ExpectedRegister>(["danakka", "formal"]);
      return formalFamily.has(got) && formalFamily.has(want);
    };
    for (const cl of pair.charLines) {
      const dialogue = cl.replace(/^[^:：]+[:：]\s*/, "");
      const reg = classifyLineRegister(dialogue);
      if (reg !== "other") {
        if (registerMatches(reg, cardMap.publicRegister)) {
          return { tag: "public", source: "register_map", lines: pair.rawLines };
        }
        if (registerMatches(reg, cardMap.privateRegister)) {
          return { tag: "private", source: "register_map", lines: pair.rawLines };
        }
      }
    }
  }

  return { tag: "private", source: "default_private", lines: pair.rawLines };
}

const TAG_LABEL: Record<ExamplePairContext, string> = {
  public: "공적",
  private: "사적",
  bed: "침대",
};

export type AutoTagResult = {
  tagged: string;
  pairs: TaggedPairResult[];
  pairCount: number;
  alreadyTaggedCount: number;
  bySource: Record<string, number>;
  byTag: Record<string, number>;
  valid: boolean;
  validationErrors: string[];
  changed: boolean;
};

/* ------------------------------------------------------------------ *
 * Composed-block adapter (character-line-only synthetic blocks)
 *
 * Production saves (src/lib/speechCreatorFields.ts composeExampleDialog)
 * write example_dialog WITHOUT user lines: a `[예시 대사]` section of bare
 * character lines followed by metadata sections ([SPEECH CONSISTENCY],
 * [말투 — 특징], [dialogue_avoid …], [말투 — 성격]). The pair parser above
 * assumes 유저:/캐: pairs and would mis-group these, so composed blocks get
 * their own line-based tagger. Metadata sections are never tagged.
 * ------------------------------------------------------------------ */

export type ExampleDialogFormat = "pair" | "composed" | "empty";

const SECTION_HEADER_RE = /^\[[^\]]+\]\s*$/;
const EXAMPLE_LINES_HEADER_RE = /^\[예시\s*(?:대사|대화)\]\s*$/;

function isNonContextSectionHeader(line: string): boolean {
  return SECTION_HEADER_RE.test(line) && !SPEECH_CONTEXT_TAG_RE_LOCAL.test(line);
}

// Mirror of SPEECH_CONTEXT_TAG_RE (imported module keeps it exported; reuse via strip helper)
const SPEECH_CONTEXT_TAG_RE_LOCAL =
  /^\[(공적|사적|둘만|침대|private|public|formal|bed|intimate)\]\s*/i;

/**
 * Pair format = at least one user-prefixed line (유저:/user: …).
 * Everything else with content is a composed/char-only block.
 */
export function detectExampleDialogFormat(raw: string): ExampleDialogFormat {
  const body = raw.trim();
  if (!body) return "empty";
  for (const rawLine of body.replace(/\r\n/g, "\n").split("\n")) {
    const line = stripLeadingContextTag(rawLine.trim()).rest;
    if (isUserLine(line)) return "pair";
  }
  return "composed";
}

export type ComposedTagOptions = {
  /** Force every untagged dialogue line to this tag (confidence gate: single [사적]). */
  forceTag?: ExamplePairContext;
};

/**
 * Tag a composed (character-line-only) block. Only dialogue lines are tagged:
 *  - lines inside the [예시 대사]/[예시 대화] section, or
 *  - all non-header lines when the block has no section headers at all.
 * Metadata sections after the first non-example header are left untouched.
 */
export function autoTagComposedExampleDialog(
  raw: string,
  speechSectionText: string,
  options: ComposedTagOptions = {}
): AutoTagResult {
  const body = raw.trim();
  const cardMap = parseCardRegisterMap(speechSectionText);
  const hasAnyHeader = body
    .replace(/\r\n/g, "\n")
    .split("\n")
    .some((l) => isNonContextSectionHeader(l.trim()));

  const outLines: string[] = [];
  const results: TaggedPairResult[] = [];
  let inExampleSection = !hasAnyHeader; // headerless block: everything is dialogue
  let alreadyTaggedCount = 0;

  const classifyLine = (
    dialogue: string
  ): { tag: ExamplePairContext; source: TaggedPairResult["source"] } => {
    if (options.forceTag) return { tag: options.forceTag, source: "default_private" };
    if (cardMap.hasContextSplit) {
      const reg = classifyLineRegister(dialogue);
      if (reg !== "other") {
        const formalFamily = new Set<ExpectedRegister>(["danakka", "formal"]);
        const matches = (want: ExpectedRegister | null) =>
          want !== null && (reg === want || (formalFamily.has(reg) && formalFamily.has(want)));
        if (matches(cardMap.publicRegister)) return { tag: "public", source: "register_map" };
        if (matches(cardMap.privateRegister)) return { tag: "private", source: "register_map" };
      }
    }
    return { tag: "private", source: "default_private" };
  };

  for (const rawLine of body.replace(/\r\n/g, "\n").split("\n")) {
    const line = rawLine.trim();
    if (!line) {
      outLines.push("");
      continue;
    }

    if (isNonContextSectionHeader(line)) {
      inExampleSection = EXAMPLE_LINES_HEADER_RE.test(line);
      outLines.push(line);
      continue;
    }

    if (!inExampleSection) {
      outLines.push(line);
      continue;
    }

    const stripped = stripLeadingContextTag(line);
    if (stripped.tag) {
      const norm = normalizeSpeechContextTag(stripped.tag);
      if (norm && norm !== "unknown") {
        alreadyTaggedCount++;
        results.push({ tag: norm as ExamplePairContext, source: "existing", lines: [line] });
        outLines.push(line);
        continue;
      }
    }

    const { tag, source } = classifyLine(line);
    results.push({ tag, source, lines: [line] });
    outLines.push(`[${TAG_LABEL[tag]}] ${line}`);
  }

  const tagged = outLines.join("\n").replace(/\n{3,}/g, "\n\n").trim();

  const bySource: Record<string, number> = {};
  const byTag: Record<string, number> = {};
  for (const r of results) {
    bySource[r.source] = (bySource[r.source] ?? 0) + 1;
    byTag[r.tag] = (byTag[r.tag] ?? 0) + 1;
  }

  const v = validateBracketTaggedExampleDialog(tagged);
  return {
    tagged,
    pairs: results,
    pairCount: results.length,
    alreadyTaggedCount,
    bySource,
    byTag,
    valid: v.valid,
    validationErrors: v.errors,
    changed: tagged !== body,
  };
}

export type DispatchedAutoTagResult = AutoTagResult & { format: ExampleDialogFormat };

/** Dispatcher: pair format → existing pair tagger; composed → line adapter. */
export function autoTagExampleDialogDispatch(
  raw: string,
  speechSectionText: string,
  options: ComposedTagOptions = {}
): DispatchedAutoTagResult {
  const format = detectExampleDialogFormat(raw);
  if (format === "empty") {
    return {
      format,
      tagged: "",
      pairs: [],
      pairCount: 0,
      alreadyTaggedCount: 0,
      bySource: {},
      byTag: {},
      valid: false,
      validationErrors: ["empty example_dialog"],
      changed: false,
    };
  }
  if (format === "pair") {
    return { format, ...autoTagExampleDialog(raw, speechSectionText, options) };
  }
  return { format, ...autoTagComposedExampleDialog(raw, speechSectionText, options) };
}

export function autoTagExampleDialog(
  raw: string,
  speechSectionText: string,
  options: ComposedTagOptions = {}
): AutoTagResult {
  const body = raw.trim();
  const cardMap = parseCardRegisterMap(speechSectionText);
  const parsed = parseExamplePairs(body);
  const results = parsed.map((p) =>
    // Confidence gate: force every non-pre-tagged pair to the given tag.
    options.forceTag && !p.existingTag
      ? { tag: options.forceTag, source: "default_private" as const, lines: p.rawLines }
      : classifyPair(p, cardMap)
  );

  const lines: string[] = [];
  for (const r of results) {
    const [first, ...rest] = r.lines;
    if (first === undefined) continue;
    lines.push(`[${TAG_LABEL[r.tag]}] ${first}`);
    lines.push(...rest);
  }
  const tagged = lines.join("\n");

  const bySource: Record<string, number> = {};
  const byTag: Record<string, number> = {};
  for (const r of results) {
    bySource[r.source] = (bySource[r.source] ?? 0) + 1;
    byTag[r.tag] = (byTag[r.tag] ?? 0) + 1;
  }

  const v = validateBracketTaggedExampleDialog(tagged);
  return {
    tagged,
    pairs: results,
    pairCount: results.length,
    alreadyTaggedCount: results.filter((r) => r.source === "existing").length,
    bySource,
    byTag,
    valid: v.valid,
    validationErrors: v.errors,
    changed: tagged.trim() !== body,
  };
}
