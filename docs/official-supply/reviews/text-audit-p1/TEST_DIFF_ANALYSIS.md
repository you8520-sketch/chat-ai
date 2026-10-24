# PR #1725 전체 테스트 실패 차이 분석 (main 318 vs PR 342)

결론: 추가 실패는 **이번 diff가 원인이 아닙니다.** 실패는 ① 영속 `data/app.db`를 병렬 프로세스가 함께 쓰는(격리 DB를 쓰지 않는) 테스트 그룹에서 발생하는 `SQLITE_BUSY`와 ② 같은 파일의 누적 데이터 충돌(랜덤 chat id)이며, main에서도 같은 종류의 실패가 다른 파일에서 같은 규모로 발생합니다. 변경된 함수는 이 그룹의 어떤 파일에서도 호출되지 않습니다. 이 결함은 별도 FOLLOW-UP입니다.

## 방법

1. 전체 실행 로그(`npm run test:regular`, PR / clean `origin/main` worktree)의 TAP을 파싱해 실패 leaf 테스트를 파일(`location`)·오류 코드별로 집계했습니다. (Node 요약은 PR 342 / main 318, leaf 집계는 PR 342 / main 326 — 요약은 스위트 단위 실패를 일부 다르게 셉니다.)
2. 파일별 실패 수가 다른 곳만 추려 16개 파일 그룹을 만들었습니다(아래 표).
3. 그룹만 **새 `DATA_DIR`(빈 임시 DB)** 에서 PR·main 양쪽을 같은 조건으로 실행했습니다: 기본 병렬 ×2, `--test-concurrency=1`(직렬) ×1.
4. 인과 확인: 변경된 `compileCreatorDescriptionTriggers` 진입에 호출 기록을 임시 삽입(커밋 안 함)하고 16개 파일을 각각 실행해 호출 횟수를 셌습니다. 대조군(`creatorDescriptionTriggerCompiler.test.ts`)은 18회 호출.

## 전체 실행에서 파일별 실패 수가 다른 곳 (leaf 기준)

| 파일 | PR | main | PR 오류 코드 | main 오류 코드 |
| --- | ---: | ---: | --- | --- |
| knowledgeTransfer.s4VariantProjection | 29 | 0 | SQLITE_BUSY_SNAPSHOT 20, SQLITE_BUSY 9 | — |
| investigationDiscovery.s3 | 9 | 0 | SQLITE_BUSY 8, ERR_ASSERTION 1 | — |
| investigationDiscovery.s3Home | 5 | 0 | SQLITE_BUSY 5 | — |
| personaSecretDiscovery.followup | 2 | 0 | SQLITE_BUSY 2 | — |
| trpg/regenNarrationState | 2 | 0 | ERR_TEST_FAILURE 1, ERR_ASSERTION 1 | — |
| recentChats | 1 | 0 | SQLITE_BUSY 1 | — |
| knowledgeTransfer.s4d | 2 | 12 | SQLITE_BUSY 2 | SQLITE_BUSY 12 |
| personaSecretDesignVerification.integration | 0 | 8 | — | SQLITE_BUSY_SNAPSHOT 5, SQLITE_BUSY 3 |
| chatImageGenerationJobs | 0 | 8 | — | ERR_TEST_FAILURE 7, SQLITE_BUSY 1 |
| worldShares / points.terra / points.reasoning-margin / personaOwnerEditorAccess | 0 | 1씩 | — | SQLITE_BUSY |
| points.muse | 1 | 2 | ERR_ASSERTION 1 | ERR_ASSERTION 1, SQLITE_BUSY 1 |
| memory/memory-branch-noncanon-phase2 | 2 | 3 | ERR_ASSERTION 2 | ERR_ASSERTION 2, SQLITE_BUSY 1 |

나머지 120개 파일은 PR·main 실패 수가 같습니다. 두 실행 모두 로그에 `dataDir: '/workspace/data'`(영속 공유 DB) 진단이 찍혀 있고, 이 파일들은 `installIsolatedTestDatabase`를 쓰지 않습니다.

## 그룹 최소 재현 (빈 `DATA_DIR`, 16개 파일, 170 tests)

| 실행 | PR 실패 | main 실패 | 오류 코드 |
| --- | ---: | ---: | --- |
| 기본 병렬 #1 | 52 | 54 | PR: SQLITE_BUSY 51 + assertion 1 / main: SQLITE_BUSY 48, SQLITE_ERROR 5, assertion 1 |
| 기본 병렬 #2 | 75 | 50 | PR: SQLITE_BUSY 70 + SNAPSHOT 4 + assertion 1 / main: SQLITE_BUSY 46, SQLITE_ERROR 4, ERR_TEST_FAILURE 7, assertion 1 |
| **직렬(`--test-concurrency=1`)** | **1** | **1** | 둘 다 `points.muse` “derives input and output rates…” (ERR_ASSERTION) |

- 병렬에서는 PR·main 모두 50~75건이 SQLITE_BUSY 계열로 실패하고 **실패 구성이 실행마다 바뀝니다**(main #2에서만 chatImageGenerationJobs 7건 등). 직렬로 돌리면 양쪽 모두 169/170 통과합니다.
- 직렬에서 남는 1건(`points.muse`)은 main에서도 동일하게 실패하는 기존 결함입니다(전체 실행에서도 양쪽 실패).
- 이 결과는 ‘9개 파일이 단독으로 통과했다’는 사실에만 기대지 않았습니다: 병렬 간섭이 있는 조건(기본)에서 **main도 같은 실패를 재현**했고, 간섭을 제거한 조건(직렬)에서 **양쪽이 같은 결과**가 된다는 대조 실험입니다.

### 영속 DB 누적 상태 결함 (별도)

`knowledgeTransfer.s4VariantProjection.test.ts`의 `setupFixture()`는 `chatId = 880000 + Math.floor(Math.random()*10000)`로 영속 `data/app.db`에 쓰고 정리하지 않습니다. 직렬 실행인데도 영속 DB에서 ‘H: duplicate same generation → idempotent’가 `3 !== 1`로 실패한 것은 이전 실행이 남긴 같은 chat id 행과의 충돌입니다(빈 `DATA_DIR`에서는 통과, 단독 재실행도 통과). 즉 실행 횟수가 쌓일수록 실패 가능성이 커지는 테스트 위생 문제입니다.

## 인과 확인: 변경 코드는 이 그룹에서 호출되지 않음

16개 파일을 각각 빈 `DATA_DIR`에서 실행하며 `compileCreatorDescriptionTriggers` 호출 수를 센 결과 **모두 0회**(대조군 18회). 이 PR이 바꾼 것은 이 함수 내부의 문장 분리와 정규식뿐이므로, 이 그룹의 실패가 이번 diff에서 나올 경로가 없습니다. (모듈 import 자체는 다른 모듈을 통해 로드되지만 호출되지 않습니다.)

## 관련 회귀 그룹: 직렬·빈 DB, 양쪽 비교

공통 제작자 저장·상태창·트리거·비밀·말투·캐논·공식 공급 관련 145개 파일을 `--test-concurrency=1`, 빈 `DATA_DIR`로 PR / main에서 실행했습니다. 둘 다 **실패 24건, 이름·위치까지 동일**(PR에만 있는 실패 0, main에만 있는 실패 0)입니다. 해당 24건은 기존 결함입니다(예: deepseekV4FlashCanonical, memory-noncanon-promotion, statusWidget/extractV4Fallback 등 모델 정책·메모리·상태창 텔레메트리 단언).

## FOLLOW-UP (이번 PR 범위 밖)

- 영속 `data/app.db`를 직접 쓰는 테스트 파일(위 16개 포함)을 `installIsolatedTestDatabase`로 전환하거나, DB 사용 파일을 직렬 러너로 분리. `Math.random()` chat id 제거.
- `points.muse.test.ts`의 ‘derives input and output rates…’ 단언 실패(main 기존).
