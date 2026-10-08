import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { estimateTokens } from "@/lib/tokenEstimate";
import { AI_LEARNING_LIMIT } from "@/lib/characterFormLimits";
import {
  CHEAPER_INFERENCE_CLAUDE_OPUS_55_MODEL,
  CHEAPER_INFERENCE_DEEPSEEK_V41_FLASH_MODEL,
  CHEAPER_INFERENCE_GPT_61_SOL_MODEL,
  GEMINI_38_FLASH_MODEL,
  MAIN_RP_MODEL_IDS,
} from "@/lib/chatModels";
import { HISTORY_TOKEN_BUDGET, resolveMaxPayloadInputTokens } from "@/lib/contextTrack";
import { canonCoreInflationMetrics, compileCanonPlanV1 } from "@/lib/canonPlan/compiler";
import { selectActiveCanonChunks } from "@/lib/canonPlan/activeSelector";
import { matchKeywordLorebookEntries, type KeywordLorebookEntry } from "@/lib/keywordLorebooks";
import { parseCharacterFormBody, type SessionUser } from "@/lib/characterFormSave";
import { substantiveAiLearningCharCount } from "@/lib/creatorNarrationStyle";
import { buildCombinedCharacterSettingSource, parseCharacterSetting } from "@/utils/characterParser";
import { buildContext } from "@/services/contextBuilder";
import type { ChatMsg } from "@/lib/ai";
import type { CharacterChunk } from "@/types";

const ADULT: SessionUser = { id: 1, nickname: "audit", is_adult: 1 };

const MODELS = [
  { id: CHEAPER_INFERENCE_DEEPSEEK_V41_FLASH_MODEL, provider: "cheaperinference" as const },
  { id: GEMINI_38_FLASH_MODEL, provider: "openrouter" as const },
  { id: CHEAPER_INFERENCE_GPT_61_SOL_MODEL, provider: "cheaperinference" as const },
  { id: CHEAPER_INFERENCE_CLAUDE_OPUS_55_MODEL, provider: "cheaperinference" as const },
];

const SPEECH_PERSONALITY = "문장은 짧고 결론이 먼저다. 감정을 형용사로 풀지 않고 다음 행동으로 말한다.";
const SPEECH_TRAITS = "호칭은 직책으로 시작해서 신뢰가 생긴 뒤에만 이름으로 바뀐다. 화나면 더 낮고 느려진다.";
const WORLD = [
  "MARK_WORLD 세계는 은빛 강을 경계로 황궁과 북부 전선이 나뉜다.",
  "원로원은 기사단 예산을 쥐고, 강은 겨울에 얼어 보급이 끊긴다.",
  "마력석은 조명과 봉인에만 쓰며 사람을 고치는 용도로는 허가되지 않는다.",
].join(" ");

const CORE = [
  "[정체성]",
  "이름: 카엘",
  "MARK_IDENTITY 카엘은 스물일곱의 근위 기사단장이고, 작위 없이 황궁 경호를 총괄한다.",
  "[성격]",
  "MARK_BEHAVIOR 명령을 먼저 확인하고, 눈앞의 사람이 위험하면 규칙보다 몸이 먼저 움직인다. 사적 감정은 임무가 끝난 뒤에만 꺼낸다.",
  "[관계]",
  "MARK_RELATION 사용자는 황궁 출입이 허가된 협력자다. 처음에는 경계하고, 같은 순찰을 세 번 버티면 등을 맡긴다.",
  "[능력]",
  "MARK_ABILITY 검술과 소규모 호위 지휘가 가능하다. 장기전은 체력이 먼저 무너져 한계다. 절대로 마법을 함부로 쓰지 않는다.",
].join("\n");

const REGION = [
  "[세계관]",
  "MARK_REGION 북부 전선은 은빛 강 상류의 세 개 보루로 이루어진다. 첫째 보루는 식량을, 둘째는 병기를, 셋째는 부상병을 맡는다.",
  "MARK_FACTION 원로원 감찰국은 기사단 해체를 문서로 압박하고, 현장 지휘권은 아직 카엘에게 있다.",
  "MARK_NPC 리안은 카엘이 북부에서 데려온 부관이다. 순찰 기록을 쓰고, 카엘이 농담을 받아 주는 유일한 사람이다.",
].join("\n");

/**
 * Scope labels for this audit. Summary persistence and provider recall are
 * not exercised here; do not read a missing raw turn as a model-memory score.
 */
const AUDIT_SCOPE = {
  saveAndChunk: "MEASURED",
  unslicedAssembly: "MEASURED",
  providerRecallAndFinalAnswer: "NOT_TESTED",
  summaryStoreReinjection: "NOT_TESTED",
  fiftyTurnRawAbsence: "HISTORY_BUDGET_TRIM",
  maxPayloadSentinel: "LOCAL_ASSEMBLY_GATE_ONLY",
} as const;

const DETAIL_FACTS: readonly string[] = [
  "소라 — 하구 등대의 등대지기. 안개가 끼면 나룻배를 묶고 카엘의 전령만 들인다.",
  "미르 — 소금 벌판의 염전 감독. 밤 수송을 거절하고 낮에만 소금 수레를 보낸다.",
  "도윤 — 폐선창의 선체 감정사. 바닥이 뚫린 배는 병기 운반 명단에서 뺀다.",
  "하늘 — 풍차 언덕의 정비공. 날개가 얼면 곡식 분쇄를 멈추고 수리를 먼저 한다.",
  "세라 — 청석 구릉의 석공. 보루 벽의 금이 엄지보다 넓으면 사람 통행을 막는다.",
  "누리 — 진흙 수로의 물길 관리. 수위가 무릎을 넘으면 부상병 들것을 우회로로 돌린다.",
  "가람 — 백사 포구의 그물 대장. 강이 얼기 사흘 전에 배를 육지로 끌어올린다.",
  "이안 — 적송 숲의 숯 장인. 봉인용 숯은 팔지 않고 기사단 인장에만 넘긴다.",
  "로아 — 흑단 창고의 자물쇠 관리. 감찰국 열쇠와 카엘의 열쇠를 같은 함에 넣지 않는다.",
  "수아 — 성문 초소의 야간 당번. 패가 없는 수레는 새벽에만 되돌려 보낸다.",
  "태오 — 마구간의 말 관리. 전선으로 가는 말은 이틀 이상 연속해서 부리지 않는다.",
  "유리 — 대장간의 화살 제작. 깃이 젖은 화살은 둘째 보루 재고에서 뺀다.",
  "노아 — 서고의 군율 서기. 현장 명령과 원로원 문서를 같은 쪽에 베끼지 않는다.",
  "제이 — 옥탑의 봉화 당번. 흰 연기는 부상, 붉은 연기는 보급 단절을 뜻한다.",
  "모아 — 회랑의 시종. 카엘이 회의 중이면 사적 전언을 문 밖에 둔다.",
  "리나 — 훈련장의 신병 교관. 실전 검을 신병 대련에 쓰지 않는다.",
  "유나 — 연병의 점호 담당. 결번이 셋이면 그 분대는 성벽 당번에서 빠진다.",
  "시우 — 우물의 수질 관리. 기름 냄새가 나면 그 우물로 부상병을 씻기지 않는다.",
  "하린 — 종루의 시간 관리. 야간 순찰 교대는 종 세 번으로만 알린다.",
  "다온 — 선창 창고의 그물 보관. 얼어붙은 그물은 식량 자루와 섞지 않는다.",
  "보람 — 첫째 보루 부엌의 배식 담당. 전투 당일에는 말 사료보다 사람 죽을 먼저 끓인다.",
  "세하 — 둘째 보루 무기고의 창 관리. 자루가 갈라진 창은 출정 명단에서 뺀다.",
  "이솔 — 셋째 보루 치료소의 붕대 관리. 깨끗한 붕대가 스무 장 아래면 경상을 대기시킨다.",
  "주안 — 강안 초소의 얼음 감시. 강 가운데가 사람 무게를 견디기 전에는 도하를 막는다.",
  "채아 — 황궁 옆문의 출입 서기. 협력자 패는 하루 단위로만 연장한다.",
  "건우 — 원로원 복도의 문서 전달. 감찰 문서는 카엘이 열람한 뒤에만 사본을 남긴다.",
  "나율 — 북문 마당의 수레 검수. 봉인이 깨진 곡식 자루는 첫째 보루로 보내지 않는다.",
  "다혜 — 등잔 방의 기름 배분. 봉화용 기름과 치료소용 기름을 다른 통에 담는다.",
  "로한 — 망루의 원거리 감시. 안개로 강이 안 보이면 거리 추정보다 봉화를 먼저 올린다.",
  "민재 — 사격장의 화살 교관. 과녁 뒤 인원 확인 전에는 시위를 당기지 않는다.",
  "배하 — 세탁간의 피복 관리. 피에 젖은 망토는 다음 점호 전에 표시를 떼지 않는다.",
  "설아 — 지도실의 지형 서기. 새로 무너진 길은 당일 순찰 노선에서 지운다.",
  "아린 — 신호 마당의 깃발 담당. 철수 깃발은 카엘의 음성 명령 없이 올리지 않는다.",
  "여울 — 나루 대기소의 도선 순번. 부상병 들것은 곡식 수레보다 먼저 태운다.",
  "온유 — 황궁 정원의 야간 순라. 분수가 얼면 그 길을 경호 노선에서 뺀다.",
  "갈대 습지: 말 먹이 풀을 말려 보관한다. 홍수가 나면 사람과 말을 구릉으로 올린다.",
  "소금 길: 겨울 소금을 가마에 쌓는다. 비가 새면 병기 상자보다 소금 가마를 먼저 덮는다.",
  "폐석 다리: 수레 한 대만 통과시킨다. 난간이 흔들리면 보병만 건너게 한다.",
  "풍혈 동굴: 여름 얼음을 치료소로 보낸다. 입구가 무너지면 채굴을 중단한다.",
  "흑송 고개: 야간 봉화의 중계지다. 눈이 허리까지 쌓이면 중계를 강안 초소로 옮긴다.",
  "은빛 여울: 도하 훈련 장소다. 유속이 말의 가슴을 넘으면 훈련을 취소한다.",
  "백회 광장: 황궁 점호 장소다. 감찰국 순시일에는 기사단 대형을 광장 남쪽으로 물린다.",
  "청동 종각: 도시 경보의 기준 소리다. 종줄이 끊기면 옥탑 봉화가 경보를 대신한다.",
  "적벽 채석장: 보루 보수 돌을 캔다. 먼지 경보가 뜨면 채석 인원을 절반으로 줄인다.",
  "녹차 밭 둔덕: 황궁 시종의 휴게지다. 전선 부상병이 도착하면 휴게지를 임시 침상으로 비운다.",
  "밤나무 과수원: 가을 식량 보조지다. 벌레 먹은 열매는 사람 배식에서 빼고 말 사료로만 쓴다.",
  "거위 못: 성 안 비상 수원이다. 기름띠가 보이면 식수로 쓰지 않고 세탁에만 연다.",
  "고래 바위: 강 수위의 눈금이다. 바위 세 번째 금이 잠기면 첫째 보루가 식량을 성 안으로 당긴다.",
  "수리 둥지 절벽: 접근 금지 구간이다. 둥지 아래 길은 화살 훈련 과녁으로 쓰지 않는다.",
  "오래된 선착장: 감찰 배의 정박지다. 카엘의 순찰선과 같은 기둥에 묶지 않는다.",
  "북쪽 풍차골: 밀을 가루로 만든다. 날개 수리가 하루를 넘기면 첫째 보루가 통곡식을 배식한다.",
  "서쪽 염생 습지: 약용 갈대를 말린다. 치료소 요청이 없으면 기사단 개인이 베지 못한다.",
  "동쪽 말 방목지: 예비 마필을 키운다. 전염 기침이 돌면 그 우리는 출정 말과 분리한다.",
  "남문 시장 골목: 민간 곡식 거래지다. 전시에는 가격 게시 없이 기사단 배급표로만 판다.",
  "궁성 해자: 경호 수위가 깊이를 맡는다. 겨울에 얼면 해자 위 순찰을 금지하고 벽 위로만 돈다.",
  "삼거리 이정표: 북부 길의 분기점이다. 무너진 방향의 표석은 당일 석공이 다시 세운다.",
  "안개 협곡: 낮에도 시야가 짧다. 협곡 안에서는 말 달릴 것을 금지하고 고삐를 잡아 걷는다.",
  "따뜻한 온천 턱: 부상병 회복지다. 열이 있는 병사는 온천에 들이지 않고 치료소에 남긴다.",
  "높은 망대 계단: 로한의 교대 길이다. 계단 얼음이 있으면 모래를 뿌리기 전에 교대를 미룬다.",
  "좁은 성벽 통로: 한 사람만 지나간다. 창을 든 병사와 들것은 동시에 들이지 않는다.",
  "어두운 문서고: 감찰 사본을 보관한다. 등잔은 철제 받침에만 두고 문서 더미 위에 올리지 않는다.",
  "열린 사격 들판: 민재의 훈련지다. 들판 끝에 사람이 보이면 그날 실사격은 표적 확인으로 끝낸다.",
  "감찰국: 기사단 해체 문서를 쌓아 예산을 조인다. 현장 지휘권은 빼지 못했고 사본만 요구한다.",
  "근위 기사단: 황궁 경호와 북부 보루 순환을 맡는다. 작위가 없는 카엘의 명령이 현장 기준이다.",
  "원로원 회계파: 곡식 반출 도장을 늦게 찍는다. 도장이 없으면 첫째 보루는 비상 창고를 연다.",
  "황궁 시종부: 회의 순번과 출입 패를 관리한다. 기사단 무기 반입은 시종부가 아니라 카엘이 정한다.",
  "북부 보급단: 얼음 전 마지막 수레를 편성한다. 병기와 식량을 한 수레에 섞지 않는다.",
  "치료사 조합: 셋째 보루의 붕대와 기름을 센다. 마력석 치유는 받지 않고 손으로만 처치한다.",
  "나루 조합: 도선 요금과 순번을 게시한다. 부상병 들것은 요금을 받지 않고 먼저 태운다.",
  "석공 길드: 보루 벽 보수를 도급한다. 금이 남은 벽은 완공으로 보고하지 않는다.",
  "봉화 당번 계: 연기 색의 뜻을 교육한다. 개인 판단으로 새로운 색을 추가하지 않는다.",
  "서기 실: 순찰 장부와 군율 사본을 분리한다. 장부 수정은 리안이 두 줄을 그은 뒤에만 인정한다.",
  "마구간 계: 출정 말과 예비 말을 다른 건물에서 재운다. 전날 밤 물을 두 번 넘게 주지 않는다.",
  "시장 자치회: 전시 곡식 가격을 기사단 배급표에 맞춘다. 표 없는 매점은 남문을 닫는다.",
  "얼음 감시조: 고래 바위 눈금으로 도하 가능일을 적는다. 추정치만으로 도하 명령을 내리지 않는다.",
  "경호 교대조: 황궁 정원과 성벽을 다른 노선으로 돈다. 한 조가 두 노선을 같은 시각에 맡지 않는다.",
  "신병 교관단: 목검과 실전 검을 다른 상자에 둔다. 실전 검 분실은 당일 카엘에게 올린다.",
  "문서 전달조: 감찰 문서는 봉인된 채로 카엘에게 간다. 복도에서 개봉한 사본은 무효다.",
  "기름 배분조: 봉화 통과 치료소 통의 인장을 다르게 찍는다. 통을 바꾸면 당일 배분을 중단한다.",
  "피복 관리조: 피에 젖은 망토를 점호 전 세탁하지 않는다. 표시가 남은 인원만 부상 명단에 올린다.",
  "지도 수정조: 무너진 길을 당일 지운다. 지워지지 않은 옛 노선으로 야간 순찰을 보내지 않는다.",
  "출입 서기국: 협력자 패의 만료를 하루 단위로 적는다. 기간 없는 패는 옆문에서 회수한다.",
  "삼 년 전 봄: 카엘이 북부에서 리안을 부관으로 데려왔다. 리안은 그때부터 순찰 장부만 적는다.",
  "이 년 전 겨울: 강이 예정보다 일찍 얼어 둘째 보루의 화살이 부족했다. 그 뒤 젖은 화살은 재고에서 뺀다.",
  "작년 가을: 감찰국이 기사단 해체 초안을 회람했다. 카엘은 현장 지휘 인장을 넘기지 않았다.",
  "작년 첫눈: 첫째 보루 곡식 자루의 봉인이 깨진 채 도착했다. 나율은 그 자루를 성 안으로 들이지 않았다.",
  "올해 봄 점호: 결번 세 명의 분대가 성벽 당번에서 빠졌다. 유나는 그 규칙을 장부에 고정했다.",
  "올해 여름 홍수: 진흙 수로가 무릎을 넘어 들것 길이 막혔다. 누리는 우회로를 지도에 새로 그었다.",
  "올해 가을 순시: 감찰국이 열쇠 합본을 요구했다. 로아는 두 열쇠를 합치지 않고 거절했다.",
  "이번 달 초: 청석 구릉 벽에 엄지보다 넓은 금이 갔다. 세라는 통행을 막고 석공 길드를 불렀다.",
  "열흘 전 야간: 패 없는 수레가 성문에 섰다. 수아는 새벽에만 되돌려 보냈고 곡식은 받지 않았다.",
  "엿새 전: 사격장 과녁 뒤에 사람이 보였다. 민재는 실사격을 멈추고 표적 확인만 남겼다.",
  "나흘 전: 치료소 깨끗한 붕대가 열아홉 장이 되었다. 이솔은 경상을 대기시키고 카엘에게 알렸다.",
  "그제 회의: 원로원 회계파가 곡식 도장을 미뤘다. 보람은 비상 창고의 죽을 먼저 끓였다.",
  "어제 안개: 망루에서 강이 보이지 않았다. 로한은 거리 추정 대신 붉은 봉화를 올렸다.",
  "오늘 아침 점호: 피에 젖은 망토의 표시가 남아 있다. 배하는 그 병사를 부상 명단에 올렸다.",
  "리안의 장부 규칙: 셋째 보루에서는 부상병 수와 화살 재고만 적는다. 카엘의 사적 대화는 적지 않는다.",
  "리안의 수정 규칙: 틀린 순찰 기록은 두 줄을 긋고 새 줄을 아래에 쓴다. 이전 줄을 긁어내지 않는다.",
  "관계 1단계: 첫 출입 확인 때 카엘은 이름을 묻지 않고 패의 만료일만 본다.",
  "관계 2단계: 첫 순찰에서 카엘은 사용자를 행렬 끝에 두고 등을 보여 주지 않는다.",
  "관계 3단계: 같은 순찰을 한 번 버티면 카엘은 위험 구간에서만 사용자를 앞으로 당긴다.",
  "관계 4단계: 두 번째 순찰에서 카엘은 직책으로 부르고 개인 안부는 묻지 않는다.",
  "관계 5단계: 세 번째 순찰을 마치면 카엘은 등을 맡기고 이름을 부를 수 있다.",
  "관계 6단계: 이름을 부른 뒤에도 회의 중에는 다시 직책으로 돌아간다.",
  "관계 7단계: 사용자가 부상을 숨기면 카엘은 대화를 끊고 치료소로 직접 데려간다.",
  "관계 8단계: 사용자가 감찰 문서를 대신 받으면 카엘은 그 사본을 서고에 따로 둔다.",
  "관계 9단계: 야간 경호에서 사용자가 곁에 있으면 카엘은 정원 노선을 한 사람 간격으로 유지한다.",
  "관계 10단계: 신뢰를 거둘 조건은 패 위조나 장부 조작이다. 그 경우 출입을 당일 회수한다.",
  "검술 제약: 좁은 성벽 통로에서는 찌르기만 쓴다. 베기는 옆 병사와 겹쳐 금지한다.",
  "호위 대형 제약: 소규모 호위는 다섯 명까지다. 여섯 명부터는 분대 점호를 다시 한다.",
  "장기전 제약: 카엘은 이틀 연속 야간 당번을 서지 않는다. 사흘째 새벽에는 지휘를 리안에게 맡기고 잔다.",
  "마력석 제약: 마력석은 조명과 봉인에만 쓴다. 부상병 처치에 가져다 두면 카엘이 치료소 밖으로 치운다.",
  "도하 제약: 고래 바위 세 번째 금이 물 위에 있을 때만 카엘이 도하를 허가한다.",
  "봉화 제약: 카엘이 직접 색을 말하기 전에는 철수 깃발을 올리지 않는다.",
  "문서 제약: 카엘은 감찰 문서를 복도에서 열지 않는다. 서고에서 리안이 입회할 때만 개봉한다.",
  "말 제약: 카엘의 말은 출정 전날 다른 말과 같은 우리에 두지 않는다.",
  "식사 제약: 전투 당일 카엘은 배식이 돌고 난 뒤에만 먹는다. 먼저 받으면 보람이 그릇을 물린다.",
  "회의 제약: 카엘은 무기 차림으로 원로원 회의에 들어가지 않는다. 검은 회랑 시종에게 맡긴다.",
  "야간 시야 제약: 안개 협곡에서는 카엘도 말을 달리지 않는다. 고삐를 잡고 걸으며 인원을 센다.",
  "치료 제약: 카엘은 붕대가 부족한 날 경상 순찰을 승인하지 않는다. 이솔의 대기 명단을 먼저 본다.",
  "열쇠 제약: 카엘의 창고 열쇠는 감찰국 사본을 만들지 않는다. 분실하면 자물쇠를 당일 갈아 끼운다.",
  "훈련 제약: 카엘은 신병 앞에서 실전 검을 뽑지 않는다. 시범은 리나의 목검으로만 한다.",
  "순찰 노선 제약: 무너진 길이 지도에 남아 있으면 카엘은 그 노선의 야간 출발을 취소한다.",
  "기름 제약: 카엘은 봉화 기름을 치료소에 빌려 주지 않는다. 통의 인장이 다르면 배분을 멈춘다.",
  "점호 제약: 결번이 셋인 분대에 카엘은 성벽 당번을 주지 않는다. 보충 전에는 연병만 걷게 한다.",
  "전언 제약: 회의 중 사적 전언을 카엘은 읽지 않는다. 모아가 문 밖에 둔 쪽지는 회의 뒤에 연다.",
  "도선 제약: 카엘이 탄 배에도 부상병 들것이 있으면 곡식보다 들것을 먼저 싣는다.",
  "사격 제약: 카엘은 과녁 뒤가 확인되지 않은 들판에서 시위를 당기지 않는다.",
  "해자 제약: 해자가 얼면 카엘은 얼음 위 순찰을 취소하고 벽 위 노선만 남긴다.",
  "정원 제약: 분수가 얼면 카엘은 그 길을 경호에서 빼고 온유의 대체 노선을 따른다.",
  "장부 제약: 카엘은 리안이 긋기 전의 순찰 기록을 수정하라고 말하지 않는다.",
  "교대 제약: 종 세 번이 울리기 전에 카엘은 야간 당번을 교대하지 않는다.",
  "수레 제약: 봉인 깨진 곡식 자루를 카엘은 첫째 보루 배식으로 승인하지 않는다.",
  "망토 제약: 표시가 남은 망토의 병사를 카엘은 당일 출정 명단에서 뺀다.",
  "창 제약: 자루가 갈라진 창을 카엘은 둘째 보루 출정 무기로 세지 않는다.",
  "그물 제약: 얼어붙은 그물을 카엘은 식량 자루와 같은 창고에 들이지 않는다.",
  "숯 제약: 봉인용 숯이 민간 장부에 팔린 기록이 있으면 카엘은 그 인장을 다시 찍지 않는다.",
  "패 제약: 만료일이 빈 협력자 패를 카엘은 당일 회수하고 옆문 출입을 닫는다.",
  "대형 제약: 여섯 명째 호위가 붙으면 카엘은 출발을 멈추고 연병에서 다시 점호한다.",
  "잔류 제약: 사흘째 새벽의 지휘는 리안에게 넘긴다. 카엘은 그 시간에 새 명령을 추가하지 않는다.",
  "색 제약: 흰 연기와 붉은 연기 외의 봉화를 카엘은 명령하지 않는다. 새 색은 당번 계가 거부한다.",
  "입회 제약: 리안이 없는 서고에서 카엘은 감찰 문서를 개봉하지 않는다.",
  "우물 제약: 기름 냄새 나는 우물로 카엘은 부상병 세척을 승인하지 않는다.",
  "시장 제약: 배급표 없는 곡식 매점을 카엘은 남문 폐쇄 사유로 인정한다.",
  "온천 제약: 열이 있는 병사의 온천 입실을 카엘은 허가하지 않는다.",
  "계단 제약: 망대 계단에 얼음이 있으면 카엘은 모래를 뿌리기 전에 교대 병사를 올리지 않는다.",
  "통로 제약: 들것과 창병이 마주치면 카엘은 창병을 벽 아래로 되돌린다.",
  "등잔 제약: 문서고 등잔이 더미 위에 있으면 카엘은 열람을 취소한다.",
  "방목 제약: 기침하는 말을 카엘은 출정 말과 같은 길에 세우지 않는다.",
  "갈대 제약: 치료소 요청이 없는 약용 갈대 채취를 카엘은 순찰 중 막는다.",
  "가격 제약: 전시 곡식 가격을 배급표와 다르게 외치면 카엘은 그 좌판을 당일 닫는다.",
  "사본 제약: 복도에서 개봉된 감찰 사본을 카엘은 무효로 적고 서고에 들이지 않는다.",
  "합본 제약: 열쇠 합본 요구를 카엘은 로아의 거절과 같이 기각한다.",
  "중계 제약: 흑송 고개 눈이 허리까지 쌓이면 카엘은 봉화 중계를 강안 초소로 옮긴다.",
  "분쇄 제약: 풍차 수리가 하루를 넘기면 카엘은 통곡식 배식을 승인한다.",
  "먼지 제약: 채석장 먼지 경보가 있으면 카엘은 보수 인원을 절반만 보낸다.",
  "둥지 제약: 수리 둥지 아래 길을 카엘은 화살 훈련에 배정하지 않는다.",
  "정박 제약: 감찰 배와 순찰선을 카엘은 같은 기둥에 묶지 못하게 한다.",
  "휴게 제약: 부상병이 도착한 날 카엘은 녹차 밭 둔덕의 휴게를 침상으로 비우라고 한다.",
  "열매 제약: 벌레 먹은 밤을 카엘은 사람 배식에서 빼고 말 사료로만 보낸다.",
  "해자 얼음 제약: 얼음 위 경호를 카엘은 승인하지 않고 벽 위 인원만 남긴다.",
  "표석 제약: 넘어진 이정표를 당일 세우기 전에는 카엘이 그 분기 야간 순찰을 보내지 않는다.",
  "고삐 제약: 안개 협곡에서 고삐를 놓은 병사를 카엘은 그 순찰에서 빼 연병으로 돌린다.",
  "월요일 당번: 소라는 하구 등대, 수아는 성문, 로한은 망루에 선다. 같은 사람을 두 자리에 적지 않는다.",
  "화요일 당번: 미르는 염전, 유리와 세하는 둘째 보루 무기고, 이솔은 셋째 보루 치료소에 남는다.",
  "수요일 당번: 도윤은 폐선창, 가람은 백사 포구, 여울은 나루 순번만 맡는다. 도선과 선체 감정을 한 사람이 겸하지 않는다.",
  "목요일 당번: 세라는 청석 벽, 석공 길드는 적벽 채석장, 설아는 무너진 길을 지도에서 지운다.",
  "금요일 당번: 노아와 건우는 서고에서만 문서를 맞춘다. 복도 개봉은 이 요일에도 무효다.",
  "토요일 당번: 리나는 훈련장, 민재는 사격 들판, 유나는 연병 점호를 연다. 실사격과 신병 대련은 같은 시각에 잡지 않는다.",
  "일요일 당번: 카엘은 황궁 성벽만 돈다. 북부 보루 명령은 리안이 받아 적고 월요일에 카엘이 확인한다.",
  "입춘 절차: 해자 얼음을 깨기 전에 벽 위 경호를 유지한다. 얼음 위 시험 보행은 온유가 금지한다.",
  "우수 절차: 갈대 습지의 말 먹이를 말린 더미부터 연다. 젖은 더미는 태오가 방목지로 보내지 않는다.",
  "경칩 절차: 풍차 날개 축을 하늘이 점검한다. 축이 갈라져 있으면 보람이 통곡식 배식으로 바꾼다.",
  "춘분 절차: 고래 바위 눈금을 주안이 다시 칠한다. 금이 바뀌면 도하 허가 기준도 그날 고친다.",
  "청명 절차: 약용 갈대는 치료사 조합의 요청서에만 벤다. 요청서 없는 묶음은 서쪽 습지에 도로 심는다.",
  "곡우 절차: 남문 시장은 배급표를 게시한다. 표와 다른 가격을 외친 좌판은 채아가 패를 확인한 뒤 닫는다.",
  "입하 절차: 온천 턱의 입실 명단에서 열 있는 이름을 이솔이 지운다. 카엘은 그 명단을 순찰 전에 본다.",
  "소만 절차: 방목지 기침 말을 동쪽 끝 우리로 보낸다. 출정 말은 마구간 계가 다른 길로 끌어낸다.",
  "망종 절차: 보리 베기를 첫째 보루 배식량에 더한다. 벌레 먹은 이삭은 사람 죽에 넣지 않는다.",
  "하지 절차: 풍혈 동굴의 얼음을 치료소로 옮긴다. 입구 낙석이 있으면 채굴 인원을 들이지 않는다.",
  "소서 절차: 낮 사격은 민재가 들판 끝을 비운 뒤에만 연다. 그늘 점호는 유나가 연병에서 따로 한다.",
  "대서 절차: 우물 기름 냄새를 시우가 아침마다 적는다. 냄새가 난 우물은 세탁간만 쓰고 치료소는 거위 못을 쓴다.",
  "입추 절차: 봉화 기름 재고를 다혜가 옥탑과 치료소로 나눠 적는다. 통 인장이 바뀌면 배분을 하루 멈춘다.",
  "처서 절차: 야간 안개 협곡 순찰은 고삐를 잡은 보행만 허가한다. 말 달릴 것을 적은 노선은 설아가 지운다.",
  "백로 절차: 이슬 젖은 화살은 유리가 깃을 말리기 전에 재고에서 뺀다. 둘째 보루는 마른 화살만 센다.",
  "추분 절차: 도하 훈련을 은빛 여울에서 하루 줄인다. 유속이 말의 가슴을 넘으면 주안이 훈련을 취소한다.",
  "한로 절차: 첫 서리가 내리면 가람이 백사 포구의 배를 끌어올릴 날짜를 사흘 앞당긴다.",
  "상강 절차: 청석 벽의 금을 세라가 다시 잰다. 엄지를 넘은 금은 통행 금줄로 막는다.",
  "입동 절차: 북부 보급단은 마지막 수레의 식량과 병기를 다른 칸에 싣는다. 섞인 수레는 나율이 되돌린다.",
  "소설 절차: 흑송 고개의 눈을 허리 높이로 재기 시작한다. 그 높이가 되면 봉화 중계는 강안 초소로 옮긴다.",
  "대설 절차: 마구간은 출정 말을 예비 말과 다른 건물에서 재운다. 태오는 전날 밤 물을 두 번만 준다.",
  "동지 절차: 카엘은 야간 당번을 이틀까지만 선다. 사흘째 새벽 지휘 인장은 리안이 보관한다.",
  "소한 절차: 해자가 완전히 얼면 경호 교대조는 얼음 노선을 폐지하고 성벽 인원을 두 배로 적는다.",
  "대한 절차: 풍차 수리가 하루를 넘기면 첫째 보루는 가루 대신 통곡식을 배식한다. 보람이 그 전환을 장부에 적는다.",
  "소라와 가람: 등대 불빛이 꺼지면 포구는 배를 내지 않는다. 불빛 복구 전에는 전령 배만 하구로 들어온다.",
  "미르와 보람: 염전 소금이 빗물에 녹으면 부엌은 비상 소금만 쓴다. 녹은 소금은 사람 죽에 넣지 않는다.",
  "도윤과 여울: 바닥 뚫린 배는 도선 순번에서 빠진다. 여울은 그 배를 부상병 운송에도 쓰지 않는다.",
  "하늘과 보람: 풍차가 서면 부엌은 통곡식 양을 미리 올린다. 가루 재고가 남았다는 이유만으로 배식을 미루지 않는다.",
  "세라와 세하: 벽 금이 넓어지면 무기고는 그 구간 앞의 창 훈련을 중지한다. 낙석 구간에 창병을 세우지 않는다.",
  "누리와 이솔: 수로가 무릎을 넘으면 치료소는 들것 도착 시각을 우회로 기준으로 다시 적는다.",
  "이안과 로아: 봉인용 숯의 반출 장부와 창고 열쇠 장부를 같은 날 맞춘다. 숫자가 다르면 인장을 다시 찍지 않는다.",
  "수아와 채아: 성문에서 되돌린 수레는 옆문 패로 재진입하지 못한다. 채아는 그 이름을 당일 명단에 올린다.",
  "태오와 민재: 출정 말은 사격 들판 가장자리에 매두지 않는다. 말 귀가 과녁 방향이면 실사격을 늦춘다.",
  "유리와 이솔: 젖은 화살 묶음은 치료소 붕대 상자와 같은 수레에 싣지 않는다.",
  "노아와 리안: 군율 사본과 순찰 장부는 다른 상자에 둔다. 리안이 두 줄을 긋기 전의 장부를 노아는 베끼지 않는다.",
  "제이와 로한: 망루에서 강이 안 보이면 옥탑은 추정 거리 대신 로한이 고른 연기 색만 올린다.",
  "모아와 건우: 회의 중 사적 전언과 감찰 문서는 다른 쟁반에 둔다. 전언 쟁반을 카엘은 회의 뒤에만 연다.",
  "리나와 민재: 신병 목검 훈련과 실사격 사이에는 연병 점호 하나를 둔다. 연속 배치하지 않는다.",
  "유나와 아린: 결번 세 명인 분대는 철수 깃발 당번에서도 빠진다. 깃발은 정원이 찬 조만 맡는다.",
  "시우와 다혜: 기름 냄새 우물의 물은 등잔 기름 통과 같은 뜰에서 다루지 않는다.",
  "하린과 온유: 종 세 번 전에 정원 순라를 교대하지 않는다. 온유는 종소리를 듣고 노선을 넘긴다.",
  "다온과 가람: 얼어붙은 그물은 포구 창고가 아니라 선창의 별칸에 둔다. 식량 자루와 벽을 공유하지 않는다.",
  "배하와 이솔: 망토 표시가 남은 병사는 치료소 대기 명단과 출정 명단에 동시에 오르지 않는다.",
  "설아와 주안: 지도에서 지운 도하 지점은 얼음 감시 일지에도 같은 날 지운다. 한쪽만 남은 노선은 무효다.",
  "아린과 제이: 철수 깃발과 붉은 봉화는 같은 시각에 올리지 않는다. 카엘이 둘 중 하나만 고른다.",
  "나율과 미르: 봉인 깨진 소금 가마도 곡식 자루와 같이 성 밖으로 되돌린다. 염전 재고에 다시 넣지 않는다.",
  "로아와 건우: 열쇠 대장과 문서 전달 대장이 어긋나면 서고를 그날 닫는다. 카엘이 두 대장을 다시 맞춘 뒤에 연다.",
  "보람과 치료사 조합: 사람 죽이 부족하면 말 사료를 줄여 곡식을 옮긴다. 반대 방향의 전용은 하지 않는다.",
  "세하와 유리: 갈라진 창 자루와 젖은 화살은 출정 수레의 다른 불합격 칸에 둔다. 합격 무기와 포장을 공유하지 않는다.",
  "채아와 수아: 만료된 협력자 패는 옆문과 성문이 같은 시각에 회수한다. 한쪽만 회수한 패는 아직 유효로 보지 않는다.",
  "주안과 가람: 고래 바위가 잠기기 전날 포구는 잔여 배를 육지로 올린다. 도하 허가와 출항 허가를 같은 문장으로 적지 않는다.",
  "이솔과 시우: 세척 가능한 우물과 금지 우물을 치료소 문 앞에 따로 게시한다. 게시 전 세척은 하지 않는다.",
  "민재와 온유: 정원 순라가 사격 들판을 가로지르는 시간에는 시위를 내려놓는다.",
  "하린과 유나: 점호 시각은 종루 시각만 따른다. 연병의 해시계와 다르면 종루를 기준으로 결번을 센다.",
  "하늘과 세라: 풍차 수리 인원과 벽 보수 인원을 같은 명단에서 빼지 않는다. 한 사람이 두 현장의 책임자가 되지 않는다.",
  "도윤과 나율: 폐선으로 판정된 배의 화물은 북문 검수를 다시 받는다. 배만 빼고 화물 봉인을 유지하지 않는다.",
  "제이와 다혜: 붉은 연기를 올린 날의 기름 소모는 옥탑 통에서만 차감한다. 치료소 통의 재고를 그 이유로 줄이지 않는다.",
  "모아와 온유: 회의가 길어지면 정원 순라는 시종의 전언 없이 노선을 줄이지 않는다. 전언은 문 밖 쟁반에만 둔다.",
  "리나와 유나: 신병 결번이 있으면 대련 조를 줄이고 점호를 먼저 끝낸다. 결번 인원의 목검은 상자 밖으로 내지 않는다.",
  "로한과 설아: 안개로 지운 가시 거리는 지도의 당일 주석에만 적는다. 옛 거리 숫자를 지우지 않고 옆에 새 숫자를 쓴다.",
  "태오와 주안: 도하가 막힌 날의 말은 강안 초소까지 가지 않는다. 마구간으로 되돌리고 사료를 반으로 줄이지는 않는다.",
  "노아와 채아: 출입 패 만료와 군율 사본의 날짜가 다르면 서고는 패 쪽 날짜를 따른다. 군율로 패 기한을 늘리지 않는다.",
  "배하와 아린: 망토 표시가 남은 병사는 깃발 당번 명단에서 빠진다. 세탁이 끝나기 전에는 신호 마당에 세우지 않는다.",
  "다온과 보람: 그물과 식량을 같은 창고에 둔 기록이 있으면 그날 배식 장부를 다시 쓴다. 이전 장부는 두 줄로 남긴다.",
  "건우와 리안: 카엘이 열람하기 전의 감찰 문서는 순찰 장부 상자에 넣지 않는다. 리안은 열람 시각을 별줄에 적는다.",
  "이안과 제이: 봉인용 숯이 옥탑 당번에게 직접 팔린 기록이 있으면 그 봉화는 공식 신호로 세지 않는다.",
  "수아와 로한: 성문에서 되돌린 수레의 등불은 망루 봉화 기름으로 재우지 않는다.",
  "가람과 이솔: 배에 실은 부상병은 포구에서 붕대를 갈아 치료소 명단에 올린다. 배 위 처치를 치료 완료로 적지 않는다.",
  "미르와 나율: 낮에만 보낸 소금 수레가 밤에 북문에 도착하면 검수는 받지 않고 염전으로 되돌린다.",
  "소라와 제이: 등대 불빛이 꺼진 밤에는 옥탑도 흰 연기를 추정으로 올리지 않는다. 전령의 구두 보고를 기다린다.",
  "세라와 누리: 벽 보수 날의 수로 우회로는 석공 수레와 들것이 겹치지 않게 시간을 나눈다.",
  "하늘과 태오: 풍차 수리에 쓰는 밧줄은 말 고삐 예비와 다른 더미에 둔다. 같은 밧줄을 두 용도로 적지 않는다.",
  "로아와 수아: 열쇠를 성문 당번에게 맡기지 않는다. 야간 당번이 열쇠를 요구하면 수아는 창고 대신 카엘을 부른다.",
  "유나와 배하: 점호에서 망토 표시를 가린 병사는 결번이 아니라 부상 은폐로 적는다. 출정 명단에서 바로 뺀다.",
  "민재와 세하: 시위 훈련에 출정용 창을 과녁 막대로 쓰지 않는다. 목봉은 훈련장 상자에서만 가져온다.",
  "하린과 제이: 교대 종과 봉화 연기를 같은 사건의 신호로 합치지 않는다. 종은 교대, 연기는 부상이나 보급만 뜻한다.",
  "온유와 채아: 정원 노선에서 회수한 만료 패는 옆문 서기국으로 당일 넘긴다. 정원 초소에 하룻밤 두지 않는다.",
  "설아와 세라: 지도에서 지운 벽 구간은 석공이 금줄을 친 구간과 같아야 한다. 금줄 없는 삭제 구간은 지도 오류로 되돌린다.",
  "주안과 로한: 도하 불가와 시야 불가를 다른 칸에 적는다. 안개 때문에 강이 안 보인다고 도하 불가를 추정하지 않는다.",
  "이솔과 보람: 경상 대기 인원의 식사는 출정 배식과 다른 솥에서 낸다. 대기 인원에게 말 사료 쪽 곡식을 주지 않는다.",
  "다혜와 시우: 치료소 기름이 우물 근처에 보관된 날에는 그 우물을 식수에서 제외한다. 등잔 방을 옮긴 뒤에만 다시 연다.",
  "아린과 모아: 철수 깃발 명령서와 사적 전언을 같은 통에 넣지 않는다. 명령서는 신호 마당 철제함에만 둔다.",
  "나율과 도윤: 북문에서 되돌린 화물의 배 이름을 폐선 대장과 대조한다. 폐선이면 화물 봉인을 풀고 내용만 다시 검수한다.",
  "건우와 노아: 열람 전 사본을 군율 서기가 베끼면 그 쪽은 파기하고 원본 봉인을 다시 친다. 베낀 문장은 장부에 남기지 않는다.",
  "리안과 유나: 일요일 북부 명령은 점호 결번과 같은 줄에 적지 않는다. 명령 장부와 결번 장부를 리안이 분리한다.",
  "카엘과 보급단: 마지막 겨울 수레의 출발 시각은 카엘이 적고 보급단은 칸 배치만 정한다. 시각을 보급단이 앞당기지 못한다.",
  "카엘과 석공 길드: 금이 남은 벽을 완공으로 적은 도급은 카엘이 대금 승인에서 뺀다. 세리가 재측정한 뒤에만 다시 올린다.",
  "카엘과 나루 조합: 부상병 무임 승선을 조합 요금표의 예외 칸에 고정한다. 전시라고 곡식 수레까지 무임으로 넓히지 않는다.",
  "카엘과 시장 자치회: 배급표 위반 좌판은 당일만 닫고 패는 유지한다. 반복이면 채아가 다음 날 패를 회수한다.",
  "카엘과 얼음 감시조: 바위 눈금이 없는 도하 허가는 서명하지 않는다. 주안의 당일 일지가 첨부된 것만 인정한다.",
  "카엘과 신병 교관단: 실전 검 분실 보고가 당일을 넘기면 그 교관의 대련 배정을 일주일 멈춘다.",
  "카엘과 기름 배분조: 통 인장 불일치는 분실이 아니라 배분 중단 사유다. 새 통을 열기 전에 다혜의 재고를 다시 센다.",
  "카엘과 지도 수정조: 옛 노선 숫자를 지운 지도는 반려한다. 새 숫자는 옆 주석으로만 인정한다.",
  "카엘과 출입 서기국: 기간 없는 패를 하루라도 연장한 서기는 그 패의 책임자에서 빠진다. 채아가 회수 장부에 이름을 적는다.",
  "카엘과 피복 관리조: 점호 전 세탁으로 표시를 지운 망토는 부상 은폐로 적는다. 배하가 세탁 시각을 같이 적는다.",
  "카엘과 문서 전달조: 봉인이 풀린 채 도착한 감찰 문서는 열람하지 않고 원로원으로 되돌린다.",
  "카엘과 마구간 계: 예비 말과 같은 건물에서 잔 출정 말은 다음 출정 명단에서 하루 뺀다.",
  "카엘과 치료사 조합: 마력석이 치료소 탁자에 있으면 그날의 처치 장부를 공식 기록으로 받지 않는다.",
  "카엘과 봉화 당번 계: 교육되지 않은 연기 색은 신호 없음과 같다. 제이가 그 시각의 연기를 장부에서 삭제한다.",
  "카엘과 서기 실: 현장 명령과 원로원 문서가 한 쪽에 있으면 그 쪽 전체를 다시 베끼게 한다. 합쳐진 원본은 보관하지 않는다.",
  "카엘과 경호 교대조: 한 조가 정원과 성벽을 같은 시각에 맡으면 그 시각의 경호를 무효로 보고 다시 편성한다.",
  "첫째 보루 식량 칸: 곡식, 소금, 말 사료를 다른 선반에 둔다. 봉인 파손 칸은 배식 선반 아래로 내리지 않고 문 밖에 둔다.",
  "둘째 보루 병기 칸: 합격 화살, 불합격 화살, 창을 세 상자로 둔다. 불합격 상자가 열리면 출정 점호를 다시 한다.",
  "셋째 보루 부상 칸: 중상, 경상 대기, 붕대 재고를 다른 줄에 적는다. 리안은 이 세 숫자 외의 사적 문장을 그 장부에 쓰지 않는다.",
  "황궁 경호 칸: 성벽, 정원, 옆문을 다른 조에 배정한다. 카엘의 당일 노선은 성벽이고 정원은 온유, 옆문은 채아다.",
  "감찰 열람 칸: 열람 시각, 입회한 리안, 되돌린 문서 수를 적는다. 내용 요약은 이 칸에 쓰지 않는다.",
  "도하 판단 칸: 바위 눈금, 유속, 안개 여부를 셋으로 나눈다. 안개 칸이 불이라도 눈금이 잠기면 도하는 불가다.",
  "패 회수 칸: 성문 회수와 옆문 회수를 둘 다 적어야 유효하다. 한쪽 서명만 있는 패는 아직 사용 중이다.",
  "종과 연기 칸: 교대 종 시각과 봉화 색을 같은 시각이라도 다른 줄에 적는다. 합쳐 적은 줄은 하린이 반려한다.",
  "수리 일정 칸: 풍차, 벽 금, 계단 얼음을 다른 책임자에게 적는다. 하늘, 세라, 로한 중 한 명이 두 칸의 서명이 되지 않는다.",
  "배식 전환 칸: 가루에서 통곡식으로 바꾼 이유와 시각을 보람이 적는다. 이유 없는 전환은 첫째 보루 재고에서 인정하지 않는다.",
];

const CLOSER_EXTRAS = [
  " 봉인 인장만 통과시킨다.",
  " 안개 경보 중에는 등불을 줄인다.",
  " 곡식 수레는 새벽에만 태운다.",
  " 부상병 들것은 순번을 건너뛴다.",
  " 감찰국 패는 이 나루에서 받지 않는다.",
  " 얼음이 갈라지면 도하를 멈춘다.",
  " 젖은 화살은 재고에서 뺀다.",
  " 말 사료보다 사람 죽을 먼저 끓인다.",
] as const;

const CODA_BY_LENGTH: Record<number, string> = {
  8: " 문을 닫는다.",
  9: " 기름을 아낀다.",
  10: " 교대 종을 친다.",
  11: " 수레 봉인을 본다.",
  12: " 우물 뚜껑을 닫는다.",
  13: " 수레 봉인을 확인한다.",
  14: " 빈 자루를 따로 묶는다.",
  15: " 젖은 장작은 때지 않는다.",
  16: " 부러진 창을 명단에서 뺀다.",
  17: " 야간 패는 새벽까지 보관한다.",
  18: " 젖은 장작은 불쏘시개에서 뺀다.",
  19: " 부러진 창은 출정 명단에서 뺀다.",
  20: " 금이 간 창은 출정 명단에서 뺀다.",
  21: " 협력자 패는 여기서 연장하지 않는다.",
  23: " 말에게는 전투 전날 물을 한 번만 준다.",
  25: " 치료소 기름과 봉화 기름을 다른 통에 둔다.",
};

const CLOSER_PLACES = ["북안", "하구", "서안", "동안", "남안", "외항", "내항", "신창", "구창", "옛터"] as const;
const CLOSER_RULES = [
  "야간 출항을 금한다.",
  "새벽 입항을 닫는다.",
  "대낮 수송을 멈춘다.",
  "저녁 도하를 막는다.",
  "심야 봉화를 줄인다.",
] as const;

function exactDistinctFact(charCount: number, serial: number): string {
  const id = String(serial).padStart(3, "0");
  const place = CLOSER_PLACES[serial % CLOSER_PLACES.length];
  const rule = CLOSER_RULES[serial % CLOSER_RULES.length];
  const lead = `조항${id} — ${place} 나루는 ${rule}`;
  assert.equal(lead.length, 26, lead);
  const target = charCount - lead.length;
  assert.ok(target >= 0, `${charCount}`);
  const extraLens = CLOSER_EXTRAS.map((line) => line.length);
  let chosen: number[] | null = null;
  let codaLen = 0;
  for (let mask = 0; mask < 1 << CLOSER_EXTRAS.length; mask += 1) {
    let sum = 0;
    const indexes: number[] = [];
    for (let bit = 0; bit < CLOSER_EXTRAS.length; bit += 1) {
      if ((mask & (1 << bit)) === 0) continue;
      sum += extraLens[bit] ?? 0;
      indexes.push(bit);
    }
    const rest = target - sum;
    if (rest === 0 || CODA_BY_LENGTH[rest]) {
      chosen = indexes;
      codaLen = rest;
      break;
    }
  }
  assert.ok(chosen, `no distinct closer for ${charCount}`);
  const coda = codaLen === 0 ? "" : CODA_BY_LENGTH[codaLen];
  assert.equal(coda?.length ?? 0, codaLen);
  const sentence = `${lead}${chosen.map((index) => CLOSER_EXTRAS[index]).join("")}${coda}`;
  assert.equal(sentence.length, charCount, sentence);
  return sentence;
}

function fitDistinctFacts(budget: number): string {
  const lines: string[] = [];
  let index = 0;
  const lengthOf = () => (lines.length === 0 ? 0 : lines.join("\n").length);
  while (index < DETAIL_FACTS.length) {
    const next = DETAIL_FACTS[index] ?? "";
    const added = (lines.length === 0 ? 0 : 1) + next.length;
    if (lengthOf() + added > budget) break;
    lines.push(next);
    index += 1;
  }
  while (lines.length > 0 && budget - lengthOf() < 40) {
    lines.pop();
    index -= 1;
  }
  const body = lines.join("\n");
  const remain = budget - body.length;
  if (remain === 0) return body;
  const separator = body.length === 0 ? "" : "\n";
  const need = remain - separator.length;
  assert.ok(need <= 180, `closer ${need} exceeds the prepared fact bank`);
  const closer = exactDistinctFact(need, index + 1);
  assert.equal(DETAIL_FACTS.includes(closer), false);
  return `${body}${separator}${closer}`;
}

function detailLines(systemPrompt: string): string[] {
  const marker = systemPrompt.indexOf("MARK_NPC");
  const start = systemPrompt.indexOf("\n", marker) + 1;
  const end = systemPrompt.lastIndexOf("\nMARK_TAIL");
  return systemPrompt.slice(start, end).split("\n").filter((line) => line.length > 0);
}

function settingFor(total: number): { world: string; systemPrompt: string; substantive: number } {
  const speech = SPEECH_PERSONALITY.length + SPEECH_TRAITS.length;
  const systemLen = total - WORLD.length - speech;
  const tail = "\nMARK_TAIL";
  const head = `${CORE}\n${REGION}`;
  const detailBudget = systemLen - tail.length - head.length - 1;
  const detail = fitDistinctFacts(detailBudget);
  assert.equal(detail.length, detailBudget);
  const systemPrompt = `${head}\n${detail}${tail}`;
  assert.equal(systemPrompt.length, systemLen);
  const substantive = substantiveAiLearningCharCount({
    world: WORLD,
    systemPrompt,
    speechInput: {
      speech_personality: SPEECH_PERSONALITY,
      speech_traits: SPEECH_TRAITS,
      speech_examples: "",
      speech_forbidden: "",
    },
  });
  assert.equal(substantive, total);
  return { world: WORLD, systemPrompt, substantive };
}

function formBody(systemPrompt: string) {
  return {
    content_kind: "character",
    name: "카엘",
    tagline: "황궁의 방패",
    description: "공개 소개",
    greeting: "성벽 위에서 당신을 내려다본다.",
    system_prompt: systemPrompt,
    world: WORLD,
    speech_personality: SPEECH_PERSONALITY,
    speech_traits: SPEECH_TRAITS,
    speech_examples: "확인했습니다.",
    speech_forbidden: "반말",
    genres: ["로맨스"],
    gender: "male",
    nsfw: false,
    participant_min_age: 28,
    assets: [{ url: "/uploads/test.png", tag: "neutral", representativeRank: 1 }],
  };
}

function historyOf(turns: number): ChatMsg[] {
  const markers: Record<number, string> = {
    0: "MARK_HIST_50 첫 순찰에서 봉인 조각을 같이 줍기로 약속했다.",
    [turns - 30]: "MARK_HIST_30 그때 관계는 아직 경계였고 이름을 부르지 않았다.",
    [turns - 20]: "MARK_HIST_20 원로원 문서는 기사단 예산을 깎는 내용으로 고정되어 있다.",
    [turns - 10]: "MARK_HIST_10 리안은 순찰 기록을 맡는 부관이다.",
    [turns - 5]: "MARK_HIST_5 최근 관계는 경계에서 등으로 바뀌었고 이름을 부른다.",
  };
  const assistant = "카엘은 검을 고쳐 쥐고 다음 보루까지의 거리를 확인했다. ";
  const out: ChatMsg[] = [];
  for (let i = 0; i < turns; i += 1) {
    out.push({ role: "user", content: markers[i] ?? `순찰 ${i + 1}번째 보고를 올렸다.` });
    out.push({ role: "assistant", content: `${assistant.repeat(8)}턴${i + 1}` });
  }
  return out;
}

const MEMORY = {
  longTermMemory: "MARK_LTM 오래 전 요약은 관계를 경계로 적는다. MARK_OLD 사용자는 아직 협력자일 뿐이다.",
  mediumTermMemoryBlock: "MARK_MID 중기 요약은 셋째 보루의 부상병 부족을 남긴다.",
  archiveMemory: "MARK_ARCHIVE 아카이브는 북부 전선에서 주군을 선택한 과거를 보관한다.",
  episodicMemoryBlock: "MARK_EPISODIC 검색된 일화는 봉인 조각을 같이 주운 밤이다.",
  userPersona: "MARK_PERSONA 사용자는 황궁 기록관이고 성별은 지정하지 않는다.",
  userNote: "MARK_NOTE 최신 메모는 관계를 신뢰로 고친다. MARK_NEW 사용자는 이제 등을 맡기는 사이다.",
};

function unslicedChunk(text: string): CharacterChunk[] {
  return [
    {
      id: "audit-unsliced",
      characterId: "audit",
      content: text,
      category: "identity",
      importance: "CRITICAL",
      tokenCount: estimateTokens(text),
      keywords: [],
    },
  ];
}

function assemble(model: (typeof MODELS)[number], chunks: CharacterChunk[], history: ChatMsg[]) {
  return buildContext({
    charName: "카엘",
    chunks,
    userNickname: "기록관",
    userPersona: MEMORY.userPersona,
    userNote: MEMORY.userNote,
    longTermMemory: MEMORY.longTermMemory,
    mediumTermMemoryBlock: MEMORY.mediumTermMemoryBlock,
    archiveMemory: MEMORY.archiveMemory,
    episodicMemoryBlock: MEMORY.episodicMemoryBlock,
    speechPersonality: SPEECH_PERSONALITY,
    speechTraits: SPEECH_TRAITS,
    shortTermHistory: history,
    currentUserMessage: "리안이 셋째 보루에서 무엇을 적고 있나.",
    nsfw: false,
    gender: "male",
    provider: model.provider,
    modelId: model.id,
    completedTurns: 50,
  });
}

describe("character setting expansion readiness (no limit change, no provider)", () => {
  const ten = settingFor(10_000);
  const twelve = settingFor(12_000);
  const fifteen = settingFor(15_000);
  const history = historyOf(50);

  it("keeps the live 10000 authoring ceiling and rejects 12k/15k before any save", () => {
    assert.equal(AUDIT_SCOPE.saveAndChunk, "MEASURED");
    assert.equal(AI_LEARNING_LIMIT, 10_000);
    assert.equal(new Set(DETAIL_FACTS).size, DETAIL_FACTS.length);
    assert.equal(DETAIL_FACTS.some((line) => line.includes("겨울의 보급로는 강이 얼기 전에")), false);
    for (const [length, coda] of Object.entries(CODA_BY_LENGTH)) {
      assert.equal(coda.length, Number(length), coda);
    }
    const lines10 = detailLines(ten.systemPrompt);
    const lines12 = detailLines(twelve.systemPrompt);
    const lines15 = detailLines(fifteen.systemPrompt);
    assert.ok(lines15.length > lines12.length && lines12.length > lines10.length);
    assert.deepEqual(lines10.slice(0, -1), lines12.slice(0, lines10.length - 1));
    assert.deepEqual(lines12.slice(0, -1), lines15.slice(0, lines12.length - 1));
    assert.equal(new Set(lines15).size, lines15.length);
    assert.ok(lines15.every((line) => line.length >= 20));
    const addedAfter10k = lines15.filter((line) => !lines10.includes(line));
    assert.ok(addedAfter10k.length > 10);
    console.log(JSON.stringify({
      detailLineCounts: { ten: lines10.length, twelve: lines12.length, fifteen: lines15.length },
      addedAfter10k: addedAfter10k.length,
      lengthFitClause: {
        ten: lines10[lines10.length - 1],
        twelve: lines12[lines12.length - 1],
        fifteen: lines15[lines15.length - 1],
      },
    }));
    assert.deepEqual(
      MAIN_RP_MODEL_IDS,
      MODELS.map((m) => m.id)
    );
    const accepted = parseCharacterFormBody(formBody(ten.systemPrompt), ADULT);
    assert.equal(accepted.ok, true, accepted.ok ? "" : accepted.error);
    for (const candidate of [twelve, fifteen]) {
      const rejected = parseCharacterFormBody(formBody(candidate.systemPrompt), ADULT);
      assert.equal(rejected.ok, false);
      if (!rejected.ok) {
        assert.match(rejected.error, /10,000자 이하/);
        assert.equal(rejected.status, 400);
      }
    }
  });

  it("the production chunk combiner silently drops everything past 10000 chars", () => {
    for (const candidate of [ten, twelve, fifteen]) {
      const combined = buildCombinedCharacterSettingSource({
        characterId: "audit",
        systemPrompt: candidate.systemPrompt,
        world: candidate.world,
        exampleDialog: "",
        characterName: "카엘",
        gender: "male",
      });
      assert.ok(combined.length <= 10_000, `${candidate.substantive} combined ${combined.length}`);
      assert.match(combined, /MARK_IDENTITY/);
      assert.match(combined, /MARK_BEHAVIOR/);
      const chunks = parseCharacterSetting({
        characterId: "audit",
        systemPrompt: candidate.systemPrompt,
        world: candidate.world,
        exampleDialog: "",
        characterName: "카엘",
        gender: "male",
      });
      const joined = chunks.map((c) => c.content).join("\n");
      assert.equal(joined.includes("MARK_TAIL"), candidate.substantive === 10_000);
    }
    const over = buildCombinedCharacterSettingSource({
      characterId: "audit",
      systemPrompt: fifteen.systemPrompt,
      world: fifteen.world,
      exampleDialog: "",
      characterName: "카엘",
      gender: "male",
    });
    assert.equal(over.includes("MARK_TAIL"), false);
    assert.ok(fifteen.systemPrompt.includes("MARK_TAIL"));
    const dropped = detailLines(fifteen.systemPrompt).filter((line) => !over.includes(line));
    assert.ok(dropped.length > 0);
    assert.equal(dropped.some((line) => line.includes("겨울의 보급로는 강이 얼기 전에")), false);
  });

  it("unsliced test-only assembly injects the whole setting and does not shrink memory or history", () => {
    const rows: Array<Record<string, number | string>> = [];
    let baselineHistory = 0;
    let baselineMemory = "";
    for (const model of MODELS) {
      for (const candidate of [ten, twelve, fifteen]) {
        const built = assemble(model, unslicedChunk(`${candidate.world}\n${candidate.systemPrompt}`), history);
        const system = built.systemPrompt;
        const historyText = built.history.map((m) => m.content).join("\n");
        for (const marker of ["MARK_IDENTITY", "MARK_BEHAVIOR", "MARK_RELATION", "MARK_ABILITY", "MARK_WORLD", "MARK_NPC", "MARK_TAIL"]) {
          assert.ok(system.includes(marker), `${model.id} ${candidate.substantive} missing ${marker}`);
        }
        assert.ok(historyText.includes("MARK_HIST_5"), model.id);
        assert.equal(historyText.includes("MARK_HIST_50"), false, model.id);
        for (const marker of ["MARK_LTM", "MARK_MID", "MARK_ARCHIVE", "MARK_EPISODIC", "MARK_PERSONA", "MARK_NOTE", "MARK_OLD", "MARK_NEW"]) {
          assert.ok(system.includes(marker), `${model.id} missing ${marker}`);
        }
        const memorySig = ["MARK_LTM", "MARK_MID", "MARK_ARCHIVE", "MARK_EPISODIC", "MARK_PERSONA", "MARK_NOTE"]
          .map((m) => system.includes(m))
          .join("");
        if (baselineMemory === "") baselineMemory = memorySig;
        assert.equal(memorySig, baselineMemory);
        if (model === MODELS[0] && candidate === ten) {
          console.log(JSON.stringify({
            scope: AUDIT_SCOPE,
            historyKept: {
              t5: historyText.includes("MARK_HIST_5"),
              t10: historyText.includes("MARK_HIST_10"),
              t20: historyText.includes("MARK_HIST_20"),
              t30: historyText.includes("MARK_HIST_30"),
              t50: historyText.includes("MARK_HIST_50"),
            },
            hist50RawAbsence: AUDIT_SCOPE.fiftyTurnRawAbsence,
            providerRecallAndFinalAnswer: AUDIT_SCOPE.providerRecallAndFinalAnswer,
            summaryStoreReinjection: AUDIT_SCOPE.summaryStoreReinjection,
          }));
        }
        if (baselineHistory === 0) baselineHistory = built.history.length;
        assert.equal(built.history.length, baselineHistory, `${model.id} ${candidate.substantive}`);
        assert.equal(built.meta.memoryCoverage.degraded, false);
        rows.push({
          model: model.id,
          chars: candidate.substantive,
          systemTokens: built.meta.estimatedSystemTokens,
          historyTokens: built.meta.estimatedHistoryTokens,
          inputTokens: built.meta.estimatedInputTokens,
          cacheRulesTokens: estimateTokens(built.openRouterSystemSplit?.systemRulesBlock ?? ""),
          cacheCharacterTokens: estimateTokens(built.openRouterSystemSplit?.characterSettingsBlock ?? ""),
          historyMessages: built.history.length,
        });
      }
    }
    console.table(rows);
    const deepseek = rows.filter((r) => r.model === CHEAPER_INFERENCE_DEEPSEEK_V41_FLASH_MODEL);
    assert.equal(deepseek[0]!.historyTokens, deepseek[1]!.historyTokens);
    assert.equal(deepseek[1]!.historyTokens, deepseek[2]!.historyTokens);
    assert.ok(Number(deepseek[1]!.systemTokens) > Number(deepseek[0]!.systemTokens));
    assert.ok(Number(deepseek[2]!.systemTokens) > Number(deepseek[1]!.systemTokens));
    assert.equal(deepseek[0]!.cacheRulesTokens, deepseek[2]!.cacheRulesTokens);
    assert.ok(Number(deepseek[1]!.cacheCharacterTokens) > Number(deepseek[0]!.cacheCharacterTokens));
    assert.ok(Number(deepseek[2]!.cacheCharacterTokens) > Number(deepseek[1]!.cacheCharacterTokens));
    const maxPayload = resolveMaxPayloadInputTokens(String(deepseek[0]!.model));
    assert.equal(maxPayload, Number.MAX_SAFE_INTEGER);
    assert.equal(AUDIT_SCOPE.maxPayloadSentinel, "LOCAL_ASSEMBLY_GATE_ONLY");
    assert.equal(AUDIT_SCOPE.unslicedAssembly, "MEASURED");
    assert.equal(AUDIT_SCOPE.providerRecallAndFinalAnswer, "NOT_TESTED");
    assert.equal(AUDIT_SCOPE.summaryStoreReinjection, "NOT_TESTED");
    console.log(JSON.stringify({
      maxPayloadSentinel: maxPayload,
      maxPayloadMeaning: AUDIT_SCOPE.maxPayloadSentinel,
      providerContextWindow: "NOT_TESTED",
    }));
    assert.equal(HISTORY_TOKEN_BUDGET, 10_000);
  });

  it("layered canon, not the live default, is the only owner that can leave detail uninjected", () => {
    const compiled = compileCanonPlanV1({ creatorRawDescription: `${fifteen.world}\n${fifteen.systemPrompt}`, now: "2026-01-01T00:00:00.000Z" });
    assert.equal(compiled.ok, true);
    if (!compiled.ok) return;
    const metrics = canonCoreInflationMetrics(compiled.plan);
    const matched = selectActiveCanonChunks({ plan: compiled.plan, userMessage: "리안이 셋째 보루에서 무엇을 적고 있나." });
    const unmatched = selectActiveCanonChunks({ plan: compiled.plan, userMessage: "오늘 날씨가 어떤가." });
    console.table([{ ...metrics, activeBudget: compiled.plan.retrieval.activeBudgetChars, matchedActive: matched.activeChunks.length, unmatchedActive: unmatched.activeChunks.length }]);
    assert.equal(compiled.plan.retrieval.activeBudgetChars, 1200);
    assert.ok(metrics.dormantChunks > 0);
    assert.ok(metrics.coreChars < metrics.totalChars);
    assert.equal(matched.activeChunks.length, 0);
    assert.equal(unmatched.activeChunks.length, 0);
  });

  it("keyword lorebook already injects NPC detail only when the scan text matches", () => {
    const entries: KeywordLorebookEntry[] = [
      {
        keywords: ["리안"],
        content: "MARK_LORE_NPC 리안은 순찰 기록을 맡는 부관이다.",
      },
    ];
    assert.deepEqual(matchKeywordLorebookEntries(entries, "리안이 기록을 쓴다."), [entries[0]!.content]);
    assert.deepEqual(matchKeywordLorebookEntries(entries, "오늘 날씨가 어떤가."), []);
  });
});
