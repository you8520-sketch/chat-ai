/**
 * Canonical Published model alias owner — single source for model ID normalization.
 */

const PUBLISHED_MODEL_ALIASES: Record<string, string> = {
  "google/gemini-3.1-pro-preview": "gemini-3.1-pro-preview",
  "deepseek-v4-pro": "deepseek-v4-pro-0813",
  "deepseek/deepseek-v4-pro": "deepseek-v4-pro-0813",
};

export function normalizePublishedModelId(modelId: string): string {
  return modelId.trim().toLowerCase();
}

export function canonicalizePublishedModelId(modelId: string): string {
  const normalized = normalizePublishedModelId(modelId);
  return PUBLISHED_MODEL_ALIASES[normalized] ?? normalized;
}
