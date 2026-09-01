import {
  buildDeterministicScenePlan,
  buildSceneSourceMessages,
  type ScenePlan,
} from "@/lib/chatImageScenePlan";

export type ComicPanelBenchmarkFixture = {
  id: string;
  formatLabel: "2panel" | "3koma" | "4panel";
  panelCount: 2 | 3 | 4;
  title: string;
  sourceScene: string;
  expectedCast: { persona: string; character: string };
  expectedKeyBeat: string;
  expectedDialogue: string[];
  expectedPanelProgression: string[];
  messages: ReturnType<typeof buildSceneSourceMessages>;
};

function fixture(
  partial: {
    id: string;
    formatLabel: "2panel" | "3koma" | "4panel";
    panelCount: 2 | 3 | 4;
    title: string;
    expectedCast: { persona: string; character: string };
    expectedKeyBeat: string;
    expectedDialogue: string[];
    expectedPanelProgression: string[];
    rows: Array<{ id: number; role: "user" | "assistant"; content: string }>;
  }
): ComicPanelBenchmarkFixture {
  const messages = buildSceneSourceMessages(partial.rows);
  return {
    id: partial.id,
    formatLabel: partial.formatLabel,
    panelCount: partial.panelCount,
    title: partial.title,
    sourceScene: partial.rows.map((row) => row.content).join("\n"),
    expectedCast: partial.expectedCast,
    expectedKeyBeat: partial.expectedKeyBeat,
    expectedDialogue: partial.expectedDialogue,
    expectedPanelProgression: partial.expectedPanelProgression,
    messages,
  };
}

/** Frozen benchmark set: 3×2-panel, 4×3-koma, 3×4-panel. */
export const COMIC_PANEL_BENCHMARK_FIXTURES: readonly ComicPanelBenchmarkFixture[] = [
  fixture({
    id: "F01-2panel-invite",
    formatLabel: "2panel",
    panelCount: 2,
    title: "후드 귀 초대",
    expectedCast: { persona: "렌", character: "태형" },
    expectedKeyBeat: "후드를 만지며 같이 가자고 묻는다",
    expectedDialogue: ["같이 갈래?", "그래."],
    expectedPanelProgression: ["Setup", "Payoff"],
    rows: [
      { id: 1, role: "user", content: '*후드 귀를 만진다*\n"같이 갈래?"' },
      { id: 2, role: "assistant", content: '렌이 후드를 만지자 태형이 고개를 돌렸다. "그래."' },
    ],
  }),
  fixture({
    id: "F02-2panel-door",
    formatLabel: "2panel",
    panelCount: 2,
    title: "문 열기",
    expectedCast: { persona: "유저", character: "민수" },
    expectedKeyBeat: "조용히 문을 연다",
    expectedDialogue: [],
    expectedPanelProgression: ["Setup", "Payoff"],
    rows: [
      { id: 1, role: "user", content: "*문을 연다*" },
      { id: 2, role: "assistant", content: "민수가 조용히 따라 나선다." },
    ],
  }),
  fixture({
    id: "F03-2panel-surprise",
    formatLabel: "2panel",
    panelCount: 2,
    title: "깜짝 선물",
    expectedCast: { persona: "하린", character: "지훈" },
    expectedKeyBeat: "상자를 내밀며 깜짝 선물",
    expectedDialogue: ["선물이야!", "진짜?"],
    expectedPanelProgression: ["Setup", "Payoff"],
    rows: [
      { id: 1, role: "user", content: '*작은 상자를 내민다*\n"선물이야!"' },
      { id: 2, role: "assistant", content: '지훈이 눈을 크게 뜨며 "진짜?"라고 되물었다.' },
    ],
  }),
  fixture({
    id: "F04-3koma-rain",
    formatLabel: "3koma",
    panelCount: 3,
    title: "비 오는 날 우산",
    expectedCast: { persona: "서연", character: "도윤" },
    expectedKeyBeat: "우산을 건네며 함께 걷자",
    expectedDialogue: ["같이 갈래?", "…고마워."],
    expectedPanelProgression: ["Setup", "Development", "Climax / punchline"],
    rows: [
      { id: 1, role: "user", content: '*우산을 든다*\n"같이 갈래?"' },
      { id: 2, role: "assistant", content: "도윤이 잠시 망설이며 시선을 피한다." },
      { id: 3, role: "assistant", content: '서연이 우산을 더 가까이 건넨다. 도윤이 작게 "…고마워."라고 말한다.' },
    ],
  }),
  fixture({
    id: "F05-3koma-cafe",
    formatLabel: "3koma",
    panelCount: 3,
    title: "카페 주문 실수",
    expectedCast: { persona: "민지", character: "현우" },
    expectedKeyBeat: "음료를 잘못 받아 당황",
    expectedDialogue: ["이거 내 주문 아닌데?", "아, 미안!"],
    expectedPanelProgression: ["Setup", "Development", "Climax / punchline"],
    rows: [
      { id: 1, role: "user", content: "*카운터에서 음료를 받는다*" },
      { id: 2, role: "user", content: '"이거 내 주문 아닌데?"' },
      { id: 3, role: "assistant", content: '현우가 황급히 돌아서며 "아, 미안!"이라고 외친다.' },
    ],
  }),
  fixture({
    id: "F06-3koma-study",
    formatLabel: "3koma",
    panelCount: 3,
    title: "공부 격려",
    expectedCast: { persona: "예린", character: "준호" },
    expectedKeyBeat: "졸린 준호를 붙잡고 격려",
    expectedDialogue: ["조금만 더!", "알겠어…"],
    expectedPanelProgression: ["Setup", "Development", "Climax / punchline"],
    rows: [
      { id: 1, role: "assistant", content: "준호가 책상에 엎드려 눈을 감는다." },
      { id: 2, role: "user", content: '*어깨를 흔든다*\n"조금만 더!"' },
      { id: 3, role: "assistant", content: '준호가 고개를 들고 "알겠어…"라고 중얼거린다.' },
    ],
  }),
  fixture({
    id: "F07-3koma-lost",
    formatLabel: "3koma",
    panelCount: 3,
    title: "길 잃음",
    expectedCast: { persona: "지아", character: "태민" },
    expectedKeyBeat: "지도를 펼치며 길을 찾는다",
    expectedDialogue: ["여기 맞아?", "…아마도."],
    expectedPanelProgression: ["Setup", "Development", "Climax / punchline"],
    rows: [
      { id: 1, role: "user", content: "*지도를 펼친다*" },
      { id: 2, role: "user", content: '"여기 맞아?"' },
      { id: 3, role: "assistant", content: '태민이 지도를 보며 "…아마도."라고 답한다.' },
    ],
  }),
  fixture({
    id: "F08-4panel-chase",
    formatLabel: "4panel",
    panelCount: 4,
    title: "복도 추격",
    expectedCast: { persona: "한별", character: "시우" },
    expectedKeyBeat: "복도에서 뛰어가며 붙잡기",
    expectedDialogue: ["잠깐!", "안 잡혀!"],
    expectedPanelProgression: ["Establish", "Escalation", "Turn", "Resolution"],
    rows: [
      { id: 1, role: "assistant", content: "시우가 복도 끝에서 갑자기 뛰기 시작한다." },
      { id: 2, role: "user", content: '*뒤쫓으며 외친다*\n"잠깐!"' },
      { id: 3, role: "assistant", content: '시우가 돌아보며 "안 잡혀!"라고 외친다.' },
      { id: 4, role: "assistant", content: "한별이 코너에서 시우의 소매를 붙잡는다." },
    ],
  }),
  fixture({
    id: "F09-4panel-cooking",
    formatLabel: "4panel",
    panelCount: 4,
    title: "요리 실패",
    expectedCast: { persona: "수아", character: "건" },
    expectedKeyBeat: "타버린 요리를 발견",
    expectedDialogue: ["이게 뭐야…", "내 탓이야."],
    expectedPanelProgression: ["Establish", "Escalation", "Turn", "Resolution"],
    rows: [
      { id: 1, role: "assistant", content: "건이 냄비 뚜껑을 연다." },
      { id: 2, role: "assistant", content: "검은 연기가 피어오른다." },
      { id: 3, role: "user", content: '"이게 뭐야…"' },
      { id: 4, role: "assistant", content: '건이 고개를 숙이며 "내 탓이야."라고 말한다.' },
    ],
  }),
  fixture({
    id: "F10-4panel-confession",
    formatLabel: "4panel",
    panelCount: 4,
    title: "고백 직전",
    expectedCast: { persona: "유나", character: "재혁" },
    expectedKeyBeat: "손을 잡고 고백",
    expectedDialogue: ["할 말이 있어.", "…들을게."],
    expectedPanelProgression: ["Establish", "Escalation", "Turn", "Resolution"],
    rows: [
      { id: 1, role: "assistant", content: "재혁이 노을진 다리 위에 선다." },
      { id: 2, role: "user", content: "*손을 잡는다*" },
      { id: 3, role: "user", content: '"할 말이 있어."' },
      { id: 4, role: "assistant", content: '재혁이 숨을 고르며 "…들을게."라고 답한다.' },
    ],
  }),
];

export function scenePlanForFixture(fixture: ComicPanelBenchmarkFixture): ScenePlan {
  return buildDeterministicScenePlan(fixture.messages, fixture.panelCount);
}
