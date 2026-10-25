# 공식 캐릭터 P2 — 저장 원고 보존형 컴파일 갱신

- 최신 main 조사 기준: `55b893e76b28f1de8fdcc0442cfe5e834f23f9ce`.
- 의존 PR #1725: `ea98b31b61283764fea3d24134fcb84512876054`, Draft·미병합 상태를 확인했다.
- 이 PR의 구현 SHA: `ee794d440d706d39997b3a14703d80e0e0794da2`.
- 이 PR은 승인된 #1725 HEAD에서 분기한 별도 작업이다. base는 `cursor/creator-description-sentence-compile-d9a9`이며 #1725를 수정하지 않는다. #1725 병합 후 main으로 base를 옮기고 최신 main에서 재검수해야 한다.
- 운영 원고 일치·Text Lock 정상·오래된 컴파일 존재는 사용자가 제공한 운영 조사 사실이다. 이번 작업은 운영 DB를 새로 조회하거나 수정하지 않았다.

## BEFORE / PROBLEM

#1725는 compiler의 문장 경계와 일반 행동의 speech 오분류를 고친다. 그러나 RP reader는 저장된 `creator_compiled_description_json.public_canon`을 우선 사용하므로 compiler 코드만 바꿔도 기존 등록 캐릭터의 저장 결과는 갱신되지 않는다.

기존 관리자 전체 sync는 GitHub/승인 공급 원고를 불러와 원고·소개·인사말·코멘트·로어북·외형 및 Text Lock 관련 정합성을 갱신하는 별도 작업이다. 그것을 실행하면 이번 컴파일 전용 범위가 아니다.

동일 compiler 회귀를 최신 main에서 실행하면 20개 중 5개가 실패한다. #1725 기준에서는 모두 통과한다. 이 PR은 그 compiler를 다시 고치지 않는다. 이 PR의 신규 갱신 경로 회귀 20개는 #1725 HEAD에서 함수/경로가 없어 20개 실패하고, 구현 후 모두 통과한다.

## 저장에서 실제 RP 요청까지의 owner

| 단계 | 기존 정본 owner / 동작 |
| --- | --- |
| 제작 원고 | bible → `compileOfficialDraftFromBible` → `buildOfficialCharacterFormBody` → `staging.ts`의 `createCharacterFromForm` |
| 일반 저장 | `characterFormSave.ts`의 `createCharacterFromForm` / `updateCharacterFromForm` → `buildCompiledCreatorDescriptionForSave` |
| 분류 | `creatorDescriptionTriggerCompiler.ts`의 `compileCreatorDescriptionTriggers` → 직렬화 JSON / `safeRuntimeCanon` |
| 현재 등록 데이터 갱신 | `officialSupply/inPlaceSync.ts`; 기존 전체 sync는 그대로 유지, 새 `recompileOfficialCharacterInPlace`는 저장 행만 읽음 |
| 청크 | `buildCharacterChunksFromSafeRuntimeCanon` → 기존 `casPublishCharacterSettingChunks`; speech_profile을 재작성하는 전체 청크 저장 함수는 호출하지 않음 |
| 번역/파생 작업 | `koreanChunksTranslationFingerprint` / `loadEnglishChunks`; `characterCanonicalSourceFingerprintFromRow`와 derived worker의 기존 stale/CAS 검사 |
| RP 소비 | `/api/chat` → `loadCharacterChunksForPrompt` + 저장 JSON의 `buildPrivateSpeechControlBlock` → contextBuilder → Main RP request adapter |

main과 #1725의 위 owner를 비교했다. 이 영역의 의도된 차이는 #1725 compiler 수정이며 새 저장 owner 충돌은 발견하지 않았다.

## AFTER

기존 `/api/admin/official-characters/sync`에 `operation: "recompile"`을 추가했다. 새 API나 runner는 없다. 기존 operation 생략/`full_sync`는 기존 전체 sync를 호출한다. 관리자 화면에 별도의 컴파일 미리보기/적용 버튼과 결과 표시를 붙였다.

컴파일 입력은 현재 저장된 `description`, `world`, `system_prompt`, `status_widget_json`, 저장 트리거다. 이 경로는 pilot/r2/bible을 불러오지 않는다. 기존 정식 저장의 순수 컴파일 함수 `buildCompiledCreatorDescriptionForSave`를 재사용한다. `creatorRawDescription` 같은 다른 반환값을 다시 저장하지 않는다.

미리보기는 query-only이며 이전/이후 JSON 해시, public_canon·speech_control 추가/제거, 변경 필드, 청크 변경, 번역 currentness, 파생 source fingerprint를 반환한다. 원고·기존 컴파일/청크·말투·코멘트·위젯/트리거·승인 공급 행/잠금·관련 저장 입력을 fingerprint에 포함한다. 활동 카운터는 원고 편집이 아니므로 제외한다.

적용은 기존 관리자 권한과 `OFFICIAL_IN_PLACE_APPLY_ENABLED=1`, 컴파일 미리보기를 요구한다. 같은 in-place owner의 단일 `BEGIN IMMEDIATE` 트랜잭션 안에서 현재 입력을 다시 읽고 fingerprint를 비교한 뒤 필요한 컴파일 JSON과 청크만 CAS로 쓴다. 둘 중 하나라도 실패하면 모두 롤백한다. 동일 결과는 SQL 쓰기 없는 no-op이며 같은 승인 스냅샷의 반복 적용도 no-op이다. 컴파일 결과가 이미 같아도 미리보기 이후 코멘트가 바뀌면 거절한다.

## 운영 적용 시 예상 변경 필드

| 필드 | 조건 / 처리 |
| --- | --- |
| `characters.creator_compiled_description_json` | 현재 저장 원고의 정식 컴파일 결과와 다를 때만 갱신 |
| `characters.setting_chunks` | 위 결과와 현재 외형 해석·기존 대사 예시로 만든 청크가 다를 때만 기존 CAS owner로 갱신 |
| `setting_chunks_en`, `prompt_translation_hash` | 쓰지 않음. 기존 해시가 새 한국어 청크와 맞지 않으면 기존 reader가 거절하고 한국어를 사용 |
| derived job identity | 새 compiled JSON을 포함한 기존 fingerprint가 바뀌므로 오래된 작업은 stale로 처리됨. 이 작업은 새 외형/유료 번역 job을 예약하지 않음 |

두 격리 fixture에서는 앞의 두 필드만 변경됐다. 실제 운영의 변경 여부·해시는 아직 실행하지 않은 운영 미리보기로 확정해야 한다. 기존 일반 채팅의 번역 backfill 정책은 변경하지 않는다.

## PRESERVED / REMOVED

원고·바이블·Text Lock·이름·소개·인사말·코멘트·말투/예시·speech_profile·세계관/로어북 연결·성인/공개/공식/권한·대화/메모리/관계·외형·이미지 14슬롯을 보존한다. 실제 위젯/수동 트리거 행은 쓰지 않고, 비밀 분류는 정식 compiler의 결과를 사용한다. `updated_at`도 이번 경로에서 쓰지 않는다.

이번 경로에 새 splitter/분류기/컴파일 복제는 없다. 전체 sync는 원래 책임 때문에 KEEP한다. appearance/translation job 예약 함수와 speech_profile 재생성 함수는 이 경로에서 호출하지 않는다. 무관한 DB·동기화·캐시는 손대지 않았다.

루시안 r2/selfDrive, Text Lock 재승인, 볼프강 서명·인장 canon 결정, 이미지 자동 제작, #1720, 공유 DB 인프라, Bonds recap은 포함하지 않는다.

## PROOF / REGRESSION RISKS

`receipts.json`의 값은 **격리 fixture**의 실측이며 운영 DB 캡처가 아니다. 루시안/볼프강 전체 원고는 기존 승인 source owner로 만든 동등 fixture이고 볼프강은 기존 승인 Text Lock 상수와 일치함을 추가 검사한다. 오래된 JSON은 관찰된 결함을 표현하는 최소 저장 결과 fixture로 만들었으며 운영 JSON과 바이트가 같다고 주장하지 않는다.

회귀는 루시안 행동 문장 전체의 public_canon 복구 및 private speech 제외, 볼프강 정식 컴파일 JSON 일치와 문장 보존, 원고 전체 핵심 섹션/대사 예시의 최종 Main RP request 보존을 검사한다. 수동 위젯/트리거·실제 말투 규칙·비밀 분류, 미리보기 무쓰기, 동시 편집 거절, 잠금/트리거 편집 거절, 카운터 변경 허용, fresh/replay no-op, 청크 실패 롤백, 오래된 publisher/job 거절을 포함한다. 허용된 두 필드를 제외한 캐릭터 행과 관련 원고/연결/대화/메모리/자산 행을 전후 비교한다.

기존 저장 compiler의 분류 결과가 바뀌므로 public_canon/speech_control 이외의 JSON 부분도 정식 결과로 재생성될 수 있다. 원고·실제 위젯·트리거 행은 유지한다. 미리보기는 두 분류의 이동과 전체 JSON 해시를 제공한다. 이후 compiler 변경으로 목표 JSON/청크가 달라지면 fingerprint가 달라져 새로운 미리보기가 필요하다. 파생 캐시가 미리보기 뒤 바뀌어도 CAS가 거절할 수 있다.

실제 운영 적용·유료 모델 응답은 실행하지 않았다. **UI 증거**는 `ui/` PNG와 `api-preview-51.json`(격리 fixture `#51` dry_run 실측)을 포함한다. `p2-ui-*.png`는 **정적 마크업 재현**, `p2-react-*.png`는 **live React**(캡처 완료, PNG만 보관)이다. 구분은 `ui/README.md`를 참고한다. 최종 wire는 기존 request adapter를 조립한 결정적 증거이며 실제 모델의 문학적 품질 승인으로 간주하지 않는다. API 비용은 0원이다. 수정 파일·검증 명령·정확한 결과는 `validation.json`에 기록한다. 관련 없는 전체 테스트 장애는 고치거나 우회하지 않았다.

**별도 Draft PR 제출 후 STOP. 병합·배포·운영 DB 쓰기 금지.**
