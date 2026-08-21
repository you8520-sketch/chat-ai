/**
 * Production-realistic temporal QA for any future pre-GM classifier.
 *
 * `previousScene` contains only state known before the current action. It never
 * asserts the current action's resolved injury/condition. This is intentionally
 * separate from RESOLVED_OUTCOME_SYNTHETIC_QA.
 */
import type { TrpgActionType } from "../src/lib/trpg/actionTypes";
import type { TrpgSuccessTier } from "../src/lib/trpg/types";

export const PRE_GM_RUNTIME_QA = [
  {
    id: "PRE_A1_enemy_ready",
    previousScene: "무장한 적이 검을 들고 복도 입구를 지키며 반격할 태세다.",
    action: "적에게 근접 공격을 시도한다.",
    actionType: "attack",
    tier: "FAILURE",
  },
  {
    id: "PRE_A2_gunfight",
    previousScene: "적의 총격이 이어지고 낮은 콘크리트 엄폐물이 앞에 있다.",
    action: "엄폐물 뒤로 몸을 숨긴다.",
    actionType: "defend",
    tier: "FAILURE",
  },
  {
    id: "PRE_A3_unstable_floor",
    previousScene: "금이 간 바닥 아래로 어두운 공간이 보이지만 아직 무너지지는 않았다.",
    action: "금이 간 바닥을 뛰어 건넌다.",
    actionType: "free",
    tier: "SEVERE_FAILURE",
  },
  {
    id: "PRE_A4_armed_trap",
    previousScene: "압력판과 쇠뇌 장치가 연결된 함정이 작동 대기 상태다.",
    action: "압력판을 해제한다.",
    actionType: "investigate",
    tier: "FAILURE",
  },
  {
    id: "PRE_C1_venomous_snake",
    previousScene: "맹독성 독사가 몸을 웅크리고 공격할 태세다.",
    action: "독사의 공격을 피한다.",
    actionType: "defend",
    tier: "FAILURE",
  },
  {
    id: "PRE_C2_toxic_tank",
    previousScene: "금이 간 화학 탱크가 흔들리지만 아직 누출 여부는 확인되지 않았다.",
    action: "탱크 옆 통로를 빠르게 통과한다.",
    actionType: "free",
    tier: "FAILURE",
  },
  {
    id: "PRE_D1_existing_poison_treatment",
    previousScene: "렌은 이전 라운드부터 중독 상태이며 강이현은 해독제를 가지고 있다.",
    action: "렌에게 해독제를 투여한다.",
    actionType: "use_item",
    tier: "SUCCESS",
  },
  {
    id: "PRE_E1_partial_attack",
    previousScene: "두 전투원이 서로 거리를 재며 공격 기회를 노린다.",
    action: "적을 창으로 밀어낸다.",
    actionType: "attack",
    tier: "PARTIAL_SUCCESS",
  },
  {
    id: "PRE_F1_uncertain_symptom",
    previousScene: "강이현은 이유를 알 수 없는 가벼운 어지럼증을 느낀다.",
    action: "증상의 원인을 확인한다.",
    actionType: "investigate",
    tier: "FAILURE",
  },
  {
    id: "PRE_SAFE1_quiet_room",
    previousScene: "적과 함정이 없는 조용한 자료실에 먼지 낀 서랍이 놓여 있다.",
    action: "서랍에서 단서를 찾는다.",
    actionType: "investigate",
    tier: "FAILURE",
  },
] satisfies Array<{
  id: string;
  previousScene: string;
  action: string;
  actionType: TrpgActionType;
  tier: TrpgSuccessTier;
}>;

if (import.meta.url === `file://${process.argv[1]}`) {
  console.log(
    JSON.stringify(
      {
        QA_TIMING_MODEL: "PRE_GM_RUNTIME_QA",
        REFEREE_SCENE_SOURCE: "previousNarration",
        CURRENT_GM_RESULT_AVAILABLE_TO_REFEREE: false,
        fixtures: PRE_GM_RUNTIME_QA,
      },
      null,
      2
    )
  );
}
