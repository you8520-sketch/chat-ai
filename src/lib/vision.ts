import fs from "fs/promises";
import path from "path";
import { EMOTION_TAGS } from "./characterAssets";
import {
  OPENROUTER_CHAT_COMPLETIONS_URL,
  buildOpenRouterHeaders,
} from "@/lib/openRouterConfig";

import { BACKGROUND_VISION_OPENROUTER_MODEL } from "@/lib/ai";

const VISION_MODEL =
  process.env.ASSET_VISION_MODEL?.trim() || BACKGROUND_VISION_OPENROUTER_MODEL;

const VISION_PROMPT = `너는 캐릭터 애니메이션 에셋 분석기야. 주어진 이미지를 보고 캐릭터의 표정과 상황을 분석해서 가장 적합한 핵심 감정 태그(예: 기쁨, 슬픔, 분노, 당황, 부끄러움, 대화, 전투, 침실 등)를 추출해 줘. 결과는 반드시 다른 설명 없이 { "tag": "감정명" } 형태의 순수한 JSON으로만 응답해.`;

async function loadImageBase64(url: string): Promise<{ mime: string; data: string }> {
  let buf: Buffer;
  let mime = "image/jpeg";

  if (url.startsWith("/uploads/")) {
    const ext = path.extname(url).slice(1).toLowerCase();
    const mimeMap: Record<string, string> = {
      png: "image/png",
      jpg: "image/jpeg",
      jpeg: "image/jpeg",
      webp: "image/webp",
      gif: "image/gif",
    };
    mime = mimeMap[ext] || "image/jpeg";
    buf = await fs.readFile(path.join(process.cwd(), "public", url));
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
  try {
    const json = JSON.parse(trimmed);
    if (typeof json.tag === "string" && json.tag.trim()) return json.tag.trim();
  } catch {
    const m = trimmed.match(/"tag"\s*:\s*"([^"]+)"/);
    if (m?.[1]) return m[1].trim();
  }
  throw new Error("태그 JSON 파싱 실패");
}

function demoTag(index: number): string {
  return EMOTION_TAGS[index % EMOTION_TAGS.length];
}

/** OpenRouter vision으로 캐릭터 에셋 감정 태그 추출 */
export async function analyzeAssetImage(url: string, index = 0): Promise<{ tag: string; estimated: boolean }> {
  const apiKey = process.env.OPENROUTER_API_KEY?.trim();
  if (!apiKey) {
    return { tag: demoTag(index), estimated: true };
  }

  const { mime, data } = await loadImageBase64(url);
  const dataUrl = `data:${mime};base64,${data}`;

  let res: Response;
  try {
    res = await fetch(OPENROUTER_CHAT_COMPLETIONS_URL, {
      method: "POST",
      headers: buildOpenRouterHeaders(apiKey),
      body: JSON.stringify({
        model: VISION_MODEL,
        messages: [
          {
            role: "user",
            content: [
              { type: "text", text: VISION_PROMPT },
              { type: "image_url", image_url: { url: dataUrl } },
            ],
          },
        ],
        temperature: 0.2,
        max_tokens: 64,
      }),
    });
  } catch (err) {
    console.error("[vision] OpenRouter fetch failed:", err);
    return { tag: demoTag(index), estimated: true };
  }

  if (!res.ok) {
    console.error("[vision] OpenRouter 오류:", await res.text());
    return { tag: demoTag(index), estimated: true };
  }

  const body = (await res.json()) as {
    choices?: { message?: { content?: string | null } }[];
  };
  const rawContent = body.choices?.[0]?.message?.content;
  const text = typeof rawContent === "string" ? rawContent : "";
  if (!text) return { tag: demoTag(index), estimated: true };

  try {
    return { tag: parseTagJson(text), estimated: false };
  } catch {
    return { tag: demoTag(index), estimated: true };
  }
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
