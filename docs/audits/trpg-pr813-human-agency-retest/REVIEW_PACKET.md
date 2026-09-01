# PR #813 Human PC Agency — Real Provider Retest

Main: `80140cf8afc59de38d849eb9323e7ccdf32ea3fb` | PR head: `92c55996828eb1612e07785d5db50afcfb1187a6`

## Scope
- Opening: seeded from #812 (0 provider calls)
- Real calls: Bot1 → Bot2 → GM normal (3 only)

HUMAN_SUBMITTED_TEXT = `주변을 살피며 두 동료에게 조용히 따라오라는 손짓을 한다.`

## GM user block authority verify
- humanAuthoritativeLabelCount = 1
- humanActorKindCount = 1
- aiActorKindCount = 2
- aiVisibleProseLabelCount = 1

## Bot cross-PC claims (RAW prose)
BOT1_CROSS_PC_CONTAMINATION_PRESENT = true
- bot_1 [`human_follow_context`] `렌의 뒤를 조용히 엄호하듯 바짝 따르` — …비교 분석하겠습니다. 가장 안전하고 빠른 경로를 먼저 도출해 안내하겠습니다." 강이현은 렌의 뒤를 조용히 엄호하듯 바짝 따르며, 데이터 패드의 감지 센서를 양쪽 통로 방향으로 겨누어 상세 수치를 기록하기 시작했다.…
BOT2_CROSS_PC_CONTAMINATION_PRESENT = true
- bot_2 [`human_movement_match`] `렌의 움직임에 맞춰` — …뭐가 튀어나오든 내가 먼저 벤다." 그는 강이현이 패드를 두드리며 경로를 가늠하는 사이, 렌의 움직임에 맞춰 전방의 시야를 확보하며 언제든 마체테를 휘두를 수 있도록 날을 비스듬히 세웠다.…

## GM human agency facts
GM_HUMAN_ROUTE_CHOICE_INVENTED = false
GM_HUMAN_MOVEMENT_INVENTED = true
- [`human_steps`] `렌이 주변의 흔들리는 안개와 균사 줄기를 재빨리 훑으며 두 동료에게 낮게 수신호를 보냈다. 묵직한 마체테를 비스듬히 세운 권태현이 그 신호에 맞춰 한 발 앞서 전방의 사각지대를 막아섰고, 뒤따른 강이현의 데이터 패드 센서가 빠르게 주변 환경 데이터를 갈무리했다. 셋의 호흡은 불필요한 지체 없이 맞물려, 짙어지는 포자 안개 속에서도 일행은 단숨에 검문소 중앙 통로 바로 앞의 엄폐물 뒤편까지 은밀하고 안정적으로 전진` — …렌이 주변의 흔들리는 안개와 균사 줄기를 재빨리 훑으며 두 동료에게 낮게 수신호를 보냈다. 묵직한 마체테를 비스듬히 세운 권태현이 그 신호에 맞춰 한 발 앞서 전방의 사각지대를 막아섰고, 뒤따른 강이현의 데이터 패드 센서가 빠르게 주변 환경 데이터를 갈무리했다. 셋의 호흡은 불필요한 지체 없이 맞물려, 짙어지는 포자 안개 속에서도 일행은 단숨에 검문소 중앙 통로 바로 앞의 엄폐물 뒤편까지 은밀하고 안정적으로 전진하는 데 성공했다. 주변을 둘러싼 공기는 점점 더 무겁게 짓눌려 오고 있었다. 깨진 검문소…
- [`human_advance_success`] `전진하는 데 성공했다` — …속에서도 일행은 단숨에 검문소 중앙 통로 바로 앞의 엄폐물 뒤편까지 은밀하고 안정적으로 전진하는 데 성공했다. 주변을 둘러싼 공기는 점점 더 무겁게 짓눌려 오고 있었다. 깨진 검문소 유리창 틈새로…
GM_HUMAN_DIALOGUE_INVENTED = false
GM_HUMAN_DECISION_INVENTED = false

## AI action preservation
- BOT1_OWN_ACTION_RESOLVED = true
- BOT2_OWN_ACTION_RESOLVED = true
- BOT_SEQUENTIAL_COOPERATION_PRESERVED = true
- BOT_CROSS_PC_CONTAMINATION_PROMOTED_TO_GM_CANON = true

## Contracts
- REAL_PROVIDER_CALLS = 3
- GM_FINISH_REASON = stop
- GM_SEMANTIC_DONE = true
- TRUNCATION_OBSERVED = false
- NARRATOR_FORMAL_POLITE_MATCHES = 0
- PRODUCTION_CODE_CHANGED_AFTER_RETEST = false