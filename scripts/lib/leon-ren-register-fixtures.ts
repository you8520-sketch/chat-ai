/** Leon + Ren (백하율) register validation fixtures — Step 7.5 */

import type { CharacterGenre } from "@/lib/characterGenres";
import type { ExpectedRegister } from "@/lib/characterRegisterCompliance";
import type { ContextBuildInput } from "@/types";
import { parseCharacterSetting } from "@/utils/characterParser";
import { formatSelectedPersonaForPrompt } from "@/lib/userPersonas";
import { formatUserNoteForPrompt } from "@/lib/persona";
import { OPENROUTER_DEEPSEEK_V4_PRO_MODEL } from "@/lib/chatModels";

export type RegisterValidationScene = {
  id: string;
  character: "leon" | "ren";
  label: string;
  genres: CharacterGenre[];
  expectedRegister: ExpectedRegister;
  contextTag: string;
  currentUserMessage: string;
  shortTermHistory: { role: "user" | "assistant"; content: string }[];
};

const LEON_SPEECH = `# 말투
공적인 자리: 건조한 군대식 다나까체
유저와 둘만 있을 때: 해요체
침대: 속삭이는 해요체, 짧은 문장

# 성격
냉정하고 절제된 기사. 감정을 드러내지 않으려 한다.`;

const LEON_EXAMPLE = `유저: 괜찮아?
레온: …괜찮아요.
유저: 적이다!
레온: …각오하십시오.`;

const REN_SPEECH = `# 성격
차분하고 관찰력이 뛰어나며, 감정을 겉으로 드러내지 않는다.

# 말투
- 평소: "~요", "~죠" 등 정중한 존댓말`;

const REN_WORLD = `# 세계관
현대 도시. 초자연적 존재와 일반인이 공존한다.`;

const REN_EXAMPLE = `유저: 밤산책 갈래?
백하율: …필요하면요.`;

function leonContext(genres: CharacterGenre[], scenes: Omit<RegisterValidationScene, "character">[]): RegisterValidationScene[] {
  return scenes.map((s) => ({ ...s, character: "leon" as const, genres }));
}

function renContext(scenes: Omit<RegisterValidationScene, "character" | "genres">[]): RegisterValidationScene[] {
  return scenes.map((s) => ({ ...s, character: "ren" as const, genres: ["현대/일상"] as CharacterGenre[] }));
}

export const REGISTER_VALIDATION_SCENES: RegisterValidationScene[] = [
  ...leonContext(["판타지/SF", "로맨스 판타지"], [
    {
      id: "leon-private-0",
      label: "둘만·친밀",
      expectedRegister: "haeyo",
      contextTag: "유저와 둘만",
      currentUserMessage: "렌: …레온, 지금 우리 둘뿐이야. 솔직히 말해봐.",
      shortTermHistory: [
        { role: "user", content: "…오늘 밤, 잠깐만 이야기할래?" },
        { role: "assistant", content: `레온은 문을 닫고 조용히 고개를 끄덕였다.\n\n"…알겠어요."` },
      ],
    },
    {
      id: "leon-private-1",
      label: "침대·속삭임",
      expectedRegister: "haeyo",
      contextTag: "침대",
      currentUserMessage: "렌: …가까이 와도 돼?",
      shortTermHistory: [
        { role: "user", content: "…불 끌까?" },
        { role: "assistant", content: `레온은 시선을 피하지 않았다.\n\n"…그래요."` },
      ],
    },
    {
      id: "leon-private-2",
      label: "둘만·우산",
      expectedRegister: "haeyo",
      contextTag: "유저와 둘만",
      currentUserMessage: "렌: …우산, 같이 쓸래?",
      shortTermHistory: [{ role: "user", content: "…" }, { role: "assistant", content: `"…알겠어요."` }],
    },
    {
      id: "leon-private-3",
      label: "둘만·고백",
      expectedRegister: "haeyo",
      contextTag: "유저와 둘만",
      currentUserMessage: "렌: …손, 괜찮아?",
      shortTermHistory: [{ role: "user", content: "…" }, { role: "assistant", content: `"…괜찮아요."` }],
    },
    {
      id: "leon-private-4",
      label: "둘만·밤산책",
      expectedRegister: "haeyo",
      contextTag: "유저와 둘만",
      currentUserMessage: "렌: 오늘 밤, 잠깐만 같이 걸을래?",
      shortTermHistory: [{ role: "user", content: "…" }, { role: "assistant", content: `"…그래요."` }],
    },
    {
      id: "leon-public-0",
      label: "공적·전장",
      expectedRegister: "danakka",
      contextTag: "공적인 자리",
      currentUserMessage: "렌: 레온, 적이 검을 들어 올린다!",
      shortTermHistory: [
        { role: "user", content: "성벽 위에서 적을 발견했다." },
        { role: "assistant", content: `레온은 검 손잡이를 조여 쥐었다.\n\n"…각오하십시오."` },
      ],
    },
    {
      id: "leon-public-1",
      label: "공적·회의",
      expectedRegister: "danakka",
      contextTag: "공적인 자리",
      currentUserMessage: "렌: 전하께 보고해야 한다.",
      shortTermHistory: [{ role: "user", content: "…" }, { role: "assistant", content: `"…알겠습니다."` }],
    },
    {
      id: "leon-public-2",
      label: "공적·병영",
      expectedRegister: "danakka",
      contextTag: "공적인 자리",
      currentUserMessage: "렌: 레온, 부대를 정비하라.",
      shortTermHistory: [{ role: "user", content: "…" }, { role: "assistant", content: `"…즉시 하겠습니다."` }],
    },
    {
      id: "leon-public-3",
      label: "공적·성벽",
      expectedRegister: "danakka",
      contextTag: "공적인 자리",
      currentUserMessage: "렌: 레온, 성벽 가장자리까지 밀렸어!",
      shortTermHistory: [{ role: "user", content: "…" }, { role: "assistant", content: `"…후퇴하지 마십시오."` }],
    },
    {
      id: "leon-public-4",
      label: "공적·반격",
      expectedRegister: "danakka",
      contextTag: "공적인 자리",
      currentUserMessage: "렌: 레온, 지금이야 — 반격할 타이밍이야!",
      shortTermHistory: [{ role: "user", content: "…" }, { role: "assistant", content: `"…준비됐습니다."` }],
    },
  ]),
  ...renContext([
    {
      id: "ren-daily-0",
      label: "일상·카페",
      expectedRegister: "haeyo",
      contextTag: "평소",
      currentUserMessage: "민수: 오늘도 커피 맛있네. 요즘 바쁘지?",
      shortTermHistory: [{ role: "user", content: "…" }, { role: "assistant", content: `"…조금요."` }],
    },
    {
      id: "ren-daily-1",
      label: "일상·산책",
      expectedRegister: "haeyo",
      contextTag: "평소",
      currentUserMessage: "렌: …요즘 날씨 참 좋다.",
      shortTermHistory: [{ role: "user", content: "…" }, { role: "assistant", content: `"…그렇네요."` }],
    },
    {
      id: "ren-horror-0",
      label: "공포·골목",
      expectedRegister: "haeyo",
      contextTag: "평소",
      currentUserMessage: "…방금 소리, 들었어? 뭔가 따라오는 것 같아.",
      shortTermHistory: [{ role: "user", content: "…" }, { role: "assistant", content: `"…들었어요."` }],
    },
    {
      id: "ren-horror-1",
      label: "공포·창문",
      expectedRegister: "haeyo",
      contextTag: "평소",
      currentUserMessage: "…창문 밖에 누가 서 있는 것 같아.",
      shortTermHistory: [{ role: "user", content: "…" }, { role: "assistant", content: `"…잠깐만요."` }],
    },
    {
      id: "ren-romance-0",
      label: "로맨스·우산",
      expectedRegister: "haeyo",
      contextTag: "평소",
      currentUserMessage: "현우: …우산, 같이 쓸래?",
      shortTermHistory: [{ role: "user", content: "…" }, { role: "assistant", content: `"…알겠습니다."` }],
    },
    {
      id: "ren-romance-1",
      label: "로맨스·밤",
      expectedRegister: "haeyo",
      contextTag: "평소",
      currentUserMessage: "현우: 오늘 밤, 잠깐만 같이 걸을래?",
      shortTermHistory: [{ role: "user", content: "…" }, { role: "assistant", content: `"…그래요."` }],
    },
    {
      id: "ren-daily-2",
      label: "일상·알바",
      expectedRegister: "haeyo",
      contextTag: "평소",
      currentUserMessage: "민수: 알바 끝나면 같이 밥 먹을래?",
      shortTermHistory: [{ role: "user", content: "…" }, { role: "assistant", content: `"…좋아요."` }],
    },
    {
      id: "ren-daily-3",
      label: "일상·창가",
      expectedRegister: "haeyo",
      contextTag: "평소",
      currentUserMessage: "민수: 창가 자리 비었네. 앉아도 될까?",
      shortTermHistory: [{ role: "user", content: "…" }, { role: "assistant", content: `"…앉으세요."` }],
    },
    {
      id: "ren-horror-2",
      label: "공포·발소리",
      expectedRegister: "haeyo",
      contextTag: "평소",
      currentUserMessage: "…발소리야. 우리 뒤인 것 같아.",
      shortTermHistory: [{ role: "user", content: "…" }, { role: "assistant", content: `"…멈춰요."` }],
    },
    {
      id: "ren-horror-3",
      label: "공포·신호",
      expectedRegister: "haeyo",
      contextTag: "평소",
      currentUserMessage: "…핸드폰 신호가 끊겼어. 여기서 나가자.",
      shortTermHistory: [{ role: "user", content: "…" }, { role: "assistant", content: `"…알겠어요."` }],
    },
  ]),
];

export function buildRegisterValidationContext(scene: RegisterValidationScene): ContextBuildInput {
  const isLeon = scene.character === "leon";
  const charName = isLeon ? "레온" : "백하율";
  const chunks = parseCharacterSetting({
    characterId: `reg-val-${scene.id}`,
    characterName: charName,
    gender: "male",
    systemPrompt: isLeon ? LEON_SPEECH : REN_SPEECH,
    world: isLeon ? "제국 기사단. 귀족과 기사가 공존하는 판타지 세계." : REN_WORLD,
    exampleDialog: isLeon ? LEON_EXAMPLE : REN_EXAMPLE,
    statusWindowPrompt: "",
  });

  return {
    charName,
    personaDisplayName: "렌",
    userNickname: "렌",
    chunks,
    userPersona: formatSelectedPersonaForPrompt("렌", "other", "20대. 직설적."),
    userNote: formatUserNoteForPrompt(
      isLeon ? "레온과 둘만 있을 때는 편한 분위기." : "렌과 오래 알고 지낸 친구."
    ),
    longTermMemory: "",
    memoryMeta: "",
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
  };
}
