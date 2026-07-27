import crypto from "crypto";
import fs from "fs/promises";
import path from "path";
import { NextResponse } from "next/server";
import sharp from "sharp";

import { getSessionUser } from "@/lib/auth";
import {
  selectCharacterImageUrl,
} from "@/lib/chatCharacterImageSelection";
import { listSelectableCharacterImages } from "@/lib/chatCharacterImageSelection.server";
import {
  CHAT_COMIC_MAX_INPUT_CHARS,
  CHAT_COMIC_IMAGE_OUTPUT_SIZE,
  CHAT_COMIC_TEMPLATE_ID,
  CHAT_COMIC_TEMPLATE_NAME,
  CHAT_COMIC_TEMPLATE_PREVIEW_URL,
  buildChatComicImagePrompt,
  buildChatComicPlannerPrompt,
  resolveChatComicPlannerModel,
  resolveChatComicPrice,
  sanitizeChatComicOptions,
  sanitizeChatComicPlan,
  type ChatComicPlan,
} from "@/lib/chatComicGeneration";
import { resolveChatImageGenerationModel } from "@/lib/chatImageGeneration";
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

const OPENAI_CHAT_URL = "https://api.openai.com/v1/chat/completions";
const MAX_REFERENCE_BYTES = 12 * 1024 * 1024;

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
  persona: PersonaRow;
  characterImageUrl: string;
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
  if (!persona) throw new RequestError("유저 페르소나가 필요합니다.");

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
  const personaImageUrl = personaImageBaseUrl(sanitizePersonaImageUrl(persona.image_url));
  if (!characterImageUrl) throw new RequestError("캐릭터 대표 이미지가 필요합니다.");
  if (!personaImageUrl) throw new RequestError("페르소나 대표 이미지가 필요합니다.");

  return {
    chatId,
    character,
    persona,
    characterImageUrl,
    personaImageUrl,
  };
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

function openAiHeaders(): Record<string, string> {
  const apiKey = process.env.OPENAI_API_KEY?.trim();
  if (!apiKey) throw new RequestError("OpenAI API 키가 설정되지 않았습니다.", 503);
  return {
    Authorization: `Bearer ${apiKey}`,
    "Content-Type": "application/json",
    Accept: "application/json",
  };
}

function upstreamMessage(data: unknown, fallback: string): string {
  if (!data || typeof data !== "object") return fallback;
  const error = (data as { error?: unknown }).error;
  if (typeof error === "string" && error.trim()) return error.slice(0, 240);
  if (error && typeof error === "object") {
    const message = (error as { message?: unknown }).message;
    if (typeof message === "string" && message.trim()) return message.slice(0, 240);
  }
  return fallback;
}

function stripJsonFence(raw: string): string {
  return raw
    .trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/, "")
    .trim();
}

function plannerCostUsd(
  model: string,
  usage: { prompt_tokens?: unknown; completion_tokens?: unknown } | null | undefined
): number | null {
  if (model !== "gpt-4o-mini" || !usage) return null;
  const promptTokens = Number(usage.prompt_tokens);
  const completionTokens = Number(usage.completion_tokens);
  if (
    !Number.isFinite(promptTokens) ||
    promptTokens < 0 ||
    !Number.isFinite(completionTokens) ||
    completionTokens < 0
  ) {
    return null;
  }
  return promptTokens * 0.00000015 + completionTokens * 0.0000006;
}

async function planComic(opts: {
  characterName: string;
  personaName: string;
  panelCount: 2 | 3 | 4;
  mood: "comic" | "lovely" | "daily" | "serious";
  sourceText: string;
}): Promise<{ plan: ChatComicPlan; costUsd: number | null; model: string }> {
  const model = resolveChatComicPlannerModel();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 60_000);
  try {
    const response = await fetch(OPENAI_CHAT_URL, {
      method: "POST",
      headers: openAiHeaders(),
      signal: controller.signal,
      body: JSON.stringify({
        model,
        temperature: 0.2,
        max_tokens: 1800,
        response_format: { type: "json_object" },
        messages: [
          {
            role: "user",
            content: buildChatComicPlannerPrompt(opts),
          },
        ],
      }),
    });
    const text = await response.text();
    let data: unknown = null;
    try {
      data = text ? JSON.parse(text) : null;
    } catch {
      data = null;
    }
    if (!response.ok) {
      throw new RequestError(upstreamMessage(data, "컷 구성을 만들지 못했습니다."), 502);
    }
    const content = (data as { choices?: Array<{ message?: { content?: unknown } }> })
      ?.choices?.[0]?.message?.content;
    if (typeof content !== "string" || !content.trim()) {
      throw new RequestError("컷 구성 응답이 비어 있습니다.", 502);
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(stripJsonFence(content));
    } catch {
      throw new RequestError("컷 구성 응답을 해석하지 못했습니다.", 502);
    }
    const costUsd = plannerCostUsd(
      model,
      (data as {
        usage?: { prompt_tokens?: unknown; completion_tokens?: unknown };
      })?.usage
    );
    return {
      plan: sanitizeChatComicPlan(parsed, opts.panelCount),
      costUsd,
      model,
    };
  } catch (error) {
    if (error instanceof RequestError) throw error;
    if (error instanceof Error && error.name === "AbortError") {
      throw new RequestError("컷 구성 시간이 초과되었습니다.", 504);
    }
    throw new RequestError("컷 구성 중 오류가 발생했습니다.", 502);
  } finally {
    clearTimeout(timer);
  }
}

async function generateComicImage(opts: {
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
      size: CHAT_COMIC_IMAGE_OUTPUT_SIZE,
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
      throw new RequestError(error.message, error.status);
    }
    if (error instanceof Error && error.name === "AbortError") {
      throw new RequestError("컷만화 생성 시간이 초과되었습니다. 다시 시도해 주세요.", 504);
    }
    throw new RequestError("OpenAI 컷만화 이미지 생성 중 오류가 발생했습니다.", 502);
  } finally {
    clearTimeout(timer);
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
    const options = sanitizeChatComicOptions({
      panelCount: body.panelCount,
      mood: body.mood,
      sourceText: body.sourceText,
    });
    if (!options.sourceText) throw new RequestError("만화로 만들 내용을 입력해 주세요.");
    if (String(body.sourceText ?? "").trim().length > CHAT_COMIC_MAX_INPUT_CHARS) {
      throw new RequestError(`내용은 최대 ${CHAT_COMIC_MAX_INPUT_CHARS}자까지 입력할 수 있습니다.`);
    }

    const pricePoints = resolveChatComicPrice(options.panelCount);
    const balanceBefore = getPointBalance(user.id);
    if (balanceBefore.total < pricePoints) {
      return NextResponse.json(
        {
          error: `포인트가 부족합니다. ${options.panelCount}컷 만화에는 ${pricePoints.toLocaleString()}P가 필요합니다.`,
          pricePoints,
          remainingPoints: balanceBefore.total,
          paidPoints: balanceBefore.paid,
          freePoints: balanceBefore.free,
        },
        { status: 402 }
      );
    }

    const planned = await planComic({
      characterName: context.character.name,
      personaName: context.persona.name,
      ...options,
    });
    const prompt = buildChatComicImagePrompt({
      characterName: context.character.name,
      personaName: context.persona.name,
      plan: planned.plan,
      ...options,
    });
    const [styleReference, characterReference, personaReference] = await Promise.all([
      imageSourceToDataUrl(CHAT_COMIC_TEMPLATE_PREVIEW_URL),
      imageSourceToDataUrl(context.characterImageUrl),
      imageSourceToDataUrl(context.personaImageUrl),
    ]);
    const model = resolveChatImageGenerationModel();
    const generated = await generateComicImage({
      model,
      prompt,
      references: [styleReference, characterReference, personaReference],
    });

    await fs.mkdir(uploadsDataDir(), { recursive: true });
    const filename = `ai-comic-${options.panelCount}p-${crypto.randomUUID()}.webp`;
    savedPath = path.join(uploadsDataDir(), filename);
    await fs.writeFile(savedPath, generated.buffer);
    const resultUrl = uploadPublicUrl(filename);

    let deduction;
    try {
      deduction = deductPoints(
        user.id,
        pricePoints,
        `GPT Image 2 · ${options.panelCount}컷 만화`,
        context.chatId ? { chatId: context.chatId } : undefined
      );
    } catch (error) {
      await fs.unlink(savedPath).catch(() => {});
      savedPath = null;
      if (error instanceof InsufficientPointsError) {
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
             options_json, result_url, upstream_cost_usd, charged_points
           ) VALUES (?,?,?,?,?,?,?,?,?,?)`
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
            panelCount: options.panelCount,
            mood: options.mood,
            sourceText: options.sourceText,
            title: planned.plan.title,
            plan: planned.plan,
            plannerModel: planned.model,
            plannerCostUsd: planned.costUsd,
          }),
          resultUrl,
          (generated.costUsd ?? 0) + (planned.costUsd ?? 0),
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
        mode: "comic",
      });
      savedToCharacterAlbum = true;
    } catch (error) {
      console.error("[chat-comic-generation] history/album insert failed", error);
    }

    const totalCostUsd = (generated.costUsd ?? 0) + (planned.costUsd ?? 0);
    console.info("[chat-comic-generation] completed", {
      userId: user.id,
      chatId: context.chatId,
      characterId: context.character.id,
      personaId: context.persona.id,
      panelCount: options.panelCount,
      imageModel: model,
      plannerModel: planned.model,
      upstreamCostUsd: totalCostUsd,
      upstreamCostKrw: Math.round(totalCostUsd * getEffectiveKrwPerUsd() * 10) / 10,
      chargedPoints: deduction.total,
    });

    return NextResponse.json({
      ok: true,
      mode: "comic",
      generationId,
      imageUrl: resultUrl,
      savedToCharacterAlbum,
      title: planned.plan.title,
      panelCount: options.panelCount,
      modelLabel: "GPT Image 2",
      totalPointsCost: deduction.total,
      remainingPoints: deduction.balance.total,
      paidPoints: deduction.balance.paid,
      freePoints: deduction.balance.free,
    });
  } catch (error) {
    if (savedPath) await fs.unlink(savedPath).catch(() => {});
    const status = error instanceof RequestError ? error.status : 500;
    const message = error instanceof Error ? error.message : "컷만화 생성에 실패했습니다.";
    console.error("[chat-comic-generation] failed", {
      status,
      message,
      error: error instanceof RequestError ? undefined : error,
    });
    return NextResponse.json({ error: message }, { status });
  }
}
