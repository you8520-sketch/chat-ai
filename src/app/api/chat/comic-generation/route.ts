import crypto from "crypto";
import fs from "fs/promises";
import path from "path";
import { NextResponse } from "next/server";
import sharp from "sharp";

import { getSessionUser } from "@/lib/auth";
import { isAdminUser } from "@/lib/isAdminUser";
import { parseAssets, type CharacterAsset } from "@/lib/characterAssets";
import {
  selectCharacterImageUrl,
} from "@/lib/chatCharacterImageSelection";
import { listSelectableCharacterImages, listCastSelectableAssets } from "@/lib/chatCharacterImageSelection.server";
import {
  CHAT_COMIC_MAX_INPUT_CHARS,
  CHAT_COMIC_TEMPLATE_ID,
  assembleComicFinalImage,
  buildChatComicGenerationPlan,
  isComicPanelMode,
  resolveChatComicOutputSize,
  resolveChatComicPrice,
  type ChatComicPanelCount,
} from "@/lib/chatComicGeneration";
import {
  applyComicHighlightStoryboardToPlan,
  buildComicHighlightStoryboard,
  type ComicStoryboard,
} from "@/lib/chatComicHighlightStoryboard";
import {
  CHAT_LD_ILLUSTRATION_OUTPUT_SIZE,
  CHAT_LD_ILLUSTRATION_QUALITY,
  CHAT_LD_ILLUSTRATION_TEMPLATE_ID,
  buildChatLdIllustrationPrompt,
  buildLdDuoGenerationPlan,
  buildLdSceneGenerationPlan,
  buildTrpgIllustrationSituation,
  resolveChatLdIllustrationPrice,
  type ChatLdIllustrationCastMember,
  withIllustrationReferenceIndices,
} from "@/lib/chatLdIllustrationGeneration";
import { extractAppearanceRawFromSetting } from "@/lib/appearanceCompiler";
import {
  CHAT_IMAGE_PARTY_NO_REFERENCE_ERROR,
  buildPartyIllustrationReferencePlan,
  defaultAppearanceMode,
  isPrimarySelectableImage,
  resolveCharacterSavedAppearance,
  resolvePersonaSavedAppearance,
  resolveRequestAppearanceModes,
} from "@/lib/chatImageVisualIdentity";
import {
  applyTrpgCastImagePicks,
  loadTrpgIllustrationScene,
} from "@/lib/trpg/illustrationCast";
import {
  resolveTrpgIllustrationSceneFocus,
  type TrpgAiFocusDiagnostics,
} from "@/lib/trpg/trpgAiFocusSelection";
import {
  buildTrpgImageSceneDiagnosticsPayload,
  resolveTrpgImageSceneDiagnosticsForResponse,
  type TrpgImageSceneDiagnosticsPayload,
} from "@/lib/trpg/trpgImageSceneDiagnosticsLifecycle";
import {
  TRPG_IMAGE_SCENE_MODE_DEFAULT,
  normalizeTrpgImageSceneMode,
  type TrpgImageSceneMode,
} from "@/lib/trpg/trpgImageSceneMode";
import {
  buildDeterministicScenePlan,
  buildSceneSourceMessages,
  formatApprovedScenePlanForIllustration,
  formatSceneSourcePreview,
  isScenePanelCount,
  reflowScenePlanPanels,
  resolveScenePresentationVisibility,
  validateScenePlan,
  type ScenePlan,
  type SceneSourceMessage,
} from "@/lib/chatImageScenePlan";
import { planChatImageScene } from "@/lib/chatImageScenePlanner";
import {
  assertChatImageScenePlanRateLimit,
  ChatImageScenePlanRateLimitError,
  releaseChatImageScenePlanRateLimit,
} from "@/lib/chatImageScenePlanRateLimit";
import { configuredCharacterVisualSubjectNames, parseCharacterVisualSubjectsJson } from "@/lib/characterVisualSubjects";
import { extractSimulationCastNames, parseContentKind, type ContentKind } from "@/lib/simulationMode";
import {
  parseVisualSubjectsJson,
  type VisualSubject,
} from "@/lib/visualSubjects";
import { type SelectableCastAsset } from "@/lib/chatImageCast";
import {
  groundCastIntent,
  parseChatImageCastManifest,
  resolveServerVisualSubjectScope,
  type ChatImageCastGroundedManifest,
} from "@/lib/chatImageCastManifest";
import { stripChatTurnMarkup } from "@/lib/chatImageSceneBrief";
import {
  resolveChatImageGenerationModel,
  type ImagePromptGender,
} from "@/lib/chatImageGeneration";
import { resolveChatImageGenderPair } from "@/lib/chatImageGender";
import {
  finishChatImageGenerationJob,
  hasRunningChatImageGenerationJob,
  startChatImageGenerationJob,
} from "@/lib/chatImageGenerationJobs";
import { settleChatImageGenerationResult } from "@/lib/chatImageGenerationPersistence";
import { getDb } from "@/lib/db";
import { getEffectiveKrwPerUsd } from "@/lib/exchangeRate";
import {
  InsufficientPointsError,
  getPointBalance,
} from "@/lib/points";
import {
  filenameFromUploadUrl,
  resolveExistingUploadPath,
  uploadPublicUrl,
  uploadsDataDir,
} from "@/lib/uploadStorage";
import {
  personaImageBaseUrl,
  sanitizePersonaImageUrl,
} from "@/lib/userPersonasClient";
import {
  OpenAiImageError,
} from "@/lib/openAiImageEdit";
import {
  serializeOpenAiImageFailureDiagnostic,
  type OpenAiImageFailureDiagnostic,
} from "@/lib/openAiImageFailureDiagnostic";
import {
  aggregateKnownProviderCostUsd,
  callOpenAiImageEditWithSafetyFallback,
  formatOpenAiImageFinalUserError,
  formatOpenAiImageProviderAttemptsForAdmin,
  OpenAiImageGenerationError,
  serializeOpenAiImageProviderAttempts,
  toOpenAiImageGeneratedWithAttempts,
  type OpenAiImageGeneratedWithAttempts,
  type OpenAiImageProviderAttemptRecord,
} from "@/lib/openAiImageSafetyFallback";
import {
  formatOpenAiImageUserError,
} from "@/lib/chatLdIllustrationGeneration";
import {
  buildStrictComicFallbackPrompt,
  buildStrictLdDuoFallbackPrompt,
  buildStrictLdPartyFallbackPrompt,
} from "@/lib/chatImageStrictSafetyFallbackPrompt";
import { projectComicSafeStructureForTier2 } from "@/lib/chatComicSafeStructure";
import {
  auditTier2ComicPrompt,
  buildComicReferenceRoleInventory,
  collectTier2RawSourceCandidates,
  formatComicGenerationAdminFailureDiagnostic,
} from "@/lib/chatComicTier2SafetyAudit";
import {
  buildComicProviderReferences,
  buildNeutralComicProviderScenePlan,
  buildNeutralComicSafeStructure,
  formatComicReferenceSetForAdmin,
  isolateComicProviderReferences,
  prepareComicProviderReferenceInput,
  resolveComicDiagnosticOverrides,
  type ComicProviderReference,
  type ComicNormalizedProviderReference,
} from "@/lib/chatComicReferenceIsolation";
import {
  assertComicDiagnosticAxisIsolation,
  buildSemanticLadderSafeStructure,
  buildSemanticLadderScenePlan,
  resolveComicDiagnosticMode,
  resolveComicPrimaryTier2Boundary,
  type ComicDiagnosticMode,
  type ComicTextBoundaryLevel,
} from "@/lib/chatComicDiagnostic";
import { buildComicPanelBalloonSlotMetadata } from "@/lib/chatComicPanelSpec";
import { effectiveIsAdult } from "@/lib/adultVerification";
import {
  resolveEffectiveAdultRp,
  resolveRoomAdultModeEnabled,
} from "@/lib/chatAdultHandoff";

export const runtime = "nodejs";
export const maxDuration = 300;

const MAX_REFERENCE_BYTES = 12 * 1024 * 1024;

type CharacterRow = {
  id: number;
  name: string;
  gender: string | null;
  assets: string;
  images: string;
  creator_id: number | null;
  visibility: string;
  appearance_raw: string | null;
  appearance_compiled: string | null;
  system_prompt: string | null;
  simulation_cast: string | null;
  content_kind: string | null;
  simulation_visual_subjects_json: string | null;
};

type PersonaRow = {
  id: number;
  name: string;
  gender: string | null;
  image_url: string;
  description: string | null;
};

type ChatRow = {
  id: number;
  character_id: number;
  selected_persona_id: number | null;
};

type GenerationContext = {
  chatId: number | null;
  contentKind: ContentKind;
  character: CharacterRow;
  persona: PersonaRow;
  characterGender: ImagePromptGender;
  personaGender: ImagePromptGender;
  characterImageUrl: string;
  personaImageUrl: string;
  characterImages: ReturnType<typeof listSelectableCharacterImages>;
  castSelectableAssets: SelectableCastAsset[];
  characterAssets: CharacterAsset[];
  visualSubjects: VisualSubject[];
  characterSavedAppearance: string;
  personaSavedAppearance: string;
  roomAdultModeEnabled: boolean;
};

type SessionUserLike = { is_adult?: number };

class RequestError extends Error {
  constructor(
    message: string,
    public status = 400,
    public imageFailureDiagnostic?: OpenAiImageFailureDiagnostic,
    public providerAttempts?: OpenAiImageProviderAttemptRecord[]
  ) {
    super(message);
    this.name = "RequestError";
  }
}

function positiveInt(raw: unknown): number | null {
  const value = Number(raw);
  return Number.isInteger(value) && value > 0 ? value : null;
}

function nonNegativeInt(raw: unknown): number | null {
  const value = Number(raw);
  return Number.isInteger(value) && value >= 0 ? value : null;
}

async function abortGeneratedImageAfterSettlementFailure(opts: {
  savedPath: string | null;
  userId: number;
  jobId: number | null;
  logTag: string;
  error: unknown;
  insufficientPoints?: InsufficientPointsError;
  providerAttemptsJson?: string | null;
}): Promise<NextResponse> {
  if (opts.savedPath) await fs.unlink(opts.savedPath).catch(() => {});
  finishChatImageGenerationJob({
    jobId: opts.jobId,
    status: "failed",
    errorMessage: opts.insufficientPoints
      ? "포인트가 부족합니다."
      : "image generation settlement failed",
    providerAttemptsJson: opts.providerAttemptsJson ?? null,
  });
  console.error(`[${opts.logTag}] settlement failed`, opts.error);
  if (opts.insufficientPoints) {
    return NextResponse.json(
      {
        error: `포인트가 부족합니다. ${opts.insufficientPoints.balance.total.toLocaleString()}P 보유 중입니다.`,
        remainingPoints: opts.insufficientPoints.balance.total,
        paidPoints: opts.insufficientPoints.balance.paid,
        freePoints: opts.insufficientPoints.balance.free,
      },
      { status: 402 }
    );
  }
  const balance = getPointBalance(opts.userId);
  return NextResponse.json(
    {
      error: "이미지 저장을 완료하지 못했습니다. 포인트는 차감되지 않았습니다.",
      remainingPoints: balance.total,
      paidPoints: balance.paid,
      freePoints: balance.free,
    },
    { status: 500 }
  );
}

function resolveGenerationContext(opts: {
  userId: number;
  userAdultVerified: boolean;
  characterId: number | null;
  chatId: number | null;
  personaId: number | null;
  requestedCharacterImageUrl?: unknown;
}): GenerationContext {
  const db = getDb();
  let characterId = opts.characterId;
  let selectedPersonaId = opts.personaId;
  let chatId: number | null = null;
  let roomAdultModeEnabled = false;

  if (opts.chatId) {
    const chat = db
      .prepare(
        "SELECT id, character_id, selected_persona_id, COALESCE(adult_handoff_enabled, 0) AS adult_handoff_enabled FROM chats WHERE id=? AND user_id=?"
      )
      .get(opts.chatId, opts.userId) as
      | (ChatRow & { adult_handoff_enabled: number | boolean })
      | undefined;
    if (!chat) throw new RequestError("채팅방을 찾을 수 없습니다.", 404);
    chatId = chat.id;
    characterId = chat.character_id;
    selectedPersonaId = chat.selected_persona_id ?? selectedPersonaId;
    roomAdultModeEnabled = resolveRoomAdultModeEnabled({
      persisted: chat.adult_handoff_enabled,
      userAdultVerified: opts.userAdultVerified,
    });
  }

  if (!characterId) throw new RequestError("캐릭터 정보가 없습니다.");
  const character = db
    .prepare(
      "SELECT id, name, gender, assets, images, creator_id, visibility, COALESCE(appearance_raw, '') AS appearance_raw, COALESCE(appearance_compiled, '') AS appearance_compiled, COALESCE(system_prompt, '') AS system_prompt, COALESCE(simulation_cast, '') AS simulation_cast, COALESCE(content_kind, 'character') AS content_kind, COALESCE(simulation_visual_subjects_json, '') AS simulation_visual_subjects_json FROM characters WHERE id=?"
    )
    .get(characterId) as CharacterRow | undefined;
  if (!character) throw new RequestError("캐릭터를 찾을 수 없습니다.", 404);
  if (character.visibility === "private" && character.creator_id !== opts.userId) {
    throw new RequestError("캐릭터를 찾을 수 없습니다.", 404);
  }

  let persona: PersonaRow | undefined;
  if (selectedPersonaId) {
    persona = db
      .prepare(
        "SELECT id, name, gender, image_url, description FROM user_personas WHERE id=? AND user_id=?"
      )
      .get(selectedPersonaId, opts.userId) as PersonaRow | undefined;
  }
  if (!persona) {
    persona = db
      .prepare(
        "SELECT id, name, gender, image_url, description FROM user_personas WHERE user_id=? ORDER BY created_at ASC, id ASC LIMIT 1"
      )
      .get(opts.userId) as PersonaRow | undefined;
  }
  if (!persona) throw new RequestError("유저 페르소나가 필요합니다.");

  const personaImageUrl = personaImageBaseUrl(sanitizePersonaImageUrl(persona.image_url));
  const contentKind = parseContentKind(character.content_kind);
  const characterImages = listSelectableCharacterImages({
    userId: opts.userId,
    characterId: character.id,
    creatorId: character.creator_id,
    assetsRaw: character.assets,
    imagesRaw: character.images,
    contentKind,
  });
  const castSelectableAssets = listCastSelectableAssets({
    userId: opts.userId,
    characterId: character.id,
    creatorId: character.creator_id,
    assetsRaw: character.assets,
    imagesRaw: character.images,
    contentKind,
  });
  const characterImageUrl =
    selectCharacterImageUrl(characterImages, opts.requestedCharacterImageUrl) ?? "";
  if (opts.requestedCharacterImageUrl && !characterImageUrl) {
    throw new RequestError("선택할 수 없는 캐릭터 이미지입니다.", 403);
  }
  if (contentKind === "character") {
    if (!characterImageUrl) throw new RequestError("캐릭터 대표 이미지가 필요합니다.");
    if (!personaImageUrl) throw new RequestError("페르소나 대표 이미지가 필요합니다.");
  }

  const genders = resolveChatImageGenderPair({
    characterName: character.name,
    characterGender: character.gender,
    personaName: persona.name,
    personaGender: persona.gender,
  });
  const characterAssets = parseAssets(character.assets);
  const visualSubjects = parseVisualSubjectsJson(
    character.simulation_visual_subjects_json ?? ""
  ).subjects;
  return {
    chatId,
    contentKind,
    character,
    persona,
    characterGender: genders.characterGender,
    personaGender: genders.personaGender,
    characterImageUrl,
    personaImageUrl,
    characterImages,
    castSelectableAssets,
    characterAssets,
    visualSubjects,
    characterSavedAppearance: resolveCharacterSavedAppearance({
      appearanceRaw: character.appearance_raw,
      appearanceSection: extractAppearanceRawFromSetting(character.system_prompt ?? ""),
      appearanceCompiled: character.appearance_compiled,
    }),
    personaSavedAppearance: resolvePersonaSavedAppearance(persona.description),
    roomAdultModeEnabled,
  };
}

/** Selected assistant message (+ immediately preceding user line when present). */
function chatSourceByMessageId(chatId: number, messageId: number): SceneSourceMessage[] {
  const assistant = getDb()
    .prepare(
      `SELECT id, role, content
       FROM messages
       WHERE chat_id=? AND id=? AND role='assistant'
       LIMIT 1`
    )
    .get(chatId, messageId) as
    | { id: number; role: "assistant"; content: string }
    | undefined;
  if (!assistant) {
    throw new RequestError("선택한 턴을 찾을 수 없습니다.", 404);
  }
  const previous = getDb()
    .prepare(
      `SELECT id, role, content
       FROM messages
       WHERE chat_id=? AND id<? AND role IN ('user', 'assistant')
       ORDER BY id DESC
       LIMIT 1`
    )
    .get(chatId, assistant.id) as
    | { id: number; role: "user" | "assistant"; content: string }
    | undefined;
  const rows: Array<{ id: number; role: "user" | "assistant"; content: string }> = [];
  if (previous?.role === "user") rows.push(previous);
  rows.push(assistant);
  const messages = buildSceneSourceMessages(rows);
  if (!messages.length) throw new RequestError("선택한 턴에 그림으로 만들 내용이 없습니다.");
  return messages;
}

function latestChatSource(chatId: number | null): SceneSourceMessage[] {
  if (!chatId) throw new RequestError("선택 턴 일러스트는 채팅방에서 만들 수 있습니다.");
  const rows = getDb()
    .prepare(
      `SELECT id, role, content
       FROM messages
       WHERE chat_id=? AND role IN ('user', 'assistant')
       ORDER BY id DESC
       LIMIT 2`
    )
    .all(chatId) as Array<{ id: number; role: "user" | "assistant"; content: string }>;
  const messages = buildSceneSourceMessages(rows.reverse());
  if (!messages.length) throw new RequestError("그림으로 만들 대화가 없습니다.");
  return messages;
}

function resolveSceneSource(opts: {
  chatId: number | null;
  messageId: number | null;
  sourceText?: string;
  requireChat?: boolean;
}): {
  messages: SceneSourceMessage[];
  turnText: string;
  messageId: number | null;
  fromManualText: boolean;
} {
  const manual = String(opts.sourceText ?? "").trim();
  if (opts.messageId && opts.chatId) {
    const messages = chatSourceByMessageId(opts.chatId, opts.messageId);
    return {
      messages,
      turnText: formatSceneSourcePreview(messages),
      messageId: opts.messageId,
      fromManualText: false,
    };
  }
  if (manual) {
    const messages = buildSceneSourceMessages([
      { id: 1, role: "assistant", content: stripChatTurnMarkup(manual) },
    ]);
    return {
      messages,
      turnText: formatSceneSourcePreview(messages),
      messageId: null,
      fromManualText: true,
    };
  }
  if (opts.requireChat !== false) {
    const messages = latestChatSource(opts.chatId);
    return {
      messages,
      turnText: formatSceneSourcePreview(messages),
      messageId: null,
      fromManualText: false,
    };
  }
  throw new RequestError("장면으로 만들 내용을 입력해 주세요.");
}

function resolveKnownSpeakerNames(
  context: GenerationContext,
  castIntentRaw: unknown
): string[] {
  const intent = parseChatImageCastManifest(castIntentRaw, context.contentKind);
  const names = new Set<string>();
  for (const name of configuredCharacterVisualSubjectNames(
    parseCharacterVisualSubjectsJson(context.character.simulation_visual_subjects_json ?? "")
  )) {
    names.add(name);
  }
  for (const name of extractSimulationCastNames(context.character.simulation_cast ?? "")) {
    names.add(name);
  }
  for (const subject of intent?.subjects ?? []) {
    if (subject.name?.trim()) names.add(subject.name.trim());
  }
  return [...names];
}

function resolveApprovedScenePlan(opts: {
  bodyPlan: unknown;
  messages: SceneSourceMessage[];
  panelCount?: unknown;
  personaName?: string;
  characterName?: string;
  knownSpeakerNames?: readonly string[];
  contentKind?: ContentKind;
}): ScenePlan {
  const requestedCount = isScenePanelCount(opts.panelCount) ? opts.panelCount : undefined;
  const speakerContext =
    opts.personaName && opts.characterName
      ? {
          personaName: opts.personaName,
          characterName: opts.characterName,
          knownSpeakerNames: opts.knownSpeakerNames,
        }
      : undefined;
  const validated = validateScenePlan(opts.bodyPlan, opts.messages, {
    allowUserEdits: true,
    personaName: opts.personaName,
    characterName: opts.characterName,
    knownSpeakerNames: opts.knownSpeakerNames,
    contentKind: opts.contentKind,
  });
  if (validated.ok) {
    return requestedCount
      ? reflowScenePlanPanels(validated.plan, requestedCount)
      : validated.plan;
  }
  const fallback = buildDeterministicScenePlan(opts.messages, requestedCount, speakerContext);
  return fallback;
}

function resolveGroundedCastManifest(opts: {
  castIntentRaw: unknown;
  context: GenerationContext;
  scenePlan: ScenePlan;
  userId: number;
  sourceMessages: SceneSourceMessage[];
  fromManualText: boolean;
}): ChatImageCastGroundedManifest | null {
  const contentKind = opts.context.contentKind;
  const intent = parseChatImageCastManifest(opts.castIntentRaw, contentKind);
  if (!intent) {
    if (contentKind === "simulation") {
      throw new RequestError("출연 인물을 선택해 주세요.");
    }
    return null;
  }
  const isCreator = opts.context.character.creator_id === opts.userId;
  const configuredNames =
    contentKind === "character"
      ? configuredCharacterVisualSubjectNames(
          parseCharacterVisualSubjectsJson(
            opts.context.character.simulation_visual_subjects_json ?? ""
          )
        )
      : extractSimulationCastNames(opts.context.character.simulation_cast ?? "");
  const scope = resolveServerVisualSubjectScope({
    contentKind,
    isCreator,
    allSubjects: opts.context.visualSubjects,
    assets: opts.context.characterAssets,
    allCastSelectableAssets: opts.context.castSelectableAssets,
    configuredNames,
    canonicalSourceTexts:
      opts.fromManualText && !isCreator
        ? []
        : opts.sourceMessages.map((message) => message.text),
  });
  const grounded = groundCastIntent(
    intent,
    {
      persona: {
        name: opts.context.persona.name,
        gender: opts.context.personaGender,
        referenceImageUrl: opts.context.personaImageUrl,
        savedAppearance: opts.context.personaSavedAppearance,
      },
      mainCharacter: {
        name: opts.context.character.name,
        gender: opts.context.characterGender,
        referenceImageUrl: opts.context.characterImageUrl,
        savedAppearance: opts.context.characterSavedAppearance,
      },
      selectableAssets: scope.viewerSelectableAssets,
      visualSubjects: scope.trustedSubjects,
      characterAssets: opts.context.characterAssets,
    },
    opts.scenePlan,
    contentKind
  );
  if (!grounded.ok) {
    throw new RequestError(grounded.reason);
  }
  const selectedCount = grounded.manifest.subjects.filter((subject) => subject.included).length;
  if (contentKind === "simulation") {
    return grounded.manifest;
  }
  return selectedCount > 2 ? grounded.manifest : null;
}

function safePublicFilePath(url: string): string | null {
  const clean = url.split("#", 1)[0]!.split("?", 1)[0]!;
  if (!clean.startsWith("/") || clean.startsWith("//")) return null;
  let relative: string;
  try {
    relative = decodeURIComponent(clean.slice(1));
  } catch {
    return null;
  }
  const publicRoot = path.resolve(process.cwd(), "public");
  const candidate = path.resolve(publicRoot, relative);
  if (candidate !== publicRoot && !candidate.startsWith(`${publicRoot}${path.sep}`)) return null;
  return candidate;
}

async function readImageSource(source: string): Promise<Buffer> {
  const clean = source.trim().split("#", 1)[0]!;
  const uploadName = filenameFromUploadUrl(clean);
  if (uploadName) {
    const uploadPath = resolveExistingUploadPath(uploadName);
    if (!uploadPath) throw new RequestError("참조 이미지를 찾을 수 없습니다.", 404);
    const input = await fs.readFile(uploadPath);
    if (input.length > MAX_REFERENCE_BYTES) throw new RequestError("참조 이미지가 너무 큽니다.");
    return input;
  }

  if (/^https?:\/\//i.test(clean)) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 30_000);
    try {
      const response = await fetch(clean, {
        signal: controller.signal,
        redirect: "follow",
        headers: { Accept: "image/*" },
      });
      if (!response.ok) throw new RequestError("참조 이미지를 불러오지 못했습니다.", 502);
      const input = Buffer.from(await response.arrayBuffer());
      if (input.length > MAX_REFERENCE_BYTES) throw new RequestError("참조 이미지가 너무 큽니다.");
      return input;
    } finally {
      clearTimeout(timer);
    }
  }

  const publicPath = safePublicFilePath(clean);
  if (!publicPath) throw new RequestError("참조 이미지 경로가 올바르지 않습니다.");
  try {
    return await fs.readFile(publicPath);
  } catch {
    throw new RequestError("참조 이미지를 찾을 수 없습니다.", 404);
  }
}

async function imageSourceToDataUrl(source: string): Promise<string> {
  const input = await readImageSource(source);
  try {
    const optimized = await sharp(input, { failOn: "none", animated: false })
      .rotate()
      .resize({ width: 1280, height: 1280, fit: "inside", withoutEnlargement: true })
      .webp({ quality: 86, effort: 4 })
      .toBuffer();
    return `data:image/webp;base64,${optimized.toString("base64")}`;
  } catch {
    throw new RequestError("참조 이미지를 처리하지 못했습니다.");
  }
}

async function generateComicImage(opts: {
  model: string;
  prompt: string;
  strictFallbackPrompt: string;
  references: ComicNormalizedProviderReference[];
  panelCount: ChatComicPanelCount;
}): Promise<OpenAiImageGeneratedWithAttempts> {
  try {
    const generated = toOpenAiImageGeneratedWithAttempts(
      await callOpenAiImageEditWithSafetyFallback({
      model: opts.model,
      primaryPrompt: opts.prompt,
      strictFallbackPrompt: opts.strictFallbackPrompt,
      references: opts.references.map((reference) => reference.dataUrl),
      size: resolveChatComicOutputSize(opts.panelCount),
      quality: "medium",
      outputCompression: 84,
      templateId: CHAT_COMIC_TEMPLATE_ID,
      mode: "comic",
    })
    );
    let output = generated.buffer;
    const metadata = await sharp(output, { failOn: "none" }).metadata();
    if (!metadata.width || !metadata.height) {
      throw new RequestError("생성된 이미지 형식이 올바르지 않습니다.", 502);
    }
    if (metadata.format !== "webp") {
      output = await sharp(output, { failOn: "none" })
        .rotate()
        .webp({ quality: 90, effort: 4 })
        .toBuffer();
    }
    return { ...generated, buffer: output };
  } catch (error) {
    if (error instanceof RequestError) throw error;
    if (error instanceof OpenAiImageGenerationError) {
      throw new RequestError(
        formatOpenAiImageFinalUserError(error.message),
        error.status,
        error.diagnostic,
        error.providerAttempts
      );
    }
    if (error instanceof OpenAiImageError) {
      throw new RequestError(
        formatOpenAiImageUserError(error.message),
        error.status,
        error.diagnostic
      );
    }
    if (error instanceof Error && error.name === "AbortError") {
      throw new RequestError("컷만화 생성 시간이 초과되었습니다. 다시 시도해 주세요.", 504);
    }
    throw new RequestError("OpenAI 컷만화 이미지 생성 중 오류가 발생했습니다.", 502);
  }
}

async function generateLdIllustrationImage(opts: {
  model: string;
  prompt: string;
  strictFallbackPrompt: string;
  references: string[];
}): Promise<OpenAiImageGeneratedWithAttempts> {
  try {
    const generated = toOpenAiImageGeneratedWithAttempts(
      await callOpenAiImageEditWithSafetyFallback({
      model: opts.model,
      primaryPrompt: opts.prompt,
      strictFallbackPrompt: opts.strictFallbackPrompt,
      references: opts.references,
      size: CHAT_LD_ILLUSTRATION_OUTPUT_SIZE,
      quality: CHAT_LD_ILLUSTRATION_QUALITY,
      outputCompression: 86,
      templateId: CHAT_LD_ILLUSTRATION_TEMPLATE_ID,
      mode: "illustration",
    })
    );
    let output = generated.buffer;
    const metadata = await sharp(output, { failOn: "none" }).metadata();
    if (!metadata.width || !metadata.height) {
      throw new RequestError("생성된 이미지 형식이 올바르지 않습니다.", 502);
    }
    if (
      metadata.width !== 800 ||
      metadata.height !== 1200 ||
      metadata.format !== "webp"
    ) {
      output = await sharp(output, { failOn: "none" })
        .rotate()
        .resize({ width: 800, height: 1200, fit: "cover", position: "centre" })
        .webp({ quality: 90, effort: 4 })
        .toBuffer();
    }
    return { ...generated, buffer: output };
  } catch (error) {
    if (error instanceof RequestError) throw error;
    if (error instanceof OpenAiImageGenerationError) {
      throw new RequestError(
        formatOpenAiImageFinalUserError(error.message),
        error.status,
        error.diagnostic,
        error.providerAttempts
      );
    }
    if (error instanceof OpenAiImageError) {
      throw new RequestError(
        formatOpenAiImageUserError(error.message),
        error.status,
        error.diagnostic
      );
    }
    if (error instanceof Error && error.name === "AbortError") {
      throw new RequestError("LD 일러스트 생성 시간이 초과되었습니다. 다시 시도해 주세요.", 504);
    }
    throw new RequestError("OpenAI LD 일러스트 생성 중 오류가 발생했습니다.", 502);
  }
}

function providerAttemptsJsonFromGenerated(
  generated: OpenAiImageGeneratedWithAttempts
): string | null {
  return generated.providerAttempts.length > 0
    ? serializeOpenAiImageProviderAttempts(generated.providerAttempts)
    : null;
}

function adminProviderAttemptDiagnostic(
  generated: OpenAiImageGeneratedWithAttempts,
  providerReferences?: readonly ComicProviderReference[]
): Record<string, unknown> {
  const referenceSet = providerReferences
    ? formatComicReferenceSetForAdmin(providerReferences)
    : undefined;
  return formatOpenAiImageProviderAttemptsForAdmin({
    providerAttempts: generated.providerAttempts,
    knownProviderCostUsd: generated.knownProviderCostUsd,
    hasUnknownAttemptCost: generated.hasUnknownAttemptCost,
    safetyFallbackUsed: generated.safetyFallbackUsed,
    referenceSet,
  });
}

function formatComicDiagnosticSafeRecord(opts: {
  mode: ComicDiagnosticMode;
  semanticLevel: string | null;
  textBoundaryLevel?: ComicTextBoundaryLevel | null;
  generated: Pick<OpenAiImageGeneratedWithAttempts, "providerAttempts">;
  providerReferences?: readonly ComicProviderReference[];
}): Record<string, unknown> {
  const primary = opts.generated.providerAttempts.find((attempt) => attempt.attempt === 1);
  const tier2 = opts.generated.providerAttempts.find((attempt) => attempt.attempt === 2);
  const categories = [
    ...new Set(
      opts.generated.providerAttempts.flatMap((attempt) => {
        const value = attempt.diagnostic?.safetyCategories;
        return Array.isArray(value)
          ? value.filter((item): item is string => typeof item === "string")
          : [];
      })
    ),
  ];
  const finalAttempt = tier2 ?? primary;
  const usageEvidence = opts.generated.providerAttempts.map((attempt) => ({
    attempt: attempt.attempt,
    evidence: attempt.usageEvidence ?? (
      attempt.diagnostic?.usageReturned === true
        ? "usage_present"
        : attempt.diagnostic?.usageReturned === false
          ? "usage_absent"
          : "unknown"
    ),
  }));
  const boundary = resolveComicPrimaryTier2Boundary({
    primaryOutcome: primary?.outcome ?? null,
    tier2Outcome: tier2?.outcome ?? null,
  });
  return {
    mode: opts.mode,
    semanticLevel: opts.semanticLevel,
    textBoundaryLevel: opts.textBoundaryLevel ?? null,
    promptHash: primary?.promptHash ?? null,
    referenceSetSignature: opts.providerReferences
      ? formatComicReferenceSetForAdmin(opts.providerReferences).referenceSetSignature
      : null,
    attemptCount: opts.generated.providerAttempts.length,
    primaryResult: primary?.outcome ?? "not_run",
    tier2Result: tier2?.outcome ?? "not_run",
    SEMANTIC_BOUNDARY_OWNER: boundary.semanticBoundaryOwner,
    PRIMARY_BOUNDARY: boundary.primaryBoundary,
    TIER2_SAFE_RECOVERY: boundary.tier2SafeRecovery,
    safetyCategories: categories.length ? categories : "UNKNOWN",
    providerRequestId:
      finalAttempt?.providerRequestId ??
      finalAttempt?.diagnostic?.providerRequestId ??
      null,
    usageEvidence,
  };
}

export async function POST(req: Request) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "로그인이 필요합니다." }, { status: 401 });

  let savedPath: string | null = null;
  let jobId: number | null = null;
  let tier2PromptAudit: ReturnType<typeof auditTier2ComicPrompt> | null = null;
  let referenceRoleInventory: ReturnType<typeof buildComicReferenceRoleInventory> | null = null;
  let providerReferences: ComicProviderReference[] | null = null;
  let diagnosticOverrides = resolveComicDiagnosticOverrides({ canSeeCost: false });
  let diagnosticMode = resolveComicDiagnosticMode({
    canSeeCost: false,
  });
  try {
    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
    const canSeeCost = isAdminUser(user as typeof user & { is_admin?: number });
    try {
      diagnosticOverrides = resolveComicDiagnosticOverrides({
        canSeeCost,
        referenceMode: body.comicReferenceIsolationMode,
        visualContextMode: body.comicVisualContextIsolationMode,
      });
      diagnosticMode = resolveComicDiagnosticMode({
        canSeeCost,
        mode: body.comicDiagnosticMode,
        semanticLevel: body.comicSemanticLevel,
        textStrategy: body.comicBlankBalloonTextStrategy,
        textBoundaryLevel: body.comicTextBoundaryLevel,
      });
      // One experiment = one variable. Ladder/hybrid must use normal isolation axes.
      assertComicDiagnosticAxisIsolation({
        mode: diagnosticMode.mode,
        referenceMode: diagnosticOverrides.referenceMode,
        visualContextMode: diagnosticOverrides.visualContextMode,
      });
    } catch (error) {
      const code = error instanceof Error ? error.message : "INVALID_COMIC_DIAGNOSTIC_OVERRIDE";
      throw new RequestError(code === "COMIC_DIAGNOSTIC_OVERRIDE_FORBIDDEN"
        || code === "COMIC_DIAGNOSTIC_MODE_FORBIDDEN"
        ? "관리자만 컷만화 진단 모드를 사용할 수 있습니다."
        : "컷만화 진단 모드가 올바르지 않습니다.", code.includes("FORBIDDEN") ? 403 : 400);
    }
    const context = resolveGenerationContext({
      userId: user.id,
      userAdultVerified: effectiveIsAdult((user as SessionUserLike).is_adult ?? 0),
      characterId: positiveInt(body.characterId),
      chatId: positiveInt(body.chatId),
      personaId: positiveInt(body.personaId),
      requestedCharacterImageUrl: body.characterImageUrl,
    });
    // Site adult text eligibility (resolveEffectiveAdultRp) gates whether
    // adult-grounded approved dialogue may be forwarded as provider-readable
    // INPUT text. This is not server image postprocessing.
    const roomAdultGrounded = resolveEffectiveAdultRp({
      userAdultVerified: effectiveIsAdult((user as SessionUserLike).is_adult ?? 0),
      roomAdultModeEnabled: context.roomAdultModeEnabled,
    });

    if (positiveInt(body.campaignId) && body.mode !== "illustration") {
      throw new RequestError("캠페인에서는 선택 턴 일러스트만 만들 수 있습니다.");
    }

    if (body.mode === "scene_brief") {
      const source = resolveSceneSource({
        chatId: context.chatId,
        messageId: positiveInt(body.messageId),
      });
      const configuredNames =
        context.contentKind === "character"
          ? configuredCharacterVisualSubjectNames(
              parseCharacterVisualSubjectsJson(context.character.simulation_visual_subjects_json ?? "")
            )
          : extractSimulationCastNames(context.character.simulation_cast ?? "");
      const isCreator = context.character.creator_id === user.id;
      const scope = resolveServerVisualSubjectScope({
        contentKind: context.contentKind,
        isCreator,
        allSubjects: context.visualSubjects,
        assets: context.characterAssets,
        allCastSelectableAssets: context.castSelectableAssets,
        configuredNames,
        canonicalSourceTexts: source.fromManualText && !isCreator
          ? []
          : source.messages.map((message) => message.text),
      });
      return NextResponse.json({
        ok: true,
        mode: "scene_brief",
        messageId: source.messageId,
        summary: source.turnText,
        messages: source.messages,
        configuredCastNames: scope.clientSubjects.map((subject) => subject.name),
        visualSubjects: scope.clientSubjects,
        castSelectableAssets: scope.viewerSelectableAssets,
        contentKind: context.contentKind,
      });
    }

    if (body.mode === "scene_plan") {
      const source = resolveSceneSource({
        chatId: context.chatId,
        messageId: positiveInt(body.messageId),
        sourceText: String(body.sourceText ?? ""),
        requireChat: false,
      });
      try {
        assertChatImageScenePlanRateLimit(user.id);
      } catch (error) {
        if (error instanceof ChatImageScenePlanRateLimitError) {
          return NextResponse.json({ ok: false, error: error.message }, { status: 429 });
        }
        throw error;
      }
      let planned;
      let scenePlanFailed = false;
      try {
        const knownSpeakerNames = resolveKnownSpeakerNames(context, body.castIntent);
        planned = await planChatImageScene({
          contentKind: context.contentKind,
          characterName: context.character.name,
          personaName: context.persona.name,
          messages: source.messages,
          speakerContext: {
            personaName: context.persona.name,
            characterName: context.character.name,
            knownSpeakerNames,
          },
        });
      } catch (error) {
        scenePlanFailed = true;
        const message =
          error instanceof Error
            ? error.message
            : "AI 제안을 불러오지 못했습니다. 현재 직접 편집한 장면은 그대로 유지됩니다.";
        return NextResponse.json({ ok: false, error: message }, { status: 502 });
      } finally {
        releaseChatImageScenePlanRateLimit(user.id, scenePlanFailed);
      }
      const requestedCount = isScenePanelCount(body.panelCount)
        ? body.panelCount
        : planned.plan.recommendedPanelCount;
      const plan =
        requestedCount === planned.plan.panels.length
          ? planned.plan
          : reflowScenePlanPanels(planned.plan, requestedCount);
      return NextResponse.json({
        ok: true,
        mode: "scene_plan",
        messageId: source.messageId,
        plan,
        model: planned.model,
        usedFallback: planned.usedFallback,
        attempts: planned.attempts,
      });
    }

    if (hasRunningChatImageGenerationJob(user.id)) {
      return NextResponse.json(
        { error: "이미 생성 중인 이미지가 있습니다. 완료된 뒤에 다시 시도해 주세요." },
        { status: 409 }
      );
    }
    const startJob = (templateId: string, mode: string) => {
      jobId = startChatImageGenerationJob({
        userId: user.id,
        chatId: context.chatId,
        characterId: context.character.id,
        personaId: context.persona.id,
        templateId,
        mode,
      });
    };
    if (body.mode === "illustration") {
      const pricePoints = resolveChatLdIllustrationPrice();
      const balanceBefore = getPointBalance(user.id);
      if (balanceBefore.total < pricePoints) {
        return NextResponse.json(
          {
            error: `포인트가 부족합니다. 선택 턴 LD 일러스트에는 ${pricePoints.toLocaleString()}P가 필요합니다.`,
            pricePoints,
            remainingPoints: balanceBefore.total,
            paidPoints: balanceBefore.paid,
            freePoints: balanceBefore.free,
          },
          { status: 402 }
        );
      }

      const campaignId = positiveInt(body.campaignId);
      const roundNumber = nonNegativeInt(body.roundNumber);
      const appearanceModes = resolveRequestAppearanceModes({
        characterImages: context.characterImages,
        selectedCharacterImageUrl: context.characterImageUrl,
        characterSavedAppearance: context.characterSavedAppearance,
        personaSavedAppearance: context.personaSavedAppearance,
        characterOverride: body.characterAppearanceMode,
        personaOverride: body.personaAppearanceMode,
      });
      let cast: ChatLdIllustrationCastMember[] | undefined;
      let partyPlan: ReturnType<typeof buildPartyIllustrationReferencePlan> | undefined;
      let referenceUrls: string[] = [];
      let situation: string | undefined;
      let sceneLocation = "";
      let sceneActions: Array<{ name: string; body: string }> = [];
      let trpgScene: ReturnType<typeof loadTrpgIllustrationScene> = null;
      let illustrationMessageId: number | null = null;
      let campaignTitle = "";
      let trpgImageSceneModeApplied: TrpgImageSceneMode = TRPG_IMAGE_SCENE_MODE_DEFAULT;
      let trpgAiFocusDiagnostics: TrpgAiFocusDiagnostics | null = null;
      let trpgImageSceneDiagnosticsPayload: TrpgImageSceneDiagnosticsPayload | null = null;
      let requestedTrpgSceneMode: TrpgImageSceneMode = TRPG_IMAGE_SCENE_MODE_DEFAULT;
      let prompt: string;
      let strictFallbackPrompt: string;
      if (campaignId) {
        trpgScene = loadTrpgIllustrationScene(getDb(), {
          campaignId,
          viewerUserId: user.id,
          roundNumber,
        });
        if (!trpgScene) throw new RequestError("캠페인을 찾을 수 없습니다.", 404);
        if (!trpgScene.narration.trim()) {
          throw new RequestError("이 라운드 GM 서술이 확정되기 전에는 일러스트를 만들 수 없습니다.");
        }
        campaignTitle = trpgScene.campaignTitle;
        const pickedMembers = applyTrpgCastImagePicks(trpgScene.members, body.castImagePicks);
        const indexed = withIllustrationReferenceIndices(pickedMembers);
        cast = indexed.map((member) => {
          const isPrimary = isPrimarySelectableImage(member.images, member.imageUrl);
          const appearanceMode = defaultAppearanceMode({
            sourceKind: "cast_member",
            isPrimaryImage: !member.imageUrl || isPrimary,
            hasOwnSavedAppearance: Boolean(member.appearanceNote?.trim()),
            hasOwnReference: Boolean(member.imageUrl),
          });
          return {
            name: member.name,
            gender: member.gender,
            role: member.role,
            referenceIndex: member.referenceIndex,
            appearanceNote:
              appearanceMode === "image_plus_saved" ? member.appearanceNote : undefined,
            aliases: member.aliases,
            appearanceMode,
            imageUrl: member.imageUrl,
            isPrimaryImage: isPrimary,
          };
        });
        partyPlan = buildPartyIllustrationReferencePlan(cast);
        if (!partyPlan.canGenerate) {
          throw new RequestError(CHAT_IMAGE_PARTY_NO_REFERENCE_ERROR);
        }
        referenceUrls = partyPlan.referenceUrls;
        cast = partyPlan.subjects.map((subject, index) => ({
          ...(cast?.[index] ?? {
            name: subject.name,
            gender: subject.gender,
            role: subject.role,
            appearanceNote: subject.savedAppearance,
            aliases: subject.aliases,
            appearanceMode: subject.appearanceMode,
            isPrimaryImage: true,
          }),
          referenceIndex: subject.referenceIndex,
          imageUrl: subject.referenceImageUrl,
        }));
        sceneLocation = trpgScene.location;
        sceneActions = trpgScene.actions;
        trpgAiFocusDiagnostics = null;
        requestedTrpgSceneMode = normalizeTrpgImageSceneMode(body.trpgImageSceneMode);
        const focus = await resolveTrpgIllustrationSceneFocus({
          sceneMode: requestedTrpgSceneMode,
          rawNarration: trpgScene.narration,
          canonicalLocation: sceneLocation,
        });
        trpgImageSceneModeApplied = focus.modeApplied;
        trpgAiFocusDiagnostics = focus.diagnostics;
        trpgImageSceneDiagnosticsPayload = buildTrpgImageSceneDiagnosticsPayload({
          requestedMode: requestedTrpgSceneMode,
          modeApplied: focus.modeApplied,
          canonicalLocation: sceneLocation,
          focusDiagnostics: focus.diagnostics,
        });
        if (focus.modeApplied === "RAW" && requestedTrpgSceneMode === "AI_FOCUS") {
          console.info(
            "[trpg-ai-focus] RAW fallback",
            JSON.stringify({
              campaignId,
              roundNumber,
              reason: focus.diagnostics?.fallbackReason ?? "unknown",
              model: focus.diagnostics?.aiModel,
            })
          );
        }
        const gmSceneNarration = focus.narration;
        situation = buildTrpgIllustrationSituation({
          location: sceneLocation,
          actions: sceneActions,
          narration: gmSceneNarration,
        });
        prompt = buildChatLdIllustrationPrompt({
          characterName: context.character.name,
          characterGender: context.characterGender,
          personaName: context.persona.name,
          personaGender: context.personaGender,
          currentTurn: trpgScene.narration,
          cast,
          subjects: partyPlan?.subjects,
          situation,
        });
        strictFallbackPrompt = buildStrictLdPartyFallbackPrompt({
          cast,
          subjects: partyPlan!.subjects,
        });
      } else {
        const source = resolveSceneSource({
          chatId: context.chatId,
          messageId: positiveInt(body.messageId),
          sourceText: String(body.sourceText ?? ""),
          requireChat: true,
        });
        illustrationMessageId = source.messageId;
        const knownSpeakerNames = resolveKnownSpeakerNames(context, body.castIntent);
        const scenePlan = resolveApprovedScenePlan({
          bodyPlan: body.scenePlan,
          messages: source.messages,
          personaName: context.persona.name,
          characterName: context.character.name,
          knownSpeakerNames,
          contentKind: context.contentKind,
        });
        const castManifest = resolveGroundedCastManifest({
          castIntentRaw: body.castIntent,
          context,
          scenePlan,
          userId: user.id,
          sourceMessages: source.messages,
          fromManualText: source.fromManualText,
        });
        const plan = buildLdSceneGenerationPlan({
          characterName: context.character.name,
          characterGender: context.characterGender,
          personaName: context.persona.name,
          personaGender: context.personaGender,
          characterImageUrl: context.characterImageUrl,
          characterSavedAppearance: context.characterSavedAppearance,
          characterAppearanceMode: appearanceModes.characterAppearanceMode,
          personaImageUrl: context.personaImageUrl,
          personaSavedAppearance: context.personaSavedAppearance,
          personaAppearanceMode: appearanceModes.personaAppearanceMode,
          approvedScenePlan: scenePlan,
          castManifest,
          contentKind: context.contentKind,
        });
        prompt = plan.prompt;
        referenceUrls = plan.referenceUrls;
        strictFallbackPrompt = buildStrictLdDuoFallbackPrompt({
          characterName: context.character.name,
          characterGender: context.characterGender,
          personaName: context.persona.name,
          personaGender: context.personaGender,
          subjects: plan.subjects,
        });
      }
      startJob(CHAT_LD_ILLUSTRATION_TEMPLATE_ID, "illustration");
      const references = await Promise.all(
        referenceUrls.map((sourceUrl) => imageSourceToDataUrl(sourceUrl))
      );
      const model = resolveChatImageGenerationModel();
      const generated = await generateLdIllustrationImage({
        model,
        prompt,
        strictFallbackPrompt,
        references,
      });

      await fs.mkdir(uploadsDataDir(), { recursive: true });
      const filename = `ai-ld-current-turn-${crypto.randomUUID()}.webp`;
      savedPath = path.join(uploadsDataDir(), filename);
      await fs.writeFile(savedPath, generated.buffer);
      const resultUrl = uploadPublicUrl(filename);

      let generationId: number;
      let deductionTotal: number;
      let deductionBalance: ReturnType<typeof getPointBalance>;
      try {
        const settled = settleChatImageGenerationResult({
          userId: user.id,
          chatId: context.chatId,
          characterId: context.character.id,
          personaId: context.persona.id,
          templateId: CHAT_LD_ILLUSTRATION_TEMPLATE_ID,
          model,
          optionsJson: {
            mode: "illustration",
            source: illustrationMessageId
              ? "selected_chat_turn"
              : campaignId
                ? "trpg_scene"
                : "latest_chat_turn",
            messageId: illustrationMessageId,
            campaignId: campaignId ?? undefined,
            campaignTitle: campaignTitle || undefined,
            roundNumber: roundNumber ?? undefined,
            castNames: cast?.map((member) => member.name),
            trpgImageSceneMode: campaignId ? trpgImageSceneModeApplied : undefined,
            trpgAiFocusDiagnostics: trpgAiFocusDiagnostics ?? undefined,
            quality: CHAT_LD_ILLUSTRATION_QUALITY,
            outputSize: CHAT_LD_ILLUSTRATION_OUTPUT_SIZE,
          },
          resultUrl,
          upstreamCostUsd: generated.knownProviderCostUsd,
          chargePoints: pricePoints,
          chargeReason: "GPT Image 2 · 선택 턴 LD 일러스트",
          chargeLink: context.chatId ? { chatId: context.chatId } : undefined,
          creatorReward: {
            creatorId: campaignId
              ? trpgScene?.authorUserId
              : context.character.creator_id,
            source: campaignId ? "trpg_scenario" : "character",
          },
          exchangeRateKrwPerUsd: getEffectiveKrwPerUsd(),
          album: {
            mode: "illustration",
            campaignId,
            campaignTitle: campaignTitle || null,
          },
        });
        generationId = settled.generationId;
        deductionTotal = settled.chargedPoints;
        deductionBalance = settled.balance;
      } catch (error) {
        const failedPath = savedPath;
        savedPath = null;
        const attemptsJson = providerAttemptsJsonFromGenerated(generated);
        if (error instanceof InsufficientPointsError) {
          return abortGeneratedImageAfterSettlementFailure({
            savedPath: failedPath,
            userId: user.id,
            jobId,
            logTag: "chat-ld-illustration",
            error,
            insufficientPoints: error,
            providerAttemptsJson: attemptsJson,
          });
        }
        return abortGeneratedImageAfterSettlementFailure({
          savedPath: failedPath,
          userId: user.id,
          jobId,
          logTag: "chat-ld-illustration",
          error,
          providerAttemptsJson: attemptsJson,
        });
      }

      finishChatImageGenerationJob({
        jobId,
        status: "completed",
        resultUrl,
        providerAttemptsJson: providerAttemptsJsonFromGenerated(generated),
      });
      jobId = null;

      const totalCostKrw =
        generated.knownProviderCostUsd == null
          ? null
          : Math.round(generated.knownProviderCostUsd * getEffectiveKrwPerUsd() * 10) / 10;
      const canSeeCost = isAdminUser(user as typeof user & { is_admin?: number });
      return NextResponse.json({
        ok: true,
        mode: "illustration",
        generationId,
        imageUrl: resultUrl,
        savedToCharacterAlbum: true,
        title: "선택 턴 LD 일러스트",
        modelLabel: "GPT Image 2",
        messageId: illustrationMessageId ?? undefined,
        upstreamCostUsd: canSeeCost ? generated.knownProviderCostUsd : undefined,
        upstreamCostKrw: canSeeCost ? totalCostKrw : undefined,
        ...(canSeeCost
          ? { providerAttemptDiagnostic: adminProviderAttemptDiagnostic(generated) }
          : {}),
        trpgImageSceneDiagnostics: resolveTrpgImageSceneDiagnosticsForResponse({
          canSeeCost,
          campaignId,
          payload: trpgImageSceneDiagnosticsPayload,
        }),
        totalPointsCost: deductionTotal,
        remainingPoints: deductionBalance.total,
        paidPoints: deductionBalance.paid,
        freePoints: deductionBalance.free,
      });
    }

    const messageId = positiveInt(body.messageId);
    const manualSourceText = String(body.sourceText ?? "").trim();
    const semanticLadderMode = diagnosticMode.mode === "semantic_ladder";
    if (!semanticLadderMode && !messageId && !manualSourceText && !body.scenePlan) {
      throw new RequestError(
        "장면으로 만들 턴을 선택하거나 내용을 입력해 주세요."
      );
    }
    if (!semanticLadderMode && !messageId && manualSourceText.length > CHAT_COMIC_MAX_INPUT_CHARS) {
      throw new RequestError(
        `내용은 최대 ${CHAT_COMIC_MAX_INPUT_CHARS.toLocaleString()}자까지 입력할 수 있습니다.`
      );
    }

    const source = semanticLadderMode
      ? {
          messages: [] as SceneSourceMessage[],
          turnText: "",
          messageId: null,
          fromManualText: false,
        }
      : resolveSceneSource({
          chatId: context.chatId,
          messageId,
          sourceText: messageId ? undefined : manualSourceText,
          requireChat: false,
        });
    const mood = "comic" as const;
    const knownSpeakerNames = resolveKnownSpeakerNames(context, body.castIntent);
    const canonicalPlan = semanticLadderMode
      ? buildSemanticLadderScenePlan(
          diagnosticMode.semanticLevel!,
          4,
          diagnosticMode.textBoundaryLevel
        )
      : resolveApprovedScenePlan({
          bodyPlan: body.scenePlan,
          messages: source.messages,
          personaName: context.persona.name,
          characterName: context.character.name,
          knownSpeakerNames,
          contentKind: context.contentKind,
        });
    // COMIC HIGHLIGHT STORYBOARD V3 — anchor-centered 3/4-panel presentation.
    // The canonical timeline stays lossless; only the comic panels are a selected
    // contiguous focus window. 2-panel is removed from the user path (legacy
    // requests retire to AUTO). Admin ladder/hybrid diagnostics keep the fixed
    // canonical scene plan.
    let comicStoryboard: ComicStoryboard | null = null;
    let scenePlan = canonicalPlan;
    let panelCount = scenePlan.panels.length as ChatComicPanelCount;
    if (!semanticLadderMode) {
      const requestedPanelMode = isComicPanelMode(body.panelCount)
        ? body.panelCount
        : "auto";
      comicStoryboard = buildComicHighlightStoryboard(canonicalPlan, {
        manualPanelCount:
          requestedPanelMode === "auto" ? undefined : (requestedPanelMode as 3 | 4),
      });
      scenePlan = applyComicHighlightStoryboardToPlan(canonicalPlan, comicStoryboard);
      panelCount = comicStoryboard.panelCount;
    }
    const castManifest = semanticLadderMode
      ? null
      : resolveGroundedCastManifest({
          castIntentRaw: body.castIntent,
          context,
          scenePlan: canonicalPlan,
          userId: user.id,
          sourceMessages: source.messages,
          fromManualText: source.fromManualText,
        });

    const balanceBefore = getPointBalance(user.id);
    const pricePoints = resolveChatComicPrice(panelCount);
    if (balanceBefore.total < pricePoints) {
      return NextResponse.json(
        {
          error: `포인트가 부족합니다. 컷만화에는 ${pricePoints.toLocaleString()}P가 필요합니다.`,
          pricePoints,
          remainingPoints: balanceBefore.total,
          paidPoints: balanceBefore.paid,
          freePoints: balanceBefore.free,
        },
        { status: 402 }
      );
    }

    startJob(CHAT_COMIC_TEMPLATE_ID, "comic");
    const appearanceModes = resolveRequestAppearanceModes({
      characterImages: context.characterImages,
      selectedCharacterImageUrl: context.characterImageUrl,
      characterSavedAppearance: context.characterSavedAppearance,
      personaSavedAppearance: context.personaSavedAppearance,
      characterOverride: body.characterAppearanceMode,
      personaOverride: body.personaAppearanceMode,
    });
    const identityPack = buildChatComicGenerationPlan({
      characterName: context.character.name,
      characterGender: context.characterGender,
      characterImageUrl: context.characterImageUrl,
      characterSavedAppearance: context.characterSavedAppearance,
      characterAppearanceMode: appearanceModes.characterAppearanceMode,
      personaName: context.persona.name,
      personaGender: context.personaGender,
      personaImageUrl: context.personaImageUrl,
      personaSavedAppearance: context.personaSavedAppearance,
      personaAppearanceMode: appearanceModes.personaAppearanceMode,
      mood,
      plan: scenePlan,
      castManifest,
contentKind: context.contentKind,
      adultGrounded: semanticLadderMode,
      compositionMode:
        diagnosticMode.mode === "blank_balloon_hybrid"
          ? "blank_balloon_hybrid"
          : "full_provider_rendered",
      providerTextAdultEligible: semanticLadderMode ? true : roomAdultGrounded,
      storyboard: comicStoryboard ?? undefined,
    });
    const neutralVisualContext = diagnosticOverrides.visualContextMode === "neutral_visual_context";
    const providerScenePlan: ScenePlan = neutralVisualContext
      ? buildNeutralComicProviderScenePlan(scenePlan)
      : scenePlan;
    const providerIdentityPack = neutralVisualContext
      ? buildChatComicGenerationPlan({
          characterName: context.character.name,
          characterGender: context.characterGender,
          characterImageUrl: context.characterImageUrl,
          characterSavedAppearance: context.characterSavedAppearance,
          characterAppearanceMode: appearanceModes.characterAppearanceMode,
          personaName: context.persona.name,
          personaGender: context.personaGender,
          personaImageUrl: context.personaImageUrl,
          personaSavedAppearance: context.personaSavedAppearance,
          personaAppearanceMode: appearanceModes.personaAppearanceMode,
          mood,
          plan: providerScenePlan,
          castManifest,
contentKind: context.contentKind,
          adultGrounded: semanticLadderMode,
          compositionMode:
            diagnosticMode.mode === "blank_balloon_hybrid"
              ? "blank_balloon_hybrid"
              : "full_provider_rendered",
          providerTextAdultEligible: semanticLadderMode ? true : roomAdultGrounded,
          storyboard: comicStoryboard ?? undefined,
        })
      : identityPack;
    const prompt = providerIdentityPack.prompt;
    const comicVisibility = resolveScenePresentationVisibility({
      contentKind: context.contentKind,
      castManifest,
    });
    const tier2SafeStructure = neutralVisualContext
      ? buildNeutralComicSafeStructure(scenePlan.panels.map((panel) => panel.index))
      : semanticLadderMode
        ? buildSemanticLadderSafeStructure(diagnosticMode.semanticLevel!, panelCount)
      : projectComicSafeStructureForTier2(scenePlan, comicVisibility);
    const hybridBalloonSlots =
      diagnosticMode.mode === "blank_balloon_hybrid"
        ? buildComicPanelBalloonSlotMetadata({
            plan: scenePlan,
            visibility: comicVisibility,
            subjects: identityPack.subjects,
          })
        : undefined;
    const strictFallbackPrompt = buildStrictComicFallbackPrompt({
      panelCount,
      mood,
      characterName: context.character.name,
      characterGender: context.characterGender,
      personaName: context.persona.name,
      personaGender: context.personaGender,
      subjects: providerIdentityPack.subjects,
      castManifest,
      castSelected: castManifest?.subjects.filter((subject) => subject.included),
      contentKind: context.contentKind,
      safeStructure: tier2SafeStructure,
      compositionMode:
        diagnosticMode.mode === "blank_balloon_hybrid"
          ? "blank_balloon_hybrid"
          : "full_provider_rendered",
      balloonSlots: hybridBalloonSlots,
    });
    const tier2PromptAuditResult = auditTier2ComicPrompt({
      prompt: strictFallbackPrompt,
      subjects: providerIdentityPack.subjects,
      safeStructure: tier2SafeStructure,
      safeStructureProjectionApplied: true,
      rawSourceCandidates:
        neutralVisualContext || semanticLadderMode
          ? []
          : collectTier2RawSourceCandidates(scenePlan),
    });
    tier2PromptAudit = tier2PromptAuditResult;
    referenceRoleInventory = buildComicReferenceRoleInventory({
      referenceUrls: providerIdentityPack.referenceUrls,
      subjects: providerIdentityPack.subjects,
    });
    providerReferences = isolateComicProviderReferences(
      buildComicProviderReferences({
        referenceUrls: providerIdentityPack.referenceUrls,
        subjects: providerIdentityPack.subjects,
      }),
      diagnosticOverrides.referenceMode
    );
    const providerInput = await prepareComicProviderReferenceInput({
      primaryPrompt: prompt,
      strictFallbackPrompt,
      references: providerReferences,
      normalizeReference: imageSourceToDataUrl,
    });
    const model = resolveChatImageGenerationModel();
    const generated = await generateComicImage({
      model,
      prompt: providerInput.primaryPrompt,
      strictFallbackPrompt: providerInput.strictFallbackPrompt,
      references: providerInput.references,
      panelCount,
    });

    // FULL PROVIDER-RENDERED comic — the provider output IS the final saved
    // image. No server text layer (speech bubbles, narration, SFX, or glyphs)
    // is composited for the comic production path.
    const assembled = assembleComicFinalImage({ providerBuffer: generated.buffer });
    const finalComicBuffer = assembled.buffer;

    await fs.mkdir(uploadsDataDir(), { recursive: true });
    const filename = `ai-comic-${panelCount}p-${crypto.randomUUID()}.webp`;
    savedPath = path.join(uploadsDataDir(), filename);
    await fs.writeFile(savedPath, finalComicBuffer);
    const resultUrl = uploadPublicUrl(filename);

    const totalCostUsd = generated.knownProviderCostUsd;
    let generationId: number;
    let deductionTotal: number;
    let deductionBalance: ReturnType<typeof getPointBalance>;
    try {
      const settled = settleChatImageGenerationResult({
        userId: user.id,
        chatId: context.chatId,
        characterId: context.character.id,
        personaId: context.persona.id,
        templateId: CHAT_COMIC_TEMPLATE_ID,
        model,
        optionsJson: {
          mode: "comic",
          panelCount,
          mood,
          messageId: source.messageId,
          quality: "medium",
          ...(diagnosticMode.mode === "normal" || diagnosticMode.mode === "blank_balloon_hybrid"
            ? { plan: scenePlan }
            : {}),
          ...(diagnosticMode.mode !== "normal"
            ? {
                comicDiagnostic: {
                  mode: diagnosticMode.mode,
                  semanticLevel: diagnosticMode.semanticLevel,
                  textBoundaryLevel: diagnosticMode.textBoundaryLevel,
                },
              }
            : {}),
        },
        resultUrl,
        upstreamCostUsd: totalCostUsd,
        chargePoints: pricePoints,
        chargeReason: `GPT Image 2 · ${panelCount}컷 만화`,
        chargeLink: context.chatId ? { chatId: context.chatId } : undefined,
        creatorReward: {
          creatorId: context.character.creator_id,
          source: "character",
        },
        exchangeRateKrwPerUsd: getEffectiveKrwPerUsd(),
        album: { mode: "comic" },
      });
      generationId = settled.generationId;
      deductionTotal = settled.chargedPoints;
      deductionBalance = settled.balance;
    } catch (error) {
      const failedPath = savedPath;
      savedPath = null;
      const attemptsJson = providerAttemptsJsonFromGenerated(generated);
      if (error instanceof InsufficientPointsError) {
        return abortGeneratedImageAfterSettlementFailure({
          savedPath: failedPath,
          userId: user.id,
          jobId,
          logTag: "chat-comic-generation",
          error,
          insufficientPoints: error,
          providerAttemptsJson: attemptsJson,
        });
      }
      return abortGeneratedImageAfterSettlementFailure({
        savedPath: failedPath,
        userId: user.id,
        jobId,
        logTag: "chat-comic-generation",
        error,
        providerAttemptsJson: attemptsJson,
      });
    }

    finishChatImageGenerationJob({
      jobId,
      status: "completed",
      resultUrl,
      providerAttemptsJson: providerAttemptsJsonFromGenerated(generated),
    });
    jobId = null;

    const totalCostKrw =
      totalCostUsd == null
        ? null
        : Math.round(totalCostUsd * getEffectiveKrwPerUsd() * 10) / 10;
    const comicDiagnostic =
      diagnosticMode.mode !== "normal"
        ? formatComicDiagnosticSafeRecord({
            mode: diagnosticMode.mode,
            semanticLevel: diagnosticMode.semanticLevel,
            textBoundaryLevel: diagnosticMode.textBoundaryLevel,
            generated,
            providerReferences: providerReferences!,
          })
        : null;
    if (comicDiagnostic) {
      console.info(
        "[chat-comic-diagnostic]",
        JSON.stringify({
          SEMANTIC_LEVEL: comicDiagnostic.semanticLevel,
          TEXT_BOUNDARY_LEVEL: comicDiagnostic.textBoundaryLevel,
          PROMPT_HASH: comicDiagnostic.promptHash,
          REFERENCE_SET_SIGNATURE: comicDiagnostic.referenceSetSignature,
          ATTEMPT_COUNT: comicDiagnostic.attemptCount,
          PRIMARY_RESULT: comicDiagnostic.primaryResult,
          TIER2_RESULT: comicDiagnostic.tier2Result,
          SEMANTIC_BOUNDARY_OWNER: comicDiagnostic.SEMANTIC_BOUNDARY_OWNER,
          PRIMARY_BOUNDARY: comicDiagnostic.PRIMARY_BOUNDARY,
          TIER2_SAFE_RECOVERY: comicDiagnostic.TIER2_SAFE_RECOVERY,
          SAFETY_CATEGORIES: comicDiagnostic.safetyCategories,
          PROVIDER_REQUEST_ID: comicDiagnostic.providerRequestId,
          USAGE_EVIDENCE: comicDiagnostic.usageEvidence,
        })
      );
    } else {
      console.info("[chat-comic-generation] completed", {
        userId: user.id,
        chatId: context.chatId,
        characterId: context.character.id,
        personaId: context.persona.id,
        panelCount,
        imageModel: model,
        upstreamCostUsd: totalCostUsd,
        upstreamCostKrw: totalCostKrw,
        chargedPoints: deductionTotal,
        hasUnknownAttemptCost: generated.hasUnknownAttemptCost,
      });
    }

    return NextResponse.json({
      ok: true,
      mode: "comic",
      generationId,
      imageUrl: resultUrl,
      savedToCharacterAlbum: true,
      title: `장면 ${panelCount}컷`,
      panelCount,
      modelLabel: "GPT Image 2",
      messageId: source.messageId ?? undefined,
      upstreamCostUsd: canSeeCost ? totalCostUsd : undefined,
      upstreamCostKrw: canSeeCost ? totalCostKrw : undefined,
      ...(canSeeCost
        ? diagnosticMode.mode === "normal"
          ? {
              providerAttemptDiagnostic: adminProviderAttemptDiagnostic(
                generated,
                providerReferences
              ),
              comicDiagnostic: {
                referenceIsolationMode: diagnosticOverrides.referenceMode,
                visualContextIsolationMode: diagnosticOverrides.visualContextMode,
                ...formatComicReferenceSetForAdmin(providerReferences),
              },
            }
          : {
              comicDiagnostic: {
                ...comicDiagnostic,
                textBoundaryLevel: diagnosticMode.textBoundaryLevel ?? null,
              },
            }
        : {}),
      totalPointsCost: deductionTotal,
      remainingPoints: deductionBalance.total,
      paidPoints: deductionBalance.paid,
      freePoints: deductionBalance.free,
    });
  } catch (error) {
    if (savedPath) await fs.unlink(savedPath).catch(() => {});
    const status = error instanceof RequestError ? error.status : 500;
    const message = error instanceof Error ? error.message : "컷만화 생성에 실패했습니다.";
    const diagnostic =
      error instanceof RequestError ? error.imageFailureDiagnostic : undefined;
    const providerAttempts =
      error instanceof RequestError ? error.providerAttempts : undefined;
    finishChatImageGenerationJob({
      jobId,
      status: "failed",
      errorMessage: message,
      failureDiagnosticJson: diagnostic
        ? serializeOpenAiImageFailureDiagnostic(diagnostic)
        : null,
      providerAttemptsJson: providerAttempts?.length
        ? serializeOpenAiImageProviderAttempts(providerAttempts)
        : null,
    });
    const canSeeCost = isAdminUser(user as typeof user & { is_admin?: number });
    const isDiagnosticRequest = diagnosticMode.mode !== "normal";
    const diagnosticFailure = isDiagnosticRequest
      ? formatComicDiagnosticSafeRecord({
          mode: diagnosticMode.mode,
          semanticLevel: diagnosticMode.semanticLevel,
          textBoundaryLevel: diagnosticMode.textBoundaryLevel,
          generated: { providerAttempts: providerAttempts ?? [] },
          providerReferences: providerReferences ?? undefined,
        })
      : null;
    const adminFailureDiagnostic = canSeeCost
      ? isDiagnosticRequest
        ? diagnosticFailure
        : formatComicGenerationAdminFailureDiagnostic({
            providerAttempts,
            tier2PromptAudit,
            referenceRoleInventory,
            providerReferences: providerReferences ?? undefined,
            referenceIsolationMode: diagnosticOverrides.referenceMode,
            imageFailureDiagnostic: diagnostic,
          })
      : null;
    if (diagnosticFailure) {
      console.error(
        "[chat-comic-diagnostic]",
        JSON.stringify({
          SEMANTIC_LEVEL: diagnosticFailure.semanticLevel,
          TEXT_BOUNDARY_LEVEL: diagnosticFailure.textBoundaryLevel,
          PROMPT_HASH: diagnosticFailure.promptHash,
          REFERENCE_SET_SIGNATURE: diagnosticFailure.referenceSetSignature,
          ATTEMPT_COUNT: diagnosticFailure.attemptCount,
          PRIMARY_RESULT: diagnosticFailure.primaryResult,
          TIER2_RESULT: diagnosticFailure.tier2Result,
          SEMANTIC_BOUNDARY_OWNER: diagnosticFailure.SEMANTIC_BOUNDARY_OWNER,
          PRIMARY_BOUNDARY: diagnosticFailure.PRIMARY_BOUNDARY,
          TIER2_SAFE_RECOVERY: diagnosticFailure.TIER2_SAFE_RECOVERY,
          SAFETY_CATEGORIES: diagnosticFailure.safetyCategories,
          PROVIDER_REQUEST_ID: diagnosticFailure.providerRequestId,
          USAGE_EVIDENCE: diagnosticFailure.usageEvidence,
        })
      );
    } else {
      console.error("[chat-comic-generation] failed", JSON.stringify({
        status,
        message,
        ...(adminFailureDiagnostic ?? {}),
      }));
    }
    return NextResponse.json(
      {
        error: message,
        ...(adminFailureDiagnostic ?? {}),
      },
      { status }
    );
  }
}
