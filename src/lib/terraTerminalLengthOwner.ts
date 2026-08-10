/**
 * Terra terminal length+completion contract — RETIRED from production runtime.
 *
 * A/B verified: contract removed; Terra uses generic USER_TAIL_LENGTH_OWNER_SENTENCE.
 * Contract strings retained for canary helpers / stale-strip / historical tests only.
 * Do not re-enable shouldUseTerraTerminalLengthOwner for production assembly.
 */

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

/** Mid-contract phrase — historical enumeration (canary may still reference). */
export const TERRA_TERMINAL_LENGTH_OWNER_ENUMERATION_PHRASE =
  "관찰·행동·대사·감각·심리의 인과적 연쇄";

/** Canary-only replacement for terminal enumeration phrase. */
export const TERRA_TERMINAL_LENGTH_OWNER_CONTINUOUS_SCENE_PHRASE = "하나의 연속된 장면";

/** Frozen Terra contract text — not injected on production path. */
export const TERRA_TERMINAL_LENGTH_OWNER_CONTRACT =
  "이번 응답은 한국어 RP 본문만 3,200자 이상을 기본 목표로 작성한다. 장면에 필요한 내용이 있으면 더 길게 이어간다. 현재 상호작용을 관찰·행동·대사·감각·심리의 인과적 연쇄로 전개하여, 조용한 장면에서는 관계나 상황의 확인 가능한 변화 하나에 도달하고, 행동 장면에서는 이번 턴에 시작된 주요 행동의 최초로 확인 가능한 결과에 도달한 뒤 마무리한다.";

/** Terminal owner with enumeration phrase → continuous-scene (byte-identical elsewhere). */
export const TERRA_TERMINAL_LENGTH_OWNER_CONTRACT_CONTINUOUS_SCENE =
  TERRA_TERMINAL_LENGTH_OWNER_CONTRACT.replace(
    `현재 상호작용을 ${TERRA_TERMINAL_LENGTH_OWNER_ENUMERATION_PHRASE}로 전개하여`,
    `현재 상호작용을 ${TERRA_TERMINAL_LENGTH_OWNER_CONTINUOUS_SCENE_PHRASE}으로 전개하여`
  );

/** Always false — Terra contract retired; fall through to USER_TAIL. */
export function shouldUseTerraTerminalLengthOwner(_opts: {
  modelId?: string | null;
  contentKind?: ContentKind | string | null;
}): boolean {
  return false;
}
