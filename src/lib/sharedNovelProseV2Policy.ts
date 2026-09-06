/**
 * Shared Novel Prose V2 — admin allowlist canary (default OFF, fail-closed).
 *
 * Exact canonical Main RP model IDs only:
 *   - deepseek-v4-pro-0813
 *   - claude-opus-5
 *   - gemini-3.1-pro-preview
 *   - gemini-3.7-flash
 *
 * Retired RP models (Luna, Gemini 3.6 Flash) are excluded — they are not Main
 * RP selectable.
 *
 * Actual ON requires BOTH:
 *   SHARED_NOVEL_PROSE_V2_ENABLED=1 (or "true")
 *   AND requesting userId in SHARED_NOVEL_PROSE_V2_USER_IDS
 *   AND modelId is one of the exact IDs above.
 */

import {
  CHEAPER_INFERENCE_CLAUDE_OPUS_5_MODEL,
  CHEAPER_INFERENCE_DEEPSEEK_V4_PRO_MODEL,
  CHEAPER_INFERENCE_GEMINI_31_PRO_PREVIEW_MODEL,
  CHEAPER_INFERENCE_GEMINI_37_FLASH_MODEL,
} from "@/lib/chatModels";

const ENV_ENABLED = "SHARED_NOVEL_PROSE_V2_ENABLED";
const ENV_USER_IDS = "SHARED_NOVEL_PROSE_V2_USER_IDS";

export const SHARED_NOVEL_PROSE_V2_MODEL_IDS = [
  CHEAPER_INFERENCE_DEEPSEEK_V4_PRO_MODEL,
  CHEAPER_INFERENCE_CLAUDE_OPUS_5_MODEL,
  CHEAPER_INFERENCE_GEMINI_31_PRO_PREVIEW_MODEL,
  CHEAPER_INFERENCE_GEMINI_37_FLASH_MODEL,
] as const;

const ALLOWED = new Set(
  SHARED_NOVEL_PROSE_V2_MODEL_IDS.map((id) => id.trim().toLowerCase())
);

const CANONICAL_POSITIVE_INT_RE = /^[1-9]\d*$/;

function parseAllowlist(raw: string | undefined): number[] {
  if (!raw) return [];
  const out: number[] = [];
  for (const part of raw.split(",")) {
    const t = part.trim();
    if (!CANONICAL_POSITIVE_INT_RE.test(t)) continue;
    const n = Number(t);
    if (Number.isSafeInteger(n) && n > 0) out.push(n);
  }
  return out;
}

function isTruthyEnvFlag(raw: string | undefined): boolean {
  const enabled = raw?.trim();
  return enabled === "1" || enabled?.toLowerCase() === "true";
}

function normalizeModelId(modelId: string | null | undefined): string | null {
  if (!modelId) return null;
  const id = modelId.trim().toLowerCase();
  return id || null;
}

export function isSharedNovelProseV2Model(
  modelId?: string | null | undefined
): boolean {
  const id = normalizeModelId(modelId);
  return !!id && ALLOWED.has(id);
}

/** Admin canary — enabled + USER_IDS + exact allowlisted model. */
export function isSharedNovelProseV2EnabledForUser(
  userId: number | null | undefined,
  modelId?: string | null | undefined
): boolean {
  if (!isTruthyEnvFlag(process.env[ENV_ENABLED])) return false;

  const allow = parseAllowlist(process.env[ENV_USER_IDS]);
  if (allow.length === 0) return false;

  if (userId == null || !Number.isSafeInteger(userId) || userId <= 0) return false;
  if (!allow.includes(userId)) return false;

  if (!isSharedNovelProseV2Model(modelId)) return false;
  return true;
}

export const SHARED_NOVEL_PROSE_V2_ENV = {
  ENABLED: ENV_ENABLED,
  USER_IDS: ENV_USER_IDS,
};
