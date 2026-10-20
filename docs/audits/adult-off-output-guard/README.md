# 성인 OFF 독립 출력 검사 — 방식 선택, 한계, 비용, 지연

상태: **Draft. 기본 OFF(`ADULT_OFF_OUTPUT_GUARD_ENABLED` 미설정 = 검사 없음).** 운영에 활성화하지 않았다. 이 문서의 수치는 GPT 검수용 근거이며, 활성화·병합·배포는 검수 후 결정한다.

외부 근거로 받은 감사 `26183635`는 `gh`에서 404로 열리지 않아 확인하지 못했다. 이 작업은 현재 `main`(a11da88c, #1668 병합 후) 코드를 직접 읽은 결과에 근거한다.

## 1. 방식 선택

| 후보 | 판단 | 근거 |
| --- | --- | --- |
| 기존 키워드/정규식 라우팅(`adultSceneRouting`, 거절 탐지) | 부적합 | 금칙어 방식이며 "키스·포옹 단어를 보면 차단"으로 정상 로맨스를 해친다. 요구사항이 금지한 방식이다. |
| 기존 댓글 moderation / vision moderation | 부적합 | 짧은 댓글·이미지용이며 장문 RP의 맥락 판정 입력이 아니다. |
| OpenAI `omni-moderation-latest` | 부적합 | 무료지만 성적 항목이 `sexual` 하나뿐이고 점수는 임계값을 직접 보정해야 하는 신호다. 키스·설렘 허용/성행위 과정 제한 경계를 표현하지 못한다. 별도 `OPENAI_API_KEY`가 필요하다. (공식 문서: https://platform.openai.com/docs/guides/moderation) |
| 생성 모델 자체 "SAFE" 선언 | 독립 검사 아님 | 검사 대상이 스스로 통과를 선언하는 구조다. 본문 안의 선언은 판정 데이터로만 취급한다. |
| **독립 LLM 독립 LLM 분류기(`gpt-6-luna`, CheaperInference, 후보·구간마다 호출)** | 채택 | Main RP 모델과 호출·컨텍스트를 공유하지 않는다. 장면 맥락 기준(허용/제한 목록)을 프롬프트로 직접 정의할 수 있다. 이미 운영 키(`CHEAPER_INFERENCE_API_KEY`)와 단가 감사가 있는 모델이다. |

분류기 계약: 엄격 `json_schema`(`decision`/`category`/`confidence`/`first_paragraph`). 파서는 정확히 이 네 키만 받는다. `allow`는 `category=none`·`first_paragraph=-1`이어야 하고 `restrict`는 `category≠none`·`first_paragraph≥0`이어야 한다. 모순, 스키마 밖 필드, 비JSON은 **승인이 아니라 검사 실패**다. `allow`라도 `confidence=low`이면 승인하지 않고 `check_failed(low_confidence_allow)`로 끝낸다(재호출 없음). 본문은 `<reply_under_review>` 태그 안에 넣고 본문 속 닫는 태그는 무력화한다. 36,000자 초과 본문은 2,000자 겹치는 구간으로 나눠 모든 구간을 검사한다.

필요한 키: 추가 키 없음. 기존 `CHEAPER_INFERENCE_API_KEY`.

## 2. 검사 순서와 전달 차단 경로 (성인 OFF Main RP, `effectiveAdultRp=false`)

생성 → 검사 → 전달 순서를 다음과 같이 정리했다. 검사 호출 수를 늘린 것이 아니라 "마지막으로 사용자에게 전달·저장되는 텍스트"에 승인을 묶었다.

1. **공급자 거절**: 후처리·검사 전에 `failMainRpTurn`으로 종료한다(#1668과 동일, `model_refusal`). 분류기는 호출하지 않는다.
2. **A 단계(`pre_postprocess`)**: 공급자 원문(`result.text`)과 스트림 표시본(`streamVisibleText`)을 검사한다. 승인되면 두 텍스트를 보류 장치의 승인 집합에 넣는다.
3. 이후 후처리(어휘 재작성, 분량 보강, HTML 카드/flash 정규화, 문단 서식)가 본문을 바꿀 수 있다.
4. **F 단계(`final`)**: 저장·정산 직전, 최종 저장 텍스트(HTML 포함)가 **이미 검사한 문자열과 정확히 같을 때만** 승인을 재사용한다(분류기 호출 0). 공백 차이, 삭제, 치환, 삽입은 재사용하지 않고 그 최종 문자열을 다시 검사한다. `그는 동의한 것이 아니었다.`의 승인으로 `그는 동의한 것이었다.`를 보내지 않는다. `release` 이후에도 다른 본문은 통과하지 않는다. 본문 차단이 확정되면 상태창 추출 같은 유료 후처리는 시작하지 않는다. 이미 발생한 호출의 원장은 유지하고, 미확정 비용을 0으로 적지 않는다.
5. HTML/flash 전용 턴(`htmlFlashOnlyTurn`)은 더 이상 검사 대상에서 빠지지 않는다. 공급자 호출이 없어도 최종 본문(HTML 안 텍스트 포함)은 F 단계에서 검사된다.

### 보류 장치 (`createAdultOffOutputHold`)

- 검사 전에는 이벤트 종류와 상관없이 본문 필드(`text`·`delta`·`content`·`finalContent`·`html`·`body` 등)를 가진 이벤트를 모두 보류한다. `{type:"status", text:"..."}`도 보류된다.
- 통과하는 것은 본문 필드가 없는 닫힌 집합뿐이다: 고정 상태 문구 7개(`생성 중…` 등), 키 허용 목록을 만족하는 `stream_heartbeat`·`turn_persisted`·`phase_latency_audit`·`reset`·`error`. 중첩 객체 안의 본문 키도 검사한다.
- 승인된 문자열과 정확히 같은 `replace`만 통과한다. `release` 뒤에도 다른 본문 문자열은 보류된다. 폐기(`discard`) 후에는 본문이 전달되지 않는다.
- 상태창 값, 추천 답장, 상태 메타 카드에 보이는 생성 문자열은 같은 출력 검사로 승인된 뒤에만 SSE·DB·메시지 API·해당 폴링에 남긴다. 기억용 `extracted_facts`와 관계 원문은 검사 범위가 아니다. 보조 결과만 제한되거나 검사에 실패하면 그 결과만 비우고, 이미 승인된 본문의 정산은 바꾸지 않는다. 동기 보조 검사의 호출 수와 지연은 `usage.adultOffGuard`의 단계 기록에 남고, 저장 시점의 비동기 검사는 같은 moderation 원장 행에 남는다. 자동 재추출·재작성은 하지 않는다.
- 부분 저장 타이머, 실패 저장(`markAssistantFailed`), 바깥 `catch`의 부분 저장, 캔 서버 메시지 경로는 모두 승인된 본문만 저장한다(`adultOffBodyMayPersist`/`adultOffPersistable`).
- 같은 `requestId`의 완료 재전송은 Main RP를 다시 호출하지 않고 포인트를 다시 차감하지 않는다. 저장된 usage의 `approvedTextHashes`가 그 본문과 정확히 같을 때만 분류 없이 다시 보낸다. `finalStatus`만으로는 승인으로 보지 않는다. 해시가 없으면 기존 분류기로 그 본문을 한 번 검사하고, 승인이면 해시를 usage에 더한다. 제한·검사 실패면 SSE에는 본문을 싣지 않으며 저장 상태와 기존 정산은 바꾸지 않는다.
- 재생성 `done`은 이전 variant 본문을 이번 승인과 구분한다. 이번 본문, 또는 그 variant usage의 해시로 증명된 이전 본문만 SSE에 남긴다. 증명되지 않은 이전 본문은 승인 집합에 넣지 않고 SSE에서 비운다. 메시지 API는 저장된 alternate를 그대로 읽는다.
- 차단(`adult_output_blocked`)·검사 실패(`adult_output_check_failed`)·공급자 거절(`model_refusal`)은 #1668의 공통 실패 경로(`failMainRpTurn`)로 합류한다: 본문 빈 문자열, 공급자 실비 `failed_with_usage` 1행 유지, `requestedPoints:0` `waived` 정산 1회, 후속 유료 호출 없음, 자동 재시도 없음, 같은 `requestId` 재전송 시 공급자 호출 0회. 사용자 청구 정책은 바꾸지 않았다.

### 분류 호출 횟수는 조건부다

"항상 1회"가 아니다. 호출 수 = Σ(검사 단계별 후보 수 × 36,000자 구간 수). 원문과 표시본이 다르면 후보가 둘, 36,000자를 넘으면 구간이 늘고, F 단계에서 본문이 바뀌었으면 한 번 더 검사한다. 호출 수와 검사별 결과는 `usage.adultOffGuard`에 기록한다. 출력 상한은 추가하지 않았다.

### 원장·usage 연결

- 분류기 호출은 기존 `ledgerContext`로 chat·assistant message·generation request·generation sequence를 연결한다(family `background`, 원가 센터 `moderation`, 요청 종류 `adult-off-output-moderation`). 어드민 턴 원가 집계 family는 바꾸지 않았고 `request_kind`로 조회한다.
- 공급자 요청 ID와 usage는 성공뿐 아니라 HTTP 오류(응답 헤더 ID, `failed_without_usage`), 타임아웃, 응답 JSON 파싱 실패(헤더 ID 보존), 분류 출력 파싱 실패(이미 발생한 원가·토큰이 `settled`로 남음)에서도 보존한다.
- 승인된 턴에도 검사 결과·호출 수·검사 시간·분류 원가·낮은 확신 여부를 `usage.adultOffGuard`(내부 전용)에 남긴다. 공개 영수증과 메시지 API 응답에서는 제거된다(`publicUsageEconomicsBoundary`).
- 재시도·백필·별도 타이머는 없다.

## 3. 검증 — 두 종류를 구분한다

### 3.1 합성 공급자 응답 + 분류기 스텁 (노출·저장·정산 경로)

`src/lib/adultOffOutputGuard.test.ts`(순수 로직), `src/lib/adultOffOutputGuard.production.test.ts`(실제 `POST /api/chat` 핸들러 12건), `src/lib/adultOffGuardEvidence.test.ts`(증거 해석 규칙). 모두 CI 워크플로 `validate-adult-off-output-guard.yml`에서 실행된다. 제한 판정은 본문 표식으로 결정하는 스텁이다.

- 차단·검사 실패(HTTP 503, 비JSON, 모순 출력, allow+first_paragraph, 스키마 밖 필드, 낮은 확신 allow, 타임아웃, 응답 본문 읽기 실패): SSE 화면 본문 빈 문자열, 검사 중 DB 어시스턴트 본문 `""`, 메시지 API 200/JSON `content` 빈 문자열, 잔액 불변, `waived` 정산, `main-rp` 원장 1행 `failed_with_usage`, 상태창·추천 호출 0건, 재시도 없음, 재전송 시 공급자 호출 0회.
- 승인: 분류기 호출 시점에 DB 본문이 비어 있고, 승인 후 SSE 재구성 화면 본문 = 저장 본문 = 메시지 API JSON `content`. 승인 전 화면은 빈 본문, 승인 후는 정상 본문(replace/delta/finalContent 의미로 재구성).
- 어휘 재작성이 본문을 바꾼 턴: 재작성본이 승인되지 않으면 차단되고(재작성본은 SSE·저장 어디에도 없음), 통과하면 재검사 후 전달된다.
- HTML flash 전용 턴: 미승인 HTML 본문은 차단되고 승인된 HTML만 전달된다.
- 분류기 호출은 chat·assistant message·generation request·sequence와 실제 공급자 요청 ID가 원장 행에 연결된다. 실패 유형별로 ID·토큰·원가가 보존된다.
- 공급자 거절은 분류기를 호출하지 않고 `model_refusal`을 유지한다. 검사 OFF는 분류기를 호출하지 않는다.

**이 검증은 분류 정확도를 증명하지 않는다.** 스텁은 표식 문자열만 본다.

### 3.2 실제 분류기 소형 프로브 (`live/classifier-probe.json`)

가상의 성인 인물만 쓴 15개 라벨 샘플(정상 로맨스 7, 제한 8). 긴 대사, 인용, 은유, 문단 경계(약 9천 자 앞부분 뒤), 과거 대화 혼합, 신체 단어가 나오는 비성적 장면, 검수 우회 문구 2종을 포함한다. 미성년 인물의 성적 시험문은 만들지 않았다.

| 항목 | 결과 |
| --- | --- |
| 정상 로맨스 허용 | 7/7 (경계 사례인 한 줄 장면 전환 1건 포함) |
| 제한 판정 | 8/8 (우회 문구 2건 포함) |
| 낮은 확신 때문에 차단되는 정상 로맨스 | 0/7 (모두 `high`). 표본이 작아 비율 추정이 아니다 |
| 분류기 1회 비용 | 0.10~0.83원, 평균 0.19원 (환율 1,360.27원/USD, 카드 수수료 포함) |
| 분류기 지연 | 중앙값 약 6.9초, 최대 9.3초 |
| 프로브 총비용 | 약 2.78원 |

**한계: 표본이 15개이고 제한 샘플은 비노골 서술이라 쉬운 편이다. 위 수치는 정확도가 아니라 동작 경향이다.** 불확실성(`low` 확신) 때문에 정상 로맨스가 막히는 실제 비율은 **미측정**이다. 활성화 전 관찰에서는 `usage.adultOffGuard.lowConfidenceAllow`와 `finalStatus=check_failed`를 별도로 집계해야 한다.

## 4. 15+ 품질 실측 재해석 (네 활성 Main RP 모델 × 1회)

기존 실측 응답을 그대로 재사용했다. 이번 보완에서는 공급자를 추가 호출하지 않았다. `scripts/adult-off-guard-reanalyze.ts`가 `live/*.json`을 오프라인으로 다시 계산해 `live/reanalysis.json`을 만든다.

**표본의 성격**: 네 원문은 장면 `relationship_turn_safe`, 즉 **"밤에 머무는 로맨스 대화"** 표본이다. 키스·포옹 생성을 검증한 것이 아니고, 제한 수위 본문을 요청하지도 않았다. 네 건 모두 정상 로맨스이므로 "정상 로맨스 4/4 허용, 분류기 `confidence=high`, 엄격 파서 재평가 통과" 이상의 의미는 없다. 미탐은 측정하지 못했다.

실측 당시의 검사는 이번 보완 이전 구현이다(최종 텍스트 F 단계, `usage.adultOffGuard` 기록 없음). 네 파일의 `recordedDecision`이 모두 `null`인 이유다. 보완 이후 구현은 합성 회귀로만 검증했다.

### 4.1 화면 본문·메시지 API 증거 정정

- 기존 JSON의 `sseText`는 `replace` 본문과 `done.finalContent`를 **단순 연결**한 값이다(길이가 저장 본문의 약 2배: 8,472 = 4,212 + 4,260). 화면 본문으로 쓸 수 없다. replace는 본문을 대체하고 `done.finalContent`는 최종 본문으로 대체하므로, 재구성한 화면 본문은 네 건 모두 저장 본문과 문자열이 같다(4,260 / 3,915 / 3,080 / 2,402자).
- 승인 전 화면 본문은 네 건 모두 0자였고(첫 본문 이벤트는 분류 완료 직후), 승인 후에 정상 본문이 한 번에 나타났다.
- 기존 `messageApiContainsPersisted:false`는 **유효한 증거가 아니다**. HTTP 상태와 JSON을 저장하지 않았고 원문 앞 40자를 JSON 텍스트에서 찾는 방식이라 이스케이프된 줄바꿈·따옴표 때문에 `false`가 나올 수 있다. 네 건 모두 "메시지 API 일치 여부 미검증"이다. 이후 실행용 스크립트는 HTTP 상태, JSON 파싱, `content`와 저장 본문 비교를 기록하도록 고쳤다(실행하지 않음). 합성 회귀가 같은 비교를 수행한다.

### 4.2 지연 (중복 합산 없음)

공급자 시간과 분류기 시간은 직렬이고 겹치지 않는다. 나머지는 요청 수신·준비·후처리·저장 시간이다.

| 모델 | 전체 | 공급자 | 분류기 | 나머지 | 분류기/전체 |
| --- | --- | --- | --- | --- | --- |
| Gemini 3.8 Flash | 42.7초 | 34.7초 | 6.9초 | 1.1초 | 16.1% |
| GPT-6.1 Sol | 71.5초 | 62.4초 | 7.6초 | 1.5초 | 10.7% |
| Claude Opus 5.5 | 66.5초 | 53.7초 | 10.9초 | 1.9초 | 16.3% |
| Gemini 4 Argon | 37.9초 | 30.0초 | 6.9초 | 1.0초 | 18.1% |

이전 문서의 "공급자 생성 시간의 12~23%"는 분류기/공급자 비율이었다. 전체 완료 시간 기준 추가 비율은 위 표와 같다. 단일 구간(36,000자 이하)·단일 후보 기준이다.

### 4.3 비용: 확정·추정·미확정

| 모델 | 확정(원) | 추정(원) | 미확정 |
| --- | --- | --- | --- |
| Gemini 3.8 Flash | 8.92 (분류기 + 본 호출) | 0 | 후속 호출 1건 `started` |
| GPT-6.1 Sol | 0.38 (분류기) | 71.85 (본 호출, usage×카탈로그 단가) | 후속 호출 1건 `started` |
| Claude Opus 5.5 | 0.33 (분류기) | 280.79 (본 호출, usage×카탈로그 단가) | 후속 호출 1건 `started` |
| Gemini 4 Argon | 46.8 (분류기 + 본 호출) | 0 | 후속 호출 1건 `started` |

- 확정 합계 약 56.4원, 추정 합계 약 352.6원, 합계 약 409원. 이전 약 62원과 분류기 프로브 약 2.78원을 더하면 확인 가능한 누적은 약 473.8원이다.
- **미확정 4건은 복구하지 않는다.** 오늘 자료의 호출은 청구 ID가 응답에 남아 있는 분류기 19건(프로브 15건의 `usage.providerRequestId` + 실측 4건의 분류기 `request_id`)과, 장부가 `started`인 채로 삭제되어 청구 ID와 최종 비용이 파일에 없는 4건이다. 그 4건의 스냅샷 `request_kind`는 `background-post-turn-shared-initial`이었지만 `provider_request_id`와 응답 본문은 저장되지 않았다. 시간적으로 가깝다는 이유만으로 이 4건을 완료된 Shared Initial 호출에 붙이지 않는다. 기존 자료로 그 ID를 복구할 수 없다.
- 그 4건의 원가는 0이 아니라 **알 수 없다**. 누적 473.8원에는 포함되어 있지 않다. 호출당 원가는 같은 모델 분류기 호출(0.29~0.43원)보다 클 수 있어 수치로 추정하지 않았고, 1,000원 한도 여유(약 526원) 대비 작은 값이라는 정성적 판단만 둔다.
- 다음 실측부터 `scripts/adult-off-guard-live-measure.ts`는 fetch를 시작한 순간부터 기록하고, 채팅 턴의 기존 후속 tail(`listOpenTurnTailWork`)이 끝낸 공급자 호출과 장부 마감(`started`가 아닌 상태)을 확인한 뒤에만 성공으로 저장한다. 타임아웃·헤더/본문 읽기 실패·미마감 장부이면 불완전 실행으로 남기고 장부를 지우지 않는다. 청구 ID는 `readCompatibleCompletionProviderRequestId`만 쓰며 completion id로 대체하지 않는다. null/unavailable 비용은 0원으로 합산하지 않고, 확정된 후속 호출 비용은 합계에 포함한다. 이 보완은 유료 호출 없이 mock으로 검증했다. 판정·프롬프트·모델·활성화 플래그는 바꾸지 않았다.
- Sol·Opus의 본 호출 원가는 공급자가 보고하지 않아(`completed_without_exact_cost`) 추정이다. 공급자 청구서와 다를 수 있다.

### 4.4 기타 관찰

- 원문 글자 수는 모델 출력 그대로다. Opus(3,006)와 Argon(2,376)은 3200 소프트 목표에 못 미쳤다. 출력 목표·상한은 바꾸지 않았다.
- 사용자에게는 분류 완료 직후 본문이 한 번에 도착했다(첫 본문 이벤트가 분류 완료 후 1~2ms).

## 5. 전체 테스트(`npm run test:regular`) 비교

기준 SHA `a11da88c`(#1668 병합 직후)와 출력 검사 보완 SHA `2dd29a6e`를 같은 머신에서 **순차 실행**(동시 부하 없음, 기준은 별도 worktree)했다. 그 비교 이후의 Luna 후속 호출 증거 보존은 이 표에 들어 있지 않다. 그 변경은 유료 호출 없는 `adultOffGuardLiveCapture.test.ts`와 `route.singleCallInvariant.test.ts`로 확인했다. 전체 스위트는 `main`에서도 녹색이 아니다.

| 실행 | 실패 리프 테스트 | 이 중 `SQLITE_BUSY*` | `SQLITE_BUSY*` 제외 |
| --- | --- | --- | --- |
| 기준 `a11da88c` | 294 | 31 | 263 |
| 브랜치 1회차(`d631f0d7` + 실행 중 시험 파일 수정) | 283 | 19 | 264 |
| 브랜치 2회차(정확히 `2dd29a6e`) | 324 | 62 | 262 |

- `SQLITE_BUSY*` 제외 실패 중 **세 실행에 공통인 것이 260건**이다. 기준에 이미 있는 실패이며 이 변경과 무관한 기존 실패(`vitest` 미설치 import, 과금·길이 단언 불일치 등)다.
- 실행마다 달라지는 것은 주로 `SQLITE_BUSY`(`database is locked`) 실패 건수다(31 / 19 / 62). 같은 SHA의 브랜치 두 실행에서도 건수가 다르다. 오류 코드로 분류한 근거이며, 재실행 통과만으로 "부하" 때문이라고 단정한 것이 아니다. 그래도 어떤 테스트가 어떤 잠금 충돌을 일으키는지는 규명하지 않았다.
- **브랜치에만 나타난 실패** (기준에는 없음):
  - `SQLITE_BUSY*`: `CheaperInference DeepSeek V4 Flash billing`(1·2회차 모두), `PR #174 follow-up — save / delete / provenance` 일부(1·2회차 모두, 번호는 회차마다 다름). 기준에서도 같은 파일의 다른 하위 시험(`7.`, `8.`)이 같은 오류로 실패했다.
  - `ERR_ASSERTION`: 2회차에만 `investigationDiscovery.s3`의 `eligible investigation rules…`, `streamRevealConcurrent`의 `C6: background bypass…`(타이머 의존). 1회차에는 없었다. 이 변경이 건드린 코드(채팅 라우트, 분류기, 공급자 호출 헬퍼)와 직접 관련이 없고, 원인은 **규명하지 못했다**.
- **기준에만 나타난 실패**: `regenerate keeps committed facts…`(2회 모두), `PR-S3 home live investigation path` 등(1회).
- 위 두 목록에 나온 시험 파일 8개를 기준·브랜치 각각 단독으로 2회씩 실행하면 전부 통과했다(8개 파일 합계 `pass 114 / fail 0`, 4회). 이는 파일 단독 실행에서는 재현되지 않는다는 사실만 보여주며, 전체 실행 실패의 원인 규명이 아니다.
- 이 변경이 새로 추가·수정한 시험(`adultOffOutputGuard.test.ts`, `adultOffOutputGuard.production.test.ts`, `adultOffGuardEvidence.test.ts`)과 건드린 공유 코드의 기존 시험(`openRouterCompletion*`, `auxProviderProvenance`, `publicUsageEconomicsBoundary`, `mainRpStrictFailure`, `refusalZeroCharge*`, `providerNativeRefusal`, `turnApiBudget`, `mainRpStartupDeadline`, `route.singleCallInvariant`)은 전체 실행 두 번 모두 통과했고 단독 실행에서도 통과했다.
- 이 비교는 부하 영향을 분리하는 설계가 아니다. 완전한 해소를 위해서는 시험 파일별 DB 격리 또는 `--test-concurrency=1` 실행으로 같은 비교를 다시 해야 한다(FOLLOW-UP, 이번 변경 범위 밖).

## 6. 남은 한계 (보호 완료가 아니다)

- **기본 OFF**: 활성화 전에는 보호가 없다. 활성화·병합·배포는 GPT 재검수 후 결정한다.
- **스트리밍 상실**: 성인 OFF 방에서 사용자는 전체 생성과 분류가 끝날 때까지 본문을 보지 못한다. 먼저 스트리밍하고 나중에 지우는 방식 금지에 따른 구조적 비용이다.
- **추가 지연·비용**: 분류 호출은 턴마다 직렬로 더해지며 후보·구간 수에 비례한다. 최종 본문이 이미 검사한 문자열과 다르면 F 단계 호출이 1회 더해지고, 그때의 호출 수와 지연은 `usage.adultOffGuard`에 남는다. 정확히 같으면 F 단계 분류 호출은 0이다. 동기 상태창·추천 답장·상태 메타도 아직 승인 집합에 없는 문자열마다 같은 기록을 남긴다. 저장 이후의 비동기 추천 답장·상태 메타 검사는 턴 usage가 이미 저장된 뒤라 그 JSON의 합계에 다시 더해지지 않고, moderation 원장 행의 호출·지연·원가로 남는다. HTML 카드 턴은 F 단계 검사가 추가된다. 차단·검사 실패 턴은 사용자 0P이므로 공급자 실비와 분류 비용이 운영 부담이다.
- **보조 출력 검사의 범위**: 사용자에게 보이는 상태창 값, 추천 답장 문장, 상태 메타 카드 문자열만 검사한다. 기억용 `extracted_facts`와 관계 원문은 포함하지 않는다. 보조 결과만 제한·검사 실패면 그 결과만 비우고 본문 정산은 유지한다. `usage.adultOffGuard.finalStatus`는 본문 단계(`pre_postprocess`·`final`)만 본다.
- **본문 차단 이후의 유료 호출**: 본문 차단이 확정된 뒤에는 상태창 추출을 시작하지 않는다. 본문이 먼저 승인된 뒤 상태창 추출이 본문을 바꾸고, 그 변경 본문이 F에서 차단되면 이미 발생한 상태창 호출의 원장은 남는다. 분량 보강·flash 단계의 추가 호출 원가는 F 차단 턴에서 개별 원장 행으로 분리되지 않는다(기존 strict 실패와 동일).
- **승인 재사용**: 검사한 문자열과 전달 문자열이 같을 때만 재사용한다. 공백 차이도 재사용하지 않는다. 재전송이 그 일치를 다시 알 수 있도록 usage에는 본문 대신 SHA-256만 남긴다. 별도의 정규화는 두지 않았다.
- **저장된 기록의 읽기**: 메시지 API와 채팅 화면은 이미 저장된 alternate 본문을 그대로 돌려준다. 이번 수정은 재전송 SSE와 재생성 `done`만 닫는다. 과거 저장분을 모든 읽기 경로에서 거르려면 메시지 API 계약을 바꿔야 하므로 하지 않았다.
- **숫자 상태창 미러**: `RP_NUMERIC_STATE_ENABLED`가 켜져 저장 후 상태창 문자열이 바뀌면, SSE를 보내기 전에 그 차이만 기존 분류기로 다시 본다. 플래그 기본값은 꺼짐이다. 이미 원장에 기록된 숫자 전이는 되돌리지 않는다.
- **HTML 원문 전송**: HTML 본문은 태그를 포함한 원문 그대로 분류기에 전달된다.
- **어휘 재작성은 현재 단일 호출 불변식 하에서 사실상 실행되지 않는다**(`TurnApiBudget`이 막는다. 합성 회귀는 예산 값을 시험 안에서만 패치해 경로를 실행). 코드는 유지하고 F 단계가 덮는다. 정리는 **FOLLOW-UP**(기록만 하고 이번 변경에서는 삭제하지 않음).
- **낮은 확신**: `allow`+`low`는 미승인(검사 실패)이다. 정상 로맨스가 이 때문에 막히는 비율은 미측정이다.
- **이전 감사 수치**: 635.11원/697.11원 견적은 재현하지 못했다.
