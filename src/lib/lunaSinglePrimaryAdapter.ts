/**
 * Luna (GPT-5.6 Luna) single-primary terminal output contract.
 * Lives only on the current user-turn tail (last meaningful instruction).
 * Never applied to simulation, ensemble/party, or non-Luna models.
 *
 * P1: dialogue concentration/share moved to the canonical common owner
 * (IMMERSIVE_PROSE_BLOCK in advancedProseNsfwGuidelines). This contract keeps
 * only the Luna length semantics — 3,200+ target, extendible, absolute end.
 */

import { isGpt56LunaModel } from "@/lib/chatModels";
import type { ContentKind } from "@/lib/simulationMode";

/** Unified length owner for Luna single_primary (dialogue economy lives in common prose). */
export const LUNA_TERMINAL_OUTPUT_CONTRACT =
  "이번 응답은 한국어 RP 본문만 3,200자 이상을 기본 목표로 작성한다. 장면에 필요한 내용이 있으면 더 길게 이어간다.";

/**
 * Returns the Luna terminal contract, or null when not applicable.
 * Caller must pass contentKind and party so we can determine single_primary
 * without importing SceneDirective (avoid circular dependency).
 */
export function resolveLunaTerminalOutputContract(
  modelId: string | null | undefined,
  contentKind: ContentKind | null | undefined,
  party: boolean | null | undefined
): string | null {
  if (!modelId || !isGpt56LunaModel(modelId)) return null;
  // single_primary = character RP without explicit party/ensemble flag.
  if (contentKind !== "character") return null;
  if (party === true) return null;
  return LUNA_TERMINAL_OUTPUT_CONTRACT;
}

/**
 * @deprecated System adapter removed — use resolveLunaTerminalOutputContract on user-tail.
 * Always returns null so system sections are never injected.
 */
export function resolveLunaSinglePrimaryLine(
  _modelId: string | null | undefined,
  _contentKind: ContentKind | null | undefined,
  _party: boolean | null | undefined
): string | null {
  return null;
}
