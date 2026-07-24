import fs from "fs/promises";
import path from "path";
import { isDemoEnv } from "@/lib/demo";
import { BACKGROUND_VISION_OPENROUTER_MODEL } from "@/lib/ai";
import { OPENROUTER_GEMINI_31_FLASH_MODEL } from "@/lib/chatModels";
import {
  OPENROUTER_CHAT_COMPLETIONS_URL,
  buildOpenRouterHeaders,
} from "@/lib/openRouterConfig";
import { filenameFromUploadUrl, resolveExistingUploadPath } from "@/lib/uploadStorage";

export type AssetModerationResult = {
  approved: boolean;
  reason: string;
  details: { url: string; safe: boolean; reason: string }[];
  estimated: boolean;
};

const DEV_API_BYPASS_NOTE = "개발: 검수 API 연결 실패 — 자동 통과 (키/모델 확인)";

const DEFAULT_MODERATION_MODEL = BACKGROUND_VISION_OPENROUTER_MODEL;
const DEFAULT_MODERATION_FALLBACK_MODEL = OPENROUTER_GEMINI_31_FLASH_MODEL;

type ModerationVerdict = {
  safe: boolean;
  reason: string;
  estimated: boolean;
};

type ModerationAttempt = ModerationVerdict & {
  /** API·파싱 실패 등 — 다음 모델로 재시도 */
  retryable: boolean;
};

function skipAssetModeration(): boolean {
  const v = process.env.SKIP_ASSET_MODERATION?.toLowerCase();
  return v === "1" || v === "true" || v === "yes";
}

/** 개발·로컬에서 검수 API 실패 시 강제 통과 */
function moderationApiBypass(): boolean {
  return isDemoEnv() || skipAssetModeration();
}

function moderationModels(): string[] {
  const primary =
    process.env.ASSET_MODERATION_MODEL?.trim() || DEFAULT_MODERATION_MODEL;
  const fallback =
    process.env.ASSET_MODERATION_MODEL_FALLBACK?.trim() ||
    DEFAULT_MODERATION_FALLBACK_MODEL;
  return primary === fallback ? [primary] : [primary, fallback];
}

function formatApiError(status: number, bodyText: string): string {
  let detail = "";
  try {
    const json = JSON.parse(bodyText) as {
      error?: { message?: string };
      message?: string;
    };
    const msg = json.error?.message ?? json.message;
    if (msg) detail = String(msg).slice(0, 200);
  } catch {
    const trimmed = bodyText.trim();
    if (trimmed) detail = trimmed.slice(0, 200);
  }
  const base = `검수 API 오류 (${status})`;
  return detail ? `${base}: ${detail}` : base;
}

const MODERATION_PROMPT = `너는 대한민국 온라인 플랫폼의 이미지 콘텐츠 검수 AI야.
아래 이미지가 서비스 공개 기준에 맞는지 판단해.
핵심: 상반신 노출은 반려하지 말고, 생식기(성기)·항문 노출과 직접 성행위만 엄격히 반려한다.

반려(REJECT) — 아래만 해당 시 반려:
- 미성년자로 보이는 인물의 성적·노출 묘사
- 성기(음경·음부·외음·고환 등) 또는 항문이 명확히 보이는 노출
- 삽입·구강성교 등 성행위 직접 묘사
- 불법촬영·유포·학대 암시
- 극단적 잔혹·고어(성적 맥락 포함)
- 실존 인물 사칭·딥페이크 성적 이미지

통과(ALLOW) — 아래는 반려하지 말 것 (NSFW 여부와 무관, 성인 캐릭터 일러스트 기준):
- 상반신 노출: 가슴·유두·어깨·배, 토pless, 젖은 상의·비치는 옷·속옷·수영복
- 선정적 포즈·키스·포옹 등 상반신·의상 중심 표현
- 하반신이 가려져 성기·항문이 보이지 않으면 통과
- 일반적인 캐릭터 일러스트·표정·의상

애매하면 상반신·젖은 상의는 safe=true. 성기·항문이 또렷할 때만 safe=false.

반드시 JSON만 응답:
{ "safe": true|false, "reason": "한국어 한 줄 사유" }`;

async function loadImageForModeration(url: string): Promise<{ mime: string; data: string } | null> {
  try {
    if (url.startsWith("/uploads/")) {
      const filename = filenameFromUploadUrl(url);
      const filePath = filename ? resolveExistingUploadPath(filename) : null;
      if (!filePath) return null;
      const ext = path.extname(url).slice(1).toLowerCase();
      const mimeMap: Record<string, string> = {
        png: "image/png",
        jpg: "image/jpeg",
        jpeg: "image/jpeg",
        webp: "image/webp",
        gif: "image/gif",
      };
      const buf = await fs.readFile(filePath);
      return { mime: mimeMap[ext] || "image/jpeg", data: buf.toString("base64") };
    }
    if (url.startsWith("http://") || url.startsWith("https://")) {
      const res = await fetch(url);
      if (!res.ok) return null;
      const mime = res.headers.get("content-type")?.split(";")[0] || "image/jpeg";
      const buf = Buffer.from(await res.arrayBuffer());
      return { mime, data: buf.toString("base64") };
    }
  } catch {
    return null;
  }
  return null;
}

function parseModerationText(text: string): ModerationAttempt | null {
  const trimmed = text.trim();
  if (!trimmed) return null;

  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/);
  const jsonCandidate = (fenced ? fenced[1] : trimmed).trim();

  try {
    const json = JSON.parse(jsonCandidate) as { safe?: unknown; reason?: unknown };
    if (typeof json.safe !== "boolean") return null;
    return {
      safe: json.safe,
      reason: String(json.reason || (json.safe ? "통과" : "규정 위반")),
      estimated: false,
      retryable: false,
    };
  } catch {
    const safeMatch = trimmed.match(/"safe"\s*:\s*(true|false)/i);
    if (!safeMatch) return null;
    const safe = safeMatch[1].toLowerCase() === "true";
    const reasonMatch = trimmed.match(/"reason"\s*:\s*"([^"]+)"/);
    return {
      safe,
      reason: reasonMatch?.[1] || (safe ? "통과" : "규정 위반 가능성"),
      estimated: true,
      retryable: false,
    };
  }
}

async function moderateOneImageWithModel(
  model: string,
  img: { mime: string; data: string },
  nsfwDeclared: boolean,
  apiKey: string
): Promise<ModerationAttempt> {
  const prompt = `${MODERATION_PROMPT}\n\n캐릭터 NSFW 선언: ${nsfwDeclared ? "예(성인)" : "아니오(전체 이용가)"}`;
  const dataUrl = `data:${img.mime};base64,${img.data}`;

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
              { type: "text", text: prompt },
              { type: "image_url", image_url: { url: dataUrl } },
            ],
          },
        ],
        temperature: 0.1,
        max_tokens: 256,
      }),
    });
  } catch (err) {
    console.error("[moderation] OpenRouter fetch failed:", model, err);
    return { safe: false, reason: "검수 API 연결 실패", estimated: false, retryable: true };
  }

  if (!res.ok) {
    const bodyText = await res.text();
    console.error("[moderation] OpenRouter HTTP error:", model, res.status, bodyText);
    return {
      safe: false,
      reason: formatApiError(res.status, bodyText),
      estimated: false,
      retryable: true,
    };
  }

  const body = (await res.json()) as {
    choices?: { message?: { content?: string | null } }[];
  };
  const rawContent = body.choices?.[0]?.message?.content;
  const text = typeof rawContent === "string" ? rawContent : "";

  const parsed = parseModerationText(text);
  if (parsed) return parsed;

  console.warn("[moderation] unparseable response:", model, text.slice(0, 300));
  return {
    safe: false,
    reason: "검수 응답 형식 오류",
    estimated: false,
    retryable: true,
  };
}

async function moderateOneImage(
  url: string,
  nsfwDeclared: boolean
): Promise<ModerationVerdict> {
  const apiKey = process.env.OPENROUTER_API_KEY?.trim();
  if (!apiKey) {
    if (isDemoEnv()) {
      return { safe: true, reason: "데모: OpenRouter 키 없음 — 자동 통과", estimated: true };
    }
    return { safe: false, reason: "이미지 검수 API를 사용할 수 없습니다.", estimated: true };
  }

  const img = await loadImageForModeration(url);
  if (!img) {
    return { safe: false, reason: "이미지를 불러올 수 없습니다.", estimated: false };
  }

  const models = moderationModels();
  let lastReason = "검수 API 오류";

  for (let i = 0; i < models.length; i++) {
    const model = models[i]!;
    const result = await moderateOneImageWithModel(model, img, nsfwDeclared, apiKey);

    if (!result.retryable) {
      return {
        safe: result.safe,
        reason: result.reason,
        estimated: result.estimated,
      };
    }

    lastReason = result.reason;
    const next = models[i + 1];
    if (next) {
      console.warn("[moderation] retrying with fallback model:", { from: model, to: next });
    }
  }

  if (moderationApiBypass()) {
    return { safe: true, reason: DEV_API_BYPASS_NOTE, estimated: true };
  }

  return { safe: false, reason: lastReason, estimated: false };
}

/** 노출(public) 에셋 이미지 일괄 검수 */
export async function moderatePublicAssets(
  urls: string[],
  nsfwDeclared: boolean
): Promise<AssetModerationResult> {
  if (skipAssetModeration()) {
    return {
      approved: true,
      reason: "검수 생략 — SKIP_ASSET_MODERATION",
      details: [],
      estimated: true,
    };
  }

  if (urls.length === 0) {
    return { approved: true, reason: "노출 이미지 없음", details: [], estimated: false };
  }

  const details: AssetModerationResult["details"] = [];
  let estimated = false;

  for (const url of urls) {
    const r = await moderateOneImage(url, nsfwDeclared);
    if (r.estimated) estimated = true;
    details.push({ url, safe: r.safe, reason: r.reason });
    if (!r.safe) {
      return {
        approved: false,
        reason: r.reason,
        details,
        estimated,
      };
    }
  }

  return {
    approved: true,
    reason: "모든 노출 이미지 검수 통과",
    details,
    estimated,
  };
}
