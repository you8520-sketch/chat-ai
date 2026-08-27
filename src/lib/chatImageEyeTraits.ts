/**
 * Canonical eye-trait owner for every character / persona / cast subject.
 * Extracts iris, pupil, optional shape, and heterochromia independently.
 * Does not invent unspecified colors or pupil shapes.
 */

export type ParsedEyeTraits = {
  irisColor: string | null;
  pupilColor: string | null;
  pupilShape: string | null;
  heterochromia: string | null;
  negatives: string[];
};

const ALREADY_NORMALIZED = /^Eyes \(explicit iris\/pupil ownership\):/m;

const KO_COLOR = [
  [/다크\s*그레이|어두운\s*회(?:색)?/i, "dark gray"],
  [/검(?:은|정)|흑(?:색)?/i, "black"],
  [/붉(?:은)?|빨(?:간|강)?|적(?:색)?/i, "red"],
  [/파란|푸른|청(?:색)?/i, "blue"],
  [/초록|녹(?:색)?/i, "green"],
  [/금(?:색)?|황금/i, "gold"],
  [/흰|하얀|백(?:색)?/i, "white"],
  [/회(?:색)?/i, "gray"],
  [/갈(?:색)?/i, "brown"],
  [/노란|황(?:색)?/i, "yellow"],
  [/보라|자주/i, "purple"],
  [/은(?:색)?/i, "silver"],
  [/헤이즐/i, "hazel"],
] as const;

const EN_COLOR =
  /(?:(?:dark|light|pale|deep|bright|warm|cool)\s+)?(?:gray|grey|blue|green|gold|golden|red|black|brown|hazel|amber|violet|purple|yellow|white|silver|orange|pink|teal|cyan|crimson)|dark|light/i;

const NOT_RED_EYE =
  /(?:붉(?:은)?|빨(?:간|강)?|적(?:색)?)\s*눈(?:동자)?(?:이|가|은|는)?\s*(?:아니(?:다|며|고)?|아님|않)|(?<![a-z])not\s+red\s+eyes?\b/i;

const POSITIVE_RED_EYE_KO = /(?:붉(?:은)?|빨(?:간|강)?|적(?:색)?)\s*눈(?!동자)|적안/i;
const POSITIVE_RED_EYE_EN = /(?<![a-z])red\s+eyes?\b/i;

const KO_ANATOMY_RE =
  /(다크\s*그레이|어두운\s*회(?:색)?|검(?:은|정)|흑(?:색)?|붉(?:은)?|빨(?:간|강)?|적(?:색)?|파란|푸른|청(?:색)?|초록|녹(?:색)?|금(?:색)?|황금|흰|하얀|백(?:색)?|회(?:색)?|갈(?:색)?|노란|황(?:색)?|보라|자주|은(?:색)?|헤이즐)\s*(눈동자|동공|홍채|홍책)/gi;

const EN_IRIS_RE = new RegExp(`(${EN_COLOR.source})\\s+iris(?:es)?\\b`, "gi");
const EN_PUPIL_COLOR_RE = new RegExp(
  `(${EN_COLOR.source})\\s+(?:(?:round|vertical|horizontal|cross[-\s]?shaped|star[-\s]?shaped|slit)\\s+)?pupils?\\b`,
  "gi"
);

const SHAPE_PATTERNS: Array<[RegExp, string]> = [
  [/vertical\s+slit(?:\s+pupils?)?/i, "vertical slit"],
  [/horizontal\s+slit(?:\s+pupils?)?/i, "horizontal slit"],
  [/cross[-\s]?shaped\s+pupils?/i, "cross-shaped"],
  [/star[-\s]?shaped\s+pupils?/i, "star-shaped"],
  [/round(?:\s+shaped)?\s+pupils?/i, "round"],
  [/세로\s*(?:슬릿|동공)/i, "vertical slit"],
  [/가로\s*(?:슬릿|동공)/i, "horizontal slit"],
  [/십자(?:\s*모양)?\s*동공/i, "cross-shaped"],
  [/별(?:\s*모양)?\s*동공/i, "star-shaped"],
  [/원형\s*동공/i, "round"],
];

const HETERO_EN =
  /left\s+([a-z]+(?:\s+[a-z]+)?)\s*(?:iris|eye|irises?)?\s*(?:\/|,|and)\s*right\s+([a-z]+(?:\s+[a-z]+)?)/i;
const HETERO_KO =
  /왼쪽\s+([가-힣A-Za-z ]+?)\s*(?:홍채|눈|눈동자)?\s*(?:\/|,|그리고)?\s*오른쪽\s+([가-힣A-Za-z ]+?)(?:\s*(?:홍채|눈|눈동자))?/i;

function mapKoColor(raw: string): string {
  const token = raw.trim();
  for (const [pattern, canonical] of KO_COLOR) {
    if (pattern.test(token)) return canonical;
  }
  return token;
}

function mapEnColor(raw: string): string {
  return raw.replace(/\s+/g, " ").trim().toLowerCase().replace(/\bgolden\b/, "gold");
}

function emptyTraits(): ParsedEyeTraits {
  return {
    irisColor: null,
    pupilColor: null,
    pupilShape: null,
    heterochromia: null,
    negatives: [],
  };
}

function extractEyeTraits(text: string): ParsedEyeTraits {
  const traits = emptyTraits();

  if (NOT_RED_EYE.test(text)) {
    traits.negatives.push("NOT red eyes.");
  }

  const heteroEn = text.match(HETERO_EN);
  if (heteroEn) {
    traits.heterochromia = `left ${mapEnColor(heteroEn[1]!)}, right ${mapEnColor(heteroEn[2]!)}`;
  } else {
    const heteroKo = text.match(HETERO_KO);
    if (heteroKo) {
      traits.heterochromia = `left ${mapKoColor(heteroKo[1]!)}, right ${mapKoColor(heteroKo[2]!)}`;
    }
  }

  for (const [pattern, shape] of SHAPE_PATTERNS) {
    if (pattern.test(text)) {
      traits.pupilShape = shape;
      break;
    }
  }

  let visibleEyeFromNundongja: string | null = null;
  let irisFromHongchae: string | null = null;

  for (const match of text.matchAll(KO_ANATOMY_RE)) {
    const color = mapKoColor(match[1]!);
    const anatomy = match[2]!;
    if (anatomy === "동공") {
      traits.pupilColor = color;
    } else if (anatomy === "홍채" || anatomy === "홍책") {
      irisFromHongchae = color;
    } else if (anatomy === "눈동자") {
      visibleEyeFromNundongja = color;
    }
  }

  for (const match of text.matchAll(EN_IRIS_RE)) {
    irisFromHongchae = mapEnColor(match[1]!);
  }
  for (const match of text.matchAll(EN_PUPIL_COLOR_RE)) {
    traits.pupilColor = mapEnColor(match[1]!);
  }

  if (irisFromHongchae) {
    traits.irisColor = irisFromHongchae;
  } else if (visibleEyeFromNundongja) {
    traits.irisColor = visibleEyeFromNundongja;
  } else if (
    !traits.negatives.length &&
    (POSITIVE_RED_EYE_KO.test(text) || POSITIVE_RED_EYE_EN.test(text))
  ) {
    traits.irisColor = "red";
  }

  return traits;
}

function lineHasSemanticContent(line: string): boolean {
  const withoutBullet = line.replace(/^\s*-\s*/, "").trim();
  if (!withoutBullet) return false;
  return /[\p{L}\p{N}]/u.test(withoutBullet);
}

function stripPunctuationOnlyResidue(text: string): string {
  return text
    .split(/\n/)
    .map((line) =>
      line
        .replace(/,\s*,+/g, ", ")
        .replace(/[,;·]\s*[,;·]+/g, ", ")
        .replace(/^\s*[,;·\-–—]+\s*/, "")
        .replace(/\s*[,;·\-–—]+\s*$/, "")
        .replace(/[ \t]{2,}/g, " ")
        .trim()
    )
    .filter((line) => lineHasSemanticContent(line))
    .join("\n")
    .trim();
}

function stripEyePhrases(text: string): string {
  return stripPunctuationOnlyResidue(
    text
      .replace(KO_ANATOMY_RE, " ")
      .replace(EN_IRIS_RE, " ")
      .replace(EN_PUPIL_COLOR_RE, " ")
      .replace(HETERO_EN, " ")
      .replace(HETERO_KO, " ")
      .replace(NOT_RED_EYE, " ")
      .replace(POSITIVE_RED_EYE_KO, " ")
      .replace(POSITIVE_RED_EYE_EN, " ")
      .replace(/vertical\s+slit(?:\s+pupils?)?/gi, " ")
      .replace(/horizontal\s+slit(?:\s+pupils?)?/gi, " ")
      .replace(/cross[-\s]?shaped\s+pupils?/gi, " ")
      .replace(/star[-\s]?shaped\s+pupils?/gi, " ")
      .replace(/round(?:\s+shaped)?\s+pupils?/gi, " ")
      .replace(/세로\s*(?:슬릿|동공)/gi, " ")
      .replace(/가로\s*(?:슬릿|동공)/gi, " ")
      .replace(/십자(?:\s*모양)?\s*동공/gi, " ")
      .replace(/별(?:\s*모양)?\s*동공/gi, " ")
      .replace(/원형\s*동공/gi, " ")
      .replace(/[ \t]{2,}/g, " ")
      .replace(/\n{3,}/g, "\n\n")
      .trim()
  );
}

export function parseEyeTraitsFromClause(clause: string): ParsedEyeTraits {
  return extractEyeTraits(String(clause ?? ""));
}

function renderEyeTraitPromptLines(traits: ParsedEyeTraits): string[] {
  const lines: string[] = [];

  if (traits.heterochromia) {
    lines.push(`Heterochromia: ${traits.heterochromia}.`);
  } else if (traits.irisColor) {
    lines.push(`Iris color: ${traits.irisColor}.`);
  }

  if (traits.pupilColor) {
    lines.push(`Pupil color: ${traits.pupilColor}.`);
  }
  if (traits.pupilShape) {
    lines.push(`Pupil shape: ${traits.pupilShape}.`);
  }

  const irisIsRed = traits.irisColor === "red" || Boolean(traits.heterochromia?.includes("red"));
  if (traits.pupilColor === "red" && !irisIsRed) {
    lines.push(
      "Red applies to the small pupil center ONLY — do NOT fill the entire iris red. Keep the iris its own color."
    );
  }
  if (irisIsRed && traits.pupilColor && traits.pupilColor !== "red") {
    lines.push("Red irises do NOT imply red pupils unless pupil color is explicitly red above.");
  }
  if (
    traits.irisColor &&
    traits.pupilColor &&
    traits.irisColor !== traits.pupilColor &&
    !traits.heterochromia
  ) {
    lines.push(
      "Iris color and pupil color are distinct; do not merge them into one 'red eyes' simplification."
    );
  }

  for (const negative of traits.negatives) {
    const conflictsWithPositiveRed =
      /not red eyes/i.test(negative) && irisIsRed && traits.pupilColor !== "red";
    if (conflictsWithPositiveRed) continue;
    if (/not red eyes/i.test(negative) && irisIsRed && !traits.pupilColor) continue;
    lines.push(negative);
  }

  return lines;
}

export function normalizeSavedAppearanceForProvider(raw: string): string {
  const text = String(raw ?? "")
    .replace(/\r\n?/g, "\n")
    .trim();
  if (!text) return "";
  if (ALREADY_NORMALIZED.test(text)) return text;

  const traits = extractEyeTraits(text);
  const eyeLines = renderEyeTraitPromptLines(traits);
  if (eyeLines.length === 0) return text;

  const body = stripEyePhrases(text);
  const eyeBlock = ["Eyes (explicit iris/pupil ownership):", ...eyeLines].join("\n");
  return body ? `${eyeBlock}\n${body}` : eyeBlock;
}
