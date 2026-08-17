/**
 * Phase G9-A — Contextual scene dynamics (experiment-only).
 *
 * Production default: OFF. Not imported by chat routes / contextBuilder.
 * Harness Arm C REPLACES overlapping [SCENE FLOW] wording for Gemini only.
 *
 * NOT changed: agency owner, CURRENT USER wrapper, prose/layout, length,
 * runtime, canon/persona/memory.
 */

import { SCENE_FLOW_BLOCK } from "@/lib/generationProcessBeatFlow";
import { isGemini31ProModel } from "@/lib/chatModels";

export type GeminiSceneDynamicsArm = "A" | "C";

/**
 * Positive scene-dynamics contract — replaces [SCENE FLOW] content.
 * No “don’t escalate / no combat / no new event” negative lists.
 */
export const GEMINI_CONTEXTUAL_SCENE_DYNAMICS = `[SCENE DYNAMICS]
장면의 운동량은 현재 상호작용의 성격에 맞춘다.

현재 장면이 관계·휴식·일상·대화 중심이면 인물의 내면, 관계의 미세한 변화, 감각, 사소한 행동과 주변 환경이 장면을 살아 있게 만든다.

현재 장면이 탐사·위험·추적·전투 중심이면 NPC, 환경, 새로운 정보와 현재 사건이 기존 인과에 맞게 더 적극적으로 움직인다.

장면의 변화는 현재 상호작용에서 자연스럽게 성장한다.`;

export function applyG9aSceneDynamicsArmToMessages(input: {
  messages: Array<{ role: string; content: string }>;
  modelId: string;
  arm: GeminiSceneDynamicsArm;
}): {
  messages: Array<{ role: string; content: string }>;
  systemText: string;
  applied: boolean;
  replacedSceneFlow: boolean;
} {
  const messages = input.messages.map((m) => ({ ...m, content: m.content }));
  if (input.arm === "A" || !isGemini31ProModel(input.modelId)) {
    const systemText = messages.find((m) => m.role === "system")?.content ?? "";
    return {
      messages,
      systemText,
      applied: false,
      replacedSceneFlow: false,
    };
  }

  let replacedSceneFlow = false;
  for (const m of messages) {
    if (m.role !== "system") continue;
    if (m.content.includes(SCENE_FLOW_BLOCK)) {
      m.content = m.content.split(SCENE_FLOW_BLOCK).join(GEMINI_CONTEXTUAL_SCENE_DYNAMICS);
      replacedSceneFlow = true;
    } else if (
      m.content.includes("[SCENE FLOW]") &&
      !m.content.includes("[SCENE DYNAMICS]")
    ) {
      // Fallback: header-only replace if block whitespace drifts
      m.content = m.content.replace(
        /\[SCENE FLOW\][\s\S]*?(?=\n\[|$)/,
        `${GEMINI_CONTEXTUAL_SCENE_DYNAMICS}\n`
      );
      replacedSceneFlow = true;
    }
  }

  const systemText = messages.find((m) => m.role === "system")?.content ?? "";
  return {
    messages,
    systemText,
    applied: replacedSceneFlow,
    replacedSceneFlow,
  };
}

export function g9aParityShas(systemText: string): {
  hasSceneDynamics: boolean;
  hasSceneFlow: boolean;
  hasCollaborative: boolean;
  hasLivingScene: boolean;
} {
  return {
    hasSceneDynamics: systemText.includes("[SCENE DYNAMICS]"),
    hasSceneFlow: systemText.includes("[SCENE FLOW]"),
    hasCollaborative: systemText.includes(
      "[USER CONTROL — COLLABORATIVE INTERACTIVE]"
    ),
    hasLivingScene: systemText.includes("[GEMINI RP — LIVING SCENE]"),
  };
}
