import {
  OPENROUTER_DEEPSEEK_V4_PRO_MODEL,
  OPENROUTER_QWEN_37_MAX_MODEL,
  isDeepSeekV4ProModel,
  isQwenModel,
} from "@/lib/chatModels";

import {
  MEMORY_META_MAX,
  RELATIONSHIP_THOUGHT_EXTRACT_RULES,
  THOUGHTS_PER_TURN_MAX,
  THOUGHTS_PER_TURN_MIN_TARGET,
} from "@/lib/chatMemory";

/** DeepSeek/Qwen — 메인 모델 JSON tail로 관계메모 self-extract (Flash 추출 생략) */
export const RELATIONSHIP_MEMORY_SELF_EXTRACT_BLOCK = `[RELATIONSHIP MEMORY — SELF-EXTRACT]
RP 본문을 마친 후, 다음 줄에 이번 턴에서 발생한 관계 변화를 JSON으로 1줄 작성할 것:
{"currentLocation":"","honorifics":[],"items":[],"thoughts":[],"promisesAdd":[],"promisesRemove":[]}
변화 없으면 배열 필드는 빈 배열, currentLocation은 빈 문자열로 둘 것. currentLocation은 턴 종료 장소이며 턴 내 이동은 "장소→이동장소" 형식. honorifics는 캐릭터·NPC가 유저를 부른 호칭만 "부른사람→유저: 호칭" 형식 최신 2개.
${RELATIONSHIP_THOUGHT_EXTRACT_RULES.replace(/캐릭터이름/g, "주인공 이름")}
thoughts는 이번 턴 **${THOUGHTS_PER_TURN_MIN_TARGET}~${THOUGHTS_PER_TURN_MAX}개** — 이번 턴 상황에 대한 반응으로. 저장은 최근 ${MEMORY_META_MAX.thoughts}개(오래된 것부터 삭제).
이 JSON은 사용자에게 보이지 않고 서버가 분리하여 처리한다.`;

export function isMainModelRelationshipSelfExtractModel(modelId: string): boolean {
  return isDeepSeekV4ProModel(modelId) || isQwenModel(modelId);
}

export const RELATIONSHIP_SELF_EXTRACT_MODEL_IDS = [
  OPENROUTER_DEEPSEEK_V4_PRO_MODEL,
  OPENROUTER_QWEN_37_MAX_MODEL,
] as const;
