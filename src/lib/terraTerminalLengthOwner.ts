/**
 * Terra terminal single-owner length adapter (production candidate).
 *
 * Applies only when model = gpt-5.6-terra AND scene cast = single_primary.
 * Injects one length+completion contract at the absolute end of the current
 * user turn; strips competing TARGET_LENGTH / MINIMUM_FLOOR owners on that path.
 *
 * Contract wording is frozen — do not edit for style experiments.
 * Not adopted into shared/common layers; Luna and other models unchanged.
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

/**
 * Exact terminal contract — inject once at absolute user-turn end.
 * Frozen candidate text; replace wholesale, do not append variants.
 */
export const TERRA_TERMINAL_LENGTH_OWNER_CONTRACT =
  "이번 응답은 한국어 RP 본문 기준 공백 포함 3,200~4,200자의 하나의 장면으로 작성한다. 서술은 주요 캐릭터의 관찰과 판단이 행동을 바꾸고, 그 행동이 환경과 관계의 변화를 낳는 흐름을 여러 단계 이어 가며 장면의 주축을 담당한다. 대사는 장면의 주요 변화마다 배치하며, 같은 화자는 그 순간 전달할 판단·설명·농담과 이어지는 반응을 하나의 충분한 발화 안에서 마친다. 조용한 장면은 확인 가능한 관계·상황 변화 하나까지, 행동 장면은 주요 행동의 최초 결과 하나까지 완성하고, 마지막에는 사용자가 바로 반응할 대상 하나만 남긴다.";

export function shouldUseTerraTerminalLengthOwner(opts: {
  modelId?: string | null;
  contentKind?: ContentKind | string | null;
}): boolean {
  if (!isGpt56TerraModel(opts.modelId ?? "")) return false;
  return resolveRpSceneCastMode(opts.contentKind) === "single_primary";
}
