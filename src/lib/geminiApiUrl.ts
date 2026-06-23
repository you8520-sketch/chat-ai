/** Google Gemini REST API 기본 origin (env 미설정 시 fallback) */
export const DEFAULT_GEMINI_API_BASE_URL = "https://generativelanguage.googleapis.com";

let baseUrlLogged = false;

/** GEMINI_API_BASE_URL — proxy/커스텀 게이트웨이. 비어 있으면 Google 본사 주소 */
export function getGeminiApiBaseUrl(): string {
  const raw = process.env.GEMINI_API_BASE_URL?.trim();
  const base = raw || DEFAULT_GEMINI_API_BASE_URL;
  return base.replace(/\/+$/, "");
}

export function logGeminiApiBaseUrlOnce(): void {
  if (baseUrlLogged || process.env.NODE_ENV === "production") return;
  baseUrlLogged = true;
  const custom = process.env.GEMINI_API_BASE_URL?.trim();
  if (custom) {
    console.log("[gemini-api] custom base URL", { GEMINI_API_BASE_URL: getGeminiApiBaseUrl() });
  }
}

/** path는 `/v1beta/...` 형식 */
export function buildGeminiApiUrl(
  path: string,
  searchParams?: Record<string, string | undefined>
): string {
  logGeminiApiBaseUrlOnce();
  const normalized = path.startsWith("/") ? path : `/${path}`;
  const url = new URL(`${getGeminiApiBaseUrl()}${normalized}`);
  if (searchParams) {
    for (const [key, value] of Object.entries(searchParams)) {
      if (value != null && value !== "") url.searchParams.set(key, value);
    }
  }
  return url.toString();
}

export function geminiGenerateContentUrl(modelId: string, apiKey: string): string {
  return buildGeminiApiUrl(`/v1beta/models/${modelId}:generateContent`, { key: apiKey });
}

export function geminiStreamGenerateContentUrl(modelId: string, apiKey: string): string {
  return buildGeminiApiUrl(`/v1beta/models/${modelId}:streamGenerateContent`, {
    alt: "sse",
    key: apiKey,
  });
}

export function geminiCachedContentsUrl(apiKey: string): string {
  return buildGeminiApiUrl("/v1beta/cachedContents", { key: apiKey });
}
