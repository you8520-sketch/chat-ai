/**
 * DeepSeek compact future-instruction boundary — RETIRED from production runtime.
 *
 * A/B verified: overlap with #307 collaborative owner; boundary removed.
 * Style-only reminder + USER_TAIL length + XML/LTM remain unchanged.
 * Constant retained for stale-strip / historical tests only.
 */

import type { ContentKind } from "@/lib/simulationMode";
import type { ChatRuntimeMode } from "@/lib/chatRuntimeMode";

/** Historical wording — not injected on production path. */
export const DEEPSEEK_COMPACT_FUTURE_INSTRUCTION_BOUNDARY =
  "[B]가 “시키는 대로 하겠다”, “지시해”, “따르겠다”처럼 포괄적으로 순응 의사를 밝혀도 이후 모든 행동·대사·선택을 대신 수행하라는 뜻은 아니다. 현재 상황에서 짧고 즉각적이며 되돌릴 수 있는 단일 보조 행동은 자연스럽게 이어갈 수 있지만, 그것을 두 번째 행동·새 대사·새 동의·중요한 선택으로 자동 연쇄하지 않는다.";

/** Unique substring for strip/re-append and offline asserts. */
export const DEEPSEEK_COMPACT_FUTURE_INSTRUCTION_BOUNDARY_MARKER =
  "포괄적으로 순응 의사를 밝혀도 이후 모든 행동·대사·선택을 대신 수행하라는 뜻은 아니다";

/** Strong Opus-style stop wording — must never be added for DeepSeek. */
export const DEEPSEEK_FORBIDDEN_ARM_E_STOP_SENTENCE =
  "첫 번째로 새롭게 요구되는 행동 직전에 무조건 멈춘다";

/** Always false — future boundary retired from production assembly. */
export function shouldUseDeepSeekCompactFutureInstructionBoundary(_opts: {
  modelId?: string | null;
  contentKind?: ContentKind | string | null;
  party?: boolean | null;
  runtimeMode?: ChatRuntimeMode | string | null;
}): boolean {
  return false;
}

/** Always null — future boundary retired. */
export function resolveDeepSeekCompactFutureInstructionBoundary(opts: {
  modelId?: string | null;
  contentKind?: ContentKind | string | null;
  party?: boolean | null;
  runtimeMode?: ChatRuntimeMode | string | null;
}): string | null {
  return shouldUseDeepSeekCompactFutureInstructionBoundary(opts)
    ? DEEPSEEK_COMPACT_FUTURE_INSTRUCTION_BOUNDARY
    : null;
}
