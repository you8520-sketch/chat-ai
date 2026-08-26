import {
  buildImageGenderLockPrompt,
  type ImagePromptGender,
} from "@/lib/chatImageGeneration";
import {
  buildChatImagePairGenderLock,
  genderWordForImagePrompt,
} from "@/lib/chatImageGender";
import {
  bindChatImageReferencePack,
  buildChatDuoVisualSubjects,
  renderChatImageVisualIdentity,
  visualSubjectsFromCastMembers,
  type ChatImageAppearanceMode,
  type ChatImageVisualSubject,
} from "@/lib/chatImageVisualIdentity";

export const CHAT_LD_ILLUSTRATION_TEMPLATE_ID = "current_turn_ld_illustration" as const;
export const CHAT_LD_ILLUSTRATION_TEMPLATE_NAME = "현재 턴 2:3 LD 일러스트";
export const CHAT_LD_ILLUSTRATION_OUTPUT_SIZE = "800x1200" as const;
export const CHAT_LD_ILLUSTRATION_QUALITY = "medium" as const;
/**
 * Flat 200P for 1:1 and TRPG party shots alike.
 * Extra party members only add cheap GPT Image 2 *input* image tokens;
 * the billed output is still one 800×1200 medium image. Do not scale by headcount.
 */
export const CHAT_LD_ILLUSTRATION_DEFAULT_POINTS = 200;

export function resolveChatLdIllustrationPrice(
  env: NodeJS.ProcessEnv = process.env
): number {
  const override = Number(env.CHAT_LD_ILLUSTRATION_POINTS);
  if (Number.isFinite(override) && override >= 1) return Math.ceil(override);
  return CHAT_LD_ILLUSTRATION_DEFAULT_POINTS;
}

/**
 * Soften RP hyperbole / metaphors that frequently false-trigger OpenAI Images
 * `safety_violations=[self-harm]` on ordinary conversation scenes.
 */
export function sanitizeChatTurnForIllustrationPrompt(raw: string): string {
  let text = String(raw ?? "");
  text = text
    .replace(/<<<STATUS_VALUES[\s\S]*?>>>/gi, " ")
    .replace(/<<<STATUS[\s\S]*?>>>/gi, " ")
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<[^>]+>/g, " ");

  const replacements: Array<[RegExp, string]> = [
    [/자해/g, "괴로움"],
    [/자살/g, "절망"],
    [/목을\s*조/g, "목을 감싸"],
    [/목을\s*졸/g, "목을 감싸"],
    [/손목을\s*긋/g, "손을 움켜쥐"],
    [/손목을\s*그어/g, "손을 움켜쥐"],
    [/손목에\s*칼/g, "손에"],
    [/손목/g, "손"],
    [/피를\s*흘리/g, "눈물을 흘리"],
    [/피범벅/g, "땀범벅"],
    [/피투성이/g, "땀투성이"],
    [/칼날/g, "날카로운 시선"],
    [/흉터/g, "흔적"],
    [/상처\s*입은/g, "마음 아픈"],
    [/마음의\s*상처/g, "마음의 아픔"],
    [/죽을\s*것\s*같/g, "너무 벅찬 것 같"],
    [/죽을\s*만큼/g, "미칠 만큼"],
    [/심장이\s*멎/g, "심장이 두근"],
    [/self[-\s]?harm/gi, "distress"],
    [/\bsuicide\b/gi, "despair"],
    [/\bblood(?:y)?\b/gi, "blush"],
    [/\bscar(?:s)?\b/gi, "mark"],
    [/\bslit\b/gi, "line"],
    [/\bwrist(?:s)?\b/gi, "hand"],
  ];
  for (const [pattern, replacement] of replacements) {
    text = text.replace(pattern, replacement);
  }

  return text.replace(/\s+/g, " ").trim().slice(0, 2_500);
}

/** Map upstream OpenAI Images safety rejections to a clearer Korean retry hint. */
export function formatOpenAiImageUserError(message: string): string {
  const raw = String(message ?? "").trim();
  if (/safety_violations\s*=\s*\[[^\]]*self-harm/i.test(raw) || /self-harm/i.test(raw)) {
    return "이미지 안전 필터가 장면 묘사를 오해해 거절했습니다. 상처·피·손목·자해 비유 표현을 순화한 뒤 다시 시도해 주세요.";
  }
  if (/rejected by the safety system/i.test(raw)) {
    return "이미지 안전 필터에 의해 거절되었습니다. 장면 표현을 순화한 뒤 다시 시도해 주세요.";
  }
  return raw || "이미지 생성에 실패했습니다.";
}

export type ChatLdIllustrationCastMember = {
  name: string;
  gender: ImagePromptGender;
  role: string;
  /** 1-based reference image index, or null when this person has no photo. */
  referenceIndex: number | null;
  appearanceNote?: string;
  aliases?: string[];
  appearanceMode?: ChatImageAppearanceMode;
  imageUrl?: string | null;
  isPrimaryImage?: boolean;
};

export function uniqueIllustrationAliases(
  primary: string,
  ...extras: Array<string | null | undefined>
): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  const push = (value: string | null | undefined) => {
    const name = String(value ?? "").trim();
    if (!name || seen.has(name)) return;
    seen.add(name);
    out.push(name);
    if (/^[가-힣]{3,4}$/.test(name)) {
      const short = name.slice(1);
      if (short && !seen.has(short)) {
        seen.add(short);
        out.push(short);
      }
    }
  };
  push(primary);
  for (const extra of extras) push(extra);
  return out.filter((name) => name !== primary);
}

export function withIllustrationReferenceIndices<T extends { imageUrl: string | null | undefined }>(
  members: readonly T[]
): Array<T & { referenceIndex: number | null }> {
  let next = 1;
  return members.map((member) => {
    const url = String(member.imageUrl ?? "").trim();
    if (!url) return { ...member, referenceIndex: null };
    const referenceIndex = next;
    next += 1;
    return { ...member, referenceIndex };
  });
}

const ILLUSTRATION_SAFETY =
  "SAFETY — depict a wholesome conversation / meeting scene only. Do not depict injury, blood, wounds, scars, weapons, self-harm, suicide, hanging, cutting, or medical trauma even if metaphorical language appears in the turn text.";

function peopleWord(count: number): string {
  return count === 1 ? "person" : "people";
}

function formatCastLine(member: ChatLdIllustrationCastMember, index: number): string {
  const name = member.name.trim() || `person ${index + 1}`;
  const gender = genderWordForImagePrompt(member.gender);
  const aliases = (member.aliases ?? [])
    .map((alias) => alias.trim())
    .filter((alias) => alias && alias !== name);
  const aliasText = aliases.length ? ` Also known as: ${aliases.join(", ")}.` : "";
  const ref =
    member.referenceIndex != null
      ? ` Reference image ${member.referenceIndex} is the identity photo for ${name} only. Do not apply this photo to anyone else.`
      : ` No photo for ${name}. Do not substitute another referenced face.`;
  return `${index + 1}. ${name} (${member.role}). Gender: confirmed ${gender}.${aliasText}${ref}`;
}

export function buildTrpgIllustrationSituation(opts: {
  location?: string;
  actions?: ReadonlyArray<{ name: string; body: string }>;
  narration: string;
}): string {
  const lines: string[] = [];
  const location = String(opts.location ?? "").trim();
  if (location) lines.push(`LOCATION: ${location}`);
  const actions = (opts.actions ?? []).filter((action) => action.body.trim());
  if (actions.length > 0) {
    lines.push("THIS ROUND'S ACTIONS (what each listed person just did — depict these poses/actions):");
    for (const action of actions) {
      const name = action.name.trim() || "player";
      const body = sanitizeChatTurnForIllustrationPrompt(action.body).slice(0, 400);
      if (!body) continue;
      lines.push(`- ${name}: ${body}`);
    }
  }
  lines.push("GM SCENE:");
  lines.push(sanitizeChatTurnForIllustrationPrompt(opts.narration).slice(0, 1_800));
  return lines.join("\n");
}

function buildPartyIllustrationPrompt(opts: {
  cast: readonly ChatLdIllustrationCastMember[];
  situation: string;
  subjects?: readonly ChatImageVisualSubject[];
}): string {
  const count = opts.cast.length;
  const subjects = opts.subjects?.length
    ? [...opts.subjects]
    : visualSubjectsFromCastMembers(opts.cast);
  return [
    "Create one polished vertical 2:3 Korean character illustration, not a comic page.",
    `This is a TRPG party group illustration. Show ALL ${count} listed ${peopleWord(count)} together in a single scene. Count the people: ${count}. Do not omit anyone.`,
    "CAST (mandatory identity — match each person exactly; do not swap faces, hair, outfits, or genders):",
    ...opts.cast.map((member, index) => formatCastLine(member, index)),
    renderChatImageVisualIdentity({
      subjects,
      hasTemplate: false,
    }),
    buildImageGenderLockPrompt(
      opts.cast.map((member) => ({
        label: member.role,
        name: member.name.trim() || member.role,
        gender: member.gender,
      }))
    ),
    ILLUSTRATION_SAFETY,
    "Depict the selected scene brief below as one cinematic, emotionally accurate group scene. If ROUND ACTIONS are listed, pose each named person according to their own action. Use LOCATION as the background.",
    "Match the drawing style, line quality, coloring, facial design, and overall finish of the supplied character references as closely as possible. If the references differ, harmonize them into one coherent polished style without changing any identity.",
    "Use natural body language, facial expressions, camera framing, props, lighting, and background that accurately express the setting, atmosphere, and actions.",
    "Key dialogue lines are for emotion and acting only. Do not render speech bubbles, captions, subtitles, or readable dialogue text in the illustration.",
    `Show exactly these ${count} ${peopleWord(count)}. Do not add extra people, duplicates, split panels, borders, speech bubbles, captions, sound effects, signatures, logos, or watermarks.`,
    "Compose a group shot so every listed face is clearly visible. Prefer a mid-shot or full-body arrangement. Do not hide a listed person behind another, off-canvas, or as a tiny background extra.",
    "Compose for a vertical 2:3 profile-friendly illustration around 800 by 1200 pixels. Keep important faces and gestures away from the outer crop edges.",
    "",
    "SELECTED TURN SCENE BRIEF:",
    opts.situation,
  ].join("\n");
}

function defaultLdDuoSubjects(opts: {
  characterName: string;
  characterGender: ImagePromptGender;
  personaName: string;
  personaGender: ImagePromptGender;
  subjects?: readonly ChatImageVisualSubject[];
}): ChatImageVisualSubject[] {
  if (opts.subjects?.length) return [...opts.subjects];
  return bindChatImageReferencePack({
    subjectsInImageOrder: buildChatDuoVisualSubjects({
      characterName: opts.characterName,
      characterGender: opts.characterGender,
      characterImageUrl: "/character-ref",
      characterSavedAppearance: "",
      characterAppearanceMode: "image_only",
      personaName: opts.personaName,
      personaGender: opts.personaGender,
      personaImageUrl: "/persona-ref",
      personaSavedAppearance: "",
      personaAppearanceMode: "image_only",
    }),
  }).subjects;
}

export function buildChatLdIllustrationPrompt(opts: {
  characterName: string;
  characterGender: ImagePromptGender;
  personaName: string;
  personaGender: ImagePromptGender;
  currentTurn: string;
  /** When set (TRPG party), every listed person must appear — not just the 1:1 duo. */
  cast?: readonly ChatLdIllustrationCastMember[];
  /** Pre-formatted TRPG situation (location, round actions, GM scene). */
  situation?: string;
  subjects?: readonly ChatImageVisualSubject[];
}) {
  if (opts.cast && opts.cast.length > 0) {
    return buildPartyIllustrationPrompt({
      cast: opts.cast,
      situation:
        opts.situation?.trim() ||
        sanitizeChatTurnForIllustrationPrompt(opts.currentTurn),
      subjects: opts.subjects,
    });
  }
  const turn = sanitizeChatTurnForIllustrationPrompt(opts.currentTurn);
  return [
    "Create one polished vertical 2:3 Korean character illustration, not a comic page.",
    renderChatImageVisualIdentity({
      subjects: defaultLdDuoSubjects(opts),
      hasTemplate: false,
    }),
    buildChatImagePairGenderLock({
      characterName: opts.characterName,
      characterGender: opts.characterGender,
      personaName: opts.personaName,
      personaGender: opts.personaGender,
    }),
    ILLUSTRATION_SAFETY,
    "Depict the selected chat-turn scene brief below as one cinematic, emotionally accurate scene.",
    "Match the drawing style, line quality, coloring, facial design, and overall finish of the supplied character references as closely as possible. If the two references differ, harmonize them into one coherent polished style without changing either identity.",
    "Use natural body language, facial expressions, camera framing, props, lighting, and background that accurately express the setting, atmosphere, and actions.",
    "Key dialogue lines are for emotion and acting only. Do not render speech bubbles, captions, subtitles, or readable dialogue text in the illustration.",
    "Show exactly these two people. Do not add extra people, duplicates, split panels, borders, speech bubbles, captions, sound effects, signatures, logos, or watermarks.",
    "Compose for a vertical 2:3 profile-friendly illustration around 800 by 1200 pixels. Keep important faces and gestures away from the outer crop edges.",
    "",
    "SELECTED TURN SCENE BRIEF:",
    turn,
  ].join("\n");
}

export function buildLdDuoGenerationPlan(opts: {
  characterName: string;
  characterGender: ImagePromptGender;
  personaName: string;
  personaGender: ImagePromptGender;
  characterImageUrl: string;
  characterSavedAppearance: string;
  characterAppearanceMode: ChatImageAppearanceMode;
  personaImageUrl: string;
  personaSavedAppearance: string;
  personaAppearanceMode: ChatImageAppearanceMode;
  currentTurn: string;
}) {
  const pack = bindChatImageReferencePack({
    subjectsInImageOrder: buildChatDuoVisualSubjects({
      characterName: opts.characterName,
      characterGender: opts.characterGender,
      characterImageUrl: opts.characterImageUrl,
      characterSavedAppearance: opts.characterSavedAppearance,
      characterAppearanceMode: opts.characterAppearanceMode,
      personaName: opts.personaName,
      personaGender: opts.personaGender,
      personaImageUrl: opts.personaImageUrl,
      personaSavedAppearance: opts.personaSavedAppearance,
      personaAppearanceMode: opts.personaAppearanceMode,
    }),
  });
  return {
    subjects: pack.subjects,
    referenceUrls: pack.referenceUrls,
    prompt: buildChatLdIllustrationPrompt({
      characterName: opts.characterName,
      characterGender: opts.characterGender,
      personaName: opts.personaName,
      personaGender: opts.personaGender,
      currentTurn: opts.currentTurn,
      subjects: pack.subjects,
    }),
  };
}
