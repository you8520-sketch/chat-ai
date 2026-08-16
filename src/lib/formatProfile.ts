import { CHARACTER_NAME_LIMIT } from "@/lib/characters";
import { PROFILE_BIOGRAPHY_LIMIT } from "@/lib/generateProfile";
import { CHEAPER_INFERENCE_DEEPSEEK_V4_PRO_MODEL } from "@/lib/chatModels";
import { callOpenRouterCompletion } from "@/lib/openRouterCompletion";

export type ProfileData = {
  name: string | null;
  tags: string[] | null;
  coreGoal: string | null;
  description: string | null;
  imageUrl: string | null;
};

export const FORMAT_PROFILE_MODEL = CHEAPER_INFERENCE_DEEPSEEK_V4_PRO_MODEL;

const FORMAT_PROMPT = `너는 캐릭터 프로필 **디자인** 편집기야. 사용자 줄글의 **모든 내용을 100% 보존**하면서, 하비 AI 공통 마크다운 레이아웃(## 메인 캐릭터, ## 서브 캐릭터, - **라벨:** 목록)만 적용해 JSON으로 분류해.
요약·축약·의역·재작성 금지. HTML·인라인 CSS 금지. description에는 원문 전체를 마크다운 디자인만 적용해 넣을 것 (최대 ${PROFILE_BIOGRAPHY_LIMIT.toLocaleString()}자).
{
"name": "캐릭터 이름",
"tags": ["직업/특징 태그 3~4개"],
"coreGoal": "한 줄 핵심 (50자 이내, 본문과 별개)",
"description": "원문 전체 — 공통 마크다운 디자인만 적용",
"imageUrl": "텍스트 내 이미지 링크 또는 null"
}
다른 설명 없이 순수 JSON만 출력해.`;

function stripHtmlFromText(text: string): string {
  return text
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<[^>]+>/g, "")
    .trim();
}

function extractJson(text: string): ProfileData {
  const trimmed = text.trim();
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/);
  const raw = fenced ? fenced[1].trim() : trimmed;
  const parsed = JSON.parse(raw) as Partial<ProfileData>;
  return normalizeProfileData(parsed);
}

export function normalizeProfileData(raw: Partial<ProfileData>): ProfileData {
  const descriptionRaw =
    typeof raw.description === "string" && raw.description.trim() ? raw.description.trim() : null;

  return {
    name: typeof raw.name === "string" && raw.name.trim() ? raw.name.trim() : null,
    tags: Array.isArray(raw.tags)
      ? raw.tags.filter((t): t is string => typeof t === "string" && t.trim().length > 0).slice(0, 8)
      : null,
    coreGoal: typeof raw.coreGoal === "string" && raw.coreGoal.trim() ? raw.coreGoal.trim() : null,
    description: descriptionRaw ? stripHtmlFromText(descriptionRaw).slice(0, PROFILE_BIOGRAPHY_LIMIT) : null,
    imageUrl: typeof raw.imageUrl === "string" && raw.imageUrl.trim() ? raw.imageUrl.trim() : null,
  };
}

/** 줄글에서 이미지 URL 추출 (데모용) */
function findImageUrl(text: string): string | null {
  const m = text.match(
    /(?:https?:\/\/[^\s<>"']+\.(?:png|jpe?g|gif|webp|avif)(?:\?[^\s<>"']*)?|\/uploads\/[^\s<>"']+)/i
  );
  return m?.[0] ?? null;
}

function demoFormatProfile(raw: string): ProfileData {
  const lines = raw
    .split(/\n+/)
    .map((l) => l.trim())
    .filter(Boolean);
  const name = lines[0]?.replace(/^[#*]\s*/, "").slice(0, CHARACTER_NAME_LIMIT) || null;
  const imageUrl = findImageUrl(raw);
  const body = lines.slice(1).join("\n\n") || raw;
  const sentences = body.split(/[.!?。]\s+/).filter(Boolean);
  const coreGoal = sentences[0]?.slice(0, 50) || null;
  return {
    name,
    tags: name ? [name.slice(0, 6), "캐릭터", "AI"] : ["캐릭터"],
    coreGoal,
    description: body.slice(0, PROFILE_BIOGRAPHY_LIMIT) || null,
    imageUrl,
  };
}

async function callDeepSeekFormatProfile(text: string): Promise<string> {
  const { text: out } = await callOpenRouterCompletion({
    model: FORMAT_PROFILE_MODEL,
    system: FORMAT_PROMPT,
    history: [{ role: "user", content: text }],
    temperature: 0.2,
    maxTokens: 16384,
    disableReasoning: true,
    requestKind: "format-profile",
    timeoutMs: 120_000,
  });
  if (!out.trim()) throw new Error("DeepSeek empty completion");
  return out;
}

export async function formatProfileText(raw: string): Promise<{ data: ProfileData; estimated: boolean }> {
  const text = raw.trim();
  if (!text) throw new Error("변환할 텍스트를 입력하세요.");

  if (
    !process.env.CHEAPER_INFERENCE_API_KEY?.trim() &&
    !process.env.OPENROUTER_API_KEY?.trim()
  ) {
    return { data: demoFormatProfile(text), estimated: true };
  }

  try {
    const out = await callDeepSeekFormatProfile(text);
    return { data: extractJson(out), estimated: false };
  } catch (e) {
    console.error("[format-profile] DeepSeek 오류:", e);
    return { data: demoFormatProfile(text), estimated: true };
  }
}

/** ProfileData → 캐릭터 생성 폼 필드 동기화 */
export function profileToFormFields(data: ProfileData) {
  const descParts: string[] = [];
  if (data.imageUrl) descParts.push(data.imageUrl);
  if (data.description) descParts.push(data.description);
  return {
    name: data.name || "",
    tagline: data.coreGoal || "",
    tags: data.tags?.join(", ") || "",
    description: descParts.join("\n\n").slice(0, PROFILE_BIOGRAPHY_LIMIT),
  };
}
