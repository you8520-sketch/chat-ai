/**
 * Luna (GPT-5.6 Luna) single-primary terminal output contract.
 * Lives only on the current user-turn tail (last meaningful instruction).
 * Never applied to simulation, ensemble/party, or non-Luna models.
 */

import { isGpt56LunaModel } from "@/lib/chatModels";
import type { ContentKind } from "@/lib/simulationMode";

/** Unified length + dialogue-concentration owner for Luna single_primary. */
export const LUNA_TERMINAL_OUTPUT_CONTRACT =
  "이번 응답은 한국어 RP 본문만 3,200자 이상을 기본 목표로 작성한다. 장면에 필요한 내용이 있으면 더 길게 이어간다. 대사의 양은 장면에 따라 없거나 몇 차례로 자연스럽게 달라질 수 있으며, 같은 화자의 이어지는 말·설명·반응은 하나의 충분한 발화로 묶고 나머지는 행동·감각·심리·환경 변화로 전개한다.";

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
