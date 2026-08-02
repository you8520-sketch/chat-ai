/**
 * Terra terminal single-owner length diagnosis (experiment).
 *
 * Consolidates length + scene-completion ownership into one user-turn-terminal
 * contract for gpt-5.6-terra + single_primary only. Not a production adapter
 * commit — diagnosis arm until A/B proves it.
 */

import { isGpt56TerraModel } from "@/lib/chatModels";
import type { ContentKind } from "@/lib/simulationMode";

/** Existing cast classification used by production contentKind. */
export type RpSceneCastMode = "single_primary" | "simulation";

/**
 * Map production contentKind → scene cast mode.
 * character (default) = single_primary; simulation = ensemble / multi-cast.
 */
export function resolveRpSceneCastMode(
  contentKind?: ContentKind | string | null
): RpSceneCastMode {
  return contentKind === "simulation" ? "simulation" : "single_primary";
}

/** Exact two-sentence terminal contract — inject once at absolute user-turn end. */
export const TERRA_TERMINAL_LENGTH_OWNER_CONTRACT =
  "이번 응답은 한국어 RP 본문만 3,200~4,200자로 작성한다. 현재 상호작용을 관찰·행동·대사·감각·심리의 인과적 연쇄로 전개하여, 조용한 장면에서는 관계나 상황의 확인 가능한 변화 하나에 도달하고, 행동 장면에서는 이번 턴에 시작된 주요 행동의 최초로 확인 가능한 결과에 도달한 뒤 마무리한다.";

export function shouldUseTerraTerminalLengthOwner(opts: {
  modelId?: string | null;
  contentKind?: ContentKind | string | null;
}): boolean {
  if (!isGpt56TerraModel(opts.modelId ?? "")) return false;
  return resolveRpSceneCastMode(opts.contentKind) === "single_primary";
}
