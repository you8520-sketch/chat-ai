const SAFE_RETURN_PATH = /^\/(?!\/)[^?#]*$/;

/** Same-origin path only. Rejects absolute, protocol-relative, query, and hash targets. */
export function sanitizeReturnPath(value: string | null | undefined, fallback = "/login"): string {
  const trimmed = value?.trim() ?? "";
  if (!trimmed || !SAFE_RETURN_PATH.test(trimmed)) return fallback;
  return trimmed;
}
