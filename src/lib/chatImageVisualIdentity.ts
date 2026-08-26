import type { ImagePromptGender } from "@/lib/chatImageGeneration";

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

const APPEARANCE_SIGNAL =
  /(?:외모|외형|생김새|인상|머리|헤어|앞머리|가르마|반가르마|중앙가르마|사이드\s*파트|묶은\s*머리|장발|단발|짧은\s*머리|머리색|금발|은발|흑발|갈색머리|적발|5\s*:\s*5|눈|눈동자|동공|홍채|벽안|적안|금안|녹안|오드아이|키|신장|체격|체형|피부|얼굴|흉터|문신|점|안경|귀걸이|피어싱|액세서리|장신구|복장|의상|옷|셔츠|교복|정장|드레스|하네스|재킷|후드|코트|유니폼|날개|뿔|귀|꼬리|appearance|hair(?:cut|style|color)?|bangs?|fringe|center[-\s]?part|side[-\s]?part|iris(?:es)?|pupils?|heterochromia|eyes?|height|build|skin|face|scar|tattoo|mole|piercing|accessor(?:y|ies)|outfit|clothes?|clothing|shirt|harness|jacket|hoodie|coat|uniform|suit)/i;

const SUBJECT_LETTERS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";

function assertNever(value: never): never {
  throw new Error(`Unhandled visual-identity variant: ${String(value)}`);
}

export function isChatImageAppearanceMode(
  value: unknown
): value is ChatImageAppearanceMode {
  return value === "image_only" || value === "image_plus_saved";
}

export function sanitizeChatImageAppearanceMode(
  raw: unknown,
  fallback: ChatImageAppearanceMode
): ChatImageAppearanceMode {
  return isChatImageAppearanceMode(raw) ? raw : fallback;
}

export function extractVisualAppearance(source: unknown): string {
  const normalized = String(source ?? "")
    .replace(/\r\n?/g, "\n")
    .replace(/[ \t]+/g, " ")
    .trim();
  if (!normalized) return "";

  const segments = normalized
    .split(/\n+|(?<=[.!?。！？])\s+/)
    .map((segment) => segment.trim())
    .filter((segment) => segment && APPEARANCE_SIGNAL.test(segment));
  return segments.join("\n").slice(0, CHAT_IMAGE_VISUAL_APPEARANCE_EXTRACT_MAX).trim();
}

export function resolveCharacterSavedAppearance(opts: {
  appearanceRaw?: string | null;
  appearanceSection?: string | null;
}): string {
  const raw =
    String(opts.appearanceRaw ?? "").trim() ||
    String(opts.appearanceSection ?? "").trim();
  return extractVisualAppearance(raw);
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
  switch (input.sourceKind) {
    case "unknown":
    case "image_only":
      return "image_only";
    case "main_character":
    case "persona":
      return input.isPrimaryImage ? "image_plus_saved" : "image_only";
    case "cast_member":
      if (input.hasOwnReference && !input.isPrimaryImage) return "image_only";
      return input.hasOwnSavedAppearance ? "image_plus_saved" : "image_only";
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
  if (isChatImageAppearanceMode(input.override)) return input.override;
  return defaultAppearanceMode(input);
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
      savedAppearance: clipSavedAppearanceForPrompt(opts.characterSavedAppearance),
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
      savedAppearance: clipSavedAppearanceForPrompt(opts.personaSavedAppearance),
      sourceKind: "persona",
    },
  ];
}

export function subjectByKey(
  subjects: readonly ChatImageVisualSubject[],
  key: string
): ChatImageVisualSubject | undefined {
  return subjects.find((subject) => subject.key === key);
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

export function referenceUrlsFromSubjects(
  subjects: readonly ChatImageVisualSubject[]
): string[] {
  return subjects
    .filter(
      (subject) =>
        subject.referenceIndex != null && String(subject.referenceImageUrl ?? "").trim()
    )
    .sort((a, b) => (a.referenceIndex ?? 0) - (b.referenceIndex ?? 0))
    .map((subject) => String(subject.referenceImageUrl).trim());
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
    const savedAppearance = clipSavedAppearanceForPrompt(member.appearanceNote);
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
    .map((line) => `- ${line}`)
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
  const reference =
    subject.referenceIndex != null
      ? `Reference: Image ${subject.referenceIndex} belongs ONLY to ${name}.`
      : `Reference: No photo for ${name}. Do not borrow another subject's reference or face.`;
  const mode =
    subject.appearanceMode === "image_plus_saved"
      ? "Appearance mode: IMAGE_PLUS_SAVED"
      : "Appearance mode: IMAGE_ONLY";
  const saved = clipSavedAppearanceForPrompt(subject.savedAppearance);
  const appearanceBlock =
    subject.appearanceMode === "image_plus_saved" && saved
      ? [
          "Saved visual identity (this subject only):",
          formatSavedAppearanceLines(saved),
          "Saved stable identity traits (hair, eyes, iris, pupils, face, scars, skin, body, species marks) are authoritative for this subject.",
          "For temporary clothing/outfit, prefer this subject's selected reference image when it clearly shows a different current outfit.",
        ].join("\n")
      : [
          "No supplemental saved appearance.",
          "Use this selected reference as the authoritative visual identity for this subject only.",
        ].join("\n");
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
    "NEVER transfer between subjects: hair color, haircut, bangs, hair part, center part / 5:5 part, eye color, iris color, pupil color, heterochromia, facial marks, scars, tattoos, accessories, body traits, or signature clothes.",
    "Do not average or homogenize identities even when both subjects look similar.",
    "Do not assume that a visually striking feature belongs to every person.",
    "A trait appearing in one subject's reference is NOT a global style property.",
    "Pupil, iris, and overall eye color are distinct traits. Keep each color on the subject that owns it.",
    "Negative identity constraints are authoritative and belong only to the named subject. Do not drop or invert them.",
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
