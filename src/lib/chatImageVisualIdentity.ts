import type { ImagePromptGender } from "@/lib/chatImageGeneration";
import { normalizeSavedAppearanceForProvider } from "@/lib/chatImageEyeTraits";

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

function clauseLooksVisual(segment: string): boolean {
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
  ldProduct?: "comic" | "illustration" | "persona";
  isTrpgParty?: boolean;
}): ChatImageAppearanceControlProduct {
  if (opts.surface === "sd") {
    if (opts.sdProduct === "emoticon") return "emoticon";
    if (opts.sdProduct === "coupleStamp") return "couple_stamp";
    return "gift";
  }
  if (opts.ldProduct === "persona") return "persona";
  if (opts.ldProduct === "comic") return "comic";
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
    normalizeSavedAppearanceForProvider(subject.savedAppearance ?? "")
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

export function renderChatImageIdentityContract(opts: {
  hasTemplate: boolean;
}): string {
  const templateRule = opts.hasTemplate
    ? [
        "REFERENCE 1 is the layout / composition / decoration template ONLY.",
        "It is NEVER a character identity source.",
        "Do not copy hair, eyes, iris, pupils, clothes, or face from the template onto any subject.",
      ].join(" ")
    : "Each numbered reference image maps 1:1 to exactly one listed subject. Do not reuse a photo for anyone else.";

  return [
    "IDENTITY OWNERSHIP IS STRICT.",
    templateRule,
    "Each subject owns only the visual traits from their own identity block and own reference.",
    "NEVER transfer between subjects: hair color, haircut, bangs, hair part, center part / 5:5 part, eye color, iris color, pupil color, pupil shape, heterochromia, facial marks, scars, tattoos, accessories, body traits, or signature clothes.",
    "Do not average or homogenize identities even when both subjects look similar.",
    "Do not assume that a visually striking feature belongs to every person.",
    "A trait appearing in one subject's reference is NOT a global style property.",
    "Pupil, iris, and overall eye color are distinct traits. Keep each color on the subject that owns it.",
    "Negative identity constraints are authoritative and belong only to the named subject. Do not drop or invert them.",
    "A healed, non-graphic scar that is explicitly part of a subject's saved stable identity or own identity reference may be preserved. Do not invent new scars from scene text or another subject.",
    "STYLE may be harmonized globally. IDENTITY may NOT be harmonized globally.",
    "Unify art style, not identity. Do not average the subjects' physical traits while harmonizing style.",
    "Template or another person's appearance must never be treated as a style characteristic.",
    "PRIORITY: 1) explicit generation product option (pose, expression, temporary costume/prop); 2) this subject's stable saved identity only when IMAGE_PLUS_SAVED; 3) this subject's own reference image; 4) template styling/composition.",
    "Product options may add a temporary prop or costume. They must not rewrite hair color, eye/iris/pupil color, or face identity.",
  ].join("\n");
}

export function renderChatImageVisualIdentity(opts: {
  subjects: readonly ChatImageVisualSubject[];
  hasTemplate: boolean;
}): string {
  return [
    "SUBJECT IDENTITY MANIFEST — each person is an independent identity owner.",
    ...opts.subjects.map((subject, index) =>
      renderChatImageSubjectManifest(subject, index)
    ),
    renderChatImageIdentityContract({ hasTemplate: opts.hasTemplate }),
  ].join("\n\n");
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
