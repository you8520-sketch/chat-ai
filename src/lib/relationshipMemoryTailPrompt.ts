import {
  OPENROUTER_DEEPSEEK_V4_PRO_MODEL,
  OPENROUTER_QWEN_37_MAX_MODEL,
  isDeepSeekV4ProModel,
  isQwenModel,
} from "@/lib/chatModels";

/** DeepSeek/Qwen — 메인 모델 JSON tail로 관계메모 self-extract (Flash 추출 생략) */
export const RELATIONSHIP_MEMORY_SELF_EXTRACT_BLOCK = `[RELATIONSHIP MEMORY — SELF-EXTRACT]
RP 본문을 마친 후, 다음 줄에 이번 턴에서 발생한 관계 변화를 JSON으로 1줄 작성할 것:
{"honorifics":[],"items":[],"thoughts":[],"promisesAdd":[],"promisesRemove":[]}
변화 없으면 모든 필드를 빈 배열로 둘 것.
이 JSON은 사용자에게 보이지 않고 서버가 분리하여 처리한다.`;

export function isMainModelRelationshipSelfExtractModel(modelId: string): boolean {
  return isDeepSeekV4ProModel(modelId) || isQwenModel(modelId);
}

export const RELATIONSHIP_SELF_EXTRACT_MODEL_IDS = [
  OPENROUTER_DEEPSEEK_V4_PRO_MODEL,
  OPENROUTER_QWEN_37_MAX_MODEL,
] as const;
