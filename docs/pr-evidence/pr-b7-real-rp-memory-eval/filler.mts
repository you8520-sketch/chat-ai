/**
 * B7 Level 2/3 synthetic long-history filler (T91+), deterministic.
 *
 * Everyday 라이크/렌 scenes that never mention the evaluated events (G-117 stone,
 * 한서윤's report, 옆구리 injury, 야시장/탕후루, 오지환, 강민호, 딸기우유), so the
 * evaluated facts must survive from T1~T90 alone. A few distractors compete on
 * purpose: a different injury (right ankle sprain T312 -> healed T330, palm burn
 * T640 -> healed T652), other drinks (no 우유 at all), other kept items.
 */
import type { ScenarioTurn } from "./scenario.mts";

const PLACES = [
  "훈련장", "구내식당", "가이딩실", "본부 옥상", "한강 둔치", "브리핑실", "매점 앞",
  "숙소 거실", "본부 뒤 정원", "지하 사격장", "자료실", "정비고", "작전 차량 안", "역 앞 분식집",
];
const NPCS = [
  "신입 가이드 유하람", "정비팀 박철", "교관 남궁현", "연구국 인턴 서다온",
  "식당 조리장 문정자", "리컨 유닛 차세린", "에지카 구급대원 염태오",
];
const DRINKS = ["캔커피", "유자차", "보리차", "레몬에이드", "핫초코"];
const ACTIVITIES = [
  ["D급 순찰", "골목 끝에서 작은 균열을 확인하고 봉인반을 불렀다"],
  ["C급 게이트 정리", "남은 크리처 두 마리를 휘파람으로 묶어 정리했다"],
  ["보고서 작성", "렌이 독수리 타법으로 한 장을 다 채울 때까지 기다렸다"],
  ["체력 훈련", "운동장 다섯 바퀴를 돌고 벤치에 나란히 뻗었다"],
  ["신입 시범 교육", "신입들 앞에서 가이딩 접촉 순서를 시연했다"],
  ["장비 점검", "권총 탄창과 무전기 배터리를 하나씩 확인했다"],
  ["저녁 준비", "라면 두 개에 계란을 풀고 파를 대충 썰어 넣었다"],
  ["영화 보기", "소파에 담요를 덮고 오래된 액션 영화를 틀었다"],
  ["보드게임", "할리갈리를 하다 태형이 종을 너무 세게 쳐서 망가뜨렸다"],
  ["야간 대기", "상황실 의자에서 번갈아 졸며 무전을 지켰다"],
  ["산책", "가로등이 켜질 때까지 천천히 걸었다"],
  ["가이딩 정기 측정", "측정기 숫자가 80%대에서 안정적으로 머무는 걸 확인했다"],
];
const ITEMS = ["은색 열쇠고리", "낡은 손수건", "곰 모양 배지", "작은 손전등", "접이식 우산"];
const WEATHER = ["맑았다", "흐렸다", "비가 왔다", "바람이 셌다", "눈발이 날렸다", "후텁지근했다"];

function rng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 0x100000000;
  };
}

function pick<T>(r: () => number, xs: readonly T[]): T {
  return xs[Math.floor(r() * xs.length)]!;
}

function hasBatchim(word: string): boolean {
  const code = word.charCodeAt(word.length - 1) - 0xac00;
  return code >= 0 && code <= 11171 && code % 28 !== 0;
}

function josa(word: string, withBatchim: string, without: string): string {
  return word + (hasBatchim(word) ? withBatchim : without);
}

const SPECIAL: Record<number, ScenarioTurn> = {
  312: {
    user: "(순찰 중 계단을 헛디딘 태형을 붙잡는다) 괜찮아? 발목 꺾였잖아.",
    assistant:
      "태형은 계단 모서리에서 미끄러지며 오른쪽 발목을 접질렀다. \"아, 이건 좀 아프다.\" 그는 렌의 어깨를 짚고 절뚝이며 벤치에 앉았다. 에지카 구급대원 염태오가 붕대로 발목을 고정해 주며 일주일은 뛰지 말라고 했다. 태형은 \"일주일이면 금방이지\"라며 억지로 웃었다.",
  },
  330: {
    user: "발목은 이제 괜찮아? 오늘 순찰 같이 뛰어도 돼?",
    assistant:
      "태형은 오른쪽 발목을 몇 번 돌려 보이고는 제자리에서 가볍게 뛰었다. \"완전 멀쩡해. 염태오 씨도 다 나았대.\" 그는 붕대를 풀어 쓰레기통에 던져 넣고 렌보다 먼저 계단을 뛰어 내려갔다.",
  },
  640: {
    user: "(정비고에서 뜨거운 배관을 잡은 태형의 손을 본다) 손바닥 빨개졌어!",
    assistant:
      "정비팀 박철이 소리를 지르기도 전에 태형은 이미 뜨거운 배관에서 손을 뗐다. 왼손 손바닥이 벌겋게 달아올라 있었다. 렌이 찬물에 그의 손을 담그게 하자 태형은 \"센티넬은 화상도 빨리 나아\"라며 엄살 반 진심 반으로 웃었다. 박철이 화상 연고를 건넸다.",
  },
  652: {
    user: "손바닥 화상은 다 나았어?",
    assistant:
      "태형은 왼손을 쫙 펴서 렌의 눈앞에 흔들었다. 붉은 자국은 거의 사라져 있었다. \"봐, 깨끗하지? 연고 덕분이야.\" 그는 그 손으로 렌의 머리를 헝클어뜨렸다.",
  },
};

export function fillerTurn(turn: number): ScenarioTurn {
  const special = SPECIAL[turn];
  if (special) return special;
  const r = rng(turn * 7919);
  const place = pick(r, PLACES);
  const npc = pick(r, NPCS);
  const drink = pick(r, DRINKS);
  const [activity, detail] = pick(r, ACTIVITIES);
  const item = pick(r, ITEMS);
  const weather = pick(r, WEATHER);
  const day = Math.floor((turn - 90) / 3) + 1;
  const variant = turn % 4;
  const user =
    variant === 0
      ? `(${place}에서) 오늘은 ${activity} 하는 날이지? 같이 가.`
      : variant === 1
        ? `${npc} 씨가 오늘 우리 찾았대. 무슨 일일까?`
        : variant === 2
          ? `(${josa(drink, "을", "를")} 내밀며) 이거 마시고 해. ${activity} 끝나면 쉬자.`
          : `오늘 날씨 좋다. ${place} 가서 좀 쉬다 갈래?`;
  const assistant =
    `그날은 ${weather}. 두 사람은 ${place}에서 ${josa(activity, "을", "를")} 했다. 태형은 ${detail}. ` +
    `${josa(npc, "이", "가")} 지나가다 "페어 호흡 좋네요"라고 한마디 던졌고, 태형은 괜히 어깨를 으쓱했다. ` +
    `렌이 건넨 ${josa(drink, "을", "를")} 받아 든 그는 "오늘이 ${day}일째 평화로운 날이네"라며 웃었다. ` +
    `헤어지기 전 태형은 주머니 속 ${josa(item, "을", "를")} 만지작거리다 렌에게 내일 아침 몇 시에 볼지 물었다.`;
  return { user, assistant };
}
