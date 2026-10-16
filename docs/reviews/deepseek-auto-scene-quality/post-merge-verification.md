# 배포 후 자동진행 품질 검증

PR #1342 머지 이후의 실측 기록이다. 이 커밋은 문서를 추가한다. Production prompt, routing, billing, runtime code는 바꾸지 않았다. PR #1329와 #1335의 상태는 그대로다. 문체 점수는 매기지 않는다. 개선율이나 인과는 확정하지 않는다.

## 배포 commit

Railway 프로젝트 `enchanting-ambition`, 서비스 `chat-ai`의 현재 SUCCESS 배포는 `d29360fb-c49a-4125-9c3f-ed88e654c774`이다. 시각은 `2026-10-02T09:57:39.052Z`, 브랜치 `main`, 커밋 `7e93ea666c0ee6a4bf9e04877fbf0dd8e3e65f3a`이다.

PR #1342 머지 커밋 `39b1d7a2c15f57cb51703f91b7f37d840c40645c`의 배포 `c8e869b1-a01b-462a-a7c8-b919788d6866`는 SUCCESS였고, 위 배포가 대체한 뒤 상태는 REMOVED다. `39b1d7a2`는 `7e93ea66`의 조상이다. 그 사이 커밋은 재무 정산 fixture다. `39b1d7a2..7e93ea66`에서 장면 지시, continue 명령, CORE ROLE, context builder, 길이 owner, 공용 문체, chat route, 공급 요청 조립, 공개 단가 파일의 diff는 비어 있다.

## 장면 지시 모드

서비스 변수 `SCENE_DIRECTIVE_V2_MODE`의 값은 `shadow`다. 다른 변수 값은 읽지 않았다. Living 장면 지시 변수 이름은 이 서비스에 없다.

`shadow`에서는 V2 블록을 주입하지 않는다. DeepSeek V4.1 Flash는 Living 모델 허용 목록 밖이다. 이번 조립의 owner는 `legacy_v1`이다. V2와 Living에 넣은 표식 문자열은 최종 블록에 없다. 헤더 `[이번 턴 장면 지시 - 비공개]`는 시스템 프롬프트와 공급 요청 본문에 각 1회다.

## 최종 요청 조립

배포 라이크 fixture (`id=18`, sourceHash `295f4d8ae3dc8391`), 페르소나 렌, DeepSeek V4.1 Flash, 빈 장기 기억, 직전 비트 `창문 쪽에 같이 서 있자.` / `라이크는 유리에 이마를 기대며 하품했다.` · `졸려. 너는 그대로 있어.` 로 `buildContext`와 `assemblePrimaryRpRequest`를 다시 탔다. 로컬 프로세스에는 `SCENE_DIRECTIVE_V2_MODE=shadow`를 넣었다. 테스트용 짧은 정본은 쓰지 않았다.

정본 `character-core-identity`는 9,474자, sha256 `0ff7d8b8157b2add40d40da018b4ca500cc72370a281584dfe01683c444cc323`이다. `36/M` 1회, `36/남` 0회다. 한국어 청크를 썼다.

모션 `MICRO_MOTION`, 전개 축 `environment`, cast `single_primary`. NPC grounding은 `existingNpcEligible: false`, `newNpcAllowed: false`, eligible actor 없음, sources `none`이다.

렌더된 장면 지시는 한 블록이다.

```
[PRIVATE SCENE ENGINE RULE]
현재 상호작용 안에서 작은 관계·감각·환경 변화 하나를 조용히 이어간다. 새 인물·별도 사건은 만들지 않는다.
전개는 항상 전투나 대형 위기일 필요가 없다. 현재 모드와 유저 조종 범위를 따르고, 이 규칙을 본문에 언급하지 않는다.
[이번 턴 장면 지시 - 비공개]
모드: 자동진행
정체 감지: 없음
권장 강도: 1
전개 필요: MICRO
허용된 변화: 환경 변화
기존 NPC 행동: 없음
새 인물 도입: 없음
전개 방향: 환경 변화
피할 것: 갑작스러운 납치, 대형 전투, 위기 남발, 괜찮냐는 반복, 이미 지난 설명 반복
다음 장면 힌트: 주변 환경의 작은 변화가 다음 대화의 방향을 자연스럽게 열어 준다.
직접 발화 중심: 라이크. 메인 캐릭터와 유저의 현재 상호작용을 이어가며, 그 밖의 인물과 세계 정보는 서술·메시지·환경 변화로 통합한다.
유저 조종: 유저 캐릭터 [B]의 대사·행동·내면·불가역 운명 범위는 USER AUTHORING owner를 그대로 따른다. 이 scene directive가 권한을 추가하거나 축소하지 않는다.
트리거된 사건 지시가 있으면 이번 턴 장면 지시보다 우선한다.
```

삭제한 충돌 문장은 시스템 프롬프트와 현재 유저 턴에 다시 없다.

- `여러 AI 캐릭터와 NPC의 대화·판단·갈등·협력·적대 세력의 움직임과 세계 사건은 적극적으로 진행한다`
- `전개는 현재 중심 인물 하나에 고정되지 않는다`
- `Multiple AI-controlled characters may speak and act`
- `Advance through [AI_CAST], NPCs`
- `Advance [AI_CAST]/NPC/environment/world proactively`

CORE ROLE `현재 장면에 적합한 AI 담당 인물과 세계가 능동적으로 진행한다`는 캐시 rules 쪽에 남아 있다. 이번 턴 장면 블록 안에는 없다. 역할 능력 문장과 이번 턴 실행 계약은 서로 다른 구간이다.

`[COMMON PROSE]` 1회. 현재 유저 턴의 `3,200자` 1회. 표시 문자열 `자동진행`은 모델에 보내는 유저 턴에 없다.

### NORMAL

프로덕션 SQLite의 `chats` 행은 이 환경에서 읽지 못했다. 기존 진단 API가 그 컬럼을 돌려주지 않고, 새 진단 경로는 만들지 않았다. 조립에 넣은 위임은 #1329 호출과 같은 객체이며, `capabilitiesFromUserAuthoringLevel("NORMAL")`과 같다.

- `allowDialogue: true`
- `allowMajorActions: true`
- `allowInnerPov: false`
- `allowIrreversibleFate: false`
- source `chat_setting`, duration `persistent`

최종 시스템에 `외부에서 관찰 가능한 행동`이 있다. 라이브 컬럼 `user_authoring_level` / `auto_progression_authoring_level` / `user_coauthor_mode`의 현재 값은 이번 검증에서 확인하지 못했다.

## 시스템 토큰

`estimateTokens`는 글자 수 × 0.9이다. 공급업체 토큰이 아니다. 수정 전 숫자는 #1342 이전 같은 fixture 재조립이다.

| 항목 | 수정 전 | 수정 후 |
|---|---:|---:|
| 시스템 | 16,192 | 16,015 |
| 조립 총량 | 17,224 | 16,813 |
| 현재 유저 턴 | 962 | 728 |
| 장면 지시 | 710 | 532 |
| 캐시 rules | 4,034 | 4,034 |
| 캐시 character | 9,738 | 9,738 |
| 캐시 dynamic | 2,418 | 2,241 |

공용 문체 599, 길이 문장 189, CORE ROLE 222는 수정 전과 같다.

## 호출 조건

PR #1325 리뷰의 상한은 전체 8회다. 그 중 4회는 CONTROL-1, CONTROL-2, CANDIDATE-1, CANDIDATE-2다. PR #1329 리뷰가 남은 예산에서 2회를 허용했고, SCENE-DIRECTIVE-1과 SCENE-DIRECTIVE-2가 그 2회다. #1335, #1339, #1342는 추가 유료 호출이 없다. 잔여 2회를 이번 검증에서 사용했다. 이 8회 예산은 이제 소진됐다.

공급 경로는 `https://api.cheaperinference.com/v1/chat/completions`이다. 와이어 스칼라는 `model=deepseek-v4.1-flash`, `stream=true`, `temperature=0.92`, `top_p=0.92`, `thinking.type=disabled`, `reasoning_effort=none`이다. `1b7813c7..7e93ea66`에서 이 조립과 공개 단가 파일의 커밋은 없다. 공개 단가는 입력 $0.30/M, 출력 $1.20/M, 캐시 읽기 $0.006/M이다.

## 실제 사용량

두 호출 모두 HTTP 경로가 끝나고 `finishReason=stop`, `responseModelId=deepseek-v4.1-flash`, `estimated=false`다. `upstreamCostUsd`, `cheaperInferenceBilledCostUsd`, `cacheDiscountUsd`는 없다. 아래 금액은 공개 단가 추정이며 청구액이 아니다.

| 호출 | 글자 | prompt | completion | cached_tokens | 공개 단가 추정 |
|---|---:|---:|---:|---:|---:|
| POST-MERGE-1 | 3,149 | 12,261 | 2,354 | 0 | $0.006503 |
| POST-MERGE-2 | 2,932 | 12,261 | 2,253 | 11,264 | $0.003070 |

이전 SCENE-DIRECTIVE 두 호출의 prompt는 각 12,466이었다. 이번 prompt는 각 12,261이다. completion reasoning_tokens는 둘 다 0이다.

## 원문

기존 원문은 PR #1329 커밋 `b22cb67714b8b3e1ff52be33d84d5b44e74d4d09`에 있다.

- [SCENE-DIRECTIVE-1.txt](https://github.com/you8520-sketch/chat-ai/blob/b22cb67714b8b3e1ff52be33d84d5b44e74d4d09/docs/reviews/phase3d/raw/SCENE-DIRECTIVE-1.txt) `1be0cc0500b1a7771480ea93ef9f8e690faabb8d397660abc9e9ac04c82c4f75`, 3,202자
- [SCENE-DIRECTIVE-2.txt](https://github.com/you8520-sketch/chat-ai/blob/b22cb67714b8b3e1ff52be33d84d5b44e74d4d09/docs/reviews/phase3d/raw/SCENE-DIRECTIVE-2.txt) `395304f23e7940ac3e9537fc0caaafca8769ad7ac9ea286cf28cfd10b4ac1140`, 4,186자

새 원문 전체는 아래 파일이다. 요약본은 만들지 않았다.

- [POST-MERGE-1.txt](raw/POST-MERGE-1.txt) `1677662c7a260240d9838268eb2a3108e6e8bb4557c45ac97d14def03af1bc61`, 3,149자
- [POST-MERGE-2.txt](raw/POST-MERGE-2.txt) `ccffaad06c747e4af8d971740ba6cf9fafca87077c851f787d33310d22ebf474`, 2,932자

## 관찰

소규모 비교다. 통계적 개선율은 없다.

POST-MERGE-1은 창가의 라이크와 렌을 유지한다. 윤태건 0, 조아인 0, 서진화 0, 여자 0, 제복 0, 가이드 0이다. 방 안에 새 인물이 들어오지 않는다. 렌 10, 라이크 13. 비어 있지 않은 줄 44개 중 따옴표가 있는 줄은 19개다. 하품 0, 졸려 0, 이마 1이다. 첫 문단이 이마를 유리에 붙인 상태를 다시 쓴다. 이어서 저녁 빛, 도시 소리, 바람, 사이렌, 목 밴드, 반지, 국수집으로 나가자는 제안까지 이동한다. 사이렌을 먼 곳의 게이트 쪽으로 말하고, 그 인물은 방 안에 등장하지 않는다. 숙소라는 장소 이름은 두 턴 히스토리에 없고, fixture의 설명 필드에는 있다. `켜졌다 켜졌다`가 한 번 겹친다. 글자 수는 3,200 미만이다.

POST-MERGE-2도 창가의 두 사람을 유지한다. 윤태건 0, 조아인 0, 서진화 0, 여자 0, 제복 0, 가이드 0이다. 렌 4, 라이크 8. 비어 있지 않은 줄 31개 중 따옴표가 있는 줄은 15개다. 하품 0, 졸려 0, 이마 1, 유리 21, 창 14, 빛 8이다. 첫 문장이 유리에 닿은 이마를 다시 쓴다. 하품과 `졸려`는 반복하지 않는다. 렌의 땋은 머리, 에메랄드, 연두 눈은 저장된 페르소나 설명에 있는 표면 특징이다. 출력은 렌의 이름을 다시 묻는다. 부산은 fixture의 system prompt와 setting chunks에 있다. 마지막은 유리에 비가 닿는 환경 변화로 남는다. 글자 수는 3,200 미만이다.

이전 SCENE-DIRECTIVE-1은 윤태건과 이름 없는 젊은 여자가 방 안에 들어왔다. SCENE-DIRECTIVE-2는 그 입장이 없고 하품, 이마, `졸려`, 유리, 창을 겹쳐 4,186자까지 이어졌다. 이번 두 편은 그 방 안 입장이 없고, 하품과 `졸려` 반복도 없다. 이마를 유리에 댄 상태는 두 편 모두 첫머리에 다시 있다. 두 편 모두 3,200자 미만이다. 이 차이를 수정 문장의 효과로 확정하지 않는다.

## 회귀

이번 작업에서 회귀 수정 코드는 추가하지 않았다.

`autoProgressionSceneContract.test.ts`, `autoProgression.prompt.test.ts`, `continueNarrative.autoContinue.test.ts`, `continueNarrative.regenerate.test.ts`는 50개 통과, 0개 실패다. 조용한 1:1, 기존 NPC 행동이 허용된 `single_primary` SCENE_ADVANCE, 트리거된 도착, simulation/party의 앙상블 유지, interactive의 앙상블 부재, continue/regenerate의 NPC 진행 명령 부재가 포함된다.

`sceneDirective.test.ts`의 `[NO FALSE SHARED MEMORY]` 기대 2건과 `sceneDirectiveV2.test.ts`의 `resolve_trigger` 기대 1건(`actual: hold_current_beat`)은 실패했다. #1342 기록에서 같은 실패를 수정 이전 main의 기존 실패로 분류했다. 이번 세션은 수정 이전 트리를 다시 실행하지 않았다. 실패 내용은 장면 지시 렌더에 그 마커가 없고, V2 결정이 `hold_current_beat`라는 점이다. 새 수정은 넣지 않았다.

## 남은 불확실성

- 프로덕션 채팅 행의 서술 권한 컬럼은 읽지 못했다.
- 출력 품질이 좋아졌다는 결론은 없다. 표본은 2회다.
- 두 새 원문 모두 3,200자 미만이다. 길이 문장은 유저 턴에 1회 남아 있다.
- 청구 비용 필드는 응답에 없다. 캐시 읽기는 두 번째 호출의 `cached_tokens` 11,264로만 확인된다.
- CORE ROLE은 캐시 고정 구간에 남아 있다. 이번 턴 계약과 문장은 분리되어 있고, 그 문장을 지우는 실험은 하지 않았다.
- 반복 묘사 수정용 다른 Draft는 건드리지 않았다.

## PR HEAD

이 파일이 들어 있는 PR #1339 HEAD가 검증 커밋이다. Draft를 유지하고 자동 머지하지 않는다.
