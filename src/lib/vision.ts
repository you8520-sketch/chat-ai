import fs from "fs/promises";
import path from "path";
import { filenameFromUploadUrl, resolveExistingUploadPath } from "@/lib/uploadStorage";
import {
  OPENROUTER_CHAT_COMPLETIONS_URL,
  buildOpenRouterHeaders,
} from "@/lib/openRouterConfig";
import {
  OPENROUTER_GEMINI_20_FLASH_MODEL,
  OPENROUTER_QWEN3_VL_8B_INSTRUCT_MODEL,
} from "@/lib/chatModels";
import { buildAssetVisionPrompt } from "@/lib/assetVisionPolicy";
import { normalizeVisionModerationFlags } from "@/lib/visionModerationNormalize";

const DEFAULT_VISION_MODEL = OPENROUTER_GEMINI_20_FLASH_MODEL;
const DEFAULT_VISION_FALLBACK_MODEL = OPENROUTER_QWEN3_VL_8B_INSTRUCT_MODEL;

function visionModels(): string[] {
  const primary =
    process.env.ASSET_VISION_MODEL?.trim() ||
    process.env.BACKGROUND_VISION_MODEL?.trim() ||
    DEFAULT_VISION_MODEL;
  const fallback =
    process.env.ASSET_VISION_MODEL_FALLBACK?.trim() || DEFAULT_VISION_FALLBACK_MODEL;
  return primary === fallback ? [primary] : [primary, fallback];
}

const VISION_PROMPT = buildAssetVisionPrompt();

async function loadImageBase64(url: string): Promise<{ mime: string; data: string }> {
  let buf: Buffer;
  let mime = "image/jpeg";

  if (url.startsWith("/uploads/")) {
    const filename = filenameFromUploadUrl(url);
    const filePath = filename ? resolveExistingUploadPath(filename) : null;
    if (!filePath) throw new Error("업로드 이미지를 찾을 수 없습니다.");
    const ext = path.extname(url).slice(1).toLowerCase();
    const mimeMap: Record<string, string> = {
      png: "image/png",
      jpg: "image/jpeg",
      jpeg: "image/jpeg",
      webp: "image/webp",
      gif: "image/gif",
    };
    mime = mimeMap[ext] || "image/jpeg";
    buf = await fs.readFile(filePath);
  } else if (url.startsWith("http://") || url.startsWith("https://")) {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`이미지를 불러올 수 없습니다 (${res.status})`);
    mime = res.headers.get("content-type")?.split(";")[0] || "image/jpeg";
    buf = Buffer.from(await res.arrayBuffer());
  } else {
    throw new Error("지원하지 않는 이미지 URL입니다.");
  }

  return { mime, data: buf.toString("base64") };
}

type ParsedVisionTag = {
  tag: string;
  adultFlagged: boolean;
  moderationReject: boolean;
  moderationReason: string;
};

function parseTagJson(raw: string): ParsedVisionTag {
  const trimmed = raw.trim();
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/);
  const candidate = (fenced ? fenced[1] : trimmed).trim();
  let tag = "";
  let adultFlagged = false;
  let moderationReject = false;
  let moderationReason = "";
  try {
    const json = JSON.parse(candidate) as {
      tag?: unknown;
      adult?: unknown;
      reject?: unknown;
      reason?: unknown;
    };
    if (typeof json.tag === "string" && json.tag.trim()) tag = json.tag.trim();
    if (typeof json.adult === "boolean") adultFlagged = json.adult;
    if (typeof json.reject === "boolean") moderationReject = json.reject;
    if (typeof json.reason === "string") moderationReason = json.reason.trim();
  } catch {
    const m = trimmed.match(/"tag"\s*:\s*"([^"]+)"/);
    if (m?.[1]) tag = m[1].trim();
    const adult = trimmed.match(/"adult"\s*:\s*(true|false)/i);
    if (adult) adultFlagged = adult[1].toLowerCase() === "true";
    const reject = trimmed.match(/"reject"\s*:\s*(true|false)/i);
    if (reject) moderationReject = reject[1].toLowerCase() === "true";
  }
  if (!tag) throw new Error("태그 JSON 파싱 실패");
  if (moderationReject) adultFlagged = true;
  return normalizeVisionModerationFlags({
    tag,
    adultFlagged,
    moderationReject,
    moderationReason: moderationReason.slice(0, 200),
  });
}

/** API·파싱 전부 실패 시 — 감정 목록 순환이 아니라 중립 라벨 (이미지와 무관한 가짜 태그 방지) */
function unresolvedTag(index: number): string {
  return `미분류 ${index + 1}`;
}

type VisionAttempt = {
  parsed: ParsedVisionTag | null;
  retryable: boolean;
};

async function analyzeWithModel(
  model: string,
  dataUrl: string,
  apiKey: string
): Promise<VisionAttempt> {
  let res: Response;
  try {
    res = await fetch(OPENROUTER_CHAT_COMPLETIONS_URL, {
      method: "POST",
      headers: buildOpenRouterHeaders(apiKey),
      body: JSON.stringify({
        model,
        messages: [
          {
            role: "user",
            content: [
              { type: "text", text: VISION_PROMPT },
              { type: "image_url", image_url: { url: dataUrl } },
            ],
          },
        ],
        temperature: 0.1,
        max_tokens: 128,
      }),
    });
  } catch (err) {
    console.error("[vision] OpenRouter fetch failed:", model, err);
    return { parsed: null, retryable: true };
  }

  if (!res.ok) {
    console.error("[vision] OpenRouter 오류:", model, await res.text());
    return { parsed: null, retryable: true };
  }

  const body = (await res.json()) as {
    choices?: { message?: { content?: string | null } }[];
  };
  const rawContent = body.choices?.[0]?.message?.content;
  const text = typeof rawContent === "string" ? rawContent : "";
  if (!text) {
    console.warn("[vision] empty response:", model);
    return { parsed: null, retryable: true };
  }

  try {
    return { parsed: parseTagJson(text), retryable: false };
  } catch {
    console.warn("[vision] unparseable response:", model, text.slice(0, 200));
    return { parsed: null, retryable: true };
  }
}

/** OpenRouter vision으로 캐릭터 에셋 감정·자세·상황 태그 추출 (이미지 첨부 필수) */
export async function analyzeAssetImage(
  url: string,
  index = 0
): Promise<{
  tag: string;
  estimated: boolean;
  adultFlagged: boolean;
  moderationReject: boolean;
  moderationReason: string;
}> {
  const apiKey = process.env.OPENROUTER_API_KEY?.trim();
  if (!apiKey) {
    return {
      tag: unresolvedTag(index),
      estimated: true,
      adultFlagged: false,
      moderationReject: false,
      moderationReason: "",
    };
  }

  let img: { mime: string; data: string };
  try {
    img = await loadImageBase64(url);
  } catch (err) {
    console.error("[vision] image load failed:", err);
    return {
      tag: unresolvedTag(index),
      estimated: true,
      adultFlagged: false,
      moderationReject: false,
      moderationReason: "",
    };
  }

  const dataUrl = `data:${img.mime};base64,${img.data}`;
  const models = visionModels();

  for (let i = 0; i < models.length; i++) {
    const model = models[i]!;
    const result = await analyzeWithModel(model, dataUrl, apiKey);
    if (result.parsed) {
      return { ...result.parsed, estimated: false };
    }
    const next = models[i + 1];
    if (next) {
      console.warn("[vision] retrying with fallback model:", { from: model, to: next });
    }
  }

  return {
    tag: unresolvedTag(index),
    estimated: true,
    adultFlagged: false,
    moderationReject: false,
    moderationReason: "",
  };
}

/** 여러 에셋 일괄 태깅 */
export async function analyzeAssetBatch(urls: string[]) {
  const results: Array<{
    url: string;
    tag: string;
    estimated: boolean;
    adultFlagged: boolean;
    moderationReject: boolean;
    moderationReason: string;
  }> = [];
  for (let i = 0; i < urls.length; i++) {
    const result = await analyzeAssetImage(urls[i], i);
    results.push({ url: urls[i], ...result });
  }
  return results;
}
