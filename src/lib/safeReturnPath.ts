import { SERVICE_PUBLIC_ORIGIN } from "@/lib/businessIdentity";

const SAFE_RETURN_PATH = /^\/(?!\/)[^?#]*$/;
const RETURN_PATH_BYPASS = /[\\\u0000-\u001F\u007F]/;

/**
 * Same-origin path only. Rejects absolute, protocol-relative, query, and hash
 * targets, plus backslash and control characters that the URL parser would
 * treat as a different host.
 */
export function sanitizeReturnPath(value: string | null | undefined, fallback = "/login"): string {
  const trimmed = value?.trim() ?? "";
  if (!trimmed || !SAFE_RETURN_PATH.test(trimmed) || RETURN_PATH_BYPASS.test(trimmed)) return fallback;

  let parsed: URL;
  try {
    parsed = new URL(trimmed, SERVICE_PUBLIC_ORIGIN);
  } catch {
    return fallback;
  }
  if (parsed.origin !== SERVICE_PUBLIC_ORIGIN || parsed.search !== "" || parsed.hash !== "") return fallback;
  return trimmed;
}
