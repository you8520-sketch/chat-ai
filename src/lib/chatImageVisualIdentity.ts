import type { ImagePromptGender } from "@/lib/chatImageGeneration";
import {
  normalizeSavedAppearanceForProvider,
  parseEyeTraitsFromClause,
} from "@/lib/chatImageEyeTraits";

export const CHAT_IMAGE_VISUAL_APPEARANCE_EXTRACT_MAX = 1_600;
export const CHAT_IMAGE_SAVED_APPEARANCE_PROMPT_MAX = 700;
export const CHAT_IMAGE_APPEARANCE_PREVIEW_MAX = 140;

export type ChatImageAppearanceMode = "image_only" | "image_plus_saved";

export type ChatImageVisualSourceKind =
  | "main_character"
  | "persona"
  | "cast_member"
  | "image_only"
  | "unknown";

export type ChatImageVisualSubject = {
  key: string;
  role: string;
  name: string;
  gender: ImagePromptGender;
  referenceIndex: number | null;
  referenceImageUrl?: string | null;
  appearanceMode: ChatImageAppearanceMode;
  savedAppearance?: string;
  trustedSavedAppearance?: boolean;
  sourceKind: ChatImageVisualSourceKind;
  aliases?: string[];
};

export type ChatImageTemplateSlot = {
  url: string;
  role: string;
};

const VISUAL_PHRASE =
  /(?:외모|외형|생김새|인상|머리|헤어|앞머리|가르마|반가르마|중앙가르마|사이드\s*파트|묶은\s*머리|장발|단발|짧은\s*머리|머리색|금발|은발|흑발|갈색머리|적발|5\s*:\s*5|눈동자|동공|홍채|벽안|적안|금안|녹안|오드아이|신장|체격|체형|피부|얼굴|흉터|문신|안경|귀걸이|피어싱|액세서리|장신구|복장|의상|셔츠|교복|정장|드레스|하네스|재킷|후드|코트|유니폼|날개|꼬리|\bappearance\b|\bhair(?:cut|style|color)?\b|\bbangs?\b|\bfringe\b|center[-\s]?part|side[-\s]?part|\biris(?:es)?\b|\bpupils?\b|\bheterochromia\b|\beyes?\b|\bheight\b|\bbuild\b|\bskin\b|\bface\b|\bscar\b|\btattoo\b|\bmole\b|\bpiercing\b|\baccessor(?:y|ies)\b|\boutfit\b|\bclothes?\b|\bclothing\b|\bshirt\b|\bharness\b|\bjacket\b|\bhoodie\b|\bcoat\b|\buniform\b|\bsuit\b)/i;

const SHORT_KO_VISUAL = ["눈", "귀", "점", "키", "뿔", "옷"] as const;
const SHORT_KO_VISUAL_RE = new RegExp(
  `(?<![가-힣A-Za-z])(?:${SHORT_KO_VISUAL.join("|")})(?:[이가을를은는의과와도만]|부터|까지|로|으로)?(?![가-힣A-Za-z])`
);

const CLAUSE_SPLIT =
  /\n+|(?<=[.!?。！？])\s+|,\s*|;\s+|이며\s*|이고\s*|하지만\s*|그리고\s+/;
const EXPLICIT_APPEARANCE_HEADING =
  /^(?:[-*]\s*)?(?:외형|외모|외관|생김새)(?:\s*특징)?\s*[:：]\s*(.*)$/i;
const EXPLICIT_APPEARANCE_ENGLISH_HEADING =
  /^(?:[-*]\s*)?(?:appearance|looks)\s*[:：]\s*(.*)$/i;
const KNOWN_CHARACTER_SETTING_HEADING =
  /^(?:[-*]\s*)?(?:외형|외모|외관|생김새)(?:\s*특징)?\s*[:：]|^(?:[-*]\s*)?(?:appearance|looks|성격|말투|관계|배경|과거|역할|목표|비밀|직업|나이|이름|캐릭터명|인물명|personality|speech|voice|relationship|background|past|role|goal|secret|occupation|age|name)\s*[:：]/i;

export const CHAT_IMAGE_PARTY_NO_REFERENCE_ERROR =
  "파티 구성원 참조 이미지가 없습니다. 채팅 캐릭터나 페르소나 사진을 대신 쓰지 않습니다. 최소 1명의 참조 사진을 선택한 뒤 다시 시도해 주세요.";

export type ChatImageAppearanceControlProduct =
  | "gift"
  | "emoticon"
  | "couple_stamp"
  | "ld_duo"
  | "ld_party"
  | "persona"
  | "comic";

const SUBJECT_LETTERS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";

function assertNever(value: never): never {
  throw new Error(`Unhandled visual-identity variant: ${String(value)}`);
}

export function isChatImageAppearanceMode(
  value: unknown
): value is ChatImageAppearanceMode {
  return value === "image_only" || value === "image_plus_saved";
}

const NUMERIC_HEIGHT_CM_MIN = 120;
const NUMERIC_HEIGHT_CM_MAX = 250;

const STANDALONE_BARE_HEIGHT_CLAUSE_RE = /^(?:[-*]\s*)?(\d{2,3})\s*cm\.?$/i;

const LABELED_HEIGHT_IN_CLAUSE_RE =
  /(?:신장|키|height)\s*[:：]?\s*(\d{2,3})\s*cm\b/i;

/** Disqualifies cm tokens that belong to non-stature measurements (waist, weapon length, etc.). */
const NON_STATURE_MEASUREMENT_PREFIX_RE =
  /(?:허리|어깨(?:너비)?|검\s*길이|날개\s*길이|소매|바지(?:\s*기장)?|기장|둘레|너비|width|waist|shoulder|blade|wing|sleeve|length\s+of)/i;

function normalizeHeightClauseSegment(segment: string): string {
  return segment.trim().replace(/^[-*]\s*/, "");
}

function parsePlausibleHeightCm(value: string): number | null {
  const cm = Number(value);
  if (!Number.isInteger(cm) || cm < NUMERIC_HEIGHT_CM_MIN || cm > NUMERIC_HEIGHT_CM_MAX) {
    return null;
  }
  return cm;
}

/** Canonical explicit numeric height evidence for one clause/segment. */
export function parseExplicitHeightCmFromClause(segment: string): number | null {
  const clause = normalizeHeightClauseSegment(segment);
  if (!clause) return null;

  const labeled = clause.match(LABELED_HEIGHT_IN_CLAUSE_RE);
  if (labeled?.[1]) {
    return parsePlausibleHeightCm(labeled[1]);
  }

  if (NON_STATURE_MEASUREMENT_PREFIX_RE.test(clause)) {
    return null;
  }

  const standalone = clause.match(STANDALONE_BARE_HEIGHT_CLAUSE_RE);
  if (standalone?.[1]) {
    return parsePlausibleHeightCm(standalone[1]);
  }

  return null;
}

export function isExplicitNumericHeightClause(segment: string): boolean {
  return parseExplicitHeightCmFromClause(segment) != null;
}

/** Explicit numeric stature (cm) from saved visual text — shared with visual extraction. */
export function parseNumericHeightCm(source: unknown): number | null {
  const normalized = String(source ?? "")
    .replace(/\r\n?/g, "\n")
    .replace(/[ \t]+/g, " ")
    .trim();
  if (!normalized) return null;

  const segments = normalized
    .split(CLAUSE_SPLIT)
    .map((segment) => segment.trim())
    .filter(Boolean);

  let labeledHeight: number | null = null;
  let bareHeight: number | null = null;

  for (const segment of segments) {
    const clause = normalizeHeightClauseSegment(segment);
    const labeled = clause.match(LABELED_HEIGHT_IN_CLAUSE_RE);
    if (labeled?.[1]) {
      const cm = parsePlausibleHeightCm(labeled[1]);
      if (cm != null) labeledHeight = cm;
      continue;
    }
    if (NON_STATURE_MEASUREMENT_PREFIX_RE.test(clause)) continue;
    const standalone = clause.match(STANDALONE_BARE_HEIGHT_CLAUSE_RE);
    if (standalone?.[1]) {
      const cm = parsePlausibleHeightCm(standalone[1]);
      if (cm != null) bareHeight = cm;
    }
  }

  if (labeledHeight != null) return labeledHeight;
  if (bareHeight != null) return bareHeight;

  // Single-segment sources that did not split (e.g. compact prose) — one final clause pass.
  return parseExplicitHeightCmFromClause(normalized);
}

function clauseLooksVisual(segment: string): boolean {
  if (/\bnot\s+visual\s+appearance\b/i.test(segment)) return false;
  if (isExplicitNumericHeightClause(segment)) return true;
  return VISUAL_PHRASE.test(segment) || SHORT_KO_VISUAL_RE.test(segment);
}

export function extractVisualAppearance(source: unknown): string {
  const normalized = String(source ?? "")
    .replace(/\r\n?/g, "\n")
    .replace(/[ \t]+/g, " ")
    .trim();
  if (!normalized) return "";

  const segments = normalized
    .split(CLAUSE_SPLIT)
    .map((segment) => segment.trim())
    .filter((segment) => segment && clauseLooksVisual(segment));
  return segments.join("\n").slice(0, CHAT_IMAGE_VISUAL_APPEARANCE_EXTRACT_MAX).trim();
}

export type ExplicitVisualAppearanceExtraction = {
  /** True when an explicit appearance heading was present in settings. */
  found: boolean;
  /** Extracted appearance text; empty when heading exists with no content (explicit clear). */
  text: string;
};

/**
 * Extracts only an explicitly labeled appearance section from one character's
 * free-form settings. It intentionally performs no inference when no heading exists.
 */
export function extractExplicitVisualAppearanceSection(
  source: unknown
): ExplicitVisualAppearanceExtraction {
  const lines = String(source ?? "").replace(/\r\n?/g, "\n").split("\n");
  const collected: string[] = [];
  let collecting = false;
  for (const rawLine of lines) {
    const line = rawLine.trim();
    const appearance =
      line.match(EXPLICIT_APPEARANCE_HEADING) ??
      line.match(EXPLICIT_APPEARANCE_ENGLISH_HEADING);
    if (appearance) {
      if (collecting) break;
      collecting = true;
      if (appearance[1]?.trim()) collected.push(appearance[1].trim());
      continue;
    }
    if (!collecting) continue;
    if (KNOWN_CHARACTER_SETTING_HEADING.test(line)) break;
    if (line) collected.push(line.replace(/^[-*]\s*/, "").trim());
  }
  if (!collecting) return { found: false, text: "" };
  return { found: true, text: clipSavedAppearanceForPrompt(collected.join("\n")) };
}

const COMPILED_APPEARANCE_FIELDS = [
  "compiled_text",
  "body",
  "hair",
  "eyes",
  "face",
  "lips_makeup",
  "clothing",
  "impression",
] as const;

function compiledAppearanceText(compiledJson: unknown): string {
  const raw = String(compiledJson ?? "").trim();
  if (!raw) return "";
  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return "";
    const compiledText = String(parsed.compiled_text ?? "").trim();
    if (compiledText) return compiledText;
    return COMPILED_APPEARANCE_FIELDS.filter((key) => key !== "compiled_text")
      .map((key) => String(parsed[key] ?? "").trim())
      .filter(Boolean)
      .join(", ");
  } catch {
    return "";
  }
}

export function resolveCharacterSavedAppearance(opts: {
  appearanceRaw?: string | null;
  appearanceSection?: string | null;
  appearanceCompiled?: string | null;
}): string {
  const raw =
    String(opts.appearanceRaw ?? "").trim() ||
    String(opts.appearanceSection ?? "").trim() ||
    compiledAppearanceText(opts.appearanceCompiled);
  return extractVisualAppearance(raw);
}

export function canRevealChatImageAppearancePreview(opts: {
  characterCreatorId: number | null | undefined;
  viewerUserId: number;
}): boolean {
  const creatorId = Number(opts.characterCreatorId);
  const viewerId = Number(opts.viewerUserId);
  return (
    Number.isInteger(creatorId) &&
    Number.isInteger(viewerId) &&
    creatorId > 0 &&
    viewerId > 0 &&
    creatorId === viewerId
  );
}

export function buildChatImageCharacterAppearanceClientView(opts: {
  savedAppearance: string;
  characterCreatorId: number | null | undefined;
  viewerUserId: number;
}): {
  hasSavedAppearance: boolean;
  appearancePreview: string;
} {
  const saved = clipSavedAppearanceForPrompt(opts.savedAppearance);
  const hasSavedAppearance = Boolean(saved);
  if (
    !hasSavedAppearance ||
    !canRevealChatImageAppearancePreview({
      characterCreatorId: opts.characterCreatorId,
      viewerUserId: opts.viewerUserId,
    })
  ) {
    return {
      hasSavedAppearance,
      appearancePreview: "",
    };
  }
  return {
    hasSavedAppearance,
    appearancePreview: saved,
  };
}

export function resolvePersonaSavedAppearance(description: unknown): string {
  return extractVisualAppearance(description);
}

export function clipSavedAppearanceForPrompt(
  raw: string | null | undefined
): string {
  return String(raw ?? "")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim()
    .slice(0, CHAT_IMAGE_SAVED_APPEARANCE_PROMPT_MAX);
}

function isTrustedStrictFallbackAppearanceSource(
  subject: ChatImageVisualSubject
): boolean {
  return (
    subject.sourceKind === "persona" ||
    subject.sourceKind === "main_character" ||
    subject.trustedSavedAppearance === true
  );
}

/**
 * Tier-2 strict fallback keeps sanitized raw visual description only.
 * Normalization/rendering is owned exclusively by renderChatImageSubjectManifest.
 */
export function clipSavedAppearanceForStrictFallback(
  subject: ChatImageVisualSubject
): string {
  if (subject.appearanceMode !== "image_plus_saved") return "";
  if (!isTrustedStrictFallbackAppearanceSource(subject)) return "";
  const raw = String(subject.savedAppearance ?? "").trim();
  if (!raw) return "";
  const visualOnly = extractVisualAppearance(raw);
  if (!visualOnly) return "";
  return clipSavedAppearanceForPrompt(visualOnly);
}

/** Canonical strict-fallback subject prep — preserves trusted immutable traits. */
export function prepareSubjectsForStrictFallback(
  subjects: readonly ChatImageVisualSubject[]
): ChatImageVisualSubject[] {
  return subjects.map((subject) => {
    const strictSaved = clipSavedAppearanceForStrictFallback(subject);
    const hasReference = Boolean(String(subject.referenceImageUrl ?? "").trim());
    const originalMode = subject.appearanceMode;
    let appearanceMode: ChatImageAppearanceMode;
    if (originalMode === "image_plus_saved" && strictSaved && hasReference) {
      appearanceMode = "image_plus_saved";
    } else if (hasReference) {
      appearanceMode = "image_only";
    } else {
      appearanceMode = subject.appearanceMode;
    }
    return {
      ...subject,
      savedAppearance: strictSaved,
      appearanceMode,
    };
  });
}

export function previewVisualAppearance(
  text: string,
  max = CHAT_IMAGE_APPEARANCE_PREVIEW_MAX
): { preview: string; full: string; truncated: boolean } {
  const full = String(text ?? "").replace(/\s+/g, " ").trim();
  if (full.length <= max) return { preview: full, full, truncated: false };
  return {
    preview: `${full.slice(0, max).trimEnd()}…`,
    full,
    truncated: true,
  };
}

export function defaultAppearanceMode(input: {
  sourceKind: ChatImageVisualSourceKind;
  isPrimaryImage: boolean;
  hasOwnSavedAppearance: boolean;
  hasOwnReference: boolean;
}): ChatImageAppearanceMode {
  if (!input.hasOwnSavedAppearance) return "image_only";
  switch (input.sourceKind) {
    case "unknown":
    case "image_only":
      return "image_only";
    case "main_character":
    case "persona":
      return input.isPrimaryImage ? "image_plus_saved" : "image_only";
    case "cast_member":
      if (input.hasOwnReference && !input.isPrimaryImage) return "image_only";
      return "image_plus_saved";
    default:
      return assertNever(input.sourceKind);
  }
}

export function resolveEffectiveAppearanceMode(input: {
  sourceKind: ChatImageVisualSourceKind;
  isPrimaryImage: boolean;
  hasOwnSavedAppearance: boolean;
  hasOwnReference: boolean;
  override?: ChatImageAppearanceMode | null;
}): ChatImageAppearanceMode {
  if (!input.hasOwnSavedAppearance) return "image_only";
  if (isChatImageAppearanceMode(input.override)) return input.override;
  return defaultAppearanceMode(input);
}

export function resolveChatImageAppearanceControlProduct(opts: {
  surface: "sd" | "ld";
  sdProduct?: "gift" | "emoticon" | "coupleStamp";
  ldProduct?: "comic" | "illustration" | "persona" | "scene";
  isTrpgParty?: boolean;
}): ChatImageAppearanceControlProduct {
  if (opts.surface === "sd") {
    if (opts.sdProduct === "emoticon") return "emoticon";
    if (opts.sdProduct === "coupleStamp") return "couple_stamp";
    return "gift";
  }
  if (opts.ldProduct === "persona") return "persona";
  if (opts.ldProduct === "comic") return "comic";
  if (opts.ldProduct === "scene") {
    return opts.isTrpgParty ? "ld_party" : "ld_duo";
  }
  return opts.isTrpgParty ? "ld_party" : "ld_duo";
}

export function shouldShowChatImageAppearanceModeControl(opts: {
  product: ChatImageAppearanceControlProduct;
  hasSavedAppearance: boolean;
}): boolean {
  if (!opts.hasSavedAppearance) return false;
  switch (opts.product) {
    case "gift":
    case "emoticon":
    case "couple_stamp":
    case "ld_duo":
      return true;
    case "ld_party":
    case "persona":
    case "comic":
      return false;
    default:
      return assertNever(opts.product);
  }
}

export function resolveRequestAppearanceModes(opts: {
  characterImages: ReadonlyArray<{ url: string }>;
  selectedCharacterImageUrl: string | null | undefined;
  characterSavedAppearance: string;
  personaSavedAppearance: string;
  characterOverride?: unknown;
  personaOverride?: unknown;
}): {
  characterAppearanceMode: ChatImageAppearanceMode;
  personaAppearanceMode: ChatImageAppearanceMode;
  isPrimaryCharacterImage: boolean;
} {
  const isPrimary = isPrimarySelectableImage(
    opts.characterImages,
    opts.selectedCharacterImageUrl
  );
  return {
    isPrimaryCharacterImage: isPrimary,
    characterAppearanceMode: resolveEffectiveAppearanceMode({
      sourceKind: "main_character",
      isPrimaryImage: isPrimary,
      hasOwnSavedAppearance: Boolean(opts.characterSavedAppearance.trim()),
      hasOwnReference: true,
      override: isChatImageAppearanceMode(opts.characterOverride)
        ? opts.characterOverride
        : null,
    }),
    personaAppearanceMode: resolveEffectiveAppearanceMode({
      sourceKind: "persona",
      isPrimaryImage: true,
      hasOwnSavedAppearance: Boolean(opts.personaSavedAppearance.trim()),
      hasOwnReference: true,
      override: isChatImageAppearanceMode(opts.personaOverride)
        ? opts.personaOverride
        : null,
    }),
  };
}

export function isPrimarySelectableImage(
  images: ReadonlyArray<{ url: string }>,
  selectedUrl: string | null | undefined
): boolean {
  const selected = String(selectedUrl ?? "").trim();
  const primary = images[0]?.url?.trim() ?? "";
  if (!selected) return true;
  if (!primary) return false;
  return selected === primary;
}

export function subjectLetter(index: number): string {
  return SUBJECT_LETTERS[index] ?? String(index + 1);
}

export function buildChatDuoVisualSubjects(opts: {
  characterName: string;
  characterGender: ImagePromptGender;
  characterImageUrl: string;
  characterSavedAppearance: string;
  characterAppearanceMode: ChatImageAppearanceMode;
  personaName: string;
  personaGender: ImagePromptGender;
  personaImageUrl: string;
  personaSavedAppearance: string;
  personaAppearanceMode: ChatImageAppearanceMode;
}): ChatImageVisualSubject[] {
  return [
    {
      key: "character",
      role: "chat character",
      name: opts.characterName.trim() || "chat character",
      gender: opts.characterGender,
      referenceIndex: null,
      referenceImageUrl: opts.characterImageUrl || null,
      appearanceMode: opts.characterAppearanceMode,
      savedAppearance: String(opts.characterSavedAppearance ?? "").trim(),
      sourceKind: "main_character",
    },
    {
      key: "persona",
      role: "user persona",
      name: opts.personaName.trim() || "user persona",
      gender: opts.personaGender,
      referenceIndex: null,
      referenceImageUrl: opts.personaImageUrl || null,
      appearanceMode: opts.personaAppearanceMode,
      savedAppearance: String(opts.personaSavedAppearance ?? "").trim(),
      sourceKind: "persona",
    },
  ];
}

export function bindChatImageReferencePack(opts: {
  template?: ChatImageTemplateSlot | null;
  subjectsInImageOrder: readonly ChatImageVisualSubject[];
}): {
  referenceUrls: string[];
  subjects: ChatImageVisualSubject[];
} {
  const referenceUrls: string[] = [];
  if (opts.template?.url) {
    referenceUrls.push(opts.template.url);
  }
  let next = referenceUrls.length + 1;
  const byKey = new Map<string, ChatImageVisualSubject>();
  for (const subject of opts.subjectsInImageOrder) {
    const url = String(subject.referenceImageUrl ?? "").trim();
    if (!url) {
      byKey.set(subject.key, { ...subject, referenceIndex: null, referenceImageUrl: null });
      continue;
    }
    const referenceIndex = next;
    next += 1;
    referenceUrls.push(url);
    byKey.set(subject.key, {
      ...subject,
      referenceIndex,
      referenceImageUrl: url,
    });
  }
  return {
    referenceUrls,
    subjects: opts.subjectsInImageOrder.map(
      (subject) => byKey.get(subject.key) ?? { ...subject, referenceIndex: null }
    ),
  };
}

export function visualSubjectsFromCastMembers(
  members: ReadonlyArray<{
    name: string;
    gender: ImagePromptGender;
    role: string;
    referenceIndex: number | null;
    appearanceNote?: string;
    aliases?: string[];
    imageUrl?: string | null;
    appearanceMode?: ChatImageAppearanceMode;
    isPrimaryImage?: boolean;
  }>
): ChatImageVisualSubject[] {
  return members.map((member, index) => {
    const imageUrl = String(member.imageUrl ?? "").trim() || null;
    const savedAppearance = String(member.appearanceNote ?? "").trim();
    const appearanceMode =
      member.appearanceMode ??
      defaultAppearanceMode({
        sourceKind: "cast_member",
        isPrimaryImage: member.isPrimaryImage !== false,
        hasOwnSavedAppearance: Boolean(savedAppearance),
        hasOwnReference: Boolean(imageUrl),
      });
    return {
      key: `cast-${index + 1}`,
      role: member.role,
      name: member.name.trim() || `person ${index + 1}`,
      gender: member.gender,
      referenceIndex: member.referenceIndex,
      referenceImageUrl: imageUrl,
      appearanceMode,
      savedAppearance,
      sourceKind: "cast_member",
      aliases: member.aliases,
    };
  });
}

function formatSavedAppearanceLines(appearance: string): string {
  return appearance
    .split(/\n+/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => (line.startsWith("- ") ? line : `- ${line}`))
    .join("\n");
}

function summarizeBoundEyeTraits(raw: string): string[] {
  const traits = parseEyeTraitsFromClause(raw);
  const parts: string[] = [];
  if (traits.heterochromia) {
    parts.push(`heterochromia ${traits.heterochromia}`);
  } else {
    if (traits.irisColor) parts.push(`iris ${traits.irisColor}`);
    if (traits.pupilColor) parts.push(`pupil ${traits.pupilColor}`);
  }
  if (traits.pupilShape) parts.push(`pupil shape ${traits.pupilShape}`);
  return parts;
}

function resolveSubjectNumericHeight(subject: ChatImageVisualSubject): number | null {
  if (subject.appearanceMode !== "image_plus_saved") return null;
  const raw = String(subject.savedAppearance ?? "").trim();
  if (!raw) return null;
  return parseNumericHeightCm(raw);
}

/** Cross-subject relative body stature — numeric saved height only; not screen position. */
export function renderCrossSubjectRelativeStature(
  subjects: readonly ChatImageVisualSubject[]
): string {
  const entries = subjects.flatMap((subject, index) => {
    const cm = resolveSubjectNumericHeight(subject);
    if (cm == null) return [];
    return [
      {
        name: subject.name.trim() || `person ${index + 1}`,
        letter: subjectLetter(index),
        cm,
      },
    ];
  });
  if (entries.length < 2) return "";

  const relationLines: string[] = [];
  for (let i = 0; i < entries.length; i++) {
    for (let j = i + 1; j < entries.length; j++) {
      const left = entries[i]!;
      const right = entries[j]!;
      if (left.cm === right.cm) continue;
      const taller = left.cm > right.cm ? left : right;
      const shorter = left.cm > right.cm ? right : left;
      const diff = taller.cm - shorter.cm;
      relationLines.push(
        `- ${taller.name} (SUBJECT ${taller.letter}, ${taller.cm} cm) is taller than ${shorter.name} (SUBJECT ${shorter.letter}, ${shorter.cm} cm) by approximately ${diff} cm.`
      );
    }
  }
  if (!relationLines.length) return "";

  return [
    "CROSS-SUBJECT RELATIVE STATURE — body proportions (not screen position):",
    ...relationLines,
    "Preserve believable relative body stature and proportions when both subjects are visible in comparable posture.",
    "Let on-screen vertical placement follow pose, sitting, leaning, bending, perspective, and camera distance while preserving believable relative body stature.",
  ].join("\n");
}

/** Cross-subject immutable eye trait isolation — prevents eye-color bleed between subjects. */
export function renderCrossSubjectTraitIsolation(
  subjects: readonly ChatImageVisualSubject[]
): string {
  const entries = subjects.flatMap((subject, index) => {
    if (subject.appearanceMode !== "image_plus_saved") return [];
    const raw = String(subject.savedAppearance ?? "").trim();
    if (!raw) return [];
    const parts = summarizeBoundEyeTraits(raw);
    if (!parts.length) return [];
    return [
      {
        name: subject.name.trim() || `person ${index + 1}`,
        letter: subjectLetter(index),
        parts,
      },
    ];
  });
  if (entries.length < 2) return "";
  return [
    "CROSS-SUBJECT IMMUTABLE TRAIT ISOLATION — exclusive eye ownership:",
    ...entries.map(
      (entry) =>
        `- ${entry.name} (SUBJECT ${entry.letter}): ${entry.parts.join("; ")}.`
    ),
    "Never swap, merge, or duplicate these eye traits onto any other subject.",
    "A striking eye color in one subject's block or reference is NOT a page-wide default.",
  ].join("\n");
}

export function renderChatImageSubjectManifest(
  subject: ChatImageVisualSubject,
  index: number
): string {
  const letter = subjectLetter(index);
  const name = subject.name.trim() || `person ${index + 1}`;
  const role = subject.role.trim() || "subject";
  const header = `[SUBJECT ${letter} — ${role.toUpperCase()}: ${name}]`;
  const aliases = (subject.aliases ?? [])
    .map((alias) => alias.trim())
    .filter((alias) => alias && alias !== name);
  const aliasLine = aliases.length ? `Also known as: ${aliases.join(", ")}.` : "";
  const hasReference = subject.referenceIndex != null;
  const saved = clipSavedAppearanceForPrompt(
    normalizeSavedAppearanceForProvider(subject.savedAppearance ?? "", {
      subjectName: name,
    })
  );
  const useSaved = subject.appearanceMode === "image_plus_saved" && Boolean(saved);
  const reference = hasReference
    ? `Reference: Image ${subject.referenceIndex} belongs ONLY to ${name}.`
    : `Reference: No photo for ${name}. Do not borrow another subject's reference or face.`;

  let mode: string;
  let appearanceBlock: string;
  if (hasReference && useSaved) {
    mode = "Appearance mode: IMAGE_PLUS_SAVED";
    appearanceBlock = [
      "Saved visual identity (this subject only):",
      formatSavedAppearanceLines(saved),
      "Saved stable identity traits (hair, eyes, iris, pupils, face, scars, skin, body, species marks) are authoritative for this subject.",
      "For temporary clothing/outfit, prefer this subject's selected reference image when it clearly shows a different current outfit.",
    ].join("\n");
  } else if (hasReference) {
    mode = "Appearance mode: IMAGE_ONLY";
    appearanceBlock = [
      "No supplemental saved appearance.",
      "Use this selected reference as the authoritative visual identity for this subject only.",
    ].join("\n");
  } else if (useSaved) {
    mode = "Appearance mode: IMAGE_PLUS_SAVED";
    appearanceBlock = [
      "Saved visual identity (this subject only):",
      formatSavedAppearanceLines(saved),
      "Saved stable identity traits (hair, eyes, iris, pupils, face, scars, skin, body, species marks) are authoritative for this subject.",
      "No selected reference image is available, so do not invent a current-outfit photo or borrow another subject's clothes.",
    ].join("\n");
  } else {
    mode = "Appearance mode: NO_VISUAL_REFERENCE";
    appearanceBlock = [
      "No visual reference or saved appearance is available for this subject.",
      "Use only the subject's name, gender lock and scene role.",
      "Never borrow another subject's face or visual traits.",
    ].join("\n");
  }

  return [
    header,
    aliasLine,
    reference,
    mode,
    appearanceBlock,
    `Identity ownership: every trait in this block belongs only to ${name}.`,
    `Never infer SUBJECT ${letter}'s identity from any other subject.`,
  ]
    .filter(Boolean)
    .join("\n");
}

export function buildPartyIllustrationReferencePlan(
  members: Parameters<typeof visualSubjectsFromCastMembers>[0]
): {
  subjects: ChatImageVisualSubject[];
  referenceUrls: string[];
  canGenerate: boolean;
  hiddenIdentityFallback: false;
} {
  const pack = bindChatImageReferencePack({
    subjectsInImageOrder: visualSubjectsFromCastMembers(members),
  });
  return {
    subjects: pack.subjects,
    referenceUrls: pack.referenceUrls,
    canGenerate: pack.referenceUrls.length > 0,
    hiddenIdentityFallback: false,
  };
}

/** Canonical style/rendering fidelity contract — single owner for LD, comic, TR, and strict fallback. */
export function renderChatImageStyleFidelityContract(opts: {
  hasTemplate: boolean;
  subjectCount?: number;
}): string {
  const subjectCount = Math.max(0, opts.subjectCount ?? 0);
  const multiSubject = subjectCount !== 1;
  const lines = [
    "STYLE FIDELITY — rendering technique must follow the supplied character identity reference images, not a generic stock illustration or default model look.",
    "Derive line weight, line quality, coloring method, shading, facial rendering, and overall finish directly from the subject reference images.",
    "Each subject reference is both an identity anchor and a style anchor for that character's rendering.",
  ];
  if (opts.hasTemplate) {
    lines.push(
      "Reference image 1 is layout, gutters, and panel structure ONLY.",
      "Do NOT copy the template sample figures, their faces, hair, bodies, or stock finish as the art style.",
      "Use subject identity references (reference image 2 and onward) as the authoritative art-style source for character rendering."
    );
  } else {
    lines.push(
      "Each numbered reference image maps 1:1 to exactly one listed subject. Do not reuse a photo for anyone else."
    );
  }
  if (multiSubject) {
    lines.push(
      "When multiple subject references differ stylistically, converge on one coherent finish derived from those references — never replace reference-derived style with a generic polished default.",
      "When converging finish, preserve each subject's immutable identity traits from their SUBJECT identity block (iris, pupil, hair, face marks) — do not average or drop them."
    );
  } else if (subjectCount === 1) {
    lines.push(
      "Match the listed subject reference rendering as closely as possible. Do not substitute a generic polished illustration look."
    );
  }
  return lines.join("\n");
}

export function renderChatImageIdentityContract(opts: {
  hasTemplate: boolean;
}): string {
  const templateRule = opts.hasTemplate
    ? [
        "REFERENCE 1 is the layout / composition / decoration template ONLY.",
        "It is NEVER a character identity source.",
        "Do not copy hair, eyes, iris, pupils, clothes, or face from the template onto any subject.",
      ].join(" ")
    : "";

  return [
    "IDENTITY OWNERSHIP IS STRICT.",
    templateRule,
    "Each subject owns only the visual traits from their own identity block and own reference.",
    "NEVER transfer between subjects: hair color, haircut, bangs, hair part, center part / 5:5 part, eye color, iris color, pupil color, pupil shape, heterochromia, facial marks, scars, tattoos, accessories, body traits, or signature clothes.",
    "Do not average or homogenize identities even when both subjects look similar.",
    "Do not assume that a visually striking feature belongs to every person.",
    "A trait appearing in one subject's reference is NOT a global identity property for other subjects.",
    "Pupil, iris, and overall eye color are distinct traits. Keep each color on the subject that owns it.",
    "Negative identity constraints are authoritative and belong only to the named subject. Do not drop or invert them.",
    "A healed, non-graphic scar that is explicitly part of a subject's saved stable identity or own identity reference may be preserved. Do not invent new scars from scene text or another subject.",
    "IDENTITY may NOT be harmonized globally. Style rendering follows the STYLE FIDELITY contract above.",
    "Template or another person's appearance must never be treated as an identity source.",
    "PRIORITY: 1) explicit generation product option (pose, expression, temporary costume/prop); 2) this subject's stable saved identity only when IMAGE_PLUS_SAVED; 3) this subject's own reference image; 4) template layout/composition only when a template is present.",
    "Product options may add a temporary prop or costume. They must not rewrite hair color, eye/iris/pupil color, or face identity.",
  ]
    .filter(Boolean)
    .join("\n");
}

export function renderChatImageVisualIdentity(opts: {
  subjects: readonly ChatImageVisualSubject[];
  hasTemplate: boolean;
}): string {
  const referencedSubjects = opts.subjects.filter(
    (subject) => subject.referenceIndex != null
  ).length;
  const traitIsolation = renderCrossSubjectTraitIsolation(opts.subjects);
  const relativeStature = renderCrossSubjectRelativeStature(opts.subjects);
  return [
    "SUBJECT IDENTITY MANIFEST — each person is an independent identity owner.",
    ...opts.subjects.map((subject, index) =>
      renderChatImageSubjectManifest(subject, index)
    ),
    renderChatImageStyleFidelityContract({
      hasTemplate: opts.hasTemplate,
      subjectCount: referencedSubjects,
    }),
    renderChatImageIdentityContract({ hasTemplate: opts.hasTemplate }),
    traitIsolation,
    relativeStature,
  ]
    .filter(Boolean)
    .join("\n\n");
}

export function describeReferenceOrder(
  pack: {
    referenceUrls: readonly string[];
    subjects: readonly ChatImageVisualSubject[];
    templateUrl?: string | null;
  }
): Array<{ image: number; url: string; owner: string }> {
  return pack.referenceUrls.map((url, index) => {
    const image = index + 1;
    if (pack.templateUrl && url === pack.templateUrl && image === 1) {
      return { image, url, owner: "template / composition only" };
    }
    const subject = pack.subjects.find(
      (item) => item.referenceIndex === image && item.referenceImageUrl === url
    );
    return {
      image,
      url,
      owner: subject ? `${subject.role}: ${subject.name}` : "unmapped",
    };
  });
}
