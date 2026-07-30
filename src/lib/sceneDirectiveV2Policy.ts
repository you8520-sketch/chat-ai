/**
 * SceneDirective V2 (Event Restraint + Two-Turn Reconvergence) mode gate.
 * Default OFF — production path unchanged.
 *
 * Distinct from Living Scene Directive Continuity Director
 * (LIVING_SCENE_DIRECTIVE_V2_ENABLED).
 */

export type SceneDirectiveV2Mode = "off" | "shadow" | "on";

const ENV_MODE = "SCENE_DIRECTIVE_V2_MODE";

export function getSceneDirectiveV2Mode(
  env: NodeJS.ProcessEnv = process.env
): SceneDirectiveV2Mode {
  const raw = env[ENV_MODE]?.trim().toLowerCase();
  if (raw === "shadow" || raw === "on") return raw;
  return "off";
}

export function isSceneDirectiveV2ComputeEnabled(
  env: NodeJS.ProcessEnv = process.env
): boolean {
  const mode = getSceneDirectiveV2Mode(env);
  return mode === "shadow" || mode === "on";
}

export function isSceneDirectiveV2InjectEnabled(
  env: NodeJS.ProcessEnv = process.env
): boolean {
  return getSceneDirectiveV2Mode(env) === "on";
}

/**
 * Single scene-pacing prompt owner for Living × Event-Restraint V2 flag matrix.
 * V2 ON is always the sole owner (no dual inject with V1/Living).
 * V2 shadow/off: Living Continuity Director (if enabled) else legacy V1.
 */
export type ScenePacingPromptOwner =
  | "event_restraint_v2"
  | "living_continuity_director"
  | "legacy_v1";

export function resolveScenePacingPromptOwner(input: {
  v2Mode: SceneDirectiveV2Mode;
  livingEnabled: boolean;
}): ScenePacingPromptOwner {
  if (input.v2Mode === "on") return "event_restraint_v2";
  if (input.livingEnabled) return "living_continuity_director";
  return "legacy_v1";
}

export const SCENE_DIRECTIVE_V2_ENV = {
  MODE: ENV_MODE,
} as const;
