# DeepSeek 자동진행 분량 미달 원인 감사

조사 기록이다. Production prompt, routing, billing, runtime code는 바꾸지 않았다. PR #1329, #1335, #1339와 #1288, #1294, #1296, #1299는 수정하지 않았다. 유료 모델 호출은 하지 않았다. 문체 점수는 매기지 않는다.

기준 커밋은 `origin/main` `7e93ea666c0ee6a4bf9e04877fbf0dd8e3e65f3a`이다. 장면 지시 owner는 이 커밋에 포함된 #1342 머지와 같다.

## BEFORE

배포 후 검증 두 출력은 같은 production 자동진행 경로다. 라이크, 페르소나 렌, NORMAL, DeepSeek V4.1 Flash, 창가 직전 비트, `finishReason=stop`.

| 원문 | 커밋 고정 링크 | sha256 | 원문 글자 | 표시 글자 |
|---|---|---|---:|---:|
| SCENE-DIRECTIVE-1 | [b22cb677](https://github.com/you8520-sketch/chat-ai/blob/b22cb67714b8b3e1ff52be33d84d5b44e74d4d09/docs/reviews/phase3d/raw/SCENE-DIRECTIVE-1.txt) | `1be0cc0500b1a7771480ea93ef9f8e690faabb8d397660abc9e9ac04c82c4f75` | 3,202 | 3,202 |
| SCENE-DIRECTIVE-2 | [b22cb677](https://github.com/you8520-sketch/chat-ai/blob/b22cb67714b8b3e1ff52be33d84d5b44e74d4d09/docs/reviews/phase3d/raw/SCENE-DIRECTIVE-2.txt) | `395304f23e7940ac3e9537fc0caaafca8769ad7ac9ea286cf28cfd10b4ac1140` | 4,186 | 4,186 |
| POST-MERGE-1 | [9c7867b0](https://github.com/you8520-sketch/chat-ai/blob/9c7867b0b4f3ca9e2c71b10aa8cd24ad33454861/docs/reviews/deepseek-auto-scene-quality/raw/POST-MERGE-1.txt) | `1677662c7a260240d9838268eb2a3108e6e8bb4557c45ac97d14def03af1bc61` | 3,149 | 3,149 |
| POST-MERGE-2 | [9c7867b0](https://github.com/you8520-sketch/chat-ai/blob/9c7867b0b4f3ca9e2c71b10aa8cd24ad33454861/docs/reviews/deepseek-auto-scene-quality/raw/POST-MERGE-2.txt) | `ccffaad06c747e4af8d971740ba6cf9fafca87077c851f787d33310d22ebf474` | 2,932 | 2,932 |

표시 글자는 `visibleAssistantDisplayCharCount` (`src/lib/chatDisplayLength.ts`)다. 네 원문 모두 원문 글자와 같다. HTML·태그 후처리로 줄어든 표시 분량은 없다.

공급업체 completion tokens: SCENE-DIRECTIVE-1 2,567 / SCENE-DIRECTIVE-2 3,482 / POST-MERGE-1 2,354 / POST-MERGE-2 2,253. 같은 모델이 3,482 토큰까지 끝난 기록이 있으므로 이번 2,253–2,354는 숨은 `max_tokens` 상한의 결과가 아니다.

## PROBLEM

한국어 3,200자 이상이 기본 목표다. POST-MERGE-1은 51자, POST-MERGE-2는 268자 미달이다. 둘 다 `stop`으로 정상 종료했다.

이 사실만으로 코드 결함을 단정하지 않는다. 같은 길이 owner와 같은 호출 조건에서 이전 두 원문은 3,202자와 4,186자였다.

길이 달성과 장면 실체는 갈라진다.

- SCENE-DIRECTIVE-1은 목표를 2자 넘겼고, 윤태건과 이름 없는 가이드 여성을 방 안에 들였다.
- SCENE-DIRECTIVE-2는 4,186자까지 갔고, 직전 턴의 이마·하품·`졸려`와 유리·창 묘사를 겹쳤다.
- POST-MERGE-1은 3,149자이고, 방 안 새 인물은 없다. 창가에서 돌아서 말하고, 사이렌을 듣고, 국수집으로 나가자는 제안까지 이동한 뒤 문고리에서 닫힌다.
- POST-MERGE-2는 2,932자이고, 방 안 새 인물은 없다. 창가에 머무르며 비를 보고, 렌의 이름을 다시 묻는다.

짧은 두 편이 더 빈약한 장면이라고 단정하지 않는다. 1편은 이전의 긴 감각 반복보다 장면 이동이 크다. 점수는 매기지 않는다.

## OWNER MAP

현재 `origin/main`의 라이브 owner다. 과거 PR 파일명으로 대체하지 않았다.

| 책임 | 라이브 owner | 이번 경로 |
|---|---|---|
| 숫자 길이 지시 | `USER_TAIL_LENGTH_OWNER_SENTENCE` (`src/lib/responseLength.ts`) | 현재 유저 턴 맨 아래 1회. 시스템 블록은 비어 있다. `appendCompactTerminalLengthToUserTurn`이 마지막에 붙인다 |
| 목표 값 | `UNIFIED_TIER_AIM_CHARS=3200` (`src/lib/responseLengthConstants.ts`) | soft aim. 상한 없음. 정확 3,200이나 3,200–3,500 밴드가 아니다 |
| 내부 바닥 | `UNIFIED_TIER_MIN_CHARS=2700` | 프롬프트에 넣지 않는다. 저장 실패 기준이 아니다 |
| 출력 토큰 | `resolveMaxOutputTokensForTarget`, `resolveOpenRouterMaxTokens` | 항상 `undefined`. 최종 요청에 `max_tokens` 없음 |
| 스트림 글자 상한 | `resolveNarrativeStreamCharCap`, `clampResponseLength` | 상한 없음. clamp는 `trim`만 한다 |
| 1-pass 정책 | `TURN_LENGTH_SUPPLEMENT_API_ENABLED=false` (`src/lib/turnApiBudget.ts`) | recovery, 이어쓰기, server 85% 보강 전부 OFF |
| 정상 종료 미달 | `detectAdultGenerationFailure` | recovery OFF이면 재앙적 짧은 응답(80자)만 실패. 3,200 미달은 실패가 아니다 |
| 85% 서버 보강 | `needsServerUnderLengthRecovery` | 바닥 2,720. cheaperinference는 `allowOpenRouterUnderLengthRecovery: false`. 플래그도 OFF |
| 장면 계약 | `renderSceneDirectiveForPrompt` | MICRO, 환경 변화, 기존 NPC 없음, 새 인물 없음 |
| 공용 문체 | `COMMON_PROSE_BLOCK` | 이번 조사에서 수정하지 않는다 |
| DeepSeek 길이 adapter | `resolveDeepSeekLengthAdapterSection` | `deepseek-v4-pro`이고 arm B/C일 때만. `deepseek-v4.1-flash`에서는 null |
| 과금 | 실제 출력 토큰 | 분량 미달로 재호출하거나 가산하지 않는다 |

길이 문장:

> 이번 응답은 한국어 3,200자 이상을 기본 목표로 하나의 충분히 전개된 장면으로 작성한다. 장면과 사용자 요청에 필요한 만큼 자연스럽게 더 길게 이어간다. 현재 상호작용을 요약하거나 성급히 닫지 말고, [AI_CAST]/NPC/환경의 관찰·심리·판단·행동·대화·감각 변화를 먼저 깊게 전개한다. [B]의 새 직접 대사·중요 선택·중대 행동을 분량 채우기용으로 만들지 않는다.

MICRO 본문:

> 현재 상호작용 안에서 작은 관계·감각·환경 변화 하나를 조용히 이어간다. 새 인물·별도 사건은 만들지 않는다.

두 문장은 한 요청에 같이 있다. 길이 문장은 감각·심리 확장을 깊이 쓰라고 하고, 장면 계약은 새 사건과 새 인물을 막는다. 이 병치는 확인된다. 그 병치가 2,932자와 3,149자의 단일 원인이라고 보지 않는다. 같은 병치에서 3,202자와 4,186자도 나왔다.

## ROOT CAUSE

분류: `ROOT_CAUSE_UNCONFIRMED`

코드 결함으로 증명한 항목은 없다. 확인한 것은 다음이다.

1. 길이 지시는 빠지지 않았다. 유저 턴 마지막에 한 번 있다.
2. DeepSeek 최종 요청은 `max_tokens`를 보내지 않는다. `temperature` 0.92, `top_p` 0.92, `stream` true, `thinking.disabled`, `reasoning_effort=none`.
3. 스트림은 `stop`으로 끝났다. 토큰 상한 잘림이 아니다. 네 원문 모두 완결 문장으로 끝난다.
4. 생성 글자와 표시 글자는 같다. 후처리가 분량을 줄이지 않았다.
5. 정상 종료 후 3,200 미달은 저장 실패도, 재호출도, 이어쓰기도 아니다. 단일 호출 정책이 그 경로를 끈다.
6. 내부 바닥 2,700과 서버 85% 바닥 2,720보다 두 새 원문이 길다. recovery가 켜져 있어도 이 두 편은 보강 대상이 아니다.
7. Flash 길이 adapter는 이 경로에 없다.

따라서 “2회가 3,200에 못 미쳤다”와 “길이 owner가 깨졌다”는 다른 주장이다. 모델이 목표 문장을 보고도 그 전에 `stop`한 이유는 이 네 편만으로 고립되지 않는다. #1342가 시스템 토큰을 줄인 사실과 출력 글자 감소를 인과로 묶지 않는다.

## PROPOSED DESIGN

Production 변경 없음.

새 공용 문체 문장, DeepSeek 전용 길이 문장, 자동 이어쓰기, 유료 재호출은 기본 해결책이 아니다. 단일 호출과 3,200+ soft aim과 장면 계약을 유지한다.

원인 미확인 상태에서 길이 문장을 더 세게 쓰거나 MICRO를 푸는 수정은 하지 않는다.

## REGRESSION RISKS

구현이 없으므로 새 회귀는 없다. 가설 수정을 나중에 검토할 때의 위험만 적는다.

- 이어쓰기나 recovery를 다시 켜면 단일 호출 정책과 과금이 깨진다.
- 길이 문장에 감각 목록을 더하면 SCENE-DIRECTIVE-2형 반복이 다시 커질 수 있다.
- MICRO를 풀어 분량을 채우면 새 NPC·사건 회귀가 난다.
- 공용 문체를 손대면 #1288, #1294, #1296, #1299와 같은 owner를 중복 편집한다.

## PROOF

결정적 측정은 네 원문과 현재 main 함수다.

| 검사 | POST-MERGE-1 | POST-MERGE-2 |
|---|---|---|
| `visibleAssistantDisplayCharCount` | 3,149 | 2,932 |
| 원문 − 표시 | 0 | 0 |
| `isCatastrophicallyShortResponse` | false | false |
| `detectAdultGenerationFailure("stop")` | null | null |
| `needsUnderLengthRecovery` | false | false |
| `needsServerUnderLengthRecovery` | false | false |
| `isBelowResponseTarget` (내부 min 2,700) | false | false |
| `endsAtCompleteSentence` | true | true |

조립 회귀는 기존 `src/lib/responseLength.canonicalPolicy.test.ts`가 모든 Main RP 모델과 자동진행·재생성 장면에서 길이 문장 1회와 `max_tokens` 미전송을 잠근다. `src/lib/responseLength.recovery.test.ts`는 1-pass를 잠근다. `src/lib/autoProgressionSceneContract.test.ts`는 조용한 1:1, 기존 NPC, 트리거 도착을 잠근다.

이번 PR의 `src/lib/responseLength.postMergeShortfall.test.ts`는 기록된 글자 수를 위 게이트에 다시 통과시킨다. 원문 전체를 복제하지 않는다.

## TOKEN DELTA

0. 프롬프트와 캐시 prefix를 바꾸지 않았다.

## FOLLOW-UP

- GPT가 네 원문 전체를 읽고 문체와 장면 실체를 판단한다.
- #1288은 이미 길이 owner의 재료 목록을 장면 비트 계약으로 바꾸자고 한다. 같은 문장을 여기서 다시 고치지 않는다.
- #1294, #1296, #1299는 공용 문체의 반복 습관을 다룬다. 분량 강제 수정이 아니다.
- DeepSeek `v4-pro` 길이 adapter는 호출되지 않는다. 정리 후보다. 삭제하지 않았다.
- `isBelowResponseTarget`는 정의만 있고 다른 런타임 호출이 없다. 정리 후보다.
- 추가 유료 호출은 승인 8회가 소진되어 하지 않는다.

## CLASSIFICATION

`ROOT_CAUSE_UNCONFIRMED`

구현하지 않았다. Draft를 유지하고 자동 머지하지 않는다.
