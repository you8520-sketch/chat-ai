/**
 * Muse Compact Semantic State — admin-only internal scene context block.
 *
 * Not assistant-role history. Not dialogue. Concept-validation fixture for
 * character 17 / persona 1 lounge checkpoint (PRESERVED facts only).
 * Not a production generalization composer.
 */

export const MUSE_COMPACT_SCENE_STATE_SECTION_ID = "rule-muse-compact-scene-state";

/**
 * Hand-authored admin canary fixture from chat-103 pre-msg-1530 PRESERVED state.
 * Source-grounded only; no ADDED facts; no dialogue quotations.
 */
export const MUSE_COMPACT_SCENE_STATE_BENCHMARK_FIXTURE =
  "[CURRENT SCENE STATE]\n" +
  "장소·시간대: 에이지스 본관 2층 휴게 라운지. 자동 차 추출기 앞. 정기 매칭 평가 기간의 본관 동선 이후 도착한 현재 장면이다.\n" +
  "현재 참여자와 위치: 서강우(코드네임 플러드, S급 수계 센티넬)와 신입 가이드 렌이 추출기 앞에 함께 있다. 둘은 복도에서 처음 마주친 뒤 동행해 계단으로 올라왔다.\n" +
  "최근 확인된 행동: 복도 충돌 직후 서강우가 물을 공중에 고정했다가 컵에 되돌렸다. 평가 종료를 알리고 가이드 등록 방향을 안내했다. A급 윤태건(스태틱)과 B급 게일이 지나갔다. 서강우는 2층 라운지에서 차를 제안했고, 자동 추출기가 우려낸다고 설명한 뒤 버튼을 눌러 가져다줄 수 있다고 했다.\n" +
  "관계 상태: 첫 만남. 렌은 직설적이고 편안한 태도로 대화·동행을 이어 갔고, 서강우는 평소보다 말을 늘리며 머뭇거리면서도 자리를 떠나지 않았다.\n" +
  "현재 목표·우려: 서강우는 렌이 고른 차에 맞춰 추출기에서 음료를 건네려 한다. 손수 다도를 하지 않는 환경에서 ‘만들어준다’는 기대를 버튼 조작으로 맞추려 한다.\n" +
  "unresolved tension: 렌의 차 취향이 아직 선택되지 않았다. 신입 가이드와 S급의 어색한 첫 동행·차 제안이 열려 있다.\n" +
  "사용 가능한 현재 장면 요소: 자동 차 추출기, 달콤한 종류·씁쓸한 찻잎·과일 향 티 메뉴, 다과·창가 자리, 식은 종이컵, 렌의 숲·과일 체향.\n" +
  "이 블록은 내부 장면 컨텍스트이며 대사로 복창하지 말 것.";

export const MUSE_COMPACT_SCENE_STATE_BLOCK = MUSE_COMPACT_SCENE_STATE_BENCHMARK_FIXTURE;
