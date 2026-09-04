import {
  buildImageGenderLockPrompt,
  type ImagePromptGender,
} from "@/lib/chatImageGeneration";
import {
  buildChatImagePairGenderLock,
  genderWordForImagePrompt,
} from "@/lib/chatImageGender";
import {
  bindApprovedCastManifest,
  renderApprovedCastManifest,
  renderCastGenderLock,
  type ChatImageCastGroundedManifest,
} from "@/lib/chatImageCastManifest";
import type { ScenePlan } from "@/lib/chatImageScenePlan";
import {
  resolveScenePresentationVisibility,
} from "@/lib/chatImageScenePlan";
import {
  formatApprovedScenePlanForSafeImageGeneration,
  projectSceneBlockForSafeImageGeneration,
  projectSceneTextForSafeImageGeneration,
  type SafeVisualProjectionContext,
} from "@/lib/chatImageSafeVisualProjection";
import {
  buildIllustrationSafeDepiction,
  sanitizeChatTurnForIllustrationPrompt,
} from "@/lib/chatImageIllustrationSanitizer";
import type { ContentKind } from "@/lib/simulationMode";
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

export { sanitizeChatTurnForIllustrationPrompt } from "@/lib/chatImageIllustrationSanitizer";
export {
  ADULT_GROUNDED_NON_EXPLICIT_ALLOWANCE,
  BASE_IMAGE_SAFE_DEPICTION,
  buildIllustrationSafeDepiction,
  ILLUSTRATION_SAFE_DEPICTION,
} from "@/lib/chatImageIllustrationSanitizer";

/**
 * @deprecated Import buildIllustrationSafeDepiction — kept for backward compatibility.
 */
export { ILLUSTRATION_SAFE_DEPICTION as ILLUSTRATION_SAFETY_LEGACY } from "@/lib/chatImageIllustrationSanitizer";

/** Map upstream OpenAI Images failures to a generic product message (final failure only). */
export function formatOpenAiImageUserError(_message?: string): string {
  return "이미지를 생성하지 못했습니다. 장면을 조금 바꿔 다시 시도해 주세요.";
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
  return `${index + 1}. ${name} (${member.role}). Gender: confirmed ${gender}.${aliasText}`;
}

export function buildTrpgIllustrationSituation(opts: {
  location?: string;
  actions?: ReadonlyArray<{ name: string; body: string }>;
  narration: string;
  adultGrounded?: boolean;
}): string {
  const projectionContext: SafeVisualProjectionContext = {
    adultGrounded: opts.adultGrounded ?? false,
  };
  const lines: string[] = [];
  const location = String(opts.location ?? "").trim();
  if (location) lines.push(`LOCATION: ${location}`);
  const actions = (opts.actions ?? []).filter((action) => action.body.trim());
  if (actions.length > 0) {
    lines.push("THIS ROUND'S ACTIONS (what each listed person just did — depict these poses/actions):");
    for (const action of actions) {
      const name = action.name.trim() || "player";
      const body = projectSceneTextForSafeImageGeneration(action.body, projectionContext).text.slice(0, 400);
      if (!body) continue;
      lines.push(`- ${name}: ${body}`);
    }
  }
  lines.push("GM SCENE:");
  lines.push(
    projectSceneBlockForSafeImageGeneration(opts.narration, projectionContext).text.slice(0, 1_800)
  );
  return lines.join("\n");
}

function buildPartyIllustrationPrompt(opts: {
  cast: readonly ChatLdIllustrationCastMember[];
  situation: string;
  subjects?: readonly ChatImageVisualSubject[];
  adultGrounded?: boolean;
}): string {
  const count = opts.cast.length;
  const subjects = opts.subjects?.length
    ? [...opts.subjects]
    : visualSubjectsFromCastMembers(opts.cast);
  return [
    "Create one polished vertical 2:3 Korean character illustration, not a comic page.",
    `This is a TRPG party group illustration. Show ALL ${count} listed ${peopleWord(count)} together in a single scene. Count the people: ${count}. Do not omit anyone.`,
    "CAST (roster — every listed person must appear):",
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
    buildIllustrationSafeDepiction({ adultGrounded: opts.adultGrounded ?? false }),
    "Depict the selected scene brief below as one cinematic, emotionally accurate group scene. If ROUND ACTIONS are listed, pose each named person according to their own action. Use LOCATION as the background.",
    "Match the drawing style, line quality, coloring, facial design, and overall finish of the supplied character references as closely as possible. If the references differ, keep one coherent polished style.",
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
  /** Approved Scene Plan text. Regular chat Scene Builder uses this instead of raw turn prose. */
  approvedScene?: string;
  /** When true, explicit adult source may use non-explicit adult intimacy projection. */
  adultGrounded?: boolean;
  /** When set (TRPG party), every listed person must appear — not just the 1:1 duo. */
  cast?: readonly ChatLdIllustrationCastMember[];
  /** Pre-formatted TRPG situation (location, round actions, GM scene). */
  situation?: string;
  subjects?: readonly ChatImageVisualSubject[];
}) {
  const projectionContext: SafeVisualProjectionContext = {
    adultGrounded: opts.adultGrounded ?? false,
  };
  if (opts.cast && opts.cast.length > 0) {
    return buildPartyIllustrationPrompt({
      cast: opts.cast,
      situation:
        opts.situation?.trim() ||
        projectSceneBlockForSafeImageGeneration(opts.currentTurn, projectionContext).text,
      subjects: opts.subjects,
      adultGrounded: opts.adultGrounded,
    });
  }
  const approved = String(opts.approvedScene ?? "").trim();
  const sceneBlock = approved
    ? ["APPROVED SCENE PLAN", approved]
    : [
        "SELECTED TURN SCENE BRIEF:",
        projectSceneBlockForSafeImageGeneration(opts.currentTurn, projectionContext).text,
      ];
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
    buildIllustrationSafeDepiction({ adultGrounded: opts.adultGrounded ?? false }),
    "Depict the approved scene plan below as one cinematic, emotionally accurate scene.",
    "Match the drawing style, line quality, coloring, facial design, and overall finish of the supplied character references as closely as possible. If the two references differ, keep one coherent polished style.",
    "Use natural body language, facial expressions, camera framing, props, lighting, and background that accurately express the setting, atmosphere, and actions.",
    "Key dialogue lines are for emotion and acting only. Do not render speech bubbles, captions, subtitles, or readable dialogue text in the illustration.",
    "Show exactly these two people. Do not add extra people, duplicates, split panels, borders, speech bubbles, captions, sound effects, signatures, logos, or watermarks.",
    "Compose for a vertical 2:3 profile-friendly illustration around 800 by 1200 pixels. Keep important faces and gestures away from the outer crop edges.",
    "",
    ...sceneBlock,
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
  approvedScene?: string;
  adultGrounded?: boolean;
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
      approvedScene: opts.approvedScene,
      adultGrounded: opts.adultGrounded,
      subjects: pack.subjects,
    }),
  };
}

export function buildLdSceneGenerationPlan(opts: {
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
  approvedScenePlan?: ScenePlan;
  approvedScene?: string;
  castManifest?: ChatImageCastGroundedManifest | null;
  contentKind?: ContentKind;
  adultGrounded?: boolean;
}) {
  const projectionContext: SafeVisualProjectionContext = {
    adultGrounded: opts.adultGrounded ?? false,
  };
  const approvedScene =
    opts.approvedScene ??
    (opts.approvedScenePlan
      ? formatApprovedScenePlanForSafeImageGeneration(
          opts.approvedScenePlan,
          resolveScenePresentationVisibility({
            contentKind: opts.contentKind,
            castManifest: opts.castManifest,
          }),
          projectionContext
        ).formatted
      : "");
  const useCast = Boolean(opts.castManifest);
  if (useCast) {
    const bound = bindApprovedCastManifest(opts.castManifest!, {
      contentKind: opts.contentKind,
    });
    const selected = bound.selected;
    const prompt = [
      "Create one polished vertical 2:3 Korean character illustration, not a comic page.",
      renderApprovedCastManifest({
        manifest: opts.castManifest!,
        selected,
        subjects: bound.subjects,
        plan: opts.approvedScenePlan,
        contentKind: opts.contentKind,
      }),
      renderChatImageVisualIdentity({
        subjects: bound.subjects,
        hasTemplate: false,
      }),
      renderCastGenderLock(bound.subjects),
      buildIllustrationSafeDepiction({ adultGrounded: opts.adultGrounded ?? false }),
      "Depict the approved scene plan below as one cinematic scene.",
      "Match the drawing style of the supplied identity references. Harmonize style, not identity.",
      "Key dialogue lines are for emotion and acting only. Do not render speech bubbles, captions, subtitles, or readable dialogue text in the illustration.",
      selected.length === 1
        ? "Show exactly this one selected person. Do not add extras, duplicates, split panels, borders, speech bubbles, captions, sound effects, signatures, logos, or watermarks."
        : selected.length <= 3
          ? `Show exactly these ${selected.length} people. Do not add extras, duplicates, split panels, borders, speech bubbles, captions, sound effects, signatures, logos, or watermarks.`
          : "Show exactly these four selected people. Do not add unnamed extras. Background/cameo people may be smaller, but do not invent a new identity.",
      "Compose for a vertical 2:3 profile-friendly illustration around 800 by 1200 pixels. Keep important faces and gestures away from the outer crop edges.",
      "",
      approvedScene ? ["APPROVED SCENE PLAN", approvedScene].join("\n") : "",
    ]
      .filter(Boolean)
      .join("\n");
    return {
      subjects: bound.subjects,
      referenceUrls: bound.referenceUrls,
      prompt,
    };
  }
  return buildLdDuoGenerationPlan({
    characterName: opts.characterName,
    characterGender: opts.characterGender,
    personaName: opts.personaName,
    personaGender: opts.personaGender,
    characterImageUrl: opts.characterImageUrl,
    characterSavedAppearance: opts.characterSavedAppearance,
    characterAppearanceMode: opts.characterAppearanceMode,
    personaImageUrl: opts.personaImageUrl,
    personaSavedAppearance: opts.personaSavedAppearance,
    personaAppearanceMode: opts.personaAppearanceMode,
    currentTurn: "",
    approvedScene,
    adultGrounded: opts.adultGrounded,
  });
}
