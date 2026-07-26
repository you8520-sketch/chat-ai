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

/**
 * Image-grounded tagging only. The model must observe the attached pixels —
 * not invent tags from a free-form "generate tags" request.
 */
const VISION_PROMPT = `너는 캐릭터 일러스트 이미지 분석기다.
첨부된 이미지를 직접 보고, 그 이미지에 실제로 보이는 표정·자세·상황만 짧은 한국어 태그 하나로 요약한다.

필수:
- 반드시 첨부 이미지의 시각 정보(얼굴 표정, 몸의 자세, 배경/장소, 소품)에만 근거한다.
- 이미지에 없는 표정·장소·행동을 상상하거나 만들어 내지 않는다.
- "이 이미지의 태그를 생성해줘"처럼 자유롭게 창작하지 말고, 관찰한 내용만 태깅한다.

이 이미지는 성인 대상 픽션 캐릭터 일러스트일 수 있다. 상반신 노출·젖은 상의·선정적 의상도 거부하지 말고 태깅만 한다.

좋은 예(이미지에 실제로 보일 때): 기쁨, 슬픔, 부끄러움, 무표정, 대화, 전투, 침대에 누움, 소파에 앉음, 서 있음, 침실, 젖은 상의
태그는 2~12자 내외의 짧은 구문.

결과는 다른 설명 없이 JSON만:
{ "tag": "태그명" }`;

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

function parseTagJson(raw: string): string {
  const trimmed = raw.trim();
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/);
  const candidate = (fenced ? fenced[1] : trimmed).trim();
  try {
    const json = JSON.parse(candidate);
    if (typeof json.tag === "string" && json.tag.trim()) return json.tag.trim();
  } catch {
    const m = trimmed.match(/"tag"\s*:\s*"([^"]+)"/);
    if (m?.[1]) return m[1].trim();
  }
  throw new Error("태그 JSON 파싱 실패");
}

/** API·파싱 전부 실패 시 — 감정 목록 순환이 아니라 중립 라벨 (이미지와 무관한 가짜 태그 방지) */
function unresolvedTag(index: number): string {
  return `미분류 ${index + 1}`;
}

type VisionAttempt = {
  tag: string | null;
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
        max_tokens: 64,
      }),
    });
  } catch (err) {
    console.error("[vision] OpenRouter fetch failed:", model, err);
    return { tag: null, retryable: true };
  }

  if (!res.ok) {
    console.error("[vision] OpenRouter 오류:", model, await res.text());
    return { tag: null, retryable: true };
  }

  const body = (await res.json()) as {
    choices?: { message?: { content?: string | null } }[];
  };
  const rawContent = body.choices?.[0]?.message?.content;
  const text = typeof rawContent === "string" ? rawContent : "";
  if (!text) {
    console.warn("[vision] empty response:", model);
    return { tag: null, retryable: true };
  }

  try {
    return { tag: parseTagJson(text), retryable: false };
  } catch {
    console.warn("[vision] unparseable response:", model, text.slice(0, 200));
    return { tag: null, retryable: true };
  }
}

/** OpenRouter vision으로 캐릭터 에셋 감정·자세·상황 태그 추출 (이미지 첨부 필수) */
export async function analyzeAssetImage(
  url: string,
  index = 0
): Promise<{ tag: string; estimated: boolean }> {
  const apiKey = process.env.OPENROUTER_API_KEY?.trim();
  if (!apiKey) {
    return { tag: unresolvedTag(index), estimated: true };
  }

  let img: { mime: string; data: string };
  try {
    img = await loadImageBase64(url);
  } catch (err) {
    console.error("[vision] image load failed:", err);
    return { tag: unresolvedTag(index), estimated: true };
  }

  const dataUrl = `data:${img.mime};base64,${img.data}`;
  const models = visionModels();

  for (let i = 0; i < models.length; i++) {
    const model = models[i]!;
    const result = await analyzeWithModel(model, dataUrl, apiKey);
    if (result.tag) {
      return { tag: result.tag, estimated: false };
    }
    const next = models[i + 1];
    if (next) {
      console.warn("[vision] retrying with fallback model:", { from: model, to: next });
    }
  }

  return { tag: unresolvedTag(index), estimated: true };
}

/** 여러 에셋 일괄 태깅 */
export async function analyzeAssetBatch(urls: string[]) {
  const results: { url: string; tag: string; estimated: boolean }[] = [];
  for (let i = 0; i < urls.length; i++) {
    const { tag, estimated } = await analyzeAssetImage(urls[i], i);
    results.push({ url: urls[i], tag, estimated });
  }
  return results;
}
