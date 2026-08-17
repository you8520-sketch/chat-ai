import { getCanonicalProseBody } from "@/lib/canonicalProse";
import {
  CHEAPER_INFERENCE_DEEPSEEK_V4_PRO_MODEL,
  isDeepSeekModel,
  normalizeDeepSeekV4ProModelId,
} from "@/lib/chatModels";
import { isNoncanonicalGeneration } from "@/lib/oocSceneRender";

/**
 * Production DeepSeek adult-handoff adapters stay OFF.
 * Style Track S1 injects the generic Source Mirror only from the experiment
 * script via an explicit buildContext option. Completion V1 is frozen for
 * audit/identity and is never applied on this branch.
 */
export const DEEPSEEK_STYLE_TRACK_S1_PRODUCTION = {
  applyStyleMirror: false,
  applySceneCompletion: false,
} as const;

export const DEEPSEEK_STYLE_TRACK_S1_CHALLENGER = {
  applyStyleMirror: true,
  applySceneCompletion: false,
} as const;

export const HANDOFF_SOURCE_CONTINUITY_STYLE_MIRROR_HEADER =
  "[HANDOFF SOURCE CONTINUITY — STYLE MIRROR]";

export const DEEPSEEK_HANDOFF_SCENE_COMPLETION_HEADER =
  "[DEEPSEEK HANDOFF — SCENE COMPLETION]";

export const HANDOFF_SOURCE_CONTINUITY_STYLE_MIRROR = `${HANDOFF_SOURCE_CONTINUITY_STYLE_MIRROR_HEADER}
직전 canonical assistant의 마지막 응답을 이번 출력의 문체와 캐릭터 표현 기준으로 삼아, 같은 응답자가 바로 다음 부분을 이어 쓰는 것처럼 자연스럽게 계속한다.
직전 응답에서 실제로 드러난 문장 길이와 호흡, 문단의 의미 단위, 서술과 대사의 비중·간격, 행동·감각·내면 묘사의 비중, 캐릭터의 말투·호칭·어휘·반응 방식을 유지한다.
이 지침 자체에서 새로운 성격, 분위기, 말버릇, 감정 성향이나 문체를 추가하지 않는다.
장면의 내용이나 강도가 변해도 범용적인 RP 문체나 상투적인 표현으로 수렴하지 말고, 직전 assistant에서 관찰되는 서술 방식과 캐릭터 고유성을 응답 마지막까지 유지한다.
같은 행동·감각·생각 흐름은 직전 응답의 문단 밀도에 맞게 연결하고, 직전 응답보다 불필요하게 문단이나 같은 화자의 연속 대사를 잘게 쪼개지 않는다.
한국어 문맥에 불필요한 외국 문자 조각을 섞지 않는다.`;

/** Frozen Completion V1 text — audit only. Do not apply on Style Track S1. */
export const DEEPSEEK_HANDOFF_SCENE_COMPLETION = `${DEEPSEEK_HANDOFF_SCENE_COMPLETION_HEADER}
현재 user 입력이 이미 명확하게 요청하거나 시작한 핵심 행동·사건은 준비·확인·예고만 한 채 응답을 끝내지 않는다. 같은 응답 안에서 그 단계의 실제 행동과 직접적인 결과·반응이 드러나는 지점까지 자연스럽게 진행한다.
장면을 성급하게 요약·종료하거나 후일담·다른 장소·다음 시간대로 건너뛰어 완결하지 않는다. 현재 장면 안에서 요청된 핵심 진행을 충분히 수행한 뒤, 다음 user가 자연스럽게 반응하거나 선택할 수 있는 열린 지점에서 멈춘다.
진행을 위해 user 캐릭터의 새로운 의미 있는 대사·중요한 결정·관계 결정·새로운 의도를 대신 만들지는 않는다.`;

export type DeepSeekAdultHandoffUserBlocks = {
  applyStyleMirror?: boolean;
  applySceneCompletion?: boolean;
};

export type CanonicalAssistantHistoryItem = {
  role: string;
  content: string;
  usage?: unknown;
  generationKind?: string;
  canonical?: boolean;
};

const INTERNAL_ONLY_MARKERS = [
  "<<<STATUS_VALUES",
  "<<<END_STATUS>>>",
  "[SYSTEM PROMPT]",
  "```json",
  "<tool_call>",
  "<|redacted_reasoning",
  "INTERNAL AION",
  "INTERNAL CONTINUATION",
];

export function isDeepSeekNativeTurn(userSelectedModelId: string): boolean {
  return isDeepSeekModel(userSelectedModelId);
}

export function isDeepSeekAdultHandoff(input: {
  adultHandoffActive: boolean;
  selectedSourceModelId: string;
  resolvedTargetModelId: string;
}): boolean {
  if (!input.adultHandoffActive) return false;
  if (isDeepSeekNativeTurn(input.selectedSourceModelId)) return false;
  return (
    normalizeDeepSeekV4ProModelId(input.resolvedTargetModelId) ===
    CHEAPER_INFERENCE_DEEPSEEK_V4_PRO_MODEL
  );
}

/** Provenance only — does not change pricing. */
export function resolveAdultHandoffApplied(input: {
  adultHandoffActive: boolean;
  userSelectedModelId: string;
  actualTargetModelId: string;
}): boolean {
  if (!input.adultHandoffActive) return false;
  const selected = normalizeDeepSeekV4ProModelId(input.userSelectedModelId)
    .trim()
    .toLowerCase();
  const actual = normalizeDeepSeekV4ProModelId(input.actualTargetModelId)
    .trim()
    .toLowerCase();
  return selected !== actual;
}

export function countPromptOccurrences(haystack: string, needle: string): number {
  if (!needle) return 0;
  return haystack.split(needle).length - 1;
}

export function stripDeepSeekAdultHandoffUserBlocks(text: string): string {
  return text
    .split(HANDOFF_SOURCE_CONTINUITY_STYLE_MIRROR)
    .join("")
    .split(DEEPSEEK_HANDOFF_SCENE_COMPLETION)
    .join("")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/**
 * User-turn DeepSeek adapters.
 * Order: current user semantic input → style mirror → scene completion.
 * Caller must keep the existing terminal user-tail owner absolutely last.
 */
export function appendDeepSeekAdultHandoffUserBlocks(
  userTurnContent: string,
  opts?: DeepSeekAdultHandoffUserBlocks | null
): string {
  const applyStyleMirror = opts?.applyStyleMirror === true;
  const applySceneCompletion = opts?.applySceneCompletion === true;
  if (!applyStyleMirror && !applySceneCompletion) {
    return userTurnContent;
  }
  let body = stripDeepSeekAdultHandoffUserBlocks(userTurnContent);
  const extras: string[] = [];
  if (applyStyleMirror) extras.push(HANDOFF_SOURCE_CONTINUITY_STYLE_MIRROR);
  if (applySceneCompletion) extras.push(DEEPSEEK_HANDOFF_SCENE_COMPLETION);
  if (!body) return extras.join("\n\n");
  return `${body}\n\n${extras.join("\n\n")}`;
}

function looksLikeInternalOnlyRaw(text: string): boolean {
  const trimmed = text.trim();
  if (!trimmed) return true;
  if (INTERNAL_ONLY_MARKERS.some((marker) => trimmed.startsWith(marker))) {
    return true;
  }
  if (trimmed.startsWith("{") && trimmed.endsWith("}")) {
    try {
      JSON.parse(trimmed);
      return true;
    } catch {
      return false;
    }
  }
  return false;
}

/**
 * Style owner for DeepSeek adult handoff: last visible canonical assistant RAW.
 * Does not guess from model name. Excludes noncanonical OOC, status widgets,
 * internal JSON/markers, and display-only paragraph transforms.
 */
export function resolveLastVisibleCanonicalAssistantRaw(
  history: CanonicalAssistantHistoryItem[]
): string | null {
  for (let i = history.length - 1; i >= 0; i -= 1) {
    const row = history[i];
    if (row.role !== "assistant") continue;
    if (isNoncanonicalGeneration(row.usage)) continue;
    if (row.generationKind === "ooc_scene_render" && row.canonical === false) {
      continue;
    }
    const raw = getCanonicalProseBody(row.content);
    if (looksLikeInternalOnlyRaw(raw)) continue;
    return raw;
  }
  return null;
}

export function resolveDeepSeekAdultHandoffUserBlocks(input: {
  adultHandoffActive: boolean;
  selectedSourceModelId: string;
  resolvedTargetModelId: string;
  experiment?: DeepSeekAdultHandoffUserBlocks;
}): DeepSeekAdultHandoffUserBlocks | null {
  if (
    !isDeepSeekAdultHandoff({
      adultHandoffActive: input.adultHandoffActive,
      selectedSourceModelId: input.selectedSourceModelId,
      resolvedTargetModelId: input.resolvedTargetModelId,
    })
  ) {
    return null;
  }
  const experiment = input.experiment ?? DEEPSEEK_STYLE_TRACK_S1_PRODUCTION;
  return {
    applyStyleMirror: experiment.applyStyleMirror === true,
    applySceneCompletion: experiment.applySceneCompletion === true,
  };
}
