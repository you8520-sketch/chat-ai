/**
 * Phase D2 — Gemini 3.1 Pro Scene Continuity adapter (experiment-only).
 *
 * Production default: OFF. Not imported by chat routes / contextBuilder.
 * Live harness may append when arm=B and model is Gemini 3.1 Pro.
 *
 * MUST NOT become: 회상 금지 / 과거 언급 금지 / 설정 언급 금지.
 */
import { isGemini31ProModel } from "@/lib/chatModels";

/** Experiment env — set to "B" to enable candidate in harness (never production default). */
export const RP_GEMINI_SCENE_CONTINUITY_ARM_ENV =
  "RP_GEMINI_SCENE_CONTINUITY_ARM";

export type GeminiSceneContinuityArm = "A" | "B";

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

/** Append adapter to an already-built production system prompt (harness only). */
export function applyGeminiSceneContinuityArmToSystem(input: {
  systemPrompt: string;
  modelId: string;
  arm: GeminiSceneContinuityArm;
}): { systemPrompt: string; injected: boolean; estimatedTokens: number } {
  const block = resolveGeminiSceneContinuityAdapterSection({
    modelId: input.modelId,
    arm: input.arm,
  });
  if (!block) {
    return {
      systemPrompt: input.systemPrompt,
      injected: false,
      estimatedTokens: 0,
    };
  }
  return {
    systemPrompt: `${input.systemPrompt.trimEnd()}\n\n${block}\n`,
    injected: true,
    estimatedTokens: estimateGeminiSceneContinuityTokens(),
  };
}
