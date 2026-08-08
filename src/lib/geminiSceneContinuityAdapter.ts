/**
 * Phase D2/D3 — Gemini 3.1 Pro Scene Continuity adapter (experiment-only).
 *
 * Production default: OFF. Not imported by chat routes / contextBuilder.
 *
 * D2: arm B = TERMINAL SYSTEM append (failed on length collapse).
 * D3: placement C = CONTEXT-BOUNDARY insert before [OUTPUT LAYOUT].
 * Wording bytes are frozen — do not patch-stack.
 *
 * MUST NOT become: 회상 금지 / 과거 언급 금지 / 설정 언급 금지.
 */
import { isGemini31ProModel } from "@/lib/chatModels";

/** Experiment env — set to "B" to enable candidate in harness (never production default). */
export const RP_GEMINI_SCENE_CONTINUITY_ARM_ENV =
  "RP_GEMINI_SCENE_CONTINUITY_ARM";

export type GeminiSceneContinuityArm = "A" | "B";

/** D3 placement variable (wording identical across T/C). */
export type GeminiContinuityPlacement =
  | "absent"
  | "terminal_system"
  | "context_boundary";

/**
 * Surgical insertion marker — production OpenRouter layout owner start.
 * Context-boundary C inserts immediately before this marker so other
 * section bytes stay unchanged (no reassembly).
 */
export const OUTPUT_LAYOUT_BOUNDARY_MARKER = "[OUTPUT LAYOUT]";

export const GEMINI_SCENE_CONTINUITY_BLOCK = `[GEMINI SCENE CONTINUITY]
캐릭터·유저·세계관·메모리와 최근 장면은 현재 반응과 다음 변화를 결정하는 근거다. 설정이나 이미 완료된 장면을 독자에게 다시 소개·요약하는 데 분량을 쓰지 않는다.

직전 장면과 현재 유저 입력에서 이미 발생한 행동·대사·환경 변화는 완료된 사건으로 취급한다. 이를 다시 수행하거나 장면 처음부터 재연하지 말고, 그 결과에 대한 NPC·환경의 새로운 반응·판단·행동과 다음 변화에서 이어간다.

과거 사실은 현재의 새로운 판단·감정·선택·위험·결과를 실제로 바꿀 때 필요한 만큼 자연스럽게 사용할 수 있다. 설정 활용 자체를 줄이지 않는다.`;

export const GEMINI_SCENE_CONTINUITY_MNEMONIC =
  "REMEMBER IT · DON'T RESTAGE IT · ACT FROM IT";

export function parseGeminiSceneContinuityArm(
  raw: string | undefined
): GeminiSceneContinuityArm {
  const v = raw?.trim().toUpperCase();
  return v === "B" ? "B" : "A";
}

export function estimateGeminiSceneContinuityTokens(): number {
  // Rough KR heuristic used by other prompt audits in this repo.
  return Math.max(1, Math.ceil(GEMINI_SCENE_CONTINUITY_BLOCK.length * 0.9));
}

/**
 * Resolve experiment adapter text. Returns null for arm A / non-Gemini-3.1-Pro /
 * missing model. Never reads process.env unless env override is passed.
 */
export function resolveGeminiSceneContinuityAdapterSection(input: {
  modelId: string;
  arm: GeminiSceneContinuityArm;
}): string | null {
  if (input.arm !== "B") return null;
  if (!isGemini31ProModel(input.modelId)) return null;
  return GEMINI_SCENE_CONTINUITY_BLOCK;
}

function resolveBlockForPlacement(input: {
  modelId: string;
  placement: GeminiContinuityPlacement;
}): string | null {
  if (input.placement === "absent") return null;
  if (!isGemini31ProModel(input.modelId)) return null;
  return GEMINI_SCENE_CONTINUITY_BLOCK;
}

/**
 * Insert continuity block immediately before [OUTPUT LAYOUT].
 * Throws if marker missing — harness must not silently fall back to terminal.
 */
export function insertGeminiSceneContinuityBeforeOutputLayout(
  systemPrompt: string,
  block: string
): string {
  const idx = systemPrompt.indexOf(OUTPUT_LAYOUT_BOUNDARY_MARKER);
  if (idx < 0) {
    throw new Error(
      "CONTEXT_BOUNDARY_INSERT_FAIL: [OUTPUT LAYOUT] marker missing in system prompt"
    );
  }
  const before = systemPrompt.slice(0, idx).trimEnd();
  const after = systemPrompt.slice(idx);
  return `${before}\n\n${block}\n\n${after}`;
}

/**
 * Verify C insertion only adds the continuity block (no other section rewrite).
 * Returns true when stripping the block from placed prompt recovers baseline.
 */
export function contextBoundaryPreservesOtherSections(input: {
  baselineSystem: string;
  placedSystem: string;
  block: string;
}): boolean {
  const stripped = input.placedSystem
    .replace(`\n\n${input.block}\n\n`, "\n\n")
    .replace(`\n\n${input.block}\n`, "\n")
    .replace(`\n${input.block}\n\n`, "\n");
  // Normalize trailing whitespace only — content must match baseline.
  return stripped.trimEnd() === input.baselineSystem.trimEnd();
}

/** D3 placement apply (harness only). */
export function applyGeminiSceneContinuityPlacement(input: {
  systemPrompt: string;
  modelId: string;
  placement: GeminiContinuityPlacement;
}): {
  systemPrompt: string;
  injected: boolean;
  placement: GeminiContinuityPlacement;
  estimatedTokens: number;
  insertMarker: string | null;
} {
  const block = resolveBlockForPlacement({
    modelId: input.modelId,
    placement: input.placement,
  });
  if (!block) {
    return {
      systemPrompt: input.systemPrompt,
      injected: false,
      placement: "absent",
      estimatedTokens: 0,
      insertMarker: null,
    };
  }
  if (input.placement === "terminal_system") {
    return {
      systemPrompt: `${input.systemPrompt.trimEnd()}\n\n${block}\n`,
      injected: true,
      placement: "terminal_system",
      estimatedTokens: estimateGeminiSceneContinuityTokens(),
      insertMarker: "SYSTEM_TAIL",
    };
  }
  // context_boundary
  return {
    systemPrompt: insertGeminiSceneContinuityBeforeOutputLayout(
      input.systemPrompt,
      block
    ),
    injected: true,
    placement: "context_boundary",
    estimatedTokens: estimateGeminiSceneContinuityTokens(),
    insertMarker: OUTPUT_LAYOUT_BOUNDARY_MARKER,
  };
}

/** Append adapter to an already-built production system prompt (D2 harness / arm B). */
export function applyGeminiSceneContinuityArmToSystem(input: {
  systemPrompt: string;
  modelId: string;
  arm: GeminiSceneContinuityArm;
}): { systemPrompt: string; injected: boolean; estimatedTokens: number } {
  const placement: GeminiContinuityPlacement =
    input.arm === "B" ? "terminal_system" : "absent";
  const applied = applyGeminiSceneContinuityPlacement({
    systemPrompt: input.systemPrompt,
    modelId: input.modelId,
    placement,
  });
  return {
    systemPrompt: applied.systemPrompt,
    injected: applied.injected,
    estimatedTokens: applied.estimatedTokens,
  };
}
