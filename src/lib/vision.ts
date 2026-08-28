import fs from "fs/promises";
import path from "path";
import { filenameFromUploadUrl, resolveExistingUploadPath } from "@/lib/uploadStorage";
import {
  OPENROUTER_CHAT_COMPLETIONS_URL,
  buildOpenRouterHeaders,
} from "@/lib/openRouterConfig";
import { OPENROUTER_QWEN38_FLASH_MODEL } from "@/lib/chatModels";
import { resolveAssetVisionModels } from "@/lib/assetVisionModels";
import { buildAssetVisionPrompt } from "@/lib/assetVisionPolicy";
import {
  buildAssetVisionJsonSchema,
  deriveFinalAssetTag,
  validateStructuredAssetVisionResult,
  type AssetVisionStructuredResult,
} from "@/lib/assetPersonTags";
import { normalizeVisionModerationFlags } from "@/lib/visionModerationNormalize";

const VISION_BATCH_CONCURRENCY = 4;

export function visionModels(): string[] {
  return resolveAssetVisionModels();
}

const VISION_PROMPT = buildAssetVisionPrompt();

export type ParsedVisionTag = {
  tag: string;
  adultFlagged: boolean;
  moderationReject: boolean;
  moderationReason: string;
};

function extractJsonCandidate(raw: string): string {
  const trimmed = raw.trim();
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/);
  return (fenced ? fenced[1] : trimmed).trim();
}

export function parseAssetVisionResponseText(raw: string): AssetVisionStructuredResult | null {
  const candidate = extractJsonCandidate(raw);
  try {
    return validateStructuredAssetVisionResult(JSON.parse(candidate));
  } catch {
    return null;
  }
}

export function finalizeStructuredVisionResult(
  structured: AssetVisionStructuredResult
): ParsedVisionTag {
  let adultFlagged = structured.adult;
  const moderationReject = structured.reject;
  if (moderationReject) adultFlagged = true;
  return normalizeVisionModerationFlags({
    tag: deriveFinalAssetTag(structured),
    adultFlagged,
    moderationReject,
    moderationReason: structured.reason.slice(0, 160),
  });
}

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

/** API·파싱 전부 실패 시 — 중립 라벨 (이미지와 무관한 가짜 태그 방지) */
function unresolvedTag(index: number): string {
  return `미분류 ${index + 1}`;
}

type VisionAttempt = {
  parsed: ParsedVisionTag | null;
  retryable: boolean;
};

/** Build OpenRouter chat-completions body for asset vision (exported for deterministic tests). */
export function buildAssetVisionRequestBody(model: string, dataUrl: string) {
  const body: Record<string, unknown> = {
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
    response_format: {
      type: "json_schema",
      json_schema: {
        name: "asset_vision_result",
        strict: true,
        schema: buildAssetVisionJsonSchema(),
      },
    },
    provider: {
      require_parameters: true,
    },
  };

  if (model === OPENROUTER_QWEN38_FLASH_MODEL) {
    body.reasoning = { effort: "none" };
  }

  return body;
}

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
      body: JSON.stringify(buildAssetVisionRequestBody(model, dataUrl)),
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

  const structured = parseAssetVisionResponseText(text);
  if (!structured) {
    console.warn("[vision] invalid structured response:", model, text.slice(0, 200));
    return { parsed: null, retryable: true };
  }

  return { parsed: finalizeStructuredVisionResult(structured), retryable: false };
}

/** OpenRouter vision으로 캐릭터 에셋 분류 태그 + moderation (이미지 첨부 필수) */
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

async function mapWithBoundedConcurrency<T, R>(
  items: readonly T[],
  concurrency: number,
  mapper: (item: T, index: number) => Promise<R>
): Promise<R[]> {
  if (items.length === 0) return [];
  const results = new Array<R>(items.length);
  let nextIndex = 0;
  const workerCount = Math.min(concurrency, items.length);

  async function worker(): Promise<void> {
    while (true) {
      const current = nextIndex;
      nextIndex += 1;
      if (current >= items.length) return;
      results[current] = await mapper(items[current]!, current);
    }
  }

  await Promise.all(Array.from({ length: workerCount }, () => worker()));
  return results;
}

/** 여러 에셋 일괄 태깅 (bounded concurrency, 순서 보존) */
export async function analyzeAssetBatch(urls: string[]) {
  const analyzed = await mapWithBoundedConcurrency(
    urls,
    VISION_BATCH_CONCURRENCY,
    async (url, index) => {
      const result = await analyzeAssetImage(url, index);
      return { url, ...result };
    }
  );
  return analyzed;
}
