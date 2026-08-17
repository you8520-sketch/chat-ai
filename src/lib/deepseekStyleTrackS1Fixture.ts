import type { CharacterChunk, ContextBuildInput } from "@/types";
import { CHEAPER_INFERENCE_DEEPSEEK_V4_PRO_MODEL } from "@/lib/chatModels";
import { DEFAULT_TARGET_RESPONSE_CHARS } from "@/lib/responseLengthConstants";
import { TERRA_PROMPT_CANARY_GREETING_NEUTRAL } from "@/lib/terraPromptCanary";
import type { DeepSeekAdultHandoffUserBlocks } from "@/lib/deepseekAdultHandoff";
import {
  DEEPSEEK_STYLE_TRACK_S1_CHALLENGER,
  DEEPSEEK_STYLE_TRACK_S1_PRODUCTION,
} from "@/lib/deepseekAdultHandoff";

/** Committed Gemini 3.7 Flash production-equivalent fixture (lobby / dialogue). */
export const STYLE_TRACK_S1_GEMINI37_SOURCE_MODEL = "gemini-3.7-flash";
export const STYLE_TRACK_S1_TARGET_MODEL = CHEAPER_INFERENCE_DEEPSEEK_V4_PRO_MODEL;
export const STYLE_TRACK_S1_CHAR_NAME = "조태형";
export const STYLE_TRACK_S1_PERSONA_NAME = "렌";

export const STYLE_TRACK_S1_T1_USER =
  "나는 렌이라고… 본 기억이 안 나는데… 나 알아?";
export const STYLE_TRACK_S1_T2_USER = "같이 갈래? *두리번*";

export const STYLE_TRACK_S1_JO_TAEHYUNG_CARD = `너는 조태형이다. 에이지스 본부 S급 특수계 음압 센티넬. 고위험 폭주형.
북극곰 귀 흰 후드티, 유광 블랙 재킷, 녹색 눈, 검은 네일, 은반지, 여자 향수.
목에 전자 초커. 낙천적이고 능청스러우며 사람을 옭아매는 관찰력이 있다.
렌 곁에서는 이명이 가라앉는다.`;

export const STYLE_TRACK_S1_WORLD =
  "에이지스 컨트롤 본부. 센티넬/가이드. 중앙 로비, 지원국, 동기화 챔버.";

export const STYLE_TRACK_S1_T1_RAW_PATH =
  "docs/audits/gemini-37-flash-baseline/t1-raw.txt";

export const STYLE_TRACK_S1_CHUNKS: CharacterChunk[] = [
  {
    id: "c18-identity",
    characterId: "18",
    content: STYLE_TRACK_S1_JO_TAEHYUNG_CARD,
    category: "identity",
    importance: "CRITICAL",
    tokenCount: 200,
    keywords: ["조태형", "센티넬"],
  },
  {
    id: "c18-world",
    characterId: "18",
    content: STYLE_TRACK_S1_WORLD,
    category: "world",
    importance: "CONTEXTUAL",
    tokenCount: 40,
    keywords: ["에이지스", "로비"],
  },
];

export function styleTrackS1History(lastAssistantRaw: string) {
  return [
    { role: "assistant" as const, content: TERRA_PROMPT_CANARY_GREETING_NEUTRAL },
    { role: "user" as const, content: STYLE_TRACK_S1_T1_USER },
    { role: "assistant" as const, content: lastAssistantRaw },
  ];
}

export function styleTrackS1BuildInput(opts: {
  lastAssistantRaw: string;
  arm: "baseline" | "challenger";
}): ContextBuildInput {
  const deepSeekAdultHandoff: DeepSeekAdultHandoffUserBlocks =
    opts.arm === "challenger"
      ? { ...DEEPSEEK_STYLE_TRACK_S1_CHALLENGER }
      : { ...DEEPSEEK_STYLE_TRACK_S1_PRODUCTION };
  return {
    charName: STYLE_TRACK_S1_CHAR_NAME,
    contentKind: "character",
    chunks: STYLE_TRACK_S1_CHUNKS,
    userNickname: STYLE_TRACK_S1_PERSONA_NAME,
    personaDisplayName: STYLE_TRACK_S1_PERSONA_NAME,
    userPersona: "이름/호칭: 렌\n성별: 남성",
    userPersonaGender: "male",
    shortTermHistory: styleTrackS1History(opts.lastAssistantRaw),
    currentUserMessage: STYLE_TRACK_S1_T2_USER,
    nsfw: false,
    gender: "male",
    provider: "cheaperinference",
    modelId: STYLE_TRACK_S1_TARGET_MODEL,
    targetResponseChars: DEFAULT_TARGET_RESPONSE_CHARS,
    completedTurns: 1,
    narrativePov: { mode: "third_person", povCharacterName: STYLE_TRACK_S1_CHAR_NAME },
    deepSeekAdultHandoff,
  };
}
