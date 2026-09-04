import crypto from "crypto";
import fs from "fs/promises";
import path from "path";
import { NextResponse } from "next/server";
import sharp from "sharp";

import { getSessionUser } from "@/lib/auth";
import {
  CHAT_COMIC_TEMPLATE_ID,
  type ChatComicPanelCount,
} from "@/lib/chatComicGeneration";
import {
  finishChatImageGenerationJob,
  findLatestChatImageGenerationJob,
  hasRunningChatImageGenerationJob,
  startChatImageGenerationJob,
} from "@/lib/chatImageGenerationJobs";
import {
  CHAT_COUPLE_STAMP_API_OUTPUT_SIZE,
  CHAT_COUPLE_STAMP_OUTPUT_HEIGHT,
  CHAT_COUPLE_STAMP_OUTPUT_WIDTH,
  CHAT_COUPLE_STAMP_QUALITY,
  CHAT_COUPLE_STAMP_TEMPLATE_ID,
  CHAT_COUPLE_STAMP_TEMPLATE_NAME,
  buildCoupleStampGenerationPlan,
  resolveChatCoupleStampPrice,
  sanitizeChatCoupleStampOptions,
} from "@/lib/chatCoupleStampGeneration";
import {
  CHAT_EMOTICON_API_OUTPUT_SIZE,
  CHAT_EMOTICON_OUTPUT_HEIGHT,
  CHAT_EMOTICON_OUTPUT_WIDTH,
  CHAT_EMOTICON_QUALITY,
  CHAT_EMOTICON_TEMPLATE_ID,
  CHAT_EMOTICON_TEMPLATE_NAME,
  buildEmoticonGenerationPlan,
  resolveChatEmoticonPrice,
  selectRandomChatEmoticonScenes,
} from "@/lib/chatEmoticonGeneration";
import { isAdminUser } from "@/lib/isAdminUser";
import {
  selectCharacterImageUrl,
  type SelectableCharacterImage,
} from "@/lib/chatCharacterImageSelection";
import { listSelectableCharacterImages, listCastSelectableAssets } from "@/lib/chatCharacterImageSelection.server";
import {
  CHAT_IMAGE_TEMPLATE_ID,
  CHAT_IMAGE_TEMPLATE_NAME,
  CHAT_IMAGE_TEMPLATE_PREVIEW_URL,
  CHAT_IMAGE_GENERATION_OUTPUT_HEIGHT,
  CHAT_IMAGE_GENERATION_OUTPUT_SIZE,
  CHAT_IMAGE_GENERATION_OUTPUT_WIDTH,
  CHAT_IMAGE_GENERATION_QUALITY,
  buildGiftBoxGenerationPlan,
  type ImagePromptGender,
  resolveChatImageGenerationModel,
  resolveChatImageGenerationPrice,
  sanitizeChatImageGenerationOptions,
} from "@/lib/chatImageGeneration";
import { extractAppearanceRawFromSetting } from "@/lib/appearanceCompiler";
import {
  buildChatImageCharacterAppearanceClientView,
  resolveCharacterSavedAppearance,
  resolvePersonaSavedAppearance,
  resolveRequestAppearanceModes,
} from "@/lib/chatImageVisualIdentity";
import { CHAT_LD_ILLUSTRATION_TEMPLATE_ID } from "@/lib/chatLdIllustrationGeneration";
import {
  CHAT_PERSONA_IMAGE_API_OUTPUT_SIZE,
  CHAT_PERSONA_IMAGE_OUTPUT_HEIGHT,
  CHAT_PERSONA_IMAGE_OUTPUT_WIDTH,
  CHAT_PERSONA_IMAGE_QUALITY,
  CHAT_PERSONA_IMAGE_TEMPLATE_ID,
  CHAT_PERSONA_IMAGE_TEMPLATE_NAME,
  buildChatPersonaImagePrompt,
  personaImageReadiness,
  resolveChatPersonaImagePrice,
} from "@/lib/chatPersonaImageGeneration";
import { getDb } from "@/lib/db";
import { parseAssets } from "@/lib/characterAssets";
import {
  buildClientScopedCastImageMetadata,
  parseVisualSubjectsJson,
  type ClientVisibleVisualSubject,
} from "@/lib/visualSubjects";
import { parseContentKind, type ContentKind } from "@/lib/simulationMode";
import { resolveChatImageSceneBuilderReadiness, type SelectableCastAsset } from "@/lib/chatImageCast";
import { resolveChatImageGenderPair } from "@/lib/chatImageGender";
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
} from "@/lib/openAiImageEdit";
import {
  formatOpenAiImageFailureDiagnosticForAdmin,
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
  buildStrictCoupleStampFallbackPrompt,
  buildStrictEmoticonFallbackPrompt,
  buildStrictPersonaFallbackPrompt,
  buildStrictSdFallbackPrompt,
} from "@/lib/chatImageStrictSafetyFallbackPrompt";
import { CHAT_IMAGE_MOODS } from "@/lib/chatImageGeneration";

export const runtime = "nodejs";
export const maxDuration = 300;

const MAX_REFERENCE_BYTES = 12 * 1024 * 1024;
const TEMPLATE_FILE = path.join(
  process.cwd(),
  "public",
  "image-templates",
  "sd-gift-box-duo.webp"
);

type CharacterRow = {
  id: number;
  name: string;
  gender: string;
  assets: string;
  images: string;
  creator_id: number | null;
  visibility: string;
  appearance_raw: string | null;
  appearance_compiled: string | null;
  system_prompt: string | null;
  content_kind: string | null;
  simulation_visual_subjects_json: string | null;
};

type PersonaRow = {
  id: number;
  name: string;
  gender: string;
  description: string;
  image_url: string;
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
  persona: PersonaRow | null;
  characterGender: ImagePromptGender;
  personaGender: ImagePromptGender;
  characterImageUrl: string;
  characterImages: SelectableCharacterImage[];
  castSelectableAssets: SelectableCastAsset[];
  visualSubjects: ClientVisibleVisualSubject[];
  allVisualSubjects: ReturnType<typeof parseVisualSubjectsJson>["subjects"];
  characterAssets: ReturnType<typeof parseAssets>;
  personaImageUrl: string;
  characterSavedAppearance: string;
  personaSavedAppearance: string;
};

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

function ensureGenerationTable() {
  const db = getDb();
  db.exec(`
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
      db.prepare("PRAGMA table_info(chat_image_generations)").all() as {
        name: string;
      }[]
    ).map((column) => column.name)
  );
  if (!columns.has("deduction_slices")) {
    db.exec("ALTER TABLE chat_image_generations ADD COLUMN deduction_slices TEXT");
  }
  if (!columns.has("exchange_rate_krw_per_usd")) {
    db.exec("ALTER TABLE chat_image_generations ADD COLUMN exchange_rate_krw_per_usd REAL");
  }
}

function resolveGenerationContext(opts: {
  userId: number;
  characterId: number | null;
  chatId: number | null;
  personaId: number | null;
  requestedCharacterImageUrl?: unknown;
  strictPersona?: boolean;
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
      "SELECT id, name, gender, assets, images, creator_id, visibility, COALESCE(appearance_raw, '') AS appearance_raw, COALESCE(appearance_compiled, '') AS appearance_compiled, COALESCE(system_prompt, '') AS system_prompt, COALESCE(content_kind, 'character') AS content_kind, COALESCE(simulation_visual_subjects_json, '') AS simulation_visual_subjects_json FROM characters WHERE id=?"
    )
    .get(characterId) as CharacterRow | undefined;
  if (!character) throw new RequestError("캐릭터를 찾을 수 없습니다.", 404);
  if (character.visibility === "private" && character.creator_id !== opts.userId) {
    throw new RequestError("캐릭터를 찾을 수 없습니다.", 404);
  }

  let persona: PersonaRow | undefined;
  if (selectedPersonaId) {
    persona = db
      .prepare("SELECT id, name, gender, description, image_url FROM user_personas WHERE id=? AND user_id=?")
      .get(selectedPersonaId, opts.userId) as PersonaRow | undefined;
    if (!persona && opts.strictPersona) {
      throw new RequestError("선택한 페르소나를 찾을 수 없습니다.", 404);
    }
  }
  if (!persona) {
    persona = db
      .prepare(
        "SELECT id, name, gender, description, image_url FROM user_personas WHERE user_id=? ORDER BY created_at ASC, id ASC LIMIT 1"
      )
      .get(opts.userId) as PersonaRow | undefined;
  }

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
  const personaImageUrl = persona
    ? personaImageBaseUrl(sanitizePersonaImageUrl(persona.image_url))
    : "";

  const genders = resolveChatImageGenderPair({
    characterName: character.name,
    characterGender: character.gender,
    personaName: persona?.name ?? "",
    personaGender: persona?.gender,
  });
  const characterAssets = parseAssets(character.assets);
  const allVisualSubjects = parseVisualSubjectsJson(
    character.simulation_visual_subjects_json ?? ""
  ).subjects;
  const isCreator = character.creator_id === opts.userId;
  const preflightCast = buildClientScopedCastImageMetadata({
    contentKind,
    isCreator,
    subjects: allVisualSubjects,
    assets: characterAssets,
    castSelectableAssets,
    visibleNames: [],
    scope: "preflight",
  });
  return {
    chatId,
    contentKind,
    character,
    persona: persona ?? null,
    characterGender: genders.characterGender,
    personaGender: genders.personaGender,
    characterImageUrl,
    characterImages,
    castSelectableAssets: [...preflightCast.castSelectableAssets],
    visualSubjects: preflightCast.visualSubjects,
    allVisualSubjects,
    characterAssets,
    personaImageUrl,
    characterSavedAppearance: resolveCharacterSavedAppearance({
      appearanceRaw: character.appearance_raw,
      appearanceSection: extractAppearanceRawFromSetting(character.system_prompt ?? ""),
      appearanceCompiled: character.appearance_compiled,
    }),
    personaSavedAppearance: resolvePersonaSavedAppearance(persona?.description),
  };
}

function readiness(context: GenerationContext) {
  return resolveChatImageSceneBuilderReadiness({
    contentKind: context.contentKind,
    characterImageUrl: context.characterImageUrl,
    hasPersona: Boolean(context.persona),
    personaImageUrl: context.personaImageUrl,
  });
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
    if (input.length > MAX_REFERENCE_BYTES) {
      throw new RequestError("참조 이미지 용량이 너무 큽니다.");
    }
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
      const contentLength = Number(response.headers.get("content-length") ?? 0);
      if (contentLength > MAX_REFERENCE_BYTES) {
        throw new RequestError("참조 이미지 용량이 너무 큽니다.");
      }
      const type = response.headers.get("content-type") ?? "";
      if (type && !type.toLowerCase().startsWith("image/")) {
        throw new RequestError("참조 이미지 형식이 올바르지 않습니다.");
      }
      const input = Buffer.from(await response.arrayBuffer());
      if (input.length > MAX_REFERENCE_BYTES) {
        throw new RequestError("참조 이미지 용량이 너무 큽니다.");
      }
      return input;
    } finally {
      clearTimeout(timer);
    }
  }

  const publicPath = safePublicFilePath(clean);
  if (!publicPath) throw new RequestError("참조 이미지 경로가 올바르지 않습니다.");
  try {
    const input = await fs.readFile(publicPath);
    if (input.length > MAX_REFERENCE_BYTES) {
      throw new RequestError("참조 이미지 용량이 너무 큽니다.");
    }
    return input;
  } catch (error) {
    if (error instanceof RequestError) throw error;
    throw new RequestError("참조 이미지를 찾을 수 없습니다.", 404);
  }
}

async function imageSourceToDataUrl(source: string): Promise<string> {
  const input = await readImageSource(source);
  try {
    const optimized = await sharp(input, { failOn: "none", animated: false })
      .rotate()
      .resize({
        width: 1536,
        height: 1536,
        fit: "inside",
        withoutEnlargement: true,
      })
      .webp({ quality: 90, effort: 4 })
      .toBuffer();
    return `data:image/webp;base64,${optimized.toString("base64")}`;
  } catch {
    throw new RequestError("참조 이미지를 처리하지 못했습니다.");
  }
}

async function callOpenAiImage(opts: {
  model: string;
  prompt: string;
  strictFallbackPrompt: string;
  references: string[];
  requestSize: string;
  outputWidth: number;
  outputHeight: number;
  quality: "low" | "medium" | "high";
  resizeFit?: "fill" | "cover";
  templateId?: string;
  mode?: string;
}): Promise<OpenAiImageGeneratedWithAttempts> {
  try {
    const generated = toOpenAiImageGeneratedWithAttempts(
      await callOpenAiImageEditWithSafetyFallback({
      model: opts.model,
      primaryPrompt: opts.prompt,
      strictFallbackPrompt: opts.strictFallbackPrompt,
      references: opts.references,
      size: opts.requestSize,
      quality: opts.quality,
      outputCompression: 88,
      templateId: opts.templateId,
      mode: opts.mode,
    })
    );
    let output = generated.buffer;

    try {
      const metadata = await sharp(output, { failOn: "none" }).metadata();
      if (!metadata.width || !metadata.height) {
        throw new Error("missing dimensions");
      }
      if (
        metadata.format !== "webp" ||
        metadata.width !== opts.outputWidth ||
        metadata.height !== opts.outputHeight
      ) {
        output = await sharp(output, { failOn: "none" })
          .rotate()
          .resize({
            width: opts.outputWidth,
            height: opts.outputHeight,
            fit: opts.resizeFit ?? "fill",
            position: "centre",
          })
          .webp({ quality: 92, effort: 4 })
          .toBuffer();
      }
    } catch {
      throw new RequestError("생성된 이미지 형식이 올바르지 않습니다.", 502);
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
      throw new RequestError("이미지 생성 시간이 초과되었습니다. 다시 시도해 주세요.", 504);
    }
    throw new RequestError("OpenAI 이미지 생성 중 오류가 발생했습니다.", 502);
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
  generated: OpenAiImageGeneratedWithAttempts
): Record<string, unknown> {
  return formatOpenAiImageProviderAttemptsForAdmin({
    providerAttempts: generated.providerAttempts,
    knownProviderCostUsd: generated.knownProviderCostUsd,
    hasUnknownAttemptCost: generated.hasUnknownAttemptCost,
    safetyFallbackUsed: generated.safetyFallbackUsed,
  });
}

function publicContextResponse(context: GenerationContext, viewerUserId: number) {
  const state = readiness(context);
  const personaState = personaImageReadiness(context.persona);
  const pricePoints = resolveChatImageGenerationPrice();
  const balance = getPointBalance(context.character.id ? 0 : 0);
  void balance;
  const characterAppearance = buildChatImageCharacterAppearanceClientView({
    savedAppearance: context.characterSavedAppearance,
    characterCreatorId: context.character.creator_id,
    viewerUserId,
  });
  const isSimulation = context.contentKind === "simulation";
  return {
    ...state,
    personaReady: isSimulation
      ? personaState.ready
      : personaState.ready && !!context.characterImageUrl,
    personaMissing: isSimulation
      ? [...personaState.missing]
      : [
          ...personaState.missing,
          ...(!context.characterImageUrl ? ["캐릭터 그림체 참조 이미지"] : []),
        ],
    pricePoints,
    modelId: resolveChatImageGenerationModel(),
    modelLabel: "GPT Image 2",
    template: {
      id: CHAT_IMAGE_TEMPLATE_ID,
      name: CHAT_IMAGE_TEMPLATE_NAME,
      previewUrl: CHAT_IMAGE_TEMPLATE_PREVIEW_URL,
    },
    character: {
      id: context.character.id,
      name: context.character.name,
      imageUrl: context.characterImageUrl,
      hasSavedAppearance: characterAppearance.hasSavedAppearance,
      appearancePreview: characterAppearance.appearancePreview,
    },
    contentKind: context.contentKind,
    characterImages: context.characterImages,
    castSelectableAssets: context.castSelectableAssets,
    visualSubjects: context.visualSubjects,
    persona: context.persona
      ? {
          id: context.persona.id,
          name: context.persona.name,
          imageUrl: context.personaImageUrl,
          gender: context.persona.gender,
          appearancePreview: personaState.appearance ?? "",
        }
      : null,
  };
}

export async function GET(req: Request) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "로그인이 필요합니다." }, { status: 401 });

  try {
    const url = new URL(req.url);
    const context = resolveGenerationContext({
      userId: user.id,
      characterId: positiveInt(url.searchParams.get("characterId")),
      chatId: positiveInt(url.searchParams.get("chatId")),
      personaId: positiveInt(url.searchParams.get("personaId")),
    });
    ensureGenerationTable();
    const db = getDb();
    const latest = db
      .prepare(
        `SELECT template_id, options_json, result_url, upstream_cost_usd,
                charged_points, created_at
         FROM chat_image_generations
         WHERE user_id=? AND character_id=? AND persona_id=?
           AND (chat_id IS ? OR chat_id=?)
         ORDER BY id DESC LIMIT 1`
      )
      .get(
        user.id,
        context.character.id,
        context.persona?.id ?? -1,
        context.chatId,
        context.chatId
      ) as
      | {
          template_id: string;
          options_json: string;
          result_url: string;
          upstream_cost_usd: number | null;
          charged_points: number;
          created_at: string;
        }
      | undefined;
    let latestOptions: {
      mode?: "sd" | "emoticon" | "couple_stamp" | "comic" | "illustration" | "persona";
      title?: string;
      panelCount?: ChatComicPanelCount;
    } = {};
    if (latest?.options_json) {
      try {
        latestOptions = JSON.parse(latest.options_json) as typeof latestOptions;
      } catch {
        latestOptions = {};
      }
    }
    const latestMode:
      | "sd"
      | "emoticon"
      | "couple_stamp"
      | "comic"
      | "illustration"
      | "persona" =
      latest?.template_id === CHAT_COMIC_TEMPLATE_ID || latestOptions.mode === "comic"
        ? "comic"
        : latest?.template_id === CHAT_PERSONA_IMAGE_TEMPLATE_ID ||
            latestOptions.mode === "persona"
          ? "persona"
        : latest?.template_id === CHAT_LD_ILLUSTRATION_TEMPLATE_ID ||
            latestOptions.mode === "illustration"
          ? "illustration"
        : latest?.template_id === CHAT_COUPLE_STAMP_TEMPLATE_ID ||
            latestOptions.mode === "couple_stamp"
          ? "couple_stamp"
        : latest?.template_id === CHAT_EMOTICON_TEMPLATE_ID ||
            latestOptions.mode === "emoticon"
          ? "emoticon"
          : "sd";
    const canSeeCost = isAdminUser(user as typeof user & { is_admin?: number });
    const exchangeRateKrwPerUsd = getEffectiveKrwPerUsd();
    const currentImageModel = resolveChatImageGenerationModel();
    const upstreamCostUsd =
      latest?.upstream_cost_usd != null &&
      latest.upstream_cost_usd > 0 &&
      Number.isFinite(latest.upstream_cost_usd)
        ? latest.upstream_cost_usd
        : null;
    const averageRows = canSeeCost
      ? (db
          .prepare(
            `SELECT template_id,
                    CASE
                      WHEN template_id = ? AND json_valid(options_json)
                      THEN CAST(json_extract(options_json, '$.panelCount') AS INTEGER)
                      ELSE NULL
                    END AS panel_count,
                    AVG(upstream_cost_usd) AS average_cost_usd,
                    COUNT(*) AS sample_count
             FROM chat_image_generations
             WHERE upstream_cost_usd IS NOT NULL
               AND upstream_cost_usd > 0
               AND model = ?
               AND (
                 template_id = ?
                 OR (
                   json_valid(options_json)
                   AND json_extract(options_json, '$.quality') = 'medium'
                 )
               )
               AND template_id IN (?, ?, ?, ?, ?, ?)
             GROUP BY template_id, panel_count`
          )
          .all(
            CHAT_COMIC_TEMPLATE_ID,
            currentImageModel,
            CHAT_COMIC_TEMPLATE_ID,
            CHAT_IMAGE_TEMPLATE_ID,
            CHAT_EMOTICON_TEMPLATE_ID,
            CHAT_COUPLE_STAMP_TEMPLATE_ID,
            CHAT_LD_ILLUSTRATION_TEMPLATE_ID,
            CHAT_PERSONA_IMAGE_TEMPLATE_ID,
            CHAT_COMIC_TEMPLATE_ID
          ) as Array<{
          template_id: string;
          panel_count: number | null;
          average_cost_usd: number;
          sample_count: number;
        }>)
      : [];
    const averageCost = (templateId: string, panelCount?: ChatComicPanelCount) => {
      const row = averageRows.find(
        (item) =>
          item.template_id === templateId &&
          (panelCount == null || item.panel_count === panelCount)
      );
      const averageUsd =
        row && Number.isFinite(row.average_cost_usd) ? row.average_cost_usd : null;
      return {
        averageUsd,
        averageKrw:
          averageUsd == null
            ? null
            : Math.round(averageUsd * exchangeRateKrwPerUsd * 10) / 10,
        sampleCount: row?.sample_count ?? 0,
      };
    };
    return NextResponse.json({
      ...publicContextResponse(context, user.id),
      balance: getPointBalance(user.id),
      activeJob: findLatestChatImageGenerationJob({
        userId: user.id,
        characterId: context.character.id,
        chatId: context.chatId,
      }),
      averageCosts: canSeeCost
        ? {
            exchangeRateKrwPerUsd,
            sd: averageCost(CHAT_IMAGE_TEMPLATE_ID),
            emoticon: averageCost(CHAT_EMOTICON_TEMPLATE_ID),
            coupleStamp: averageCost(CHAT_COUPLE_STAMP_TEMPLATE_ID),
            persona: averageCost(CHAT_PERSONA_IMAGE_TEMPLATE_ID),
            illustration: averageCost(CHAT_LD_ILLUSTRATION_TEMPLATE_ID),
            comic: {
              2: averageCost(CHAT_COMIC_TEMPLATE_ID, 2),
              3: averageCost(CHAT_COMIC_TEMPLATE_ID, 3),
              4: averageCost(CHAT_COMIC_TEMPLATE_ID, 4),
            },
          }
        : undefined,
      latestResult: latest
        ? {
            imageUrl: latest.result_url,
            chargedPoints: latest.charged_points,
            createdAt: latest.created_at,
            mode: latestMode,
            title: latestOptions.title,
            panelCount: latestOptions.panelCount,
            upstreamCostUsd: canSeeCost ? upstreamCostUsd : undefined,
            upstreamCostKrw:
              canSeeCost && upstreamCostUsd != null
                ? Math.round(upstreamCostUsd * exchangeRateKrwPerUsd * 10) / 10
                : undefined,
          }
        : null,
    });
  } catch (error) {
    const status = error instanceof RequestError ? error.status : 500;
    const message = error instanceof Error ? error.message : "이미지 생성 정보를 불러오지 못했습니다.";
    return NextResponse.json({ error: message }, { status });
  }
}

export async function POST(req: Request) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "로그인이 필요합니다." }, { status: 401 });

  let savedPath: string | null = null;
  let jobId: number | null = null;
  try {
    if (hasRunningChatImageGenerationJob(user.id)) {
      return NextResponse.json(
        { error: "이미 생성 중인 이미지가 있습니다. 완료된 뒤에 다시 시도해 주세요." },
        { status: 409 }
      );
    }
    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
    const isPersona = body.templateId === CHAT_PERSONA_IMAGE_TEMPLATE_ID;
    const context = resolveGenerationContext({
      userId: user.id,
      characterId: positiveInt(body.characterId),
      chatId: positiveInt(body.chatId),
      personaId: positiveInt(body.personaId),
      requestedCharacterImageUrl: body.characterImageUrl,
      strictPersona: isPersona,
    });
    const isEmoticon = body.templateId === CHAT_EMOTICON_TEMPLATE_ID;
    const isCoupleStamp = body.templateId === CHAT_COUPLE_STAMP_TEMPLATE_ID;
    const templateId = isPersona
      ? CHAT_PERSONA_IMAGE_TEMPLATE_ID
      : isCoupleStamp
      ? CHAT_COUPLE_STAMP_TEMPLATE_ID
      : isEmoticon
        ? CHAT_EMOTICON_TEMPLATE_ID
        : CHAT_IMAGE_TEMPLATE_ID;
    const templateName = isPersona
      ? CHAT_PERSONA_IMAGE_TEMPLATE_NAME
      : isCoupleStamp
      ? CHAT_COUPLE_STAMP_TEMPLATE_NAME
      : isEmoticon
        ? CHAT_EMOTICON_TEMPLATE_NAME
        : CHAT_IMAGE_TEMPLATE_NAME;
    const quality = isPersona
      ? CHAT_PERSONA_IMAGE_QUALITY
      : isCoupleStamp
      ? CHAT_COUPLE_STAMP_QUALITY
      : isEmoticon
        ? CHAT_EMOTICON_QUALITY
        : CHAT_IMAGE_GENERATION_QUALITY;
    const state = isPersona ? personaImageReadiness(context.persona) : readiness(context);
    if (!context.characterImageUrl) {
      throw new RequestError(
        isPersona ? "캐릭터 그림체 참조 이미지가 필요합니다." : "캐릭터 대표 이미지가 필요합니다."
      );
    }
    if (!state.ready || !context.persona) {
      throw new RequestError(`${state.missing.join(", ")}가 필요합니다.`);
    }

    const pricePoints = isPersona
      ? resolveChatPersonaImagePrice()
      : isCoupleStamp
      ? resolveChatCoupleStampPrice()
      : isEmoticon
        ? resolveChatEmoticonPrice()
        : resolveChatImageGenerationPrice();
    const balanceBefore = getPointBalance(user.id);
    if (balanceBefore.total < pricePoints) {
      return NextResponse.json(
        {
          error: `포인트가 부족합니다. 이미지 생성에는 ${pricePoints.toLocaleString()}P가 필요합니다.`,
          pricePoints,
          balance: balanceBefore,
        },
        { status: 402 }
      );
    }

    const appearanceModes = resolveRequestAppearanceModes({
      characterImages: context.characterImages,
      selectedCharacterImageUrl: context.characterImageUrl,
      characterSavedAppearance: context.characterSavedAppearance,
      personaSavedAppearance: context.personaSavedAppearance,
      characterOverride: body.characterAppearanceMode,
      personaOverride: body.personaAppearanceMode,
    });
    let prompt: string;
    let strictFallbackPrompt: string;
    let referenceSources: string[];
    let generationOptions: Record<string, unknown>;
    if (isPersona) {
      const personaState = personaImageReadiness(context.persona);
      prompt = buildChatPersonaImagePrompt({
        personaName: context.persona.name,
        gender: context.persona.gender,
        appearance: personaState.appearance ?? "",
        characterName: context.character.name,
      });
      strictFallbackPrompt = buildStrictPersonaFallbackPrompt({
        personaName: context.persona.name,
        gender: context.personaGender,
        characterName: context.character.name,
      });
      // The edit endpoint accepts an image array, so the character artwork is a
      // direct style reference. Persona identity remains text-authoritative.
      referenceSources = [context.characterImageUrl];
      generationOptions = {
        mode: "persona",
        quality,
        apiOutputSize: CHAT_PERSONA_IMAGE_API_OUTPUT_SIZE,
        outputSize: `${CHAT_PERSONA_IMAGE_OUTPUT_WIDTH}x${CHAT_PERSONA_IMAGE_OUTPUT_HEIGHT}`,
        styleReference: "character_image",
      };
    } else if (isCoupleStamp) {
      const coupleOptions = sanitizeChatCoupleStampOptions({
        height: body.coupleHeight,
        background: body.coupleBackground,
        border: body.coupleBorder,
        characterExpression: body.coupleCharacterExpression,
        personaExpression: body.couplePersonaExpression,
      });
      const plan = buildCoupleStampGenerationPlan({
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
        options: coupleOptions,
      });
      prompt = plan.prompt;
      strictFallbackPrompt = buildStrictCoupleStampFallbackPrompt({
        characterName: context.character.name,
        characterGender: context.characterGender,
        personaName: context.persona.name,
        personaGender: context.personaGender,
        subjects: plan.subjects,
      });
      referenceSources = plan.referenceUrls;
      generationOptions = {
        mode: "couple_stamp",
        quality,
        ...coupleOptions,
        characterAppearanceMode: appearanceModes.characterAppearanceMode,
        personaAppearanceMode: appearanceModes.personaAppearanceMode,
      };
    } else if (isEmoticon) {
      const scenes = selectRandomChatEmoticonScenes();
      const plan = buildEmoticonGenerationPlan({
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
        scenes,
      });
      prompt = plan.prompt;
      strictFallbackPrompt = buildStrictEmoticonFallbackPrompt({
        characterName: context.character.name,
        characterGender: context.characterGender,
        personaName: context.persona.name,
        personaGender: context.personaGender,
        subjects: plan.subjects,
      });
      referenceSources = plan.referenceUrls;
      generationOptions = {
        mode: "emoticon",
        quality,
        scenes,
        characterAppearanceMode: appearanceModes.characterAppearanceMode,
        personaAppearanceMode: appearanceModes.personaAppearanceMode,
      };
    } else {
      const options = sanitizeChatImageGenerationOptions({
        placement: body.placement,
        topExpression: body.topExpression,
        bottomExpression: body.bottomExpression,
        mood: body.mood,
      });
      const plan = buildGiftBoxGenerationPlan({
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
        ...options,
      });
      prompt = plan.prompt;
      strictFallbackPrompt = buildStrictSdFallbackPrompt({
        characterName: context.character.name,
        characterGender: context.characterGender,
        personaName: context.persona.name,
        personaGender: context.personaGender,
        subjects: plan.subjects,
        moodLabel: CHAT_IMAGE_MOODS.find((item) => item.id === options.mood)?.label,
      });
      referenceSources = plan.referenceUrls;
      generationOptions = {
        mode: "sd",
        ...options,
        quality,
        characterAppearanceMode: appearanceModes.characterAppearanceMode,
        personaAppearanceMode: appearanceModes.personaAppearanceMode,
      };
    }

    const mode = isPersona
      ? "persona"
      : isCoupleStamp
        ? "couple_stamp"
        : isEmoticon
          ? "emoticon"
          : "sd";
    // Written before the upstream call so a refreshed client still sees 생성중.
    jobId = startChatImageGenerationJob({
      userId: user.id,
      chatId: context.chatId,
      characterId: context.character.id,
      personaId: context.persona.id,
      templateId,
      mode,
    });

    const references = await Promise.all(
      referenceSources.map((source) => imageSourceToDataUrl(source))
    );

    const model = resolveChatImageGenerationModel();
    const generated = await callOpenAiImage({
      model,
      prompt,
      strictFallbackPrompt,
      references,
      templateId,
      mode,
      requestSize: isEmoticon
        ? CHAT_EMOTICON_API_OUTPUT_SIZE
        : isPersona
          ? CHAT_PERSONA_IMAGE_API_OUTPUT_SIZE
        : isCoupleStamp
          ? CHAT_COUPLE_STAMP_API_OUTPUT_SIZE
          : CHAT_IMAGE_GENERATION_OUTPUT_SIZE,
      outputWidth: isEmoticon
        ? CHAT_EMOTICON_OUTPUT_WIDTH
        : isPersona
          ? CHAT_PERSONA_IMAGE_OUTPUT_WIDTH
        : isCoupleStamp
          ? CHAT_COUPLE_STAMP_OUTPUT_WIDTH
          : CHAT_IMAGE_GENERATION_OUTPUT_WIDTH,
      outputHeight: isEmoticon
        ? CHAT_EMOTICON_OUTPUT_HEIGHT
        : isPersona
          ? CHAT_PERSONA_IMAGE_OUTPUT_HEIGHT
        : isCoupleStamp
          ? CHAT_COUPLE_STAMP_OUTPUT_HEIGHT
          : CHAT_IMAGE_GENERATION_OUTPUT_HEIGHT,
      quality,
      resizeFit: isPersona ? "cover" : undefined,
    });

    await fs.mkdir(uploadsDataDir(), { recursive: true });
    const filename = `${
      isPersona
        ? "ai-persona-ld"
        : isCoupleStamp
          ? "ai-couple-stamp"
          : isEmoticon
            ? "ai-emoticon"
            : "ai-sd"
    }-${crypto.randomUUID()}.webp`;
    savedPath = path.join(uploadsDataDir(), filename);
    await fs.writeFile(savedPath, generated.buffer);
    const resultUrl = uploadPublicUrl(filename);

    let deduction;
    try {
      deduction = deductPoints(
        user.id,
        pricePoints,
        `GPT Image 2 · ${templateName}`,
        context.chatId ? { chatId: context.chatId } : undefined
      );
    } catch (error) {
      await fs.unlink(savedPath).catch(() => {});
      savedPath = null;
      const attemptsJson = providerAttemptsJsonFromGenerated(generated);
      if (error instanceof InsufficientPointsError) {
        finishChatImageGenerationJob({
          jobId,
          status: "failed",
          errorMessage: "포인트가 부족합니다.",
          providerAttemptsJson: attemptsJson,
        });
        jobId = null;
        return NextResponse.json(
          {
            error: `포인트가 부족합니다. 이미지 생성에는 ${pricePoints.toLocaleString()}P가 필요합니다.`,
            pricePoints,
            balance: error.balance,
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
          templateId,
          model,
          JSON.stringify(generationOptions),
          resultUrl,
          generated.knownProviderCostUsd,
          deduction.total,
          JSON.stringify(deduction.slices),
          getEffectiveKrwPerUsd()
        );
      generationId = Number(insert.lastInsertRowid);
      if (!isPersona) {
        const albumMode = isCoupleStamp
          ? "couple_stamp"
          : isEmoticon
            ? "emoticon"
            : "sd";
        saveGeneratedImageToCharacterAlbum({
          userId: user.id,
          characterId: context.character.id,
          personaId: context.persona.id,
          chatId: context.chatId,
          generationId,
          imageUrl: resultUrl,
          mode: albumMode,
        });
        savedToCharacterAlbum = true;
      }
    } catch (error) {
      console.error("[chat-image-generation] history/album insert failed", error);
    }

    finishChatImageGenerationJob({
      jobId,
      status: "completed",
      resultUrl,
      providerAttemptsJson: providerAttemptsJsonFromGenerated(generated),
    });
    jobId = null;

    const costKrw =
      generated.knownProviderCostUsd == null
        ? null
        : Math.round(generated.knownProviderCostUsd * getEffectiveKrwPerUsd() * 10) / 10;
    const canSeeCost = isAdminUser(user as typeof user & { is_admin?: number });
    console.info("[chat-image-generation] completed", {
      userId: user.id,
      chatId: context.chatId,
      characterId: context.character.id,
      personaId: context.persona.id,
      model,
      quality,
      templateId,
      upstreamCostUsd: generated.knownProviderCostUsd,
      upstreamCostKrw: costKrw,
      chargedPoints: deduction.total,
      hasUnknownAttemptCost: generated.hasUnknownAttemptCost,
    });

    return NextResponse.json({
      ok: true,
      mode,
      imageUrl: resultUrl,
      templateId,
      modelId: model,
      modelLabel: "GPT Image 2",
      quality,
      savedToCharacterAlbum,
      upstreamCostUsd: canSeeCost ? generated.knownProviderCostUsd : undefined,
      upstreamCostKrw: canSeeCost ? costKrw : undefined,
      ...(canSeeCost
        ? { providerAttemptDiagnostic: adminProviderAttemptDiagnostic(generated) }
        : {}),
      pricePoints: deduction.total,
      totalPointsCost: deduction.total,
      remainingPoints: deduction.balance.total,
      paidPoints: deduction.balance.paid,
      freePoints: deduction.balance.free,
    });
  } catch (error) {
    if (savedPath) await fs.unlink(savedPath).catch(() => {});
    const status = error instanceof RequestError ? error.status : 500;
    const message = error instanceof Error ? error.message : "이미지 생성에 실패했습니다.";
    const diagnostic =
      error instanceof RequestError ? error.imageFailureDiagnostic : undefined;
    const providerAttempts =
      error instanceof RequestError ? error.providerAttempts : undefined;
    const attemptsJson = providerAttempts?.length
      ? serializeOpenAiImageProviderAttempts(providerAttempts)
      : null;
    finishChatImageGenerationJob({
      jobId,
      status: "failed",
      errorMessage: message,
      failureDiagnosticJson: diagnostic
        ? serializeOpenAiImageFailureDiagnostic(diagnostic)
        : null,
      providerAttemptsJson: attemptsJson,
    });
    const canSeeCost = isAdminUser(user as typeof user & { is_admin?: number });
    console.error("[chat-image-generation] failed", {
      status,
      message,
      imageAttemptDiagnostic: diagnostic
        ? formatOpenAiImageFailureDiagnosticForAdmin(diagnostic)
        : undefined,
    });
    return NextResponse.json(
      {
        error: message,
        ...(canSeeCost && diagnostic
          ? {
              imageAttemptDiagnostic: formatOpenAiImageFailureDiagnosticForAdmin(diagnostic),
            }
          : {}),
        ...(canSeeCost && providerAttempts?.length
          ? {
              providerAttemptDiagnostic: formatOpenAiImageProviderAttemptsForAdmin({
                providerAttempts,
                knownProviderCostUsd: aggregateKnownProviderCostUsd(providerAttempts),
                hasUnknownAttemptCost: providerAttempts.some(
                  (attempt) => attempt.costUsd == null
                ),
                safetyFallbackUsed: providerAttempts.some(
                  (attempt) => attempt.kind === "strict_safety_fallback" && attempt.outcome === "success"
                ),
              }),
            }
          : {}),
      },
      { status }
    );
  }
}
