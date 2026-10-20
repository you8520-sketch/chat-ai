# C-1 — 성인 OFF 기존 RP 사전검사 실행 계획 (Draft)

상태: **준비 단계만 완료.** 운영 DB 쓰기·1,347건 유료 분류·가드 ON·배포는 GPT 재검수 후 STOP.

## 기준 SHA (작성 시점)

| 참조 | SHA | 설명 |
| --- | --- | --- |
| `origin/main` tip | `671d3925e0745ad283c98f6a000ed47c30b6ad35` | #1694 병합 후 |
| Production SUCCESS / #1692 | `824f3c865de1cd3edc464e75f3ce2bf4f047ef91` | 성인 OFF stored read·aux·variant owner |
| C-1 prep PR | `1415875d…` 이후 재검수 커밋 | batch prep owner |

정책 버전: **2**. 플래그: `ADULT_OFF_OUTPUT_GUARD_ENABLED` 기본 **OFF**.

## Canonical owner (코드)

| 단계 | Owner |
| --- | --- |
| 대상 열거 | `listAdultOffInspectionTargets()` |
| variant 정규화·row 미러 | `normalizeMessageVariants()` |
| 해시 기록 | `applyAdultOffStoredInspection()` |
| 배치 계획·지문·커밋 | `src/lib/adultOffBatchInspectionPrep.ts` |
| 활성 미러 검증 | `activeVariantMirrorsCanonicalRow()`, `listActiveRowMirrorInconsistentMessageIds()` |
| 읽기/표시 | `adultOffStoredTextDisposition()`, `presentAdultOffStoredRead()` |
| 유료 분류 (운영 실행 시) | `createAdultOffClassifier()` — **C-1에서 호출하지 않음** |

## 1. 운영 데이터 백업·복구

1. Railway/운영 볼륨에서 SQLite 파일 스냅샷 (`app.db` + 존재 시 `-wal`/`-shm`).
2. 읽기 전용 마운트 또는 복사본에서 `PRAGMA integrity_check` = `ok`.
3. **격리 리허설 복사:** `copySqliteDatabaseForRehearsal(source, dest)` — 원본 **`readonly`**, SQLite **`VACUUM INTO`** 스냅샷(원본 파일/WAL truncate 없음). `dest`가 이미 있거나 source=dest면 **거부**.
4. 복구: 스냅샷으로 볼륨 교체 후 서비스 재기동. 사전검사는 usage 해시만 추가하므로 롤백 시 스냅샷 복원이 전체 복구 경로.

## 2. 배치 중 서비스 동작

- 검사는 **assistant variant 본문**의 `usage.adultOffGuard` 해시만 갱신. `content`·포인트·원장·레거시 `alternates`/`active_variant` 형태는 유지.
- `commitAdultOffInspectionIfFresh()`는 txn 내부에서 **활성 variant ↔ `messages.content`/`messages.usage` 미러**를 재검증. 불일치면 `skipped_stale` — **자동 보정 없음, STOP 조사**.
- **유료 분류 중** 긴 DB 트랜잭션 금지: 분류 → 짧은 txn으로 commit 1건.
- `ADULT_OFF_OUTPUT_GUARD_ENABLED`는 배치 완료·체크리스트 전까지 **0 유지**.

## 3. 실패·중단·재개

1. **계획:** `planAdultOffBatchInspection()` — v2 해시 재사용 / 분류 필요 / skip.
2. **기록 직전:** variant 지문 + **canonical 미러** + settlement 필드 불변.
3. **중단 후:** 재실행 — 동일 문자열은 `wrote: false` (중복 해시 없음).
4. **unresolved:** commit 안 함.
5. **재생성·variant 전환·미러 깨짐:** stale skip.

## 4. 비용 상한 (1,000원)

- **본문 1,347건:** v2 길이 가중 추정 **약 378원** (`docs/audits/adult-off-output-guard/README.md` 및 과거 조사)을 **1차 예산 참고**로 사용.
- 28건 프로브 단순 평균 × 1,347(≈256원)은 **확정 예산이 아님** — 표본·본문 길이 분포가 다름.
- **보조 출력**(status meta·추천 답장·표시 위젯) 추가 유료 검사는 **별도 호출·별도 비용** — `surveyAdultOffBatchReadOnly().aux`로 범위 산출 후 합산.
- `dedupeAdultOffClassificationTexts`로 동일 문자열 중복 호출 감소.
- 실행 전 `needsClassification` 재집계; **1,000원 초과 예상 시 STOP**.

## 5. 마지막 증분·재집계

1. 배치 시작 시 plan snapshot / `max(message.id)` 기록.
2. 완료 후 **신규 message id**뿐 아니라 **기존 id의 재생성·variant 변경·미러 불일치**(`mirrorInconsistentMessageIds`) 재plan.
3. aux는 `surveyAdultOffAuxSurfaces()` — **본문 `bodyUnreviewedTargets`와 aux 미검증 문자 수 분리** 보고.
4. 운영 copy에서 `activeRowMirrorInconsistentMessages > 0` → **자동 보정하지 않고 STOP**.

## 6. 완료 후 미확정·가드 ON 체크리스트

- [ ] `body.needsClassification` = 0, stale/unresolved ID 목록 export (본문 없음).
- [ ] 미러 inconsistent = 0.
- [ ] aux `auxUnreviewedVisibleTextCount` = 0 또는 별도 aux batch 완료.
- [ ] 격리 DB 리허설 + `integrity_check` green.
- [ ] 스테이징에서 가드 ON 회귀 (15세 로맨스·성인 ON).
- [ ] 프로덕션 가드 ON은 GPT 승인 후 별도 변경.

## 7. 읽기 전용 사전 집계

```bash
DATA_DIR=/path/to/isolated-copy tsx scripts/adult-off-batch-prep-survey.ts
```

출력: `body` / `aux` 분리 집계, mirror inconsistent **건수만** (plaintext 없음).

## 8. 격리 DB 검증 게이트 (CI)

`src/lib/adultOffBatchInspectionPrep.test.ts` — WAL 복사, 미러 stale, 레거시 NULL, aux 집계, 유료 API **0**.

## STOP 조건 (⑨)

원본/정산 불변 불가, **미러 inconsistent**, 재개 중복/누락, 복사본 파싱 실패, 예상 비용 ≥1,000원, 대규모 migration, 정상 15세 RP 과제한, aux owner 불확실 — **임의 운영 적용 없이 보고**.
