/**
 * Scene policy provider-evidence benchmark — synthetic fixture manifest.
 * Offline only: no provider calls, no production DB, no user chat copies.
 */
import type { ChatMsg } from "@/lib/ai";
import { defaultReconvergenceState, type ReconvergenceState } from "@/lib/reconvergenceState";
import { parseCharacterSetting } from "@/utils/characterParser";
import { formatSelectedPersonaForPrompt } from "@/lib/userPersonas";
import { formatMemoryMetaForPrompt, parseMemoryMeta } from "@/lib/chatMemory";
import type { ContextBuildInput } from "@/types";
import { CHEAPER_INFERENCE_DEEPSEEK_V4_PRO_MODEL } from "@/lib/chatModels";

export type BenchmarkFamily =
  | "B01_QUIET_STABLE"
  | "B02_QUIET_RELATIONSHIP"
  | "B03_USER_LED_ACTIVE"
  | "B04_REAL_STAGNATION"
  | "B05_ESTABLISHED_TASK"
  | "B06_GROUNDED_NPC"
  | "B07_OFF_SCENE_NPC"
  | "B08_REMOTE_CONTACT"
  | "B09_EXPLICIT_ARRIVAL"
  | "B10_AUTHORITATIVE_TRIGGER"
  | "B11_PARTING"
  | "B12_SEPARATION_NO_HOOK"
  | "B13_SEPARATION_WITH_HOOK"
  | "B14_LONG_SEPARATION"
  | "B15_MULTI_CHARACTER_TEXT"
  | "B16_ACTIVE_CONFLICT";

export type BenchmarkKind =
  | "single_turn"
  | "reconvergence_trajectory"
  | "living_focus"
  | "event_restraint_focus";

export type ScenePolicyBenchmarkFixture = {
  id: string;
  family: BenchmarkFamily;
  kind: BenchmarkKind;
  label: string;
  history: ChatMsg[];
  currentUserMessage: string;
  memoryText?: string;
  relationshipMemoryText?: string;
  lorebookText?: string;
  triggeredEventText?: string;
  reconvergenceState?: ReconvergenceState;
  currentTurn?: number;
  /** Pilot-phase representative fixture */
  pilotRepresentative?: boolean;
};

export type BenchmarkTrajectoryTurn = {
  turnIndex: number;
  userMessage: string;
  /** Offline placeholder — trajectory assembly without live model output */
  frozenAssistantResponse: string;
  reconvergenceStateBefore?: ReconvergenceState;
};

export type ScenePolicyBenchmarkTrajectory = {
  id: string;
  label: string;
  kind: "reconvergence_trajectory";
  arms: Array<"v1" | "v2" | "living">;
  turns: BenchmarkTrajectoryTurn[];
  pilotRepresentative?: boolean;
};

export const BENCHMARK_CHAT_ID = 88001;
export const BENCHMARK_CHARACTER_ID = 8801;
export const BENCHMARK_CHAR_NAME = "한서린";
export const BENCHMARK_USER_PERSONA = "민";
export const BENCHMARK_DEFAULT_MODEL = CHEAPER_INFERENCE_DEEPSEEK_V4_PRO_MODEL;
export const BENCHMARK_DEFAULT_TARGET_CHARS = 3200;

const BASE_MEMORY =
  "두 사람은 같은 아파트 단지에 살며, 최근 몇 달간 서로의 일상을 자연스럽게 공유해 왔다.";
const BASE_RELATIONSHIP =
  '{"affection":55,"trust":60,"relationshipLabel":"편안한 지인"}';

function msgs(pairs: Array<[ChatMsg["role"], string]>): ChatMsg[] {
  return pairs.map(([role, content]) => ({ role, content }));
}

function sepState(input: {
  turn: number;
  hooks?: ReconvergenceState["unresolvedHooks"];
  dueTurn?: number;
}): ReconvergenceState {
  return {
    ...defaultReconvergenceState(BENCHMARK_CHAT_ID, BENCHMARK_CHARACTER_ID),
    state: "separated",
    separationTurn: input.turn - 2,
    reconvergenceDueTurn: input.dueTurn ?? input.turn + 2,
    unresolvedHooks: input.hooks ?? [],
  };
}

function fixture(input: Omit<ScenePolicyBenchmarkFixture, "kind"> & { kind?: BenchmarkKind }): ScenePolicyBenchmarkFixture {
  return { kind: "single_turn", ...input };
}

/** Shared neutral synthetic canon for all benchmark arms. */
export function buildBenchmarkContextBase(): Pick<
  ContextBuildInput,
  | "charName"
  | "personaDisplayName"
  | "userNickname"
  | "chunks"
  | "userPersona"
  | "memoryMeta"
  | "longTermMemory"
  | "nsfw"
  | "gender"
  | "userPersonaGender"
  | "userImpersonation"
  | "novelModeEnabled"
  | "targetResponseChars"
  | "completedTurns"
  | "genres"
  | "provider"
  | "modelId"
  | "contentKind"
> {
  const chunks = parseCharacterSetting({
    characterId: String(BENCHMARK_CHARACTER_ID),
    characterName: BENCHMARK_CHAR_NAME,
    gender: "female",
    systemPrompt: `# 성격
차분하고 관찰력이 뛰어나며, 감정을 겉으로 드러내지 않는다.

# 말투
- 평소: "~요", "~죠" 등 정중한 존댓말`,
    world: `# 세계관
현대 도시의 중형 아파트와 인근 상가. 일상·관계·소규모 사건이 자연스럽게 이어진다.`,
    exampleDialog: `유저: 오늘은 좀 쉴까?\n${BENCHMARK_CHAR_NAME}: …그래요. 조용히 있어도 괜찮아요.`,
    statusWindowPrompt: "",
  });
  return {
    charName: BENCHMARK_CHAR_NAME,
    personaDisplayName: BENCHMARK_USER_PERSONA,
    userNickname: BENCHMARK_USER_PERSONA,
    chunks,
    userPersona: formatSelectedPersonaForPrompt(
      BENCHMARK_USER_PERSONA,
      "other",
      "20대 후반. 직장인. 말수는 적지만 행동으로 장면을 이끈다."
    ),
    memoryMeta: formatMemoryMetaForPrompt(parseMemoryMeta(BASE_RELATIONSHIP)),
    longTermMemory: BASE_MEMORY,
    nsfw: false,
    gender: "female",
    userPersonaGender: "other",
    userImpersonation: false,
    novelModeEnabled: false,
    targetResponseChars: BENCHMARK_DEFAULT_TARGET_CHARS,
    completedTurns: 8,
    genres: ["현대/일상"],
    provider: "cheaperinference",
    modelId: BENCHMARK_DEFAULT_MODEL,
    contentKind: "character",
  };
}

export const SCENE_POLICY_BENCHMARK_FIXTURES: ScenePolicyBenchmarkFixture[] = [
  // B01 — quiet stable (×2)
  fixture({
    id: "B01a",
    family: "B01_QUIET_STABLE",
    label: "소파 휴식",
    pilotRepresentative: true,
    history: msgs([
      ["assistant", "한서린은 거실 소파에 앉아 창밖을 본다."],
      ["user", "옆 자리에 앉는다."],
      ["assistant", "잔잔한 오후 햇빛이 카펫 위로 길게 드리운다."],
      ["user", "무언가 말하지 않아도 괜찮다."],
    ]),
    currentUserMessage: "조용히 앉아 숨을 고른다.",
  }),
  fixture({
    id: "B01b",
    family: "B01_QUIET_STABLE",
    label: "베란다 차",
    history: msgs([
      ["assistant", "베란다 테이블에 끓인 물을 올린다."],
      ["user", "고마워."],
      ["assistant", "바람이 시원하다."],
      ["user", "잠시 그대로 있다."],
    ]),
    currentUserMessage: "차잔을 들고 하늘을 본다.",
  }),

  // B02 — quiet relationship (×2)
  fixture({
    id: "B02a",
    family: "B02_QUIET_RELATIONSHIP",
    label: "감정 미세 변화",
    history: msgs([
      ["assistant", "한서린은 시선을 잠깐 피했다가 다시 맞춘다."],
      ["user", "오늘 좀 다른 것 같아."],
      ["assistant", "…그런가요."],
      ["user", "응. 나쁘진 않아."],
    ]),
    currentUserMessage: "손끝으로 테이블을 가볍게 톡톡 친다.",
  }),
  fixture({
    id: "B02b",
    family: "B02_QUIET_RELATIONSHIP",
    label: "침묵 속 거리",
    history: msgs([
      ["assistant", "한서린은 컵 손잡이를 천천히 돌린다."],
      ["user", "요즘 바빴지?"],
      ["assistant", "조금요."],
      ["user", "그래도 와줘서 고마워."],
    ]),
    currentUserMessage: "잠깐 눈을 맞춘다.",
  }),

  // B03 — user-led active (×2)
  fixture({
    id: "B03a",
    family: "B03_USER_LED_ACTIVE",
    label: "복도 이동",
    pilotRepresentative: true,
    history: msgs([
      ["assistant", "복도 끝 안내판을 본다."],
      ["user", "저쪽으로 나가자."],
      ["assistant", "…알겠어요."],
      ["user", "엘리베이터 쪽이야."],
    ]),
    currentUserMessage: "앞장서서 엘리베이터 버튼을 누른다.",
  }),
  fixture({
    id: "B03b",
    family: "B03_USER_LED_ACTIVE",
    label: "문 열고 퇴장",
    history: msgs([
      ["assistant", "현관 신발을 정리한다."],
      ["user", "잠깐 나갔다 올게."],
      ["assistant", "네."],
      ["user", "열쇠는 내가 가져갈게."],
    ]),
    currentUserMessage: "문을 열고 복도로 나선다.",
  }),

  // B04 — real stagnation (×2)
  fixture({
    id: "B04a",
    family: "B04_REAL_STAGNATION",
    label: "짧은 반복",
    history: msgs([
      ["assistant", "괜찮아요. 말하지 않아도 돼요."],
      ["user", "응."],
      ["assistant", "정말 괜찮아요."],
      ["user", "..."],
      ["assistant", "…그냥 이렇게 있어도 돼요."],
      ["user", "응."],
    ]),
    currentUserMessage: "응.",
  }),
  fixture({
    id: "B04b",
    family: "B04_REAL_STAGNATION",
    label: "동일 확인",
    history: msgs([
      ["assistant", "오늘도 조용하네요."],
      ["user", "그래."],
      ["assistant", "네, 조용해요."],
      ["user", "그래."],
      ["assistant", "…네."],
      ["user", "그래."],
    ]),
    currentUserMessage: "그래.",
  }),

  // B05 — established task (×2)
  fixture({
    id: "B05a",
    family: "B05_ESTABLISHED_TASK",
    label: "정리 약속",
    history: msgs([
      ["assistant", "오늘은 서재 정리하기로 했죠."],
      ["user", "맞아, 책부터 분류하자."],
      ["assistant", "상단 선반부터 할게요."],
      ["user", "좋아."],
    ]),
    currentUserMessage: "분류 기준을 다시 확인한다.",
    lorebookText: "서재 정리는 이번 주말까지 마치기로 한 일정이다.",
  }),
  fixture({
    id: "B05b",
    family: "B05_ESTABLISHED_TASK",
    label: "장보기 목록",
    history: msgs([
      ["assistant", "장보기 목록은 냉장고에 붙여뒀어요."],
      ["user", "우유랑 계란만 추가하면 돼."],
      ["assistant", "알겠어요."],
      ["user", "오후에 같이 가자."],
    ]),
    currentUserMessage: "목록을 보며 빠진 항목이 없는지 본다.",
    lorebookText: "오늘 오후 마트 장보기가 확정된 일정이다.",
  }),

  // B06 — grounded NPC (×2)
  fixture({
    id: "B06a",
    family: "B06_GROUNDED_NPC",
    label: "카페 바리스타",
    history: msgs([
      ["assistant", "카페 창가 자리에 앉는다."],
      ["user", "여기 분위기 좋다."],
      ["assistant", "바리스타가 메뉴판을 건넨다."],
      ["user", "아메리카노 두 잔 주세요."],
    ]),
    currentUserMessage: "바리스타를 향해 주문을 마친다.",
    lorebookText: "카운터 뒤 바리스타가 현재 장면에 있다.",
  }),
  fixture({
    id: "B06b",
    family: "B06_GROUNDED_NPC",
    label: "경비원",
    history: msgs([
      ["assistant", "아파트 로비에 선다."],
      ["user", "택배 왔어요?"],
      ["assistant", "경비원이 고개를 끄덕인다."],
      ["user", "감사합니다."],
    ]),
    currentUserMessage: "경비원과 눈을 맞춘다.",
    lorebookText: "로비 경비원이 현재 장면에 있다.",
  }),

  // B07 — off-scene NPC (×2)
  fixture({
    id: "B07a",
    family: "B07_OFF_SCENE_NPC",
    label: "퇴장한 동료",
    history: msgs([
      ["assistant", "회의실 문을 닫는다. 동료 지호는 이미 퇴장했다."],
      ["user", "지호는 갔네."],
      ["assistant", "네, 먼저 내려갔어요."],
      ["user", "알겠어."],
    ]),
    currentUserMessage: "빈 의자를 본다.",
    lorebookText: "동료 지호는 이미 건물을 떠났다.",
  }),
  fixture({
    id: "B07b",
    family: "B07_OFF_SCENE_NPC",
    label: "전화만 가능",
    history: msgs([
      ["assistant", "언니는 지금 출장 중이에요."],
      ["user", "아, 그랬지."],
      ["assistant", "연락은 문자로만 가능해요."],
      ["user", "응."],
    ]),
    currentUserMessage: "한서린을 바라본다.",
    lorebookText: "언니는 현재 장면에 없으며 해외 출장 중이다.",
  }),

  // B08 — remote contact (×2)
  fixture({
    id: "B08a",
    family: "B08_REMOTE_CONTACT",
    label: "문자 채널",
    history: msgs([
      ["assistant", "아까 문자로 도착 시간 보냈죠."],
      ["user", "응, 확인했어."],
      ["assistant", "필요하면 다시 보낼게요."],
      ["user", "괜찮아."],
    ]),
    currentUserMessage: "휴대폰을 주머니에 넣는다.",
    lorebookText: "두 사람 사이에 문자 연락 채널이 이미 성립되어 있다.",
  }),
  fixture({
    id: "B08b",
    family: "B08_REMOTE_CONTACT",
    label: "통화 예정",
    history: msgs([
      ["assistant", "저녁에 전화하기로 했잖아요."],
      ["user", "맞아, 여덟 시."],
      ["assistant", "네, 그때 받을게요."],
      ["user", "좋아."],
    ]),
    currentUserMessage: "시계를 본다.",
    lorebookText: "오늘 저녁 8시 전화 약속이 있다.",
  }),

  // B09 — explicit arrival (×2)
  fixture({
    id: "B09a",
    family: "B09_EXPLICIT_ARRIVAL",
    label: "노크 후 입장",
    history: msgs([
      ["assistant", "현관 쪽에서 노크 소리가 난다."],
      ["user", "들어와."],
      ["assistant", "문을 연다."],
      ["user", "배달 왔어?"],
    ]),
    currentUserMessage: "배달원이 현관에 들어선다.",
    triggeredEventText: "[TRIGGERED] 배달원 도착",
  }),
  fixture({
    id: "B09b",
    family: "B09_EXPLICIT_ARRIVAL",
    label: "친구 방문",
    history: msgs([
      ["assistant", "초인종이 울린다."],
      ["user", "누구지?"],
      ["assistant", "모니터에 친구 하늘이 보여요."],
      ["user", "아, 오늘 오기로 했지."],
    ]),
    currentUserMessage: "문을 열어 하늘을 맞이한다.",
    triggeredEventText: "[TRIGGERED] 친구 하늘 방문",
  }),

  // B10 — authoritative trigger (×2)
  fixture({
    id: "B10a",
    family: "B10_AUTHORITATIVE_TRIGGER",
    label: "경보",
    pilotRepresentative: true,
    history: msgs([
      ["assistant", "조용히 대기한다."],
      ["user", "뭔가 이상한데."],
      ["assistant", "…네?"],
      ["user", "소리 들려?"],
    ]),
    currentUserMessage: "주변을 살핀다.",
    triggeredEventText: "[TRIGGERED] 건물 화재 경보 발동",
  }),
  fixture({
    id: "B10b",
    family: "B10_AUTHORITATIVE_TRIGGER",
    label: "정전",
    history: msgs([
      ["assistant", "거실 조명을 켠다."],
      ["user", "갑자기 어두워졌어."],
      ["assistant", "정전인가 봐요."],
      ["user", "응."],
    ]),
    currentUserMessage: "창밖을 본다.",
    triggeredEventText: "[TRIGGERED] 단지 정전",
  }),

  // B11 — parting (×2)
  fixture({
    id: "B11a",
    family: "B11_PARTING",
    label: "오늘은 여기까지",
    kind: "living_focus",
    history: msgs([
      ["assistant", "시간이 꽤 흘렀네요."],
      ["user", "응."],
      ["assistant", "차라도 더 드릴까요?"],
      ["user", "괜찮아."],
    ]),
    currentUserMessage: "가방끈을 고치며 말한다. 「오늘은 여기까지 할게.」",
  }),
  fixture({
    id: "B11b",
    family: "B11_PARTING",
    label: "먼저 퇴장",
    kind: "living_focus",
    history: msgs([
      ["assistant", "창밖 비가 그친 것 같아요."],
      ["user", "그러네."],
      ["assistant", "…조용해졌네요."],
      ["user", "응."],
    ]),
    currentUserMessage: "일어서며 말한다. 「난 먼저 들어갈게.」",
  }),

  // B12 — separation no hook (×2)
  fixture({
    id: "B12a",
    family: "B12_SEPARATION_NO_HOOK",
    label: "재회 근거 없음",
    kind: "reconvergence_trajectory",
    history: msgs([
      ["assistant", "현관까지 배웅한다."],
      ["user", "들어가. 오늘 고마웠어."],
      ["assistant", "…네."],
      ["user", "집에 간다."],
    ]),
    currentUserMessage: "집에서 창밖을 본다.",
    reconvergenceState: sepState({ turn: 5, hooks: [] }),
    currentTurn: 5,
  }),
  fixture({
    id: "B12b",
    family: "B12_SEPARATION_NO_HOOK",
    label: "연락 거부",
    kind: "reconvergence_trajectory",
    history: msgs([
      ["assistant", "문 앞에 선다."],
      ["user", "오늘은 그만하자."],
      ["assistant", "알겠어요."],
      ["user", "찾아오지 마."],
    ]),
    currentUserMessage: "연락하지 않겠다고 다시 확인한다.",
    reconvergenceState: sepState({ turn: 4, hooks: [] }),
    currentTurn: 4,
  }),

  // B13 — separation with hook (×2)
  fixture({
    id: "B13a",
    family: "B13_SEPARATION_WITH_HOOK",
    label: "맡긴 코트",
    kind: "reconvergence_trajectory",
    pilotRepresentative: true,
    history: msgs([
      ["assistant", "네 코트는 걸어뒀어요."],
      ["user", "고마워, 다음에 받을게."],
      ["assistant", "네."],
      ["user", "먼저 갈게."],
    ]),
    currentUserMessage: "집에 도착해 신발을 벗는다.",
    reconvergenceState: sepState({
      turn: 5,
      hooks: [
        {
          type: "shared_item",
          summary: "맡긴 코트",
          sourceTurn: 1,
          confidence: "high",
        },
      ],
    }),
    currentTurn: 5,
  }),
  fixture({
    id: "B13b",
    family: "B13_SEPARATION_WITH_HOOK",
    label: "공동 업무",
    kind: "reconvergence_trajectory",
    history: msgs([
      ["assistant", "보고서 초안은 내일까지예요."],
      ["user", "응, 내가 표 부분 맡을게."],
      ["assistant", "그럼 나머지는 제가."],
      ["user", "집에 가서 이어서 할게."],
    ]),
    currentUserMessage: "노트북을 연다.",
    reconvergenceState: sepState({
      turn: 6,
      hooks: [
        {
          type: "shared_task",
          summary: "공동 보고서 마감",
          sourceTurn: 1,
          confidence: "high",
        },
      ],
    }),
    currentTurn: 6,
  }),

  // B14 — long separation (×2)
  fixture({
    id: "B14a",
    family: "B14_LONG_SEPARATION",
    label: "독립 일상 3턴",
    kind: "reconvergence_trajectory",
    history: msgs([
      ["assistant", "문을 닫는다."],
      ["user", "..."],
      ["assistant", "혼자 남아 창밖을 본다."],
      ["user", "집에서 책을 읽는다."],
      ["assistant", "저녁을 준비한다."],
      ["user", "산책을 나간다."],
    ]),
    currentUserMessage: "저녁 공기를 마시며 걷는다.",
    reconvergenceState: sepState({ turn: 8, dueTurn: 10 }),
    currentTurn: 8,
  }),
  fixture({
    id: "B14b",
    family: "B14_LONG_SEPARATION",
    label: "독립 일상 5턴",
    kind: "reconvergence_trajectory",
    history: msgs([
      ["assistant", "배웅한다."],
      ["user", "..."],
      ["assistant", "업무 메일을 확인한다."],
      ["user", "운동을 한다."],
      ["assistant", "창문을 연다."],
      ["user", "영화를 본다."],
      ["assistant", "설거지를 한다."],
      ["user", "일기를 쓴다."],
    ]),
    currentUserMessage: "불을 끄고 잔다.",
    reconvergenceState: sepState({ turn: 10, dueTurn: 12 }),
    currentTurn: 10,
  }),

  // B15 — multi-character text (×2)
  fixture({
    id: "B15a",
    family: "B15_MULTI_CHARACTER_TEXT",
    label: "둘 다 향한 질문",
    kind: "living_focus",
    history: msgs([
      ["assistant", "하늘과 한서린이 마주 선다."],
      ["user", "둘 다 여기 있네."],
      ["assistant", "하늘이 고개를 끄덕인다."],
      ["user", "..."],
    ]),
    currentUserMessage: "둘을 번갈아 보며 말한다. 「너희 둘 다 어떻게 할래?」",
  }),
  fixture({
    id: "B15b",
    family: "B15_MULTI_CHARACTER_TEXT",
    label: "대화에 두 인물",
    kind: "living_focus",
    history: msgs([
      ["assistant", "한서린과 동생 수아가 소파에 앉아 있다."],
      ["user", "수아도 왔구나."],
      ["assistant", "수아가 손을 흔든다."],
      ["user", "오랜만이야."],
    ]),
    currentUserMessage: "두 사람을 향해 인사한다.",
  }),

  // B16 — active conflict (×2)
  fixture({
    id: "B16a",
    family: "B16_ACTIVE_CONFLICT",
    label: "복도 추격",
    kind: "event_restraint_focus",
    history: msgs([
      ["assistant", "복도 끝에서 발소리가 가까워진다."],
      ["user", "뛰어!"],
      ["assistant", "한서린은 문 쪽으로 달린다."],
      ["user", "여기야!"],
    ]),
    currentUserMessage: "쫓아오는 그림자를 피해 계단으로 내려간다.",
  }),
  fixture({
    id: "B16b",
    family: "B16_ACTIVE_CONFLICT",
    label: "말다툼",
    kind: "event_restraint_focus",
    history: msgs([
      ["assistant", "목소리가 거칠어진다."],
      ["user", "그건 아니잖아!"],
      ["assistant", "그럼 뭐가 맞는데요?"],
      ["user", "..."],
    ]),
    currentUserMessage: "책상을 치며 말한다. 「지금 당장 설명해.」",
  }),
];

/** Event-restraint focus subset (ER1–ER10) — references primary fixture ids. */
export const EVENT_RESTRAINT_BENCHMARK_IDS = [
  "B01a", // ER1 quiet
  "B04a", // ER2 stagnant
  "B05a", // ER3 existing task
  "B06a", // ER4 grounded NPC
  "B07a", // ER5 off-scene NPC
  "B08a", // ER6 remote contact
  "B12a", // ER7 no contact channel
  "B03a", // ER8 user-led
  "B10a", // ER9 trigger
  "B16a", // ER10 conflict
] as const;

/** Living-specific subset (L1–L7). */
export const LIVING_BENCHMARK_IDS = [
  "B11a", // L1 parting
  "B01a", // L2 quiet continuity
  "B16a", // L3 active scene
  "B10a", // L4 triggered event
  "B05a", // L5 established task
  "B15a", // L6 multi-character
  "B16b", // L7 multi-stage conflict
] as const;

export const RECONVERGENCE_TRAJECTORIES: ScenePolicyBenchmarkTrajectory[] = [
  {
    id: "R1",
    label: "NATURAL_PARTING_NO_HOOK",
    kind: "reconvergence_trajectory",
    arms: ["v1", "v2"],
    pilotRepresentative: true,
    turns: [
      {
        turnIndex: 1,
        userMessage: "오늘은 여기까지. 들어가.",
        frozenAssistantResponse: "한서린은 고개를 끄덕이며 현관까지 배웅한다.",
      },
      {
        turnIndex: 2,
        userMessage: "집에 도착했다.",
        frozenAssistantResponse: "한서린은 거실 창밖을 보며 조용히 앉는다.",
        reconvergenceStateBefore: sepState({ turn: 2, hooks: [] }),
      },
      {
        turnIndex: 3,
        userMessage: "책을 읽는다.",
        frozenAssistantResponse: "한서린은 주방에서 설거지를 한다.",
        reconvergenceStateBefore: sepState({ turn: 3, hooks: [] }),
      },
      {
        turnIndex: 4,
        userMessage: "불을 끈다.",
        frozenAssistantResponse: "한서린은 불을 끄고 침실로 간다.",
        reconvergenceStateBefore: sepState({ turn: 4, hooks: [], dueTurn: 6 }),
      },
    ],
  },
  {
    id: "R2",
    label: "PARTING_WITH_SHARED_ITEM",
    kind: "reconvergence_trajectory",
    arms: ["v1", "v2"],
    turns: [
      {
        turnIndex: 1,
        userMessage: "코트 맡아줘. 다음에 받을게.",
        frozenAssistantResponse: "한서린은 코트를 걸어둔다. 「네, 받아가세요.」",
      },
      {
        turnIndex: 2,
        userMessage: "집에 도착했다.",
        frozenAssistantResponse: "한서린은 코트를 보며 창밖을 본다.",
        reconvergenceStateBefore: sepState({
          turn: 2,
          hooks: [{ type: "shared_item", summary: "맡긴 코트", sourceTurn: 1, confidence: "high" }],
        }),
      },
      {
        turnIndex: 3,
        userMessage: "잠깐 누워 있다.",
        frozenAssistantResponse: "한서린은 코트 옆에 메모를 붙인다.",
        reconvergenceStateBefore: sepState({
          turn: 3,
          hooks: [{ type: "shared_item", summary: "맡긴 코트", sourceTurn: 1, confidence: "high" }],
          dueTurn: 5,
        }),
      },
    ],
  },
  {
    id: "R3",
    label: "CONFIRMED_NEXT_MEETING",
    kind: "reconvergence_trajectory",
    arms: ["v1", "v2"],
    turns: [
      {
        turnIndex: 1,
        userMessage: "그럼 내일 점심에 보자.",
        frozenAssistantResponse: "한서린은 고개를 끄덕인다. 「네, 내일 봐요.」",
      },
      {
        turnIndex: 2,
        userMessage: "집에 간다.",
        frozenAssistantResponse: "한서린은 일정을 확인한다.",
        reconvergenceStateBefore: sepState({
          turn: 2,
          hooks: [{ type: "existing_promise", summary: "내일 점심 약속", sourceTurn: 1, confidence: "high" }],
        }),
      },
    ],
  },
  {
    id: "R4",
    label: "SHARED_UNFINISHED_TASK",
    kind: "reconvergence_trajectory",
    arms: ["v1", "v2"],
    turns: [
      {
        turnIndex: 1,
        userMessage: "보고서는 내가 표, 너는 본문 맡아.",
        frozenAssistantResponse: "한서린은 노트를 연다. 「알겠어요.」",
      },
      {
        turnIndex: 2,
        userMessage: "집에서 이어서 할게.",
        frozenAssistantResponse: "한서린은 자료를 정리한다.",
        reconvergenceStateBefore: sepState({
          turn: 2,
          hooks: [{ type: "shared_task", summary: "공동 보고서", sourceTurn: 1, confidence: "high" }],
        }),
      },
    ],
  },
  {
    id: "R5",
    label: "USER_AVOIDS_REUNION",
    kind: "reconvergence_trajectory",
    arms: ["v1", "v2"],
    pilotRepresentative: true,
    turns: [
      {
        turnIndex: 1,
        userMessage: "오늘은 그만. 찾아오지 마.",
        frozenAssistantResponse: "한서린은 잠시 멈춘 뒤 고개를 끄덕인다.",
      },
      {
        turnIndex: 2,
        userMessage: "혼자 있고 싶어.",
        frozenAssistantResponse: "한서린은 조용히 문을 닫는다.",
        reconvergenceStateBefore: sepState({ turn: 2, hooks: [] }),
      },
      {
        turnIndex: 3,
        userMessage: "연락하지 마.",
        frozenAssistantResponse: "한서린은 창밖을 보며 혼자 남는다.",
        reconvergenceStateBefore: sepState({ turn: 3, hooks: [], dueTurn: 5 }),
      },
    ],
  },
  {
    id: "R6",
    label: "MULTI_TURN_SEPARATION",
    kind: "reconvergence_trajectory",
    arms: ["v1", "v2"],
    turns: [
      {
        turnIndex: 1,
        userMessage: "먼저 갈게.",
        frozenAssistantResponse: "한서린은 배웅한다.",
      },
      {
        turnIndex: 2,
        userMessage: "산책한다.",
        frozenAssistantResponse: "한서린은 집에서 차를 내린다.",
        reconvergenceStateBefore: sepState({ turn: 2 }),
      },
      {
        turnIndex: 3,
        userMessage: "영화 본다.",
        frozenAssistantResponse: "한서린은 메일을 확인한다.",
        reconvergenceStateBefore: sepState({ turn: 3, dueTurn: 5 }),
      },
      {
        turnIndex: 4,
        userMessage: "운동한다.",
        frozenAssistantResponse: "한서린은 창문을 연다.",
        reconvergenceStateBefore: sepState({ turn: 4, dueTurn: 6 }),
      },
      {
        turnIndex: 5,
        userMessage: "잔다.",
        frozenAssistantResponse: "한서린은 불을 끈다.",
        reconvergenceStateBefore: sepState({ turn: 5, dueTurn: 7 }),
      },
    ],
  },
];

export function getBenchmarkFixtureById(id: string): ScenePolicyBenchmarkFixture | undefined {
  return SCENE_POLICY_BENCHMARK_FIXTURES.find((f) => f.id === id);
}

export function listPilotFixtures(): ScenePolicyBenchmarkFixture[] {
  return SCENE_POLICY_BENCHMARK_FIXTURES.filter((f) => f.pilotRepresentative);
}

export function countSingleTurnFixtures(): number {
  return SCENE_POLICY_BENCHMARK_FIXTURES.length;
}
