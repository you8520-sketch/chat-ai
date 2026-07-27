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
import { isAdminUser } from "@/lib/isAdminUser";
import {
  selectCharacterImageUrl,
  type SelectableCharacterImage,
} from "@/lib/chatCharacterImageSelection";
import { listSelectableCharacterImages } from "@/lib/chatCharacterImageSelection.server";
import {
  CHAT_IMAGE_TEMPLATE_ID,
  CHAT_IMAGE_TEMPLATE_NAME,
  CHAT_IMAGE_TEMPLATE_PREVIEW_URL,
  CHAT_IMAGE_GENERATION_OUTPUT_HEIGHT,
  CHAT_IMAGE_GENERATION_OUTPUT_SIZE,
  CHAT_IMAGE_GENERATION_OUTPUT_WIDTH,
  CHAT_IMAGE_GENERATION_QUALITY,
  buildChatImageGenerationPrompt,
  resolveChatImageGenerationModel,
  resolveChatImageGenerationPrice,
  resolveChatImageReferenceOrder,
  sanitizeChatImageGenerationOptions,
} from "@/lib/chatImageGeneration";
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
const TEMPLATE_FILE = path.join(
  process.cwd(),
  "public",
  "image-templates",
  "sd-gift-box-duo.webp"
);

type CharacterRow = {
  id: number;
  name: string;
  assets: string;
  images: string;
  creator_id: number | null;
  visibility: string;
};

type PersonaRow = {
  id: number;
  name: string;
  image_url: string;
};

type ChatRow = {
  id: number;
  character_id: number;
  selected_persona_id: number | null;
};

type GenerationContext = {
  chatId: number | null;
  character: CharacterRow;
  persona: PersonaRow | null;
  characterImageUrl: string;
  characterImages: SelectableCharacterImage[];
  personaImageUrl: string;
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
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_chat_image_generations_user_recent
      ON chat_image_generations(user_id, created_at DESC, id DESC);
  `);
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
      "SELECT id, name, assets, images, creator_id, visibility FROM characters WHERE id=?"
    )
    .get(characterId) as CharacterRow | undefined;
  if (!character) throw new RequestError("캐릭터를 찾을 수 없습니다.", 404);
  if (character.visibility === "private" && character.creator_id !== opts.userId) {
    throw new RequestError("캐릭터를 찾을 수 없습니다.", 404);
  }

  let persona: PersonaRow | undefined;
  if (selectedPersonaId) {
    persona = db
      .prepare("SELECT id, name, image_url FROM user_personas WHERE id=? AND user_id=?")
      .get(selectedPersonaId, opts.userId) as PersonaRow | undefined;
  }
  if (!persona) {
    persona = db
      .prepare(
        "SELECT id, name, image_url FROM user_personas WHERE user_id=? ORDER BY created_at ASC, id ASC LIMIT 1"
      )
      .get(opts.userId) as PersonaRow | undefined;
  }

  const characterImages = listSelectableCharacterImages({
    userId: opts.userId,
    characterId: character.id,
    creatorId: character.creator_id,
    assetsRaw: character.assets,
    imagesRaw: character.images,
  });
  const characterImageUrl =
    selectCharacterImageUrl(characterImages, opts.requestedCharacterImageUrl) ?? "";
  if (opts.requestedCharacterImageUrl && !characterImageUrl) {
    throw new RequestError("선택할 수 없는 캐릭터 이미지입니다.", 403);
  }
  const personaImageUrl = persona
    ? personaImageBaseUrl(sanitizePersonaImageUrl(persona.image_url))
    : "";

  return {
    chatId,
    character,
    persona: persona ?? null,
    characterImageUrl,
    characterImages,
    personaImageUrl,
  };
}

function readiness(context: GenerationContext) {
  const missing: string[] = [];
  if (!context.characterImageUrl) missing.push("캐릭터 대표 이미지");
  if (!context.persona) missing.push("유저 페르소나");
  else if (!context.personaImageUrl) missing.push("페르소나 대표 이미지");
  return { ready: missing.length === 0, missing };
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
  references: string[];
}): Promise<{ buffer: Buffer; costUsd: number | null }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 285_000);
  try {
    const generated = await callOpenAiImageEdit({
      model: opts.model,
      prompt: opts.prompt,
      references: opts.references,
      size: CHAT_IMAGE_GENERATION_OUTPUT_SIZE,
      quality: CHAT_IMAGE_GENERATION_QUALITY,
      outputCompression: 88,
      signal: controller.signal,
    });
    let output = generated.buffer;

    try {
      const metadata = await sharp(output, { failOn: "none" }).metadata();
      if (!metadata.width || !metadata.height) {
        throw new Error("missing dimensions");
      }
      if (
        metadata.format !== "webp" ||
        metadata.width !== CHAT_IMAGE_GENERATION_OUTPUT_WIDTH ||
        metadata.height !== CHAT_IMAGE_GENERATION_OUTPUT_HEIGHT
      ) {
        output = await sharp(output, { failOn: "none" })
          .rotate()
          .resize({
            width: CHAT_IMAGE_GENERATION_OUTPUT_WIDTH,
            height: CHAT_IMAGE_GENERATION_OUTPUT_HEIGHT,
            fit: "fill",
          })
          .webp({ quality: 92, effort: 4 })
          .toBuffer();
      }
    } catch {
      throw new RequestError("생성된 이미지 형식이 올바르지 않습니다.", 502);
    }

    return {
      buffer: output,
      costUsd: generated.costUsd,
    };
  } catch (error) {
    if (error instanceof RequestError) throw error;
    if (error instanceof OpenAiImageError) {
      throw new RequestError(error.message, error.status);
    }
    if (error instanceof Error && error.name === "AbortError") {
      throw new RequestError("이미지 생성 시간이 초과되었습니다. 다시 시도해 주세요.", 504);
    }
    throw new RequestError("OpenAI 이미지 생성 중 오류가 발생했습니다.", 502);
  } finally {
    clearTimeout(timer);
  }
}

function publicContextResponse(context: GenerationContext) {
  const state = readiness(context);
  const pricePoints = resolveChatImageGenerationPrice();
  const balance = getPointBalance(context.character.id ? 0 : 0);
  void balance;
  return {
    ...state,
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
    },
    characterImages: context.characterImages,
    persona: context.persona
      ? {
          id: context.persona.id,
          name: context.persona.name,
          imageUrl: context.personaImageUrl,
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
    const latest = getDb()
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
      mode?: "sd" | "comic";
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
    const latestMode: "sd" | "comic" =
      latest?.template_id === CHAT_COMIC_TEMPLATE_ID || latestOptions.mode === "comic"
        ? "comic"
        : "sd";
    const canSeeCost = isAdminUser(user as typeof user & { is_admin?: number });
    const upstreamCostUsd =
      latest?.upstream_cost_usd != null &&
      latest.upstream_cost_usd > 0 &&
      Number.isFinite(latest.upstream_cost_usd)
        ? latest.upstream_cost_usd
        : null;
    return NextResponse.json({
      ...publicContextResponse(context),
      balance: getPointBalance(user.id),
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
                ? Math.round(upstreamCostUsd * getEffectiveKrwPerUsd() * 10) / 10
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
  try {
    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
    const context = resolveGenerationContext({
      userId: user.id,
      characterId: positiveInt(body.characterId),
      chatId: positiveInt(body.chatId),
      personaId: positiveInt(body.personaId),
      requestedCharacterImageUrl: body.characterImageUrl,
    });
    const quality = CHAT_IMAGE_GENERATION_QUALITY;
    const state = readiness(context);
    if (!state.ready || !context.persona) {
      throw new RequestError(`${state.missing.join(", ")}가 필요합니다.`);
    }

    const pricePoints = resolveChatImageGenerationPrice();
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

    const options = sanitizeChatImageGenerationOptions({
      placement: body.placement,
      topExpression: body.topExpression,
      bottomExpression: body.bottomExpression,
      mood: body.mood,
    });
    const order = resolveChatImageReferenceOrder({
      characterName: context.character.name,
      characterImageUrl: context.characterImageUrl,
      personaName: context.persona.name,
      personaImageUrl: context.personaImageUrl,
      placement: options.placement,
    });
    const prompt = buildChatImageGenerationPrompt({
      characterName: context.character.name,
      personaName: context.persona.name,
      ...options,
    });

    const [templateReference, topReference, bottomReference] = await Promise.all([
      imageSourceToDataUrl(CHAT_IMAGE_TEMPLATE_PREVIEW_URL),
      imageSourceToDataUrl(order.top.imageUrl),
      imageSourceToDataUrl(order.bottom.imageUrl),
    ]);

    const model = resolveChatImageGenerationModel();
    const generated = await callOpenAiImage({
      model,
      prompt,
      references: [templateReference, topReference, bottomReference],
    });

    await fs.mkdir(uploadsDataDir(), { recursive: true });
    const filename = `ai-sd-${crypto.randomUUID()}.webp`;
    savedPath = path.join(uploadsDataDir(), filename);
    await fs.writeFile(savedPath, generated.buffer);
    const resultUrl = uploadPublicUrl(filename);

    let deduction;
    try {
      deduction = deductPoints(
        user.id,
        pricePoints,
        `GPT Image 2 · ${CHAT_IMAGE_TEMPLATE_NAME}`,
        context.chatId ? { chatId: context.chatId } : undefined
      );
    } catch (error) {
      await fs.unlink(savedPath).catch(() => {});
      savedPath = null;
      if (error instanceof InsufficientPointsError) {
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
             options_json, result_url, upstream_cost_usd, charged_points
           ) VALUES (?,?,?,?,?,?,?,?,?,?)`
        )
        .run(
          user.id,
          context.chatId,
          context.character.id,
          context.persona.id,
          CHAT_IMAGE_TEMPLATE_ID,
          model,
          JSON.stringify({ ...options, quality }),
          resultUrl,
          generated.costUsd,
          deduction.total
        );
      generationId = Number(insert.lastInsertRowid);
      saveGeneratedImageToCharacterAlbum({
        userId: user.id,
        characterId: context.character.id,
        personaId: context.persona.id,
        chatId: context.chatId,
        generationId,
        imageUrl: resultUrl,
        mode: "sd",
      });
      savedToCharacterAlbum = true;
    } catch (error) {
      console.error("[chat-image-generation] history/album insert failed", error);
    }

    const costKrw =
      generated.costUsd == null
        ? null
        : Math.round(generated.costUsd * getEffectiveKrwPerUsd() * 10) / 10;
    console.info("[chat-image-generation] completed", {
      userId: user.id,
      chatId: context.chatId,
      characterId: context.character.id,
      personaId: context.persona.id,
      model,
      quality,
      templateId: CHAT_IMAGE_TEMPLATE_ID,
      upstreamCostUsd: generated.costUsd,
      upstreamCostKrw: costKrw,
      chargedPoints: deduction.total,
    });

    return NextResponse.json({
      ok: true,
      imageUrl: resultUrl,
      modelId: model,
      modelLabel: "GPT Image 2",
      quality,
      savedToCharacterAlbum,
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
    console.error("[chat-image-generation] failed", {
      status,
      message,
      error: error instanceof RequestError ? undefined : error,
    });
    return NextResponse.json({ error: message }, { status });
  }
}
