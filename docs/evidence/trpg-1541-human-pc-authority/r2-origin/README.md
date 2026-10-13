# #1541 R2 — 인간 PC 비제출 직접 대사 최초 발생 원인 추적

추적 이슈: https://github.com/you8520-sketch/chat-ai/issues/1541

사실과 원문 위치만 기록한다. 품질 점수·판정은 하지 않는다(GPT 원문 평가 대기).
**코드는 수정하지 않았다. PR은 없다.** docs-only 증거 브랜치다.

## 1. 결론

원인 미확정. 코드 변경 없음, PR 없음, STOP.

- 구조 감사(무료): R2 최종 입력에 소유자 충돌·중복·우선순위 역전으로 볼 만한 단일 지점을 특정하지 못했다.
- 유료 재현 1회(b1, R2 원본 입력 byte 동일): 현의 직접 대사 0회. 원본 R2의 현 직접 대사는 이 1회 샘플에서 재현되지 않았다.
- 따라서 "문구를 바꾸면 해결된다"는 전제를 지지하는 증거가 없다. 일부 샘플에서만 성공하는 문구는 개선이 아니다.

## 2. 소유자 지도 (현재 main `3b553c6c`)

| 책임 | 소유자 | 확인한 사실 |
| --- | --- | --- |
| 인간 행동 생성·저장·수집 | `engineAdvance.ts` `submitTrpgAction` + `canonicalAttempt.ts` | 인간 canonical attempt는 제출 원문 그대로다. 공백 정규화만 한다. AI canonical은 봇 의도 파싱이고, 봇 연출 prose(대사 포함)는 별도 필드다. |
| 인간 PC 권한 | `gmPrompt.ts` ROUND CRAFT 2 | 유일한 권한 문장. 테스트(`gmPrompt.test.ts`, `gmPromptLengthConsolidation.test.ts`, `trpgHumanPcAgencyTrustBoundary.test.ts`)가 문구를 고정한다. |
| `[PLAYER PERSONAS]` | `hostPersona.ts` `formatTrpgPlayerPersonaBlock` | 이름·호칭·설정. `[말투 예시]`는 설정에 있을 때만 포함된다. 헤더는 "portray these human PCs as written. Do not invent a different identity." R2 입력에는 말투 예시가 없었다. |
| `[RECENT ROUNDS — RAW]` | `memory.ts` | `  이름: 행동` 다음 `  GM: narration` 형태로 직전 GM 원문을 그대로 넣는다. 화자 라벨 줄과 같은 모양이다. |
| `[RESOLUTION ORDER]` | `initiative.ts` `formatResolutionOrderBlock` | "Do not add actions a player did not declare."가 이미 있다. R2 실제 입력에도 있었다. |
| `[CHECK]` | `gmPrompt.ts` | 행위자별 `no_check reason=talk — spoken words occur; listener/world response is still GM-owned`. |
| GM 호출·소비 | `gmCall.ts` `buildTrpgGmProviderRequest` / `callTrpgGm`, `engineAdvance.ts` `runGmForRound` | `TRPG_GM_SYSTEM` + `buildTrpgGmUserBlock` 한 번의 호출. recovery/재작성 경로 없음. 출력은 structured JSON `{narration, delta}`의 narration을 그대로 저장. |

## 3. 라운드별 인간 PC 직접 대사 (원본 `docs/evidence/trpg-1541-real-play/live/raw/*`)

| 라운드 | 현(인간) 제출 | GM 원문의 현 직접 대사 | 비고 |
| --- | --- | --- | --- |
| R0 | 도입 | 0 | |
| R1 | 일행에게 알리는 행동 | 0 | GM이 "현이 조용히 손짓하여 일행에게 알린" 식으로 제출 행동을 몸짓으로 중계했다. 직접 대사 아님. |
| R2 | 소란 틈에 빠져나가 몰래 뒤따라간다(꼬리 추적만 제출) | 1(긴 직접 대사) | 최초 발생. 제출 대사 없음. |
| R3 | 열쇠로 문을 열고 서류함을 확인 | 0 | 표정·몸짓 등 비제출 행동은 있음. |
| R4 | 낮은 목소리로 캐묻는다 | 1 | 제출된 질문 + 비제출 위협 문장. R2 대사가 `[RECENT ROUNDS — RAW]`에 선례로 들어 있었다. |

렌(인간)의 talk 체크가 현에게 번졌는지: R1·R2에서 GM이 렌의 talk에 대해 렌 직접 대사를 쓰지 않았다. 렌의 `spoken words occur` 문구가 현으로 누출됐다는 증거는 없다.

파티 합류 장면에서는 GM이 매 라운드 AI 동료의 대사를 쓴다(허용된 AI 동료 대사 구조). 이 반복이 모델의 일반적 서사 완결 경향을 만들 수 있으나, 현 대사 발생과의 인과는 이 증거로 분리되지 않는다.

## 4. 이전 보고 재활용 (#1461·#1462, 변경 없이 인용)

- `docs/audits/trpg-1452-paid-gm-evidence.md`, `docs/audits/trpg-1462-paid-gm-reverify.md`(각 브랜치 `cursor/trpg-1452-gm-evidence-9d27`, `cursor/trpg-1462-paid-evidence-9d27`).
- 당시 문구 억제는 4건 중 2건에서 제출된 발화 자체를 누락시켰다(과억제). 이 티켓의 불변조건(제출된 인간 대사는 반영)과 충돌한다.

## 5. 유료 재현 b1 (R2 원본 입력, 코드 변경 없음)

- 입력: `live/wire/call-07-gm-r2-provider-request.json`의 system/user. system sha256 `b329d0a1…03b6a0`, user sha256 `7da81bf3…75e02f`(원본과 동일).
- 호출 1회, 재시도·모델 대체 없음, fetch 가드(허용 1회). `gemini-3.8-flash`, `max_tokens` 16,384(증거 하네스).
- 결과: 현 직접 대사 0. 꼬리 추적 실패는 서술문으로 처리되었고 서하가 일행에게 상황을 전달했다. finish `stop`, 입력 9,509 / 출력 3,950 토큰, narration 5,040자, 약 20.7 KRW.
- 파일: `calls/b1-r2-before/b1-r2-before-{system.txt,raw.txt,narration.txt,call.json,provider-request.json}`, 원장 `spend-ledger.json`, 하네스 `replay-r2.ts`.
- 이번 티켓 유료 사용: GM 1회 / 최대 4회, 약 20.7 KRW / 1,000 KRW 미만. 나머지 3회는 사용하지 않았다.

## 6. 선택지 비교 (구조 후보, 적용 안 함)

| 안 | 내용 | 증거 상태 |
| --- | --- | --- |
| S1 | ROUND CRAFT 2에 제출 발화의 실현 범위와 비제출 대사 금지를 서술 | 이전 티켓 v1/v2에서 일부 샘플만 성공, 일부 제출 발화 누락. 지지 증거 없음 |
| S2 | `Allowed speaker lines` 줄 삭제 또는 병합 | 단독 효과를 R2 입력에서 분리하지 못함 |
| S3 | `[RECENT ROUNDS — RAW]`의 과거 GM 원문 변형 | 기억·연속성 손상 위험. 금지 방향 |
| S4 | 사후 정규식 제거 / 별도 AI 검열 호출 | 티켓에서 금지 |
| S5 | 변경 없음, 증거 추가 후 재판단 | 현재 선택 |

단일 샘플 재현 실패(b1)로는 R2의 원인 가설을 구체화할 수 없다. 추가 유료 호출은 중복 실험이 되거나 부분 성공 문구를 만들 위험이 있어 하지 않았다.

## 7. 남은 위험 (관찰 사실)

- 이전 티켓의 v2 실험 한 샘플에서 모델이 `"`를 이스케이프하지 않아 structured JSON narration이 중간에서 끊겼다(2,463자). 문구 실험 시 별도로 관찰해야 하는 위험이다.
- 프로덕션 `[말투 예시]` 경로는 이번 R2 입력에 없어 검증하지 못했다.
