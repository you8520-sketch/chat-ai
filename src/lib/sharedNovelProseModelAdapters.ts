/**
 * Shared Novel Prose — model-specific adapters (length / early-stop).
 *
 * Shared Novel Prose Core owns style. Adapters own model-specific length
 * completion only.
 *
 * Registry:
 * - DeepSeek length arms: experiment env only (default OFF)
 * - Terra terminal length owner: gpt-5.6-terra + single_primary (candidate)
 * - Luna / Gemini Flash: reserved null stubs
 */

import { isCheaperInferenceDeepSeekV4ProModel } from "@/lib/chatModels";
import {
  shouldUseTerraTerminalLengthOwner,
  TERRA_TERMINAL_LENGTH_OWNER_CONTRACT,
} from "@/lib/terraTerminalLengthOwner";
import type { ContentKind } from "@/lib/simulationMode";

export {
  resolveRpSceneCastMode,
  shouldUseTerraTerminalLengthOwner,
  TERRA_TERMINAL_LENGTH_OWNER_CONTRACT,
} from "@/lib/terraTerminalLengthOwner";
export type { RpSceneCastMode } from "@/lib/terraTerminalLengthOwner";

/** Experiment-only — DeepSeek length arm selector (A|B|C). Not a production flag. */
export const SNPV2_DEEPSEEK_LENGTH_ARM_ENV = "SNPV2_DEEPSEEK_LENGTH_ARM";

export type DeepSeekLengthArm = "A" | "B" | "C";

/** Anti-filler safety — always paired after DeepSeek length sentences (B/C). */
export const DEEPSEEK_LENGTH_SAFETY_SENTENCE =
  "분량을 늘리기 위해 새로운 NPC·별도 사건·불필요한 질문·설정 설명·같은 감정의 반복 해석을 추가하지 않는다. 현재 장면에서 실제로 발생하는 변화만 전개한다.";

/** Arm B — safe scene-unit completion (DeepSeek-only). */
export const DEEPSEEK_LENGTH_ARM_B_SENTENCE =
  "이번 응답에서는 현재 장면을 중간에서 성급하게 끊지 말고, 인물의 행동·반응·판단과 그에 따른 장면 변화를 충분히 전개하여 하나의 실질적인 장면 단위를 완성한다.";

/**
 * Arm C — exact production terminal strong phrase (comparison only).
 * Source: buildCompactTerminalLengthAbsoluteTail non-V2 suffix in responseLength.ts
 */
export const DEEPSEEK_LENGTH_ARM_C_SENTENCE =
  "단일 응답 최대 전개·미달 조기 종료 금지.";

/**
 * Phase-2 candidate only — do NOT apply in transport-1 experiments.
 * Inner-repeat / echo guard wording for Shared Core revision.
 */
export const SHARED_NOVEL_PROSE_INNER_REPEAT_CANDIDATE =
  "현재 장면의 중심 심리와 판단을 충분히 보여주되, 이미 제시한 감정이나 해석을 다른 표현으로 반복하지 않는다. 새 내면 문장은 새로운 기억·오해·판단·욕구·결정 변화 중 하나를 추가해야 한다.";

/**
 * Phase-2 candidate only — do NOT apply in transport-1 experiments.
 * User exit / distance intent handling.
 */
export const SHARED_NOVEL_PROSE_USER_EXIT_CANDIDATE =
  "유저가 대화 종료·보류·거리 두기 의사를 보이면, 그 의미를 반복해서 해석하거나 새로운 질문으로 붙잡지 않는다. 캐릭터다운 마지막 반응과 필요한 내면 변화까지만 묘사한 뒤 다음 선택을 유저에게 남긴다.";

/**
 * Soft length wording candidate — not applied in transport-1
 * (keep current V2 TARGET/FLOOR strings unchanged).
 */
export const SHARED_NOVEL_PROSE_SOFT_LENGTH_CANDIDATE = [
  "SOFT_TARGET_RANGE: 약 2,800–3,300 한국어 글자",
  "PREFERRED_CENTER: 약 3,000자",
  "QUALITY_FLOOR: 약 2,500자",
].join("\n");

export function parseDeepSeekLengthArm(
  raw: string | undefined
): DeepSeekLengthArm {
  const v = raw?.trim().toUpperCase();
  if (v === "B" || v === "C") return v;
  return "A";
}

export function buildDeepSeekLengthAdapterBlock(
  arm: DeepSeekLengthArm
): string | null {
  if (arm === "A") return null;
  if (arm === "B") {
    return `[DEEPSEEK LENGTH ADAPTER — B]
${DEEPSEEK_LENGTH_ARM_B_SENTENCE}
${DEEPSEEK_LENGTH_SAFETY_SENTENCE}`;
  }
  return `[DEEPSEEK LENGTH ADAPTER — C]
${DEEPSEEK_LENGTH_ARM_C_SENTENCE}
${DEEPSEEK_LENGTH_SAFETY_SENTENCE}`;
}

/**
 * Resolve DeepSeek length adapter for prompt assembly.
 * Active only when model is CheaperInference deepseek-v4-pro AND
 * SNPV2_DEEPSEEK_LENGTH_ARM is B or C.
 */
export function resolveDeepSeekLengthAdapterSection(
  modelId?: string | null | undefined
): string | null {
  if (!isCheaperInferenceDeepSeekV4ProModel(modelId ?? "")) return null;
  const arm = parseDeepSeekLengthArm(process.env[SNPV2_DEEPSEEK_LENGTH_ARM_ENV]);
  return buildDeepSeekLengthAdapterBlock(arm);
}

/**
 * Terra terminal single-owner — sole active Terra length adapter.
 * Returns the frozen contract when model=gpt-5.6-terra and cast=single_primary;
 * null for simulation / other models (caller keeps production TARGET/FLOOR owners).
 */
export function resolveTerraTerminalLengthOwnerContract(opts: {
  modelId?: string | null;
  contentKind?: ContentKind | string | null;
}): string | null {
  if (!shouldUseTerraTerminalLengthOwner(opts)) return null;
  return TERRA_TERMINAL_LENGTH_OWNER_CONTRACT;
}

/** @deprecated Use resolveTerraTerminalLengthOwnerContract + scene cast gate. */
export function isTerraTerminalLengthOwnerActive(opts: {
  modelId?: string | null;
  contentKind?: ContentKind | string | null;
}): boolean {
  return shouldUseTerraTerminalLengthOwner(opts);
}

/** Luna adapter — reserved; inactive (do not copy Terra contract here). */
export function resolveLunaAdapterSection(): string | null {
  return null;
}

export function resolveGemini36FlashAdapterSection(): string | null {
  return null;
}
