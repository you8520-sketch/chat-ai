/** Production buildContext fixtures for Step 1.9b validation scenes. */

import type { CharacterGenre } from "@/lib/characterGenres";
import type { ContextBuildInput } from "@/types";
import { parseCharacterSetting } from "@/utils/characterParser";
import { formatSelectedPersonaForPrompt } from "@/lib/userPersonas";
import { formatUserNoteForPrompt } from "@/lib/persona";
import { formatMemoryMetaForPrompt, parseMemoryMeta } from "@/lib/chatMemory";
import { OPENROUTER_DEEPSEEK_V4_PRO_MODEL } from "@/lib/chatModels";

export type ProductionValidationScene = {
  id: string;
  label: string;
  genres: CharacterGenre[];
  currentUserMessage: string;
  shortTermHistory: { role: "user" | "assistant"; content: string }[];
};

const charName = "백하율";
const personaDisplayName = "렌";

const baseChunks = () =>
  parseCharacterSetting({
    characterId: "prod-val-1",
    characterName: charName,
    gender: "male",
    systemPrompt: `# 성격
차분하고 관찰력이 뛰어나며, 감정을 겉으로 드러내지 않는다.

# 말투
- 평소: "~요", "~죠" 등 정중한 존댓말`,
    world: `# 세계관
현대 도시. 초자연적 존재와 일반인이 공존한다.`,
    exampleDialog: `유저: 밤산책 갈래?\n${charName}: …필요하면요.`,
    statusWindowPrompt: "",
  });

const userPersonaPrompt = formatSelectedPersonaForPrompt(
  personaDisplayName,
  "other",
  "20대 대학원생. 호기심 많고 직설적."
);
const userNotePrompt = formatUserNoteForPrompt("렌과 오래 알고 지낸 친구. 3년 전 실종 사건 이후 더 자주 연락한다.");
const memoryMeta = formatMemoryMetaForPrompt(
  parseMemoryMeta(JSON.stringify({ affection: 65, trust: 58, relationshipLabel: "오래된 지인" }))
);
const longTermMemory =
  "3년 전 실종 사건 이후 서로를 더 자주 확인한다. 최근 도심 골목에서 이상한 그림자를 목격했다.";

export const PRODUCTION_VALIDATION_SCENES: ProductionValidationScene[] = [
  {
    id: "horror",
    label: "공포/추리",
    genres: ["공포/추리"],
    currentUserMessage: "…방금 소리, 들었어? 뭔가 따라오는 것 같아.",
    shortTermHistory: [
      { role: "user", content: "오늘도 밤산책 갈래? 거리가 좀 이상한 것 같아." },
      {
        role: "assistant",
        content: `백하율은 창밖의 어두운 거리를 잠시 바라본 뒤, 조용히 고개를 끄덕였다.

"…이상하다고 느끼셨군요."

그는 코트 단추를 채우며 렌 쪽을 돌아보았다.`,
      },
    ],
  },
  {
    id: "romance",
    label: "로맨스",
    genres: ["로맨스"],
    currentUserMessage: "현우: …우산, 같이 쓸래?",
    shortTermHistory: [
      { role: "user", content: "비가 갑자기 내리네." },
      {
        role: "assistant",
        content: `지우는 현관 처마 아래 서서 하늘을 올려다봤다.

"…갑자기 오네."`,
      },
    ],
  },
  {
    id: "daily",
    label: "현대/일상",
    genres: ["현대/일상"],
    currentUserMessage: "민수: 오늘도 커피 맛있네. 요즘 바쁘지?",
    shortTermHistory: [
      { role: "user", content: "아메리카노 하나 주세요." },
      {
        role: "assistant",
        content: `서연은 메뉴판에서 시선을 들어 올렸다.

"네, 잠시만요."`,
      },
    ],
  },
  {
    id: "action",
    label: "코믹/액션",
    genres: ["코믹/액션"],
    currentUserMessage: "레온, 적이 검을 들어 올린다. 어떻게 대응할 것인가?",
    shortTermHistory: [
      { role: "user", content: "성벽 위에서 적을 발견했다." },
      {
        role: "assistant",
        content: `레온은 검 손잡이를 조여 쥐었다.

"…왔군."`,
      },
    ],
  },
];

export function buildProductionContextForScene(
  scene: ProductionValidationScene
): ContextBuildInput {
  return {
    charName,
    personaDisplayName,
    userNickname: personaDisplayName,
    chunks: baseChunks(),
    userPersona: userPersonaPrompt,
    userNote: userNotePrompt,
    longTermMemory,
    memoryMeta,
    shortTermHistory: scene.shortTermHistory,
    currentUserMessage: scene.currentUserMessage,
    nsfw: true,
    gender: "male",
    userPersonaGender: "other",
    userImpersonation: false,
    novelModeEnabled: false,
    targetResponseChars: 3200,
    completedTurns: 8,
    genres: scene.genres,
    provider: "openrouter",
    modelId: OPENROUTER_DEEPSEEK_V4_PRO_MODEL,
    recentNarrativeContext: "[RECENT NARRATIVE CONTEXT · turn 8]\n장면이 긴장감 있게 이어지고 있다.",
  };
}
