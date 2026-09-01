# PR #813 Human PC Agency — Real Provider Retest

Main: `80140cf8afc59de38d849eb9323e7ccdf32ea3fb` | PR head: `f0db4154`

## Scope
- Opening: seeded from #812 (0 provider calls)
- Real calls: Bot1 → Bot2 → GM normal (3 only)

HUMAN_SUBMITTED_TEXT = `주변을 살피며 두 동료에게 조용히 따라오라는 손짓을 한다.`

## GM user block authority verify
- humanAuthoritativeLabelCount = 1
- humanActorKindCount = 1
- aiActorKindCount = 2
- aiAttemptLabelCount = 2
- BOT_PRESENTATION_PROSE_PRESENT_IN_GM_INPUT = false
- BOT_CROSS_PC_CONTAMINATION_PRESENT_IN_GM_INPUT = false

## Bot cross-PC claims (RAW prose)
BOT1_CROSS_PC_CONTAMINATION_PRESENT = true
- bot_1 [`human_movement_verb`] `렌이 나아` — …동 경로상의 기압과 오염 수치를 지속해서 체크하겠습니다." 그는 패드의 간이 스캐너를 켜 렌이 나아가는 방향의 잔류 균사 밀도를 실시간으로 기록하며 신중하게 뒤따랐다.…
BOT2_CROSS_PC_CONTAMINATION_PRESENT = false
- (none)

## GM human agency facts
GM_HUMAN_ROUTE_CHOICE_INVENTED = false
GM_HUMAN_MOVEMENT_INVENTED = true
- [`human_steps`] `렌이 낮게 손짓을 보내자 잿빛 안개 속에서 세 사람의 움직임이 한 호흡으로 맞물려 들었다. 권태현은 묵직한 왼손 마체테를 비스듬히 치켜든 채 지면으로 늘어진 끈적한 균사 덩굴들을 쳐내며 단단한 엄호선을 구축했고, 강이현은 뒤편에서 파랗게 번뜩이는 데이터 패드를 기민하게 조작해 잔해 너머의 환경 수치를 신속히 갱신했다. 발걸음` — …렌이 낮게 손짓을 보내자 잿빛 안개 속에서 세 사람의 움직임이 한 호흡으로 맞물려 들었다. 권태현은 묵직한 왼손 마체테를 비스듬히 치켜든 채 지면으로 늘어진 끈적한 균사 덩굴들을 쳐내며 단단한 엄호선을 구축했고, 강이현은 뒤편에서 파랗게 번뜩이는 데이터 패드를 기민하게 조작해 잔해 너머의 환경 수치를 신속히 갱신했다. 발걸음을 죽인 세 사람의 진입로는 거친 쇳소리나 포자 낭포의 파열 없이 은밀하고 매끄럽게 관리…
GM_HUMAN_DIALOGUE_INVENTED = false
GM_HUMAN_DECISION_INVENTED = false

## AI action preservation
- BOT1_OWN_ACTION_RESOLVED = true
- BOT2_OWN_ACTION_RESOLVED = true
- BOT_SEQUENTIAL_COOPERATION_PRESERVED = true
- BOT_CROSS_PC_CONTAMINATION_PROMOTED_TO_GM_CANON = false
- STRONG_CROSS_PC_STRESS_PROOF = OBSERVED
- HUMAN_AGENCY_REAL_SAMPLE_MOVEMENT = GM_INVENTED_HUMAN_MOVEMENT

## Contracts
- REAL_PROVIDER_CALLS = 3
- GM_FINISH_REASON = stop
- GM_SEMANTIC_DONE = true
- TRUNCATION_OBSERVED = false
- NARRATOR_FORMAL_POLITE_MATCHES = 0
- PRODUCTION_CODE_CHANGED_AFTER_RETEST = false