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
  buildChatComicGenerationPlan,
  resolveChatComicOutputSize,
  resolveChatComicPrice,
  type ChatComicPanelCount,
} from "@/lib/chatComicGeneration";
import {
  CHAT_LD_ILLUSTRATION_OUTPUT_SIZE,
  CHAT_LD_ILLUSTRATION_QUALITY,
  CHAT_LD_ILLUSTRATION_TEMPLATE_ID,
  buildChatLdIllustrationPrompt,
  buildLdDuoGenerationPlan,
  buildLdSceneGenerationPlan,
  buildTrpgIllustrationSituation,
  formatOpenAiImageUserError,
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
  buildDeterministicScenePlan,
  buildSceneSourceMessages,
  formatApprovedScenePlanForIllustration,
  formatSceneSourcePreview,
  isScenePanelCount,
  reflowScenePlanPanels,
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
import { getDb } from "@/lib/db";
import { getEffectiveKrwPerUsd } from "@/lib/exchangeRate";
import { saveGeneratedImageToCharacterAlbum } from "@/lib/chatImageAlbum";
import {
  InsufficientPointsError,
  deductPoints,
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
  callOpenAiImageEdit,
} from "@/lib/openAiImageEdit";

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
};

class RequestError extends Error {
  constructor(
    message: string,
    public status = 400
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

function ensureGenerationTable() {
  getDb().exec(`
    CREATE TABLE IF NOT EXISTS chat_image_generations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      chat_id INTEGER,
      character_id INTEGER NOT NULL,
      persona_id INTEGER NOT NULL,
      template_id TEXT NOT NULL,
      model TEXT NOT NULL,
      options_json TEXT NOT NULL DEFAULT '{}',
      result_url TEXT NOT NULL,
      upstream_cost_usd REAL,
      charged_points INTEGER NOT NULL,
      deduction_slices TEXT,
      exchange_rate_krw_per_usd REAL,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_chat_image_generations_user_recent
      ON chat_image_generations(user_id, created_at DESC, id DESC);
  `);
  const columns = new Set(
    (
      getDb().prepare("PRAGMA table_info(chat_image_generations)").all() as {
        name: string;
      }[]
    ).map((column) => column.name)
  );
  if (!columns.has("deduction_slices")) {
    getDb().exec("ALTER TABLE chat_image_generations ADD COLUMN deduction_slices TEXT");
  }
  if (!columns.has("exchange_rate_krw_per_usd")) {
    getDb().exec(
      "ALTER TABLE chat_image_generations ADD COLUMN exchange_rate_krw_per_usd REAL"
    );
  }
}

function resolveGenerationContext(opts: {
  userId: number;
  characterId: number | null;
  chatId: number | null;
  personaId: number | null;
  requestedCharacterImageUrl?: unknown;
}): GenerationContext {
  const db = getDb();
  let characterId = opts.characterId;
  let selectedPersonaId = opts.personaId;
  let chatId: number | null = null;

  if (opts.chatId) {
    const chat = db
      .prepare(
        "SELECT id, character_id, selected_persona_id FROM chats WHERE id=? AND user_id=?"
      )
      .get(opts.chatId, opts.userId) as ChatRow | undefined;
    if (!chat) throw new RequestError("채팅방을 찾을 수 없습니다.", 404);
    chatId = chat.id;
    characterId = chat.character_id;
    selectedPersonaId = chat.selected_persona_id ?? selectedPersonaId;
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

function resolveApprovedScenePlan(opts: {
  bodyPlan: unknown;
  messages: SceneSourceMessage[];
  panelCount?: unknown;
  personaName?: string;
  characterName?: string;
  contentKind?: ContentKind;
}): ScenePlan {
  const requestedCount = isScenePanelCount(opts.panelCount) ? opts.panelCount : undefined;
  const validated = validateScenePlan(opts.bodyPlan, opts.messages, {
    allowUserEdits: true,
    personaName: opts.personaName,
    characterName: opts.characterName,
    contentKind: opts.contentKind,
  });
  if (validated.ok) {
    return requestedCount
      ? reflowScenePlanPanels(validated.plan, requestedCount)
      : validated.plan;
  }
  const fallback = buildDeterministicScenePlan(opts.messages, requestedCount);
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
  references: string[];
  panelCount: ChatComicPanelCount;
}): Promise<{ buffer: Buffer; costUsd: number | null }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 285_000);
  try {
    const generated = await callOpenAiImageEdit({
      model: opts.model,
      prompt: opts.prompt,
      references: opts.references,
      size: resolveChatComicOutputSize(opts.panelCount),
      quality: "medium",
      outputCompression: 84,
      signal: controller.signal,
    });
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
    return {
      buffer: output,
      costUsd: generated.costUsd,
    };
  } catch (error) {
    if (error instanceof RequestError) throw error;
    if (error instanceof OpenAiImageError) {
      throw new RequestError(formatOpenAiImageUserError(error.message), error.status);
    }
    if (error instanceof Error && error.name === "AbortError") {
      throw new RequestError("컷만화 생성 시간이 초과되었습니다. 다시 시도해 주세요.", 504);
    }
    throw new RequestError("OpenAI 컷만화 이미지 생성 중 오류가 발생했습니다.", 502);
  } finally {
    clearTimeout(timer);
  }
}

async function generateLdIllustrationImage(opts: {
  model: string;
  prompt: string;
  references: string[];
}): Promise<{ buffer: Buffer; costUsd: number | null }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 285_000);
  try {
    const generated = await callOpenAiImageEdit({
      model: opts.model,
      prompt: opts.prompt,
      references: opts.references,
      size: CHAT_LD_ILLUSTRATION_OUTPUT_SIZE,
      quality: CHAT_LD_ILLUSTRATION_QUALITY,
      outputCompression: 86,
      signal: controller.signal,
    });
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
    return { buffer: output, costUsd: generated.costUsd };
  } catch (error) {
    if (error instanceof RequestError) throw error;
    if (error instanceof OpenAiImageError) {
      throw new RequestError(formatOpenAiImageUserError(error.message), error.status);
    }
    if (error instanceof Error && error.name === "AbortError") {
      throw new RequestError("LD 일러스트 생성 시간이 초과되었습니다. 다시 시도해 주세요.", 504);
    }
    throw new RequestError("OpenAI LD 일러스트 생성 중 오류가 발생했습니다.", 502);
  } finally {
    clearTimeout(timer);
  }
}

export async function POST(req: Request) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "로그인이 필요합니다." }, { status: 401 });

  let savedPath: string | null = null;
  let jobId: number | null = null;
  try {
    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
    const context = resolveGenerationContext({
      userId: user.id,
      characterId: positiveInt(body.characterId),
      chatId: positiveInt(body.chatId),
      personaId: positiveInt(body.personaId),
      requestedCharacterImageUrl: body.characterImageUrl,
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
        planned = await planChatImageScene({
          contentKind: context.contentKind,
          characterName: context.character.name,
          personaName: context.persona.name,
          messages: source.messages,
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
      let prompt: string;
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
        situation = buildTrpgIllustrationSituation({
          location: sceneLocation,
          actions: sceneActions,
          narration: trpgScene.narration,
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
      } else {
        const source = resolveSceneSource({
          chatId: context.chatId,
          messageId: positiveInt(body.messageId),
          sourceText: String(body.sourceText ?? ""),
          requireChat: true,
        });
        illustrationMessageId = source.messageId;
        const scenePlan = resolveApprovedScenePlan({
          bodyPlan: body.scenePlan,
          messages: source.messages,
          personaName: context.persona.name,
          characterName: context.character.name,
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
      }
      startJob(CHAT_LD_ILLUSTRATION_TEMPLATE_ID, "illustration");
      const references = await Promise.all(
        referenceUrls.map((sourceUrl) => imageSourceToDataUrl(sourceUrl))
      );
      const model = resolveChatImageGenerationModel();
      const generated = await generateLdIllustrationImage({
        model,
        prompt,
        references,
      });

      await fs.mkdir(uploadsDataDir(), { recursive: true });
      const filename = `ai-ld-current-turn-${crypto.randomUUID()}.webp`;
      savedPath = path.join(uploadsDataDir(), filename);
      await fs.writeFile(savedPath, generated.buffer);
      const resultUrl = uploadPublicUrl(filename);

      let deduction;
      try {
        deduction = deductPoints(
          user.id,
          pricePoints,
          "GPT Image 2 · 선택 턴 LD 일러스트",
          context.chatId ? { chatId: context.chatId } : undefined
        );
      } catch (error) {
        await fs.unlink(savedPath).catch(() => {});
        savedPath = null;
        if (error instanceof InsufficientPointsError) {
          finishChatImageGenerationJob({
            jobId,
            status: "failed",
            errorMessage: "포인트가 부족합니다.",
          });
          jobId = null;
          return NextResponse.json(
            {
              error: `포인트가 부족합니다. ${pricePoints.toLocaleString()}P가 필요합니다.`,
              remainingPoints: error.balance.total,
              paidPoints: error.balance.paid,
              freePoints: error.balance.free,
            },
            { status: 402 }
          );
        }
        throw error;
      }

      ensureGenerationTable();
      let generationId: number | null = null;
      let savedToCharacterAlbum = false;
      try {
        const insert = getDb()
          .prepare(
            `INSERT INTO chat_image_generations (
               user_id, chat_id, character_id, persona_id, template_id, model,
               options_json, result_url, upstream_cost_usd, charged_points,
               deduction_slices, exchange_rate_krw_per_usd
             ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`
          )
          .run(
            user.id,
            context.chatId,
            context.character.id,
            context.persona.id,
            CHAT_LD_ILLUSTRATION_TEMPLATE_ID,
            model,
            JSON.stringify({
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
              quality: CHAT_LD_ILLUSTRATION_QUALITY,
              outputSize: CHAT_LD_ILLUSTRATION_OUTPUT_SIZE,
            }),
            resultUrl,
            generated.costUsd,
            deduction.total,
            JSON.stringify(deduction.slices),
            getEffectiveKrwPerUsd()
          );
        generationId = Number(insert.lastInsertRowid);
        saveGeneratedImageToCharacterAlbum({
          userId: user.id,
          characterId: context.character.id,
          personaId: context.persona.id,
          chatId: context.chatId,
          generationId,
          imageUrl: resultUrl,
          mode: "illustration",
          campaignId,
          campaignTitle: campaignTitle || null,
        });
        savedToCharacterAlbum = true;
      } catch (error) {
        console.error("[chat-ld-illustration] history/album insert failed", error);
      }

      finishChatImageGenerationJob({ jobId, status: "completed", resultUrl });
      jobId = null;

      const totalCostKrw =
        generated.costUsd == null
          ? null
          : Math.round(generated.costUsd * getEffectiveKrwPerUsd() * 10) / 10;
      const canSeeCost = isAdminUser(user as typeof user & { is_admin?: number });
      return NextResponse.json({
        ok: true,
        mode: "illustration",
        generationId,
        imageUrl: resultUrl,
        savedToCharacterAlbum,
        title: "선택 턴 LD 일러스트",
        modelLabel: "GPT Image 2",
        messageId: illustrationMessageId ?? undefined,
        upstreamCostUsd: canSeeCost ? generated.costUsd : undefined,
        upstreamCostKrw: canSeeCost ? totalCostKrw : undefined,
        totalPointsCost: deduction.total,
        remainingPoints: deduction.balance.total,
        paidPoints: deduction.balance.paid,
        freePoints: deduction.balance.free,
      });
    }

    const messageId = positiveInt(body.messageId);
    const manualSourceText = String(body.sourceText ?? "").trim();
    if (!messageId && !manualSourceText && !body.scenePlan) {
      throw new RequestError(
        "장면으로 만들 턴을 선택하거나 내용을 입력해 주세요."
      );
    }
    if (!messageId && manualSourceText.length > CHAT_COMIC_MAX_INPUT_CHARS) {
      throw new RequestError(
        `내용은 최대 ${CHAT_COMIC_MAX_INPUT_CHARS.toLocaleString()}자까지 입력할 수 있습니다.`
      );
    }

    const source = resolveSceneSource({
      chatId: context.chatId,
      messageId,
      sourceText: messageId ? undefined : manualSourceText,
      requireChat: false,
    });
    const mood = "comic" as const;
    const scenePlan = resolveApprovedScenePlan({
      bodyPlan: body.scenePlan,
      messages: source.messages,
      panelCount: body.panelCount,
      personaName: context.persona.name,
      characterName: context.character.name,
      contentKind: context.contentKind,
    });
    const panelCount = scenePlan.panels.length as ChatComicPanelCount;
    const castManifest = resolveGroundedCastManifest({
      castIntentRaw: body.castIntent,
      context,
      scenePlan,
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
    });
    const prompt = identityPack.prompt;
    const references = await Promise.all(
      identityPack.referenceUrls.map((url) => imageSourceToDataUrl(url))
    );
    const model = resolveChatImageGenerationModel();
    const generated = await generateComicImage({
      model,
      prompt,
      references,
      panelCount,
    });

    await fs.mkdir(uploadsDataDir(), { recursive: true });
    const filename = `ai-comic-${panelCount}p-${crypto.randomUUID()}.webp`;
    savedPath = path.join(uploadsDataDir(), filename);
    await fs.writeFile(savedPath, generated.buffer);
    const resultUrl = uploadPublicUrl(filename);

    let deduction;
    try {
      deduction = deductPoints(
        user.id,
        pricePoints,
        `GPT Image 2 · ${panelCount}컷 만화`,
        context.chatId ? { chatId: context.chatId } : undefined
      );
    } catch (error) {
      await fs.unlink(savedPath).catch(() => {});
      savedPath = null;
      if (error instanceof InsufficientPointsError) {
        finishChatImageGenerationJob({
          jobId,
          status: "failed",
          errorMessage: "포인트가 부족합니다.",
        });
        jobId = null;
        return NextResponse.json(
          {
            error: `포인트가 부족합니다. ${pricePoints.toLocaleString()}P가 필요합니다.`,
            remainingPoints: error.balance.total,
            paidPoints: error.balance.paid,
            freePoints: error.balance.free,
          },
          { status: 402 }
        );
      }
      throw error;
    }

    const totalCostUsd = generated.costUsd == null ? null : generated.costUsd;
    ensureGenerationTable();
    let generationId: number | null = null;
    let savedToCharacterAlbum = false;
    try {
      const insert = getDb()
        .prepare(
          `INSERT INTO chat_image_generations (
             user_id, chat_id, character_id, persona_id, template_id, model,
             options_json, result_url, upstream_cost_usd, charged_points,
             deduction_slices, exchange_rate_krw_per_usd
           ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`
        )
        .run(
          user.id,
          context.chatId,
          context.character.id,
          context.persona.id,
          CHAT_COMIC_TEMPLATE_ID,
          model,
          JSON.stringify({
            mode: "comic",
            panelCount,
            mood,
            messageId: source.messageId,
            plan: scenePlan,
            quality: "medium",
          }),
          resultUrl,
          totalCostUsd,
          deduction.total,
          JSON.stringify(deduction.slices),
          getEffectiveKrwPerUsd()
        );
      generationId = Number(insert.lastInsertRowid);
      saveGeneratedImageToCharacterAlbum({
        userId: user.id,
        characterId: context.character.id,
        personaId: context.persona.id,
        chatId: context.chatId,
        generationId,
        imageUrl: resultUrl,
        mode: "comic",
      });
      savedToCharacterAlbum = true;
    } catch (error) {
      console.error("[chat-comic-generation] history/album insert failed", error);
    }

    finishChatImageGenerationJob({ jobId, status: "completed", resultUrl });
    jobId = null;

    const totalCostKrw =
      totalCostUsd == null
        ? null
        : Math.round(totalCostUsd * getEffectiveKrwPerUsd() * 10) / 10;
    console.info("[chat-comic-generation] completed", {
      userId: user.id,
      chatId: context.chatId,
      characterId: context.character.id,
      personaId: context.persona.id,
      panelCount,
      imageModel: model,
      upstreamCostUsd: totalCostUsd,
      upstreamCostKrw: totalCostKrw,
      chargedPoints: deduction.total,
    });

    const canSeeCost = isAdminUser(user as typeof user & { is_admin?: number });
    return NextResponse.json({
      ok: true,
      mode: "comic",
      generationId,
      imageUrl: resultUrl,
      savedToCharacterAlbum,
      title: `장면 ${panelCount}컷`,
      panelCount,
      modelLabel: "GPT Image 2",
      messageId: source.messageId ?? undefined,
      upstreamCostUsd: canSeeCost ? totalCostUsd : undefined,
      upstreamCostKrw: canSeeCost ? totalCostKrw : undefined,
      totalPointsCost: deduction.total,
      remainingPoints: deduction.balance.total,
      paidPoints: deduction.balance.paid,
      freePoints: deduction.balance.free,
    });
  } catch (error) {
    if (savedPath) await fs.unlink(savedPath).catch(() => {});
    const status = error instanceof RequestError ? error.status : 500;
    const message = error instanceof Error ? error.message : "컷만화 생성에 실패했습니다.";
    finishChatImageGenerationJob({ jobId, status: "failed", errorMessage: message });
    console.error("[chat-comic-generation] failed", {
      status,
      message,
      error: error instanceof RequestError ? undefined : error,
    });
    return NextResponse.json({ error: message }, { status });
  }
}
