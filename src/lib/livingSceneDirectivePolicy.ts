/**
 * Living Scene Directive V2 — Continuity Director canary (default OFF).
 * Gate OFF → legacy Scene Directive prompt byte-identical.
 */

import {
  CHEAPER_INFERENCE_DEEPSEEK_V4_PRO_MODEL,
  CHEAPER_INFERENCE_GPT_56_LUNA_MODEL,
  OPENROUTER_GEMINI_36_FLASH_MODEL,
} from "@/lib/chatModels";

const ENV_ENABLED = "LIVING_SCENE_DIRECTIVE_V2_ENABLED";
const ENV_USER_IDS = "LIVING_SCENE_DIRECTIVE_V2_USER_IDS";

export const LIVING_SCENE_DIRECTIVE_V2_MODEL_IDS = [
  CHEAPER_INFERENCE_GPT_56_LUNA_MODEL,
  CHEAPER_INFERENCE_DEEPSEEK_V4_PRO_MODEL,
  OPENROUTER_GEMINI_36_FLASH_MODEL,
] as const;

const ALLOWED = new Set(
  LIVING_SCENE_DIRECTIVE_V2_MODEL_IDS.map((id) => id.trim().toLowerCase())
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

export function isLivingSceneDirectiveV2EnabledForUser(
  userId: number | null | undefined,
  modelId?: string | null | undefined
): boolean {
  if (!isTruthyEnvFlag(process.env[ENV_ENABLED])) return false;
  const allow = parseAllowlist(process.env[ENV_USER_IDS]);
  if (allow.length === 0) return false;
  if (userId == null || !Number.isSafeInteger(userId) || userId <= 0) return false;
  if (!allow.includes(userId)) return false;
  const id = modelId?.trim().toLowerCase();
  if (!id || !ALLOWED.has(id)) return false;
  return true;
}

export const LIVING_SCENE_DIRECTIVE_V2_ENV = {
  ENABLED: ENV_ENABLED,
  USER_IDS: ENV_USER_IDS,
};
