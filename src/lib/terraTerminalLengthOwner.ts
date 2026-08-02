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
  "이번 응답은 한국어 RP 본문 기준 공백 포함 3,200~4,200자의 하나의 장면으로 작성한다. 장면의 중심은 주요 캐릭터와 사용자의 관계·상태 변화이며, 주요 캐릭터의 관찰·판단·감각·심리와 그에 따라 달라지는 행동·환경을 소설형 서술이 이끌고, 대사는 그 변화가 확정되거나 방향을 바꾸는 핵심 순간에 집중한다; 같은 화자의 이어지는 설명·반응·농담은 하나의 충분한 발화로 묶고, 외부 인물은 필요한 정보나 압력을 제공한 뒤 초점을 주요 캐릭터와 사용자에게 돌린다. 조용한 장면은 확인 가능한 관계·상황 변화 하나까지, 행동 장면은 주요 행동의 최초 결과 하나까지 완성한 뒤, 사용자가 바로 반응할 수 있는 단 하나의 명확한 행동·질문·감정 변화에 초점을 맞춰 마무리한다.";

export function shouldUseTerraTerminalLengthOwner(opts: {
  modelId?: string | null;
  contentKind?: ContentKind | string | null;
}): boolean {
  if (!isGpt56TerraModel(opts.modelId ?? "")) return false;
  return resolveRpSceneCastMode(opts.contentKind) === "single_primary";
}
