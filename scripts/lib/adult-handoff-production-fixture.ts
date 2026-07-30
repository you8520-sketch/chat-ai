import type { ContextBuildInput } from "@/types";
import type { SceneContinuityPacket } from "@/lib/adultSceneRouting";
import { parseCharacterSetting } from "@/utils/characterParser";
import { formatSelectedPersonaForPrompt } from "@/lib/userPersonas";
import { formatUserNoteForPrompt } from "@/lib/persona";
import { formatMemoryMetaForPrompt, parseMemoryMeta } from "@/lib/chatMemory";
import { CHEAPER_INFERENCE_DEEPSEEK_V4_PRO_MODEL } from "@/lib/chatModels";

export type GeneralOriginModel = "gemini-3.6-flash" | "gpt-5.6-luna";

export type ProductionHandoffScene = {
  id: string;
  label: string;
  originModel: GeneralOriginModel;
  currentUserMessage: string;
  history: { role: "user" | "assistant"; content: string }[];
  continuityPacket: SceneContinuityPacket;
  anchors: string[];
};

const CHARACTER_NAME = "서이안";
const PERSONA_NAME = "윤재";

const SYSTEM_PROMPT = `# 정체성
서이안은 29세의 성인 남성 조사관이다. 관찰력이 뛰어나고 감정을 절제하지만, 윤재 앞에서는 짧은 농담과 조용한 배려가 드러난다.

# 성격
- 침착하고 신중하다.
- 위기에서는 단문 명령을 쓰되 상대의 선택을 빼앗지 않는다.
- 친밀한 상황에서도 과장된 감탄이나 갑작스러운 성격 변화를 피한다.

# 말투
- 윤재에게 기본적으로 낮고 차분한 반말을 쓴다.
- 호칭은 반드시 "윤재"로 유지한다.
- 대사는 짧고 정확하며, 감정은 행동과 시선으로 먼저 드러낸다.

# Speech Lock
- 유행어, 과도한 존댓말, 장황한 자기설명 금지.
- "괜찮아", "천천히", "여기 있어"처럼 짧고 절제된 어휘를 선호한다.
- 다른 등장인물의 말투와 섞지 않는다.`;

const WORLD = `# 세계관·캐논
현대 도시의 비공개 재난대응국. 기억을 교란하는 균열 현상을 추적한다.
서이안과 윤재는 모두 성인이며 3년째 같은 조사팀에서 일한다.
은색 표식은 균열의 방향을, 붉은 경보등은 공간 붕괴를 뜻한다.
팀 규정상 현장에서는 무전 채널과 손 신호를 함께 사용한다.`;

const EXAMPLE_DIALOG = `윤재: 지금 들어가도 돼?
서이안: 아직. 내 신호 보고 움직여.

윤재: 계속 보고 있었어?
서이안: 네가 무리하니까. 그것뿐이야.`;

const USER_PERSONA = formatSelectedPersonaForPrompt(
  PERSONA_NAME,
  "male",
  "27세 성인 남성 현장 분석관. 상황 판단이 빠르지만 위험을 혼자 감당하려는 버릇이 있다."
);

const USER_NOTE = formatUserNoteForPrompt(
  "서이안과 윤재는 오래된 동료이자 연인이다. 윤재의 말과 행동은 사용자가 직접 결정한다."
);

const MEMORY_META = formatMemoryMetaForPrompt(
  parseMemoryMeta(
    JSON.stringify({
      affection: 78,
      trust: 84,
      relationshipLabel: "오래된 동료이자 연인",
    })
  )
);

const LONG_TERM_MEMORY = `두 사람은 3년 전 지하역 균열 사건에서 처음 함께 살아남았다.
서이안은 윤재가 왼쪽 어깨를 다친 뒤 무리하는 습관을 걱정한다.
최근 은색 표식이 본부 내부에서도 발견되어 내부 협력자를 의심하고 있다.
서로의 감정을 확인했지만 현장에서는 임무를 우선하기로 합의했다.`;

const ARCHIVE_MEMORY = `[ARCHIVE]
- 지하역 사건: 붉은 경보등, 끊어진 무전, 서쪽 비상계단.
- 항구 창고 사건: 서이안이 문을 지탱하고 윤재가 봉인식을 완성함.
- 관계 변화: 임무 뒤 서로의 곁에 남겠다고 약속함.`;

const EPISODIC_MEMORY = `[EPISODIC RECALL]
turn 18: 윤재가 "혼자 두지 마"라고 말했고 서이안은 손목을 잡은 채 고개를 끄덕였다.
turn 31: 폐극장에서 검은 유리 조각을 회수했다.
turn 46: 두 사람은 작전 뒤 옥상에서 다음 임무도 함께 가기로 합의했다.`;

const STATUS_WIDGET_PROMPT = `[상태창 내부 지시]
장소, 시간, 등장인물, 자세, 미완료 행동을 비공개 상태값으로 일관되게 유지한다.
본문에 내부 키나 JSON을 노출하지 않는다.`;

const TRIGGER_CONTEXT = `[TRIGGERED SCENARIO EVENTS]
- 붉은 경보등이 세 번 깜박이면 북쪽 통로가 닫힌다.
- 은색 표식이 젖으면 숨겨진 문이 드러난다.`;

const KEYWORD_LOREBOOK = `[KEYWORD LOREBOOK]
균열 나침반: 은색 바늘이 가장 불안정한 공간을 가리킨다.
차폐등: 푸른빛이 켜진 동안 기억 교란이 약해진다.`;

const SCENES: Array<{
  id: string;
  label: string;
  originModel: GeneralOriginModel;
  location: string;
  mode: SceneContinuityPacket["previousSceneMode"];
  setup: string;
  unfinished: string;
  currentUser: string;
  anchors: string[];
}> = [
  {
    id: "romance_entry",
    label: "일반 대화에서 로맨스 진입",
    originModel: "gemini-3.6-flash",
    location: "본부 옥상",
    mode: "romantic",
    setup: "비가 그친 옥상에서 두 사람이 난간 곁에 서 있다",
    unfinished: "서이안이 윤재의 젖은 머리카락에서 손을 거두지 못했다",
    currentUser: "윤재는 피하지 않고 그의 손끝을 바라봤다. “더 가까이 와도 돼.”",
    anchors: ["옥상", "젖은 머리카락", "난간", "윤재", "가까이"],
  },
  {
    id: "tension_to_explicit_dialogue",
    label: "긴장감에서 노골적 대사 진입",
    originModel: "gpt-5.6-luna",
    location: "차폐실",
    mode: "tension",
    setup: "차폐실 문이 잠기고 두 사람이 매우 가까운 거리에서 마주 선다",
    unfinished: "서이안이 대답 직전 윤재의 턱 아래에서 손을 멈췄다",
    currentUser: "윤재가 숨을 고르며 그가 원하는 것을 숨기지 말고 말해 보라고 했다.",
    anchors: ["차폐실", "잠긴 문", "턱", "숨", "말해"],
  },
  {
    id: "dirty_talk_only",
    label: "행위 없는 더티토크",
    originModel: "gemini-3.6-flash",
    location: "심야 무전실",
    mode: "explicit_dialogue",
    setup: "서로 다른 층에 있는 두 사람이 암호화 무전으로만 대화한다",
    unfinished: "서이안이 낮은 목소리로 다음 말을 고르며 송신 버튼을 누르고 있다",
    currentUser: "윤재는 행동하지 않은 채, 무전 너머로 더 솔직하고 노골적으로 말해 달라고 요구했다.",
    anchors: ["무전실", "송신 버튼", "다른 층", "목소리", "윤재"],
  },
  {
    id: "coercive_nonsexual",
    label: "강압적인 성격이지만 비성적 장면",
    originModel: "gpt-5.6-luna",
    location: "붕괴 직전 북쪽 통로",
    mode: "normal",
    setup: "천장이 무너지는 통로에서 서이안이 단호하게 퇴로를 지시한다",
    unfinished: "서이안이 방화문을 어깨로 버틴 채 윤재에게 나가라고 명령했다",
    currentUser: "윤재는 현장 지휘에 따르되, 혼자 남지 말고 셋을 세면 같이 뛰자고 답했다.",
    anchors: ["북쪽 통로", "방화문", "셋", "퇴로", "같이"],
  },
  {
    id: "consensual_power_play",
    label: "합의된 권력관계",
    originModel: "gemini-3.6-flash",
    location: "안전가옥 침실",
    mode: "intimate_transition",
    setup: "두 성인이 미리 정한 중단 신호를 확인한 뒤 역할극을 시작한다",
    unfinished: "서이안이 마지막 확인 질문을 하고 윤재의 대답을 기다린다",
    currentUser: "윤재는 합의한 신호를 다시 말하고, 계속하겠다는 의사를 분명하게 밝혔다.",
    anchors: ["안전가옥", "중단 신호", "확인", "의사", "기다린다"],
  },
  {
    id: "complex_positions",
    label: "자세와 위치가 복잡하게 바뀐 장면",
    originModel: "gpt-5.6-luna",
    location: "기울어진 지하 기록실",
    mode: "tension",
    setup: "바닥이 기울고 서가가 쓰러져 두 사람의 위치가 여러 번 바뀐다",
    unfinished: "윤재는 낮은 계단에, 서이안은 한 단 위에 서서 오른손으로 서가를 받친다",
    currentUser: "윤재는 왼손으로 난간을 잡고 서이안의 오른쪽 옆으로 몸을 옮기려 했다.",
    anchors: ["낮은 계단", "한 단 위", "오른손", "서가", "난간"],
  },
  {
    id: "multiple_participants",
    label: "복수 등장인물",
    originModel: "gemini-3.6-flash",
    location: "폐역 통제실",
    mode: "tension",
    setup: "서이안과 윤재, 성인 동료 한서진이 서로 다른 출입구를 감시한다",
    unfinished: "한서진은 동쪽 문, 윤재는 콘솔, 서이안은 서쪽 창문을 맡고 있다",
    currentUser: "윤재가 콘솔의 은색 표식을 가리키며 두 사람에게 동시에 화면을 보라고 했다.",
    anchors: ["한서진", "동쪽 문", "콘솔", "서쪽 창문", "은색 표식"],
  },
  {
    id: "aftercare",
    label: "장면 직후 aftercare",
    originModel: "gpt-5.6-luna",
    location: "안전가옥 거실",
    mode: "aftercare",
    setup: "친밀한 장면이 끝난 뒤 두 사람이 소파에 기대어 호흡을 가라앉힌다",
    unfinished: "서이안이 물잔을 건넨 뒤 담요 끝을 윤재의 어깨에 올리고 있다",
    currentUser: "윤재는 물을 한 모금 마시고, 지금은 말없이 곁에 있어 달라고 했다.",
    anchors: ["거실", "소파", "물잔", "담요", "말없이"],
  },
  {
    id: "safe_return",
    label: "시간·장소 전환 후 일반 모델 복귀",
    originModel: "gemini-3.6-flash",
    location: "다음 날 오전 본부 회의실",
    mode: "normal",
    setup: "밤의 친밀한 장면 이후 시간이 넘어가 두 사람이 공식 브리핑에 참석한다",
    unfinished: "서이안이 사건 지도를 펼치며 북쪽 표식에 펜끝을 댔다",
    currentUser: "윤재는 개인적인 이야기를 미뤄 두고, 지도에서 사라진 통로부터 확인하자고 말했다.",
    anchors: ["다음 날 오전", "회의실", "사건 지도", "북쪽 표식", "브리핑"],
  },
  {
    id: "speech_lock_cliffhanger",
    label: "강한 Speech Lock과 문장 중간 미완료 행동",
    originModel: "gpt-5.6-luna",
    location: "침수된 지하 승강장",
    mode: "intimate_transition",
    setup: "물이 발목까지 차오르고 경보음 사이로 두 사람이 서로의 숨을 확인한다",
    unfinished: "서이안이 '윤재, 지금은—'이라고 말하며 손을 뻗는 순간 조명이 꺼졌다",
    currentUser: "어둠 속에서 윤재는 그 손이 닿기를 기다리며 이름을 한 번 불렀다.",
    anchors: ["침수된 승강장", "발목", "윤재, 지금은", "조명", "손"],
  },
];

function longAssistant(scene: (typeof SCENES)[number], turn: number): string {
  const beats = [
    `${scene.location}의 공기는 이전보다 무거웠다. ${scene.setup}. 서이안은 먼저 주변의 출입구와 윤재의 위치를 확인했다. 급하게 결론을 내리지 않는 버릇대로, 그는 눈앞의 움직임과 멀리서 들리는 소리를 하나씩 분리해 받아들였다.`,
    `붉은 경보등이 천천히 벽을 훑고 지나갈 때마다 사물의 윤곽이 잠깐씩 달라졌다. 그는 윤재를 대신해 움직이지 않았다. 다만 선택할 수 있는 길과 위험한 지점을 짧게 알려 주고, 윤재가 스스로 결정할 시간을 남겼다.`,
    `"윤재, 서두르지 마." 낮고 차분한 목소리가 소음 사이를 갈랐다. 평소와 같은 짧은 말이었지만 시선은 오래 머물렀다. 서이안은 불필요한 설명 대신 손끝으로 방향을 가리켰고, 두 사람 사이에 쌓인 경험이 나머지 뜻을 채웠다.`,
    `바닥에는 젖은 발자국과 은색 가루가 엇갈려 있었다. 그는 무릎을 굽혀 흔적을 살핀 뒤 곧바로 일어나지 않았다. 윤재가 보는 각도와 자신이 막고 있는 통로를 함께 계산하면서, 몸의 방향만 조금 바꾸었다.`,
    `멀리서 금속이 한 번 울렸다. 서이안의 어깨가 아주 작게 굳었지만 표정은 변하지 않았다. 그는 무전기의 송신 버튼을 눌렀다가, 잡음만 돌아오자 천천히 손을 내렸다. "채널이 끊겼어. 그래도 여기 있어."`,
    `말이 끝난 뒤에도 그는 윤재의 반응을 기다렸다. 침묵을 조급하게 메우지 않고, 호흡이 고르게 돌아오는지와 시선이 어디에 머무는지를 확인했다. 가까운 거리에서도 상대의 결정을 앞질러 가지 않는 태도는 변하지 않았다.`,
    `차폐등의 푸른빛이 켜지자 공간의 깊이가 다시 선명해졌다. 벽의 균열, 넘어질 듯 기운 가구, 두 사람 사이의 좁은 동선이 차례로 드러났다. 서이안은 가장 안전한 발판을 먼저 짚고도 윤재에게 손을 강요하지 않았다.`,
    `그는 짧게 숨을 내쉬었다. "괜찮아. 천천히." 같은 말을 반복하는 대신 다음 순간에 필요한 행동을 골랐다. 한 걸음 옮기고, 시선을 맞추고, 아직 끝나지 않은 말을 삼키는 동안 장면의 긴장은 느슨해지지 않았다.`,
  ];
  const paragraphs: string[] = [];
  for (let i = 0; paragraphs.join("\n\n").length < 2250; i++) {
    const beat = beats[(i + turn) % beats.length]!;
    paragraphs.push(i === 7 ? `${beat}\n\n${scene.unfinished}.` : beat);
  }
  return paragraphs.join("\n\n").slice(0, 2850);
}

function buildHistory(scene: (typeof SCENES)[number]) {
  const userTurns = [
    `윤재는 ${scene.location}을 둘러보며 현재 위치와 퇴로부터 확인하자고 말했다.`,
    "윤재는 서두르지 않고 바닥의 표식과 경보등의 변화를 손으로 짚어 보였다.",
    "윤재는 무전 상태를 확인한 뒤 서이안에게 지금 보이는 것을 그대로 말해 달라고 했다.",
    "윤재는 한 걸음 옮기기 전에 서로의 위치와 다음 행동을 다시 확인했다.",
    "윤재는 그의 짧은 대답을 듣고도 결론을 재촉하지 않은 채 주변 소리에 귀를 기울였다.",
    `윤재는 ${scene.unfinished}는 사실을 알아차리고, 다음 말을 기다렸다.`,
  ];
  return userTurns.flatMap((content, index) => [
    { role: "user" as const, content },
    { role: "assistant" as const, content: longAssistant(scene, index) },
  ]);
}

export const PRODUCTION_HANDOFF_SCENES: ProductionHandoffScene[] = SCENES.map(
  (scene) => ({
    id: scene.id,
    label: scene.label,
    originModel: scene.originModel,
    currentUserMessage: scene.currentUser,
    history: buildHistory(scene),
    continuityPacket: {
      location: scene.location,
      time: scene.id === "safe_return" ? "다음 날 오전" : "현재 장면",
      charactersPresent:
        scene.id === "multiple_participants"
          ? [CHARACTER_NAME, PERSONA_NAME, "한서진"]
          : [CHARACTER_NAME, PERSONA_NAME],
      currentPov: "3인칭 서이안 중심 제한 시점",
      positions: scene.setup,
      unfinishedAction: scene.unfinished,
      emotionalBalance: "긴장을 유지하되 상대의 선택과 합의가 우선된다",
      currentSpeechState: "서이안은 윤재에게 낮고 차분한 반말과 짧은 문장을 쓴다",
      relationshipChange: "오래된 신뢰 위에서 친밀감과 경계 확인이 함께 깊어졌다",
      previousSceneMode: scene.mode,
      sexualContextActive:
        scene.mode === "explicit_dialogue" ||
        scene.mode === "intimate_transition" ||
        scene.mode === "aftercare",
      activeConsentMode:
        scene.id === "consensual_power_play" ? "power_play" : "standard",
    },
    anchors: scene.anchors,
  })
);

export function buildProductionHandoffContext(
  scene: ProductionHandoffScene,
  shortTermHistory: ProductionHandoffScene["history"]
): ContextBuildInput {
  const chunks = parseCharacterSetting({
    characterId: "adult-handoff-prod-equivalent",
    characterName: CHARACTER_NAME,
    gender: "male",
    systemPrompt: SYSTEM_PROMPT,
    world: WORLD,
    exampleDialog: EXAMPLE_DIALOG,
    statusWindowPrompt: STATUS_WIDGET_PROMPT,
  });
  return {
    charName: CHARACTER_NAME,
    contentKind: "character",
    narrativePov: { mode: "third_person", povCharacterName: CHARACTER_NAME },
    chunks,
    systemPrompt: SYSTEM_PROMPT,
    world: WORLD,
    exampleDialog: EXAMPLE_DIALOG,
    speechProfileJson: JSON.stringify({
      register: "low_calm_banmal",
      address: PERSONA_NAME,
      forbidden: ["과도한 존댓말", "유행어", "감탄사 남발"],
    }),
    speechPersonality: "절제되고 차분함. 감정은 행동과 시선으로 먼저 표현.",
    speechTraits: "짧은 반말, 정확한 지시, 윤재 호칭 고정",
    characterPersonality: "침착하고 관찰력이 뛰어난 성인 조사관",
    userNickname: PERSONA_NAME,
    userPersona: USER_PERSONA,
    userNote: USER_NOTE,
    longTermMemory: LONG_TERM_MEMORY,
    archiveMemory: ARCHIVE_MEMORY,
    shortTermHistory,
    currentUserMessage: scene.currentUserMessage,
    nsfw: true,
    gender: "male",
    memoryMeta: MEMORY_META,
    modelId: CHEAPER_INFERENCE_DEEPSEEK_V4_PRO_MODEL,
    provider: "cheaperinference",
    userImpersonation: false,
    novelModeEnabled: false,
    runtimeMode: "interactive",
    personaDisplayName: PERSONA_NAME,
    userId: 1,
    chatId: 315,
    targetResponseChars: 3200,
    completedTurns: 24,
    userPersonaGender: "male",
    genres: ["로맨스", "현대/일상"],
    episodicMemoryBlock: EPISODIC_MEMORY,
    triggeredScenarioEventsBlock: TRIGGER_CONTEXT,
    keywordLorebookBlock: KEYWORD_LOREBOOK,
    globalLorebookBlock: "[GLOBAL LORE]\n균열 내부에서는 실제 시각보다 손 신호와 나침반을 우선한다.",
    recentNarrativeContext:
      "[RECENT NARRATIVE CONTEXT · turn 24]\n두 사람은 현재 장면의 위치와 미완료 행동을 유지한 채 다음 순간으로 이어진다.",
    privateSpeechControlBlock:
      "[PRIVATE SPEECH CONTROL]\n서이안은 윤재에게 낮은 반말. 호칭 윤재 고정. 말끝을 과장하지 않는다.",
    sceneDirectiveBlock:
      "[SCENE DIRECTIVE]\n직전 행동의 물리적 결과부터 이어가고 공간·자세를 임의로 초기화하지 않는다.",
    statusWidgetActive: true,
    statusWidgetPromptBlock: STATUS_WIDGET_PROMPT,
  };
}
