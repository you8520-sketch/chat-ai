/**
 * Eye-trait normalization and provider rendering.
 * Separates iris vs pupil so "red pupil" does not flatten into full red eyes.
 */

const RED = /(?:붉(?:은|은)?|빨(?:간|간)?|적(?:색)?|red)/i;
const BLACK_DARK = /(?:검(?:은|정)?|흑(?:색)?|dark|black)/i;
const PUPIL_KO = /(?:동공|눈동자)/;
const IRIS_KO = /(?:홍채|홍책)/;
const FULL_RED_EYE_KO = /(?:붉(?:은|은)?|빨(?:간|간)?|적(?:색)?)\s*(?:눈|눈동자)(?!.*(?:아니|않|not))/i;
const NOT_RED_EYE = /(?:붉(?:은|은)?|빨(?:간|간)?|적(?:색)?)\s*(?:눈|눈동자).{0,12}(?:아니|않)|(?:not\s*)?red\s*eyes?/i;

const PUPIL_EN = /\bpupils?\b/i;
const IRIS_EN = /\biris(?:es)?\b/i;
const RED_EYES_AMBIG = /\bred\s*eyes?\b/i;

type ParsedEyeTraits = {
  irisColor: string | null;
  pupilColor: string | null;
  negatives: string[];
  explicitLines: string[];
};

function colorWord(isRed: boolean, isDark: boolean): string | null {
  if (isRed) return "red";
  if (isDark) return "dark/black";
  return null;
}

function parseKoreanEyeSegment(segment: string): ParsedEyeTraits | null {
  const text = segment.trim();
  if (!PUPIL_KO.test(text) && !IRIS_KO.test(text) && !FULL_RED_EYE_KO.test(text)) {
    return null;
  }

  const result: ParsedEyeTraits = {
    irisColor: null,
    pupilColor: null,
    negatives: [],
    explicitLines: [],
  };

  if (NOT_RED_EYE.test(text)) {
    result.negatives.push("NOT full red eyes; NOT solid red irises unless explicitly listed below.");
  }

  const pupilMatch = text.match(
    new RegExp(`(${RED.source}|${BLACK_DARK.source})\\s*(?:색\\s*)?(?:의\\s*)?(?:동공|눈동자)`, "i")
  );
  if (pupilMatch) {
    result.pupilColor = colorWord(RED.test(pupilMatch[1]!), BLACK_DARK.test(pupilMatch[1]!));
  }

  const irisMatch = text.match(
    new RegExp(`(${RED.source}|${BLACK_DARK.source})\\s*(?:색\\s*)?(?:의\\s*)?(?:홍채|홍책)`, "i")
  );
  if (irisMatch) {
    result.irisColor = colorWord(RED.test(irisMatch[1]!), BLACK_DARK.test(irisMatch[1]!));
  }

  if (!result.pupilColor && !result.irisColor && FULL_RED_EYE_KO.test(text) && !NOT_RED_EYE.test(text)) {
    result.negatives.push("Avoid interpreting generic 'red eyes' as full red irises unless iris color is explicitly stated.");
  }

  return result;
}

function parseEnglishEyeSegment(segment: string): ParsedEyeTraits | null {
  const text = segment.trim();
  if (!PUPIL_EN.test(text) && !IRIS_EN.test(text) && !RED_EYES_AMBIG.test(text)) {
    return null;
  }

  const result: ParsedEyeTraits = {
    irisColor: null,
    pupilColor: null,
    negatives: [],
    explicitLines: [],
  };

  if (/not\s*red\s*eyes?/i.test(text)) {
    result.negatives.push("NOT full red eyes; NOT solid red irises unless explicitly listed below.");
  }

  const pupilMatch = text.match(/(red|black|dark(?:\s*\/\s*black)?)\s+pupils?/i);
  if (pupilMatch) {
    result.pupilColor = /red/i.test(pupilMatch[1]!) ? "red" : "dark/black";
  }

  const irisMatch = text.match(/(red|dark(?:\s*gray)?|black|dark(?:\s*\/\s*black)?)\s+irises?/i);
  if (irisMatch) {
    result.irisColor = /red/i.test(irisMatch[1]!) ? "red" : "dark/black";
  }

  if (RED_EYES_AMBIG.test(text) && !result.irisColor && !result.pupilColor) {
    result.negatives.push("Do not use ambiguous 'red eyes'; apply iris/pupil colors only as specified below.");
  }

  return result;
}

/** Normalize one appearance clause; returns null when no eye semantics detected. */
export function parseEyeTraitsFromClause(clause: string): ParsedEyeTraits | null {
  return parseKoreanEyeSegment(clause) ?? parseEnglishEyeSegment(clause);
}

function mergeEyeTraits(parts: ParsedEyeTraits[]): ParsedEyeTraits {
  const merged: ParsedEyeTraits = {
    irisColor: null,
    pupilColor: null,
    negatives: [],
    explicitLines: [],
  };
  for (const part of parts) {
    if (part.irisColor) merged.irisColor = part.irisColor;
    if (part.pupilColor) merged.pupilColor = part.pupilColor;
    merged.negatives.push(...part.negatives);
    merged.explicitLines.push(...part.explicitLines);
  }
  merged.negatives = [...new Set(merged.negatives)];
  return merged;
}

/** Strip eye clauses from a line so they are not duplicated as ambiguous plain text. */
export function stripAmbiguousEyeClause(clause: string): string {
  let text = clause.trim();
  if (!text) return "";

  text = text
    .replace(/(?:검은|흑(?:색)?|붉(?:은|은)?|빨(?:간|간)?|적(?:색)?|dark|black|red)\s*(?:색\s*)?(?:의\s*)?(?:동공|눈동자|홍채|홍책)/gi, "")
    .replace(/\b(?:black|red|dark(?:\s*\/\s*black)?|dark\s*gray)\s+(?:pupils?|irises?)\b/gi, "")
    .replace(/(?:붉(?:은|은)?|빨(?:간|간)?|적(?:색)?)\s*(?:눈|눈동자)(?:이|가|은|는)?\s*(?:아니(?:다|며|고)?|않(?:다|음|아)?)/gi, "")
    .replace(/\bnot\s*red\s*eyes?\b/gi, "")
    .replace(/[,;·]\s*[,;·]+/g, ", ")
    .replace(/^\s*[,;·]\s*/g, "")
    .replace(/\s*[,;·]\s*$/g, "")
    .replace(/\s{2,}/g, " ")
    .trim();

  return text;
}

/** Provider-facing eye lines for one subject's saved appearance. */
export function renderEyeTraitPromptLines(traits: ParsedEyeTraits): string[] {
  const lines: string[] = [];

  if (traits.irisColor) {
    lines.push(`Iris color: ${traits.irisColor}.`);
  }
  if (traits.pupilColor) {
    lines.push(`Pupil color: ${traits.pupilColor}.`);
    if (traits.pupilColor === "red" && traits.irisColor !== "red") {
      lines.push(
        "Red applies to the small pupil center ONLY — do NOT fill the entire iris red. Keep the iris its own color."
      );
    }
  }
  if (traits.irisColor === "red" && traits.pupilColor && traits.pupilColor !== "red") {
    lines.push("Red irises do NOT imply red pupils unless pupil color is explicitly red above.");
  }
  if (traits.irisColor && traits.pupilColor && traits.irisColor !== traits.pupilColor) {
    lines.push("Iris color and pupil color are distinct; do not merge them into one 'red eyes' simplification.");
  }
  for (const negative of traits.negatives) {
    lines.push(negative);
  }
  for (const explicit of traits.explicitLines) {
    lines.push(explicit);
  }

  return lines;
}

/**
 * Normalize saved appearance text: extract eye semantics into explicit iris/pupil lines
 * and remove ambiguous source clauses that caused full-red-eye drift.
 */
export function normalizeSavedAppearanceForProvider(raw: string): string {
  const text = String(raw ?? "").trim();
  if (!text) return "";

  const clauses = text
    .split(/\n+/)
    .flatMap((line) => line.split(/(?<=[.!?。！？])\s+|,\s*(?=[^,]+)/))
    .map((part) => part.trim())
    .filter(Boolean);

  const eyeParts: ParsedEyeTraits[] = [];
  const nonEyeLines: string[] = [];

  for (const clause of clauses) {
    const parsed = parseEyeTraitsFromClause(clause);
    if (parsed && (parsed.irisColor || parsed.pupilColor || parsed.negatives.length > 0)) {
      eyeParts.push(parsed);
      const remainder = stripAmbiguousEyeClause(clause);
      if (remainder) nonEyeLines.push(remainder);
      continue;
    }
    nonEyeLines.push(clause);
  }

  const merged = eyeParts.length ? mergeEyeTraits(eyeParts) : null;
  const eyeLines = merged ? renderEyeTraitPromptLines(merged) : [];
  const bodyLines = nonEyeLines.filter(Boolean);

  if (eyeLines.length === 0) {
    return text;
  }

  const eyeBlock = ["Eyes (explicit iris/pupil ownership):", ...eyeLines.map((line) => `- ${line}`)].join("\n");
  if (bodyLines.length === 0) return eyeBlock;
  return [...bodyLines, eyeBlock].join("\n");
}
