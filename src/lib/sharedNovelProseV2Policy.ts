/**
 * Shared Novel Prose V2 — admin allowlist canary (default OFF, fail-closed).
 *
 * Exact canonical Main RP model IDs only (derived from MAIN_RP_MODEL_IDS).
 * Retired RP models (Opus 5, Luna, Gemini 3.6 Flash, …) are excluded.
 *
 * Actual ON requires BOTH:
 *   SHARED_NOVEL_PROSE_V2_ENABLED=1 (or "true")
 *   AND requesting userId in SHARED_NOVEL_PROSE_V2_USER_IDS
 *   AND modelId is one of the exact IDs above.
 */

import { MAIN_RP_MODEL_IDS } from "@/lib/chatModels";

const ENV_ENABLED = "SHARED_NOVEL_PROSE_V2_ENABLED";
const ENV_USER_IDS = "SHARED_NOVEL_PROSE_V2_USER_IDS";

export const SHARED_NOVEL_PROSE_V2_MODEL_IDS = [...MAIN_RP_MODEL_IDS] as const;

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
