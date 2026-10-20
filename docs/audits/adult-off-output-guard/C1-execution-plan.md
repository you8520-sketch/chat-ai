# C-1 — 성인 OFF 기존 RP 사전검사 실행 계획 (Draft)

상태: **준비 단계만 완료.** 운영 DB 쓰기·1,347건 유료 분류·가드 ON·배포는 GPT 재검수 전 금지.

## 기준 SHA (작성 시점)

| 참조 | SHA | 설명 |
| --- | --- | --- |
| `origin/main` tip | `671d3925e0745ad283c98f6a000ed47c30b6ad35` | #1694 병합 후 |
| Production SUCCESS / #1692 | `824f3c865de1cd3edc464e75f3ce2bf4f047ef91` | 성인 OFF stored read·aux·variant owner |

정책 버전: **2**. 플래그: `ADULT_OFF_OUTPUT_GUARD_ENABLED` 기본 **OFF**.

## Canonical owner (코드)

| 단계 | Owner |
| --- | --- |
| 대상 열거 | `listAdultOffInspectionTargets()` |
| variant 정규화·row 미러 | `normalizeMessageVariants()`, `variantToRowFields()` |
| 해시 기록 | `applyAdultOffStoredInspection()` |
| 배치 계획·지문·커밋 | `src/lib/adultOffBatchInspectionPrep.ts` |
| 읽기/표시 | `adultOffStoredTextDisposition()`, `presentAdultOffStoredRead()` |
| 유료 분류 (운영 실행 시) | `createAdultOffClassifier()` — **C-1에서 호출하지 않음** |

## 1. 운영 데이터 백업·복구

1. Railway/운영 볼륨에서 SQLite 파일 스냅샷 (`app.db` + 존재 시 `-wal`/`-shm`).
2. 읽기 전용 마운트 또는 복사본에서 `PRAGMA integrity_check` = `ok`.
3. WAL 일관 복사: `copySqliteDatabaseForRehearsal()` (`wal_checkpoint` + `VACUUM INTO`) 또는 동등 절차.
4. 복구: 스냅샷으로 볼륨 교체 후 서비스 재기동. **사전검사는 usage 해시만 추가**하므로 롤백 시 스냅샷 복원이 전체 복구 경로.

## 2. 배치 중 서비스 동작

- 검사는 **assistant variant 본문**의 `usage.adultOffGuard` 해시만 갱신. `content`·포인트·원장·`alternates` 구조는 유지.
- **유료 분류 중** 긴 DB 트랜잭션 금지: 분류 → 짧은 txn으로 `commitAdultOffInspectionIfFresh()` 1건.
- `ADULT_OFF_OUTPUT_GUARD_ENABLED`는 배치 완료·체크리스트 전까지 **0 유지** → 사용자 UI는 기존과 동일.
- 신규 Main RP는 계속 생성; 배치 중 들어온 메시지는 **지문 불일치**로 `skipped_stale` → 재평가 큐에 남음.

## 3. 실패·중단·재개

1. **계획**: `planAdultOffBatchInspection()` — v2 승인/제한 해시 일치 시 `reuse_*`, 아니면 분류.
2. **기록 직전**: `fingerprint` (messageId, variantIndex, textSha256, activeVariant) 재검증.
3. **중단 후**: 동일 복사본/운영 DB에서 재실행 — 이미 해시된 문자열은 `applyAdultOffStoredInspection` → `wrote: false` (중복 기록 없음).
4. **unresolved/timeout/low confidence**: `commit`하지 않음 (`skipped_unresolved`).
5. **variant 전환·재생성 경합**: stale skip, 오래된 결과로 덮어쓰지 않음.

## 4. 비용 상한 (1,000원)

- 프로브 평균 ~0.19원/건 × 1,347 ≈ **256원** (문서 `classifier-probe.json` 기준).
- 고유 문자열 dedupe (`dedupeAdultOffClassificationTexts`)로 실비는 **≤ 1,347 호출**.
- 실행 전 `planAdultOffBatchInspectionSummary().needsClassification` 재집계; **1,000원 초과 예상 시 STOP** (⑨).

## 5. 마지막 증분 검사

1. 배치 시작 시 `max(message.id)` / 타임스탬프 기록.
2. 본 batch 완료 후 `id > watermark` assistant variant만 추가 plan.
3. aux(status meta·추천 답장·위젯)는 **별도 승인 증명** 필요 — 본문 batch와 동일 runbook으로 `adultOffAuxApproval` 경로 재사용(유료 호출은 aux owner 정책에 따름). C-1 조사: `surveyAdultOffAuxSurfaces()` 집계.

## 6. 완료 후 미확정·가드 ON 체크리스트

- [ ] `needsClassification` = 0, `skipped_stale` / `skipped_unresolved` 목록 export (ID만, 본문 없음).
- [ ] 활성 variant `usage` ↔ `messages.usage` 미러 spot-check (`assertActiveUsageMirrorsRow` 패턴).
- [ ] aux: `auxItemsWithUnapprovedVisibleText` = 0 또는 별도 aux batch 완료.
- [ ] 격리 DB 리허설 + `integrity_check` green.
- [ ] `ADULT_OFF_OUTPUT_GUARD_ENABLED=1` **스테이징**에서 15세 로맨스·성인 ON 회귀 수동 확인 (Cloud Agent는 영상 검증 없음 — PR checklist).
- [ ] 프로덕션 가드 ON은 GPT 승인 후 별도 변경.

## 7. 읽기 전용 사전 집계

```bash
DATA_DIR=/path/to/isolated-copy tsx scripts/adult-off-batch-prep-survey.ts
```

출력: 건수·정책 버전·integrity·aux 집계 (plaintext 없음).

## 8. 격리 DB 검증 게이트 (CI)

`src/lib/adultOffBatchInspectionPrep.test.ts` — 합성 분류, 유료 API **0**.

## STOP 조건 (⑨)

운영 적용 없이 보고: 원본/정산 보존 불가, usage 미러 불일치, 재개 중복/누락, 복사본 파싱 실패, 예상 비용 ≥1,000원, 대규모 migration 필요, 정상 15세 RP 과제한 증거, aux 처리 owner 불확실.
