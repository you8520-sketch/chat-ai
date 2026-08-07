/**
 * Opus (claude-opus-5) frozen Arm E terminal owner — production candidate.
 *
 * Source: Audit 58 AUDIT58_ARM_E_TERMINAL (byte-identical).
 * Freeze: docs/audits/OPUS_AUDIT_57_59_FINAL_FREEZE.md
 *
 * Applies ONLY when:
 * - model = claude-opus-5
 * - standard interactive ordinary RP (runtimeMode === "interactive")
 * - contentKind = character (single_primary)
 * - party !== true
 *
 * Does NOT apply to auto progression, co-narration (OOC impersonation),
 * simulation, party, Terra, or DeepSeek.
 * Audit 59 Arm F stop-relaxation is intentionally absent.
 */

import { isCheaperInferenceClaudeOpus5Model } from "@/lib/chatModels";
import type { ContentKind } from "@/lib/simulationMode";
import type { ChatRuntimeMode } from "@/lib/chatRuntimeMode";

/** Frozen Audit 58 Arm E — do not edit wording/order/whitespace. */
export const OPUS_ARM_E_TERMINAL = `이번 응답은 한국어 총 표시 3,200~4,200자의 하나의 밀도 있는 장면으로 전개한다.

분량은 [A]와 AI가 담당하는 NPC·환경의 판단, 대사, 행동, 감각, 반응 및 그 결과를 중심으로 확장한다.

[B]의 유저 페르소나와 최근 행동 양식은 [B]의 즉각적인 반응을 자연스럽게 연결하기 위한 보조 근거로만 사용한다. 페르소나에 어울린다는 이유만으로 새로운 목표·선택·대사·동의·거절·관계 결정·위험 행동을 대신 만들지 않는다.

[B]가 현재 입력에서 이미 시작한 행동은 즉각적이고 가역적인 범위에서 자연스럽게 마무리할 수 있다. 또한 현재 상황에서 거의 자동적으로 발생하는 작고 비결정적인 반응은 유저 페르소나와 명백히 모순되지 않을 때만 제한적으로 묘사할 수 있다.

허용 가능한 [B]의 보조 행동은 모두 다음 조건을 충족해야 한다.

1. 현재 입력이나 직전 상황에서 직접 이어지는 행동이다.
2. 유저 페르소나 및 최근 행동과 모순되지 않는다.
3. 짧고 즉각적이며 되돌릴 수 있다.
4. 장면의 방향·관계·위험·동의를 결정하지 않는다.
5. 새로운 직접 대사를 포함하지 않는다.
6. 여러 단계의 후속 행동 연쇄로 확장되지 않는다.

[B]가 현재 입력에서 직접 선언하거나 시작한 하나의 행동은 그 행동 자체의 즉각적인 결과까지 이어갈 수 있다. 그러나 [B]가 “지시해”, “시키는 대로 하겠다”, “명령만 해”, “따르겠다”처럼 아직 특정되지 않은 이후 행동을 맡긴 표현은 미래 행동 전체에 대한 포괄적 위임이 아니다.
이 경우 AI는 [A]와 NPC가 지시·선택지·위험·예상 결과를 제시할 수 있지만, 현재 입력에서 [B]가 직접 선언하거나 시작하지 않은 지시 이행을 같은 응답 안에서 [B]가 실제로 수행한 것으로 서술하지 않는다. 첫 번째로 새롭게 요구되는 [B]의 행동 직전에 멈춘다.
하나의 명시된 행동을 처리한 뒤에는 그 결과에 대한 [A]·NPC·환경의 반응을 충분히 전개할 수 있지만, 그 반응 속에서 [B]에게 두 번째 행동을 자동으로 이어 붙이지 않는다.

[B]의 새로운 직접 대사, 중요한 선택·동의·거절, 고백, 공격, 도주, 동행, 퇴장, 구매, 선물, 비밀 공개, 관계 변화, 성적 행동, 위험 감수, 감정 결론은 대신 작성하지 않는다.

[B]의 반응이나 선택이 필요한 순간에는 그 직전에서 멈춘다.

현재 장면 안에서 하나 이상의 의미 있는 변화와 그 결과를 만든 뒤, [B]가 다음 행동을 선택할 수 있는 지점에서 끝낸다. 요약·예고·메타 해설이나 [B]의 역할 대행으로 분량을 채우지 않는다.`;

/** Unique marker for strip/re-append and offline asserts. */
export const OPUS_ARM_E_TERMINAL_MARKER =
  "유저 페르소나와 최근 행동 양식은 [B]의 즉각적인 반응";

/** Instruction-boundary marker — must be present; Arm F must be absent. */
export const OPUS_ARM_E_INSTRUCTION_BOUNDARY_MARKER =
  "미래 행동 전체에 대한 포괄적 위임이 아니다";

/** Rejected Audit 59 Arm F wording — must never appear in production. */
export const OPUS_ARM_F_REJECTED_STOP_MARKER =
  "더 이상 의미 있는 진행이 불가능한 지점에서 멈춘다";

export function shouldUseOpusArmETerminal(opts: {
  modelId?: string | null;
  contentKind?: ContentKind | string | null;
  party?: boolean | null;
  runtimeMode?: ChatRuntimeMode | string | null;
}): boolean {
  if (!isCheaperInferenceClaudeOpus5Model(opts.modelId ?? "")) return false;
  // Require explicit character (single_primary); never simulation/party/auto.
  if (opts.contentKind !== "character") return false;
  if (opts.party === true) return false;
  if (opts.runtimeMode !== "interactive") return false;
  return true;
}

/**
 * Returns frozen Arm E terminal, or null when not applicable.
 */
export function resolveOpusArmETerminal(opts: {
  modelId?: string | null;
  contentKind?: ContentKind | string | null;
  party?: boolean | null;
  runtimeMode?: ChatRuntimeMode | string | null;
}): string | null {
  if (!shouldUseOpusArmETerminal(opts)) return null;
  return OPUS_ARM_E_TERMINAL;
}
