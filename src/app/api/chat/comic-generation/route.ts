import crypto from "crypto";
import fs from "fs/promises";
import path from "path";
import { NextResponse } from "next/server";
import sharp from "sharp";

import { getSessionUser } from "@/lib/auth";
import { planChatComic } from "@/lib/chatComicPlanner";
import {
  CHAT_COMIC_MAX_INPUT_CHARS,
  CHAT_COMIC_STYLE_PREVIEW_URL,
  buildChatComicImagePrompt,
  resolveChatComicGenerationPrice,
  resolveChatImageGenerationModel,
  sanitizeChatComicMood,
  sanitizeChatComicPanelCount,
  type ChatComicPanelCount,
} from "@/lib/chatImageGeneration";
import { getCharacterRepresentativeImageUrl } from "@/lib/characterAssets";
import { getDb } from "@/lib/db";
import { getEffectiveKrwPerUsd } from "@/lib/exchangeRate";
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

export const runtime = "nodejs";
export const maxDuration = 300;

const OPENROUTER_IMAGES_URL = "https://openrouter.ai/api/v1/images";
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

function ensureComicGenerationTable() {
  getDb().exec(`
    CREATE TABLE IF NOT EXISTS chat_comic_generations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      chat_id INTEGER,
      character_id INTEGER NOT NULL,
      persona_id INTEGER NOT NULL,
      panel_count INTEGER NOT NULL,
      mood TEXT NOT NULL,
      source_text TEXT NOT NULL,
      plan_json TEXT NOT NULL DEFAULT '{}',
      planner_model TEXT NOT NULL,
      image_model TEXT NOT NULL,
      result_url TEXT NOT NULL,
      planner_cost_usd REAL,
      image_cost_usd REAL,
      charged_points INTEGER NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_chat_comic_generations_user_recent
      ON chat_comic_generations(user_id, created_at DESC, id DESC);
    CREATE INDEX IF NOT EXISTS idx_chat_comic_generations_character_recent
      ON chat_comic_generations(user_id, character_id, created_at DESC, id DESC);
  `);
}

function resolveGenerationContext(opts: {
  userId: number;
  characterId: number | null;
  chatId: number | null;
  personaId: number | null;
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

  const characterImageUrl =
    getCharacterRepresentativeImageUrl(character.assets, character.images)?.trim() ?? "";
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
  const clean = source.trim().split("#", 1)[0]!.split("?", 1)[0]!;
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
      const length = Number(response.headers.get("content-length") ?? 0);
      if (length > MAX_REFERENCE_BYTES) throw new RequestError("참조 이미지 용량이 너무 큽니다.");
      const type = response.headers.get("content-type") ?? "";
      if (type && !type.toLowerCase().startsWith("image/")) {
        throw new RequestError("참조 이미지 형식이 올바르지 않습니다.");
      }
      const input = Buffer.from(await response.arrayBuffer());
      if (input.length > MAX_REFERENCE_BYTES) throw new RequestError("참조 이미지 용량이 너무 큽니다.");
      return input;
    } finally {
      clearTimeout(timer);
    }
  }

  const publicPath = safePublicFilePath(clean);
  if (!publicPath) throw new RequestError("참조 이미지 경로가 올바르지 않습니다.");
  try {
    const input = await fs.readFile(publicPath);
    if (input.length > MAX_REFERENCE_BYTES) throw new RequestError("참조 이미지 용량이 너무 큽니다.");
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
        width: 1024,
        height: 1024,
        fit: "inside",
        withoutEnlargement: true,
      })
      .webp({ quality: 86, effort: 4 })
      .toBuffer();
    return `data:image/webp;base64,${optimized.toString("base64")}`;
  } catch {
    throw new RequestError("참조 이미지를 처리하지 못했습니다.");
  }
}

function upstreamErrorMessage(data: unknown): string {
  if (!data || typeof data !== "object") return "컷만화 이미지 생성 요청에 실패했습니다.";
  const error = (data as { error?: unknown }).error;
  if (typeof error === "string" && error.trim()) return error.slice(0, 240);
  if (error && typeof error === "object") {
    const message = (error as { message?: unknown }).message;
    if (typeof message === "string" && message.trim()) return message.slice(0, 240);
  }
  return "컷만화 이미지 생성 요청에 실패했습니다.";
}

function outputBounds(panelCount: ChatComicPanelCount) {
  return panelCount === 2
    ? { width: 1200, height: 900, aspectRatio: "4:3" }
    : { width: 1080, height: 1440, aspectRatio: "3:4" };
}

async function callOpenRouterComicImage(opts: {
  model: string;
  prompt: string;
  panelCount: ChatComicPanelCount;
  references: string[];
}): Promise<{ buffer: Buffer; costUsd: number | null }> {
  const apiKey = process.env.OPENROUTER_API_KEY?.trim();
  if (!apiKey) throw new RequestError("OpenRouter API 키가 설정되지 않았습니다.", 503);

  const bounds = outputBounds(opts.panelCount);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 285_000);
  try {
    const headers: Record<string, string> = {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
      Accept: "application/json",
      "X-Title": "Habi Chat Comic Generator",
    };
    const referer =
      process.env.NEXT_PUBLIC_APP_URL?.trim() || process.env.APP_URL?.trim();
    if (referer) headers["HTTP-Referer"] = referer;

    const response = await fetch(OPENROUTER_IMAGES_URL, {
      method: "POST",
      headers,
      signal: controller.signal,
      body: JSON.stringify({
        model: opts.model,
        prompt: opts.prompt,
        n: 1,
        quality: "medium",
        aspect_ratio: bounds.aspectRatio,
        background: "opaque",
        output_format: "webp",
        output_compression: 82,
        input_references: opts.references.map((url) => ({
          type: "image_url",
          image_url: { url },
        })),
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
      throw new RequestError(upstreamErrorMessage(data), response.status >= 500 ? 502 : 400);
    }

    const image = (data as { data?: Array<{ b64_json?: string }> })?.data?.[0];
    const encoded = image?.b64_json?.replace(/^data:[^;]+;base64,/, "");
    if (!encoded) throw new RequestError("생성된 컷만화 데이터가 비어 있습니다.", 502);

    const source = Buffer.from(encoded, "base64");
    if (!source.length) throw new RequestError("생성된 컷만화 데이터가 비어 있습니다.", 502);

    let output: Buffer;
    try {
      output = await sharp(source, { failOn: "none" })
        .rotate()
        .resize({
          width: bounds.width,
          height: bounds.height,
          fit: "inside",
          withoutEnlargement: true,
        })
        .webp({ quality: 86, effort: 4 })
        .toBuffer();
      const metadata = await sharp(output, { failOn: "none" }).metadata();
      if (!metadata.width || !metadata.height) throw new Error("missing dimensions");
    } catch {
      throw new RequestError("생성된 컷만화 형식이 올바르지 않습니다.", 502);
    }

    const parsedCost = Number((data as { usage?: { cost?: unknown } })?.usage?.cost);
    return {
      buffer: output,
      costUsd: Number.isFinite(parsedCost) && parsedCost >= 0 ? parsedCost : null,
    };
  } catch (error) {
    if (error instanceof RequestError) throw error;
    if (error instanceof Error && error.name === "AbortError") {
      throw new RequestError("컷만화 생성 시간이 초과되었습니다. 다시 시도해 주세요.", 504);
    }
    throw new RequestError("OpenRouter 컷만화 생성 중 오류가 발생했습니다.", 502);
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
    const sourceText = String(body.sourceText ?? "").trim();
    if (!sourceText) throw new RequestError("컷만화로 만들 본문을 입력해 주세요.");
    if (sourceText.length > CHAT_COMIC_MAX_INPUT_CHARS) {
      throw new RequestError(
        `본문은 최대 ${CHAT_COMIC_MAX_INPUT_CHARS.toLocaleString()}자까지 입력할 수 있습니다.`
      );
    }

    const panelCount = sanitizeChatComicPanelCount(body.panelCount);
    const mood = sanitizeChatComicMood(body.mood);
    const context = resolveGenerationContext({
      userId: user.id,
      characterId: positiveInt(body.characterId),
      chatId: positiveInt(body.chatId),
      personaId: positiveInt(body.personaId),
    });

    const pricePoints = resolveChatComicGenerationPrice(panelCount);
    const balanceBefore = getPointBalance(user.id);
    if (balanceBefore.total < pricePoints) {
      return NextResponse.json(
        {
          error: `포인트가 부족합니다. ${panelCount}컷 만화에는 ${pricePoints.toLocaleString()}P가 필요합니다.`,
          pricePoints,
          balance: balanceBefore,
        },
        { status: 402 }
      );
    }

    const planned = await planChatComic({ sourceText, panelCount, mood });
    const prompt = buildChatComicImagePrompt({
      characterName: context.character.name,
      personaName: context.persona.name,
      panelCount,
      mood,
      plan: planned.plan,
    });

    const [styleReference, characterReference, personaReference] = await Promise.all([
      imageSourceToDataUrl(CHAT_COMIC_STYLE_PREVIEW_URL),
      imageSourceToDataUrl(context.characterImageUrl),
      imageSourceToDataUrl(context.personaImageUrl),
    ]);

    const model = resolveChatImageGenerationModel();
    const generated = await callOpenRouterComicImage({
      model,
      prompt,
      panelCount,
      references: [styleReference, characterReference, personaReference],
    });

    await fs.mkdir(uploadsDataDir(), { recursive: true });
    const filename = `ai-comic-${panelCount}cut-${crypto.randomUUID()}.webp`;
    savedPath = path.join(uploadsDataDir(), filename);
    await fs.writeFile(savedPath, generated.buffer);
    const resultUrl = uploadPublicUrl(filename);

    let deduction;
    try {
      deduction = deductPoints(
        user.id,
        pricePoints,
        `GPT Image 2 · AI ${panelCount}컷 만화`,
        context.chatId ? { chatId: context.chatId } : undefined
      );
    } catch (error) {
      await fs.unlink(savedPath).catch(() => {});
      savedPath = null;
      if (error instanceof InsufficientPointsError) {
        return NextResponse.json(
          {
            error: `포인트가 부족합니다. ${panelCount}컷 만화에는 ${pricePoints.toLocaleString()}P가 필요합니다.`,
            pricePoints,
            balance: error.balance,
          },
          { status: 402 }
        );
      }
      throw error;
    }

    ensureComicGenerationTable();
    try {
      getDb()
        .prepare(
          `INSERT INTO chat_comic_generations (
             user_id, chat_id, character_id, persona_id, panel_count, mood,
             source_text, plan_json, planner_model, image_model, result_url,
             planner_cost_usd, image_cost_usd, charged_points
           ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`
        )
        .run(
          user.id,
          context.chatId,
          context.character.id,
          context.persona.id,
          panelCount,
          mood,
          sourceText,
          JSON.stringify(planned.plan),
          planned.model,
          model,
          resultUrl,
          planned.costUsd,
          generated.costUsd,
          deduction.total
        );
    } catch (error) {
      console.error("[chat-comic-generation] history insert failed", error);
    }

    const combinedCostUsd =
      planned.costUsd == null && generated.costUsd == null
        ? null
        : (planned.costUsd ?? 0) + (generated.costUsd ?? 0);
    const costKrw =
      combinedCostUsd == null
        ? null
        : Math.round(combinedCostUsd * getEffectiveKrwPerUsd() * 10) / 10;
    console.info("[chat-comic-generation] completed", {
      userId: user.id,
      chatId: context.chatId,
      characterId: context.character.id,
      personaId: context.persona.id,
      panelCount,
      mood,
      plannerModel: planned.model,
      imageModel: model,
      upstreamCostUsd: combinedCostUsd,
      upstreamCostKrw: costKrw,
      chargedPoints: deduction.total,
    });

    return NextResponse.json({
      ok: true,
      imageUrl: resultUrl,
      modelId: model,
      modelLabel: "GPT Image 2",
      panelCount,
      planTitle: planned.plan.title,
      albumTag: `AI ${panelCount}컷 만화`,
      downloadName: `${context.character.name}-${panelCount}컷-만화.webp`,
      pricePoints: deduction.total,
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
