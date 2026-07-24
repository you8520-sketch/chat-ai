/** Gemini generateContent용 모델 우선순위 (무료 tier 지원 모델 우선) */
export function getGeminiModelCandidates(envKey?: string): string[] {
  const fromEnv = [
    envKey && process.env[envKey],
    process.env.GEMINI_GENERATE_MODEL,
    process.env.GEMINI_FORMAT_MODEL,
    process.env.GEMINI_MODEL,
  ].filter(Boolean) as string[];

  const defaults = ["gemini-3.1-flash-lite", "gemini-2.0-flash"];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const m of [...fromEnv, ...defaults]) {
    if (!seen.has(m)) {
      seen.add(m);
      out.push(m);
    }
  }
  return out;
}

import { formatHttpApiError } from "@/lib/apiErrors";

export function parseGeminiError(bodyText: string, status: number): string {
  const statusText =
    status === 401
      ? "Unauthorized"
      : status === 402
        ? "Payment Required"
        : status === 403
          ? "Forbidden"
          : status === 404
            ? "Not Found"
            : status === 429
              ? "Too Many Requests"
              : status === 503
                ? "Service Unavailable"
                : "Error";
  return formatHttpApiError(status, statusText, bodyText);
}
