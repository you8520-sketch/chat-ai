/**
 * Single pinned Jev Decisions model policy, shared by the runtime transport
 * and the independent weekly model radar. Never use a floating "latest" alias.
 */
export const JEV_ACTIVE_MODEL = "typesafe/jev-1.14";

/**
 * Retired IDs remain here ONLY as a negative safety policy. They are not
 * request defaults, aliases, fallbacks, or eligible benchmark candidates.
 */
const RETIRED_JEV_MODEL = "typesafe/jev-1.13";

export function isRetiredJevModelId(modelId: string): boolean {
  const trimmed = modelId.trim().toLowerCase();
  const id = trimmed.startsWith("~") ? trimmed.slice(1) : trimmed;
  if (!id.startsWith(RETIRED_JEV_MODEL)) return false;
  const suffix = id.slice(RETIRED_JEV_MODEL.length);
  return suffix === "" || suffix.startsWith("-") || suffix.startsWith(":");
}
