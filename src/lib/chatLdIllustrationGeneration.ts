import {
  buildImageGenderLockPrompt,
  type ImagePromptGender,
} from "@/lib/chatImageGeneration";
import { buildChatImagePairGenderLock } from "@/lib/chatImageGender";

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
};

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

function buildPartyIllustrationPrompt(opts: {
  cast: readonly ChatLdIllustrationCastMember[];
  currentTurn: string;
}): string {
  const turn = sanitizeChatTurnForIllustrationPrompt(opts.currentTurn);
  const count = opts.cast.length;
  const castLines = opts.cast.map((member, index) => {
    const name = member.name.trim() || `person ${index + 1}`;
    const ref =
      member.referenceIndex != null
        ? `Reference image ${member.referenceIndex} is the identity and art-style reference for ${name}.`
        : `No photo for ${name}. Still draw this person using the name, gender lock, and appearance notes. Do not substitute another referenced face.`;
    const note = member.appearanceNote?.trim()
      ? ` Appearance: ${member.appearanceNote.trim()}`
      : "";
    return `${index + 1}. ${name} (${member.role}). ${ref}${note}`;
  });
  return [
    "Create one polished vertical 2:3 Korean character illustration, not a comic page.",
    `This is a TRPG party group illustration. Show ALL ${count} listed ${peopleWord(count)} together in a single scene. Count the people: ${count}. Do not omit anyone.`,
    "CAST (mandatory — every person below must be clearly visible):",
    ...castLines,
    buildImageGenderLockPrompt(
      opts.cast.map((member) => ({
        label: member.role,
        name: member.name.trim() || member.role,
        gender: member.gender,
      }))
    ),
    ILLUSTRATION_SAFETY,
    "Depict the selected scene brief below as one cinematic, emotionally accurate group scene.",
    "Keep every identity clearly separate and highly recognizable. Preserve each person's face, hairstyle, hair color, eye color, body impression, outfit details, accessories, and distinguishing traits.",
    "Match the drawing style, line quality, coloring, facial design, and overall finish of the supplied character references as closely as possible. If the references differ, harmonize them into one coherent polished style without changing any identity.",
    "Use natural body language, facial expressions, camera framing, props, lighting, and background that accurately express the setting, atmosphere, and actions.",
    "Key dialogue lines are for emotion and acting only. Do not render speech bubbles, captions, subtitles, or readable dialogue text in the illustration.",
    `Show exactly these ${count} ${peopleWord(count)}. Do not add extra people, duplicates, split panels, borders, speech bubbles, captions, sound effects, signatures, logos, or watermarks.`,
    "Compose a group shot so every listed face is clearly visible. Prefer a mid-shot or full-body arrangement. Do not hide a listed person behind another, off-canvas, or as a tiny background extra.",
    "Compose for a vertical 2:3 profile-friendly illustration around 800 by 1200 pixels. Keep important faces and gestures away from the outer crop edges.",
    "",
    "SELECTED TURN SCENE BRIEF:",
    turn,
  ].join("\n");
}

export function buildChatLdIllustrationPrompt(opts: {
  characterName: string;
  characterGender: ImagePromptGender;
  personaName: string;
  personaGender: ImagePromptGender;
  currentTurn: string;
  /** When set (TRPG party), every listed person must appear — not just the 1:1 duo. */
  cast?: readonly ChatLdIllustrationCastMember[];
}) {
  if (opts.cast && opts.cast.length > 0) {
    return buildPartyIllustrationPrompt({
      cast: opts.cast,
      currentTurn: opts.currentTurn,
    });
  }
  const turn = sanitizeChatTurnForIllustrationPrompt(opts.currentTurn);
  return [
    "Create one polished vertical 2:3 Korean character illustration, not a comic page.",
    `Reference image 1 is the identity and art-style reference for ${opts.characterName}, the chat character.`,
    `Reference image 2 is the identity and art-style reference for ${opts.personaName}, the user persona.`,
    buildChatImagePairGenderLock({
      characterName: opts.characterName,
      characterGender: opts.characterGender,
      personaName: opts.personaName,
      personaGender: opts.personaGender,
    }),
    ILLUSTRATION_SAFETY,
    "Depict the selected chat-turn scene brief below as one cinematic, emotionally accurate scene.",
    "Keep both identities clearly separate and highly recognizable. Preserve each person's face, hairstyle, hair color, eye color, body impression, outfit details, accessories, and distinguishing traits.",
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
