import {
  galleryImageUrls,
  normalizeBiographyStructure,
} from "@/lib/profileMarkdown";
import type { LayoutHint } from "@/lib/profileTypography";

export type GeneratedProfile = {
  name: string | null;
  tags: string[] | null;
  summary: string | null;
  biography: string | null;
  appearance: string | null;
  layoutHint: LayoutHint;
};

export type GenerateProfileResult = {
  profile: GeneratedProfile;
  estimated: boolean;
  warning?: string;
  modelUsed?: string;
};

/** 소개 본문(biography) 최대 글자 수 — 원문 보존 기준 */
export const PROFILE_BIOGRAPHY_LIMIT = 3_000;

/** @deprecated 로컬 처리 — 클라이언트 fetch 상한용 */
export const PROFILE_GENERATION_TIMEOUT_MS = 30_000;

function stripHtmlFromText(text: string): string {
  return text
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .trim();
}

function findImageUrl(text: string): string | null {
  const m = text.match(
    /(?:https?:\/\/[^\s<>"']+\.(?:png|jpe?g|gif|webp|avif)(?:\?[^\s<>"']*)?|\/uploads\/[^\s<>"']+)/i
  );
  return m?.[0] ?? null;
}

function parseLayoutHint(v: unknown): LayoutHint {
  if (v === "top" || v === "left" || v === "right" || v === "inline") return v;
  return "right";
}

const BANNED_TAGS = new Set([
  "캐릭터",
  "채릭터",
  "character",
  "이름",
  "name",
  "애칭",
  "별명",
  "호칭",
]);

/** 이름·애칭·메타 단어 제외 — 장르/분위기 키워드만 */
export function filterProfileTags(tags: string[] | null | undefined, name: string | null): string[] | null {
  if (!tags?.length) return null;
  const nameNorm = name?.trim().toLowerCase() ?? "";
  const nameParts = nameNorm.split(/\s+/).filter((p) => p.length >= 2);

  const filtered = tags
    .map((t) => t.trim())
    .filter((t) => t.length > 0)
    .filter((t) => {
      const lower = t.toLowerCase();
      if (BANNED_TAGS.has(lower)) return false;
      if (!nameNorm) return true;
      if (lower === nameNorm) return false;
      if (nameNorm.includes(lower) && lower.length >= 2) return false;
      if (lower.includes(nameNorm)) return false;
      for (const part of nameParts) {
        if (part === lower) return false;
        if (part.length >= 2 && lower.includes(part)) return false;
        if (lower.length >= 2 && part.includes(lower)) return false;
      }
      return true;
    })
    .slice(0, 4);

  return filtered.length > 0 ? filtered : null;
}

export function normalizeGeneratedProfile(raw: Partial<GeneratedProfile>): GeneratedProfile {
  const name = typeof raw.name === "string" && raw.name.trim() ? raw.name.trim() : null;
  const rawTags = Array.isArray(raw.tags)
    ? raw.tags.filter((t): t is string => typeof t === "string" && t.trim().length > 0)
    : null;

  const biographyRaw =
    typeof raw.biography === "string" && raw.biography.trim() ? raw.biography.trim() : null;

  return {
    name,
    tags: filterProfileTags(rawTags, name),
    summary: typeof raw.summary === "string" && raw.summary.trim() ? raw.summary.trim().slice(0, 50) : null,
    biography: biographyRaw
      ? normalizeBiographyStructure(stripHtmlFromText(biographyRaw)).slice(
          0,
          PROFILE_BIOGRAPHY_LIMIT
        )
      : null,
    appearance: null,
    layoutHint: parseLayoutHint(raw.layoutHint),
  };
}

function detectLayoutHint(text: string): LayoutHint {
  if (/위에|상단|맨\s*위|top/i.test(text)) return "top";
  if (/왼쪽|좌측|left/i.test(text)) return "left";
  if (/오른쪽|우측|right/i.test(text)) return "right";
  return "right";
}

function designOnlyMarkdown(body: string): string {
  const trimmed = stripHtmlFromText(body.trim());
  if (!trimmed) return "";
  return normalizeBiographyStructure(trimmed).slice(0, PROFILE_BIOGRAPHY_LIMIT);
}

/** 사이트 공통 프로필 디자인 — 본문 마크다운만 · 이름/한줄소개/태그는 제작 탭 전용 */
function layoutProfileLocally(rawText: string): GeneratedProfile {
  const trimmed = stripHtmlFromText(rawText.trim());
  return normalizeGeneratedProfile({
    name: null,
    tags: null,
    summary: null,
    biography: designOnlyMarkdown(trimmed),
    appearance: null,
    layoutHint: detectLayoutHint(rawText),
  });
}

/**
 * 줄글 → 공통 프로필 디자인.
 * AI 호출 없음 — 사이트 `ProfileRichText` 공통 레이아웃을 로컬에서 즉시 적용.
 */
export async function generateProfileFromText(
  rawText: string,
  _imageUrl?: string
): Promise<GenerateProfileResult> {
  const text = rawText.trim();
  if (!text) throw new Error("줄글 텍스트를 입력하세요.");

  return {
    profile: layoutProfileLocally(text),
    estimated: false,
  };
}

/** GeneratedProfile → 캐릭터 생성 폼 필드 */
export function generatedProfileToFormFields(profile: GeneratedProfile, imageUrls?: string[]) {
  const urls = imageUrls?.filter(Boolean) ?? [];
  const fromBio = findImageUrl(profile.biography ?? "");
  const allUrls = urls.length > 0 ? urls : fromBio ? [fromBio] : [];
  const gallery = galleryImageUrls(allUrls, profile.biography ?? "");
  const descParts: string[] = [...gallery];
  if (profile.biography) descParts.push(profile.biography);

  return {
    name: profile.name || "",
    tagline: (profile.summary || "").slice(0, 50),
    tags: profile.tags?.join(", ") || "",
    description: descParts.join("\n\n").slice(0, PROFILE_BIOGRAPHY_LIMIT),
    layoutHint: profile.layoutHint,
    imageUrls: gallery,
  };
}
