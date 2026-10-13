# 볼프강 #51 관리자 소유권 정상화 (Draft, 운영 미적용)

운영 DB에는 아무것도 적용하지 않았다. 아래 증거는 운영 DB의 읽기 전용 직렬화 사본(`serialize`, `mode=ro`)에서 만든 로컬 복사본에서 나왔다.

## BEFORE

- #51 `creator_id=108` (`로맨스 공식 스튜디오`, `site_managed=1`, 로그인 불가 계정). `official=0`, `private`, `approved`, `creator_name=로맨스 공식계정`.
- `canAccessCharacter()`는 `creator_id === viewer`만 비공개를 허용하므로, 실제 관리자 계정(운영 `users.id=1` `공식계정`, `ADMIN_EMAILS` 허용, 성인 인증됨)은 #51을 열 수 없다. `/api/chat`은 접근이 막힌다.

## PROBLEM

- 정책: 공식 캐릭터의 실제 소유자는 사용 중인 관리자 계정, 공개 제작자명은 `로맨스 공식계정`, 공식 캐릭터 CP 없음.
- 소유 계정 108에는 #50(공개 공식), #51(비공개), 로어북 12개(`keyword_lorebooks.creator_id=108`), `official_supply_world_lorebooks` 12행, 월드 #7이 묶여 있다.
- 로어북 2~9는 #50과 #51이 공유한다. 로어북 11~14는 #50 전용이다.
- 관리자 계정 1은 일반 크리에이터다(`site_managed=0`). #10·#13·#15에서 실제 CP 적립 이력이 있고 현재 잔액은 165.7, 출금 이력은 없다. 그래서 계정을 `site_managed=1`로 바꾸는 방식은 기존 로스터의 CP 자격을 없애므로 쓸 수 없다.

## AFTER (제안, 최소 변경)

- `transferOfficialCharacterOwnerToAdmin` (`src/lib/officialSupply/ownerTransfer.ts`): `characters.creator_id` 한 컬럼만 쓴다. 기존 `inPlaceSync` 패턴을 재사용한다(dry-run 기본, `OFFICIAL_OWNER_TRANSFER_ENABLED=1`, 재검증된 preflight 토큰, 단일 트랜잭션, 쓰기 후 비소유자 컬럼 해시 재검증).
- 대상 소유자는 항상 실행한 관리자 본인이다. 임의 user id를 받지 않는다.
- 관리자 라우트: `POST /api/admin/official-characters/owner` (`requireAdminUser`, 기존 `sync` 라우트와 같은 형태). 새 인증·로그인 경로는 없다.
- STOP 게이트: 비관리자, 공개/공식 행(#50 거부), 공급 기록 미연결, 현재 소유자가 사이트 관리 계정이 아님, 대상 관리자 미성인(NSFW), 대상이 사이트 관리 계정.
- 필수 정리 2건:
  - `creditChatRoomImageCreatorReward`에 캐릭터 단위 `official=1` 제외를 추가했다. 기존에는 계정 단위 `site_managed`만 막아서, 공식 캐릭터가 일반 계정 소유가 되면 이미지 생성당 15 CP가 새는 구멍이 있었다.
  - `deleteUserCharacter`는 `official_supply_characters`와 연결된 캐릭터를 삭제하지 않는다. 이전 후 관리자가 `내 캐릭터`에서 #51을 삭제할 수 있게 되는 새 위험을 막는다.

## 관리 경로 유지 (#1589 최종 정상화)

이전만 하면 #51이 공식 관리 경로에서 빠지던 문제를 같은 소유자 모듈 안에서 고쳤다. 새 판별 시스템, 새 권한 모델, 새 게시 API, 로어북 복제는 없다.

### Canonical owner map

- 공식 관리 대상 판별: `src/lib/officialAdminAccess.ts` (`isOfficialManagedCharacterRow`, `canAdminManageOfficialCharacter`, `listOfficialCharactersForAdmin`). 추가된 조건은 한 가지다. `official=0`, `official_supply_characters.staged_character_id` 연결이 정확히 1개이고 `stage=staged_private`, 소유자가 관리자 계정. "관리자라는 이유만으로" 일반 캐릭터를 관리하지 않는다.
- 공급 연결 조회: 같은 모듈의 `isOfficialSupplyLinkedCharacter` / `notOfficialSupplyLinkedSql`. `deleteCharacter`의 인라인 쿼리도 이것으로 합쳤다.
- 동기화: `src/lib/officialSupply/inPlaceSync.ts`. 캐릭터 소유자(관리자)와 스튜디오·월드·로어북 소유자(부착 로어북의 단일 사이트 관리 소유자)를 분리한다. 섞여 있으면 `owner_not_site_managed`로 중단한다.
- 공개: `src/lib/officialSupply/publish.ts`. 소유자 게이트가 사이트 관리 계정 또는 관리자 계정을 허용한다. 공급 기록과 stage 검사는 그대로다.
- 편집 저장: `src/lib/characterFormSave.ts` (PUT/PATCH), `src/app/api/characters/[id]/route.ts`. `official_admin`은 `preserveListingState`, `preserveAdultFlags`, `skipFollowerNotify`를 쓴다.
- 로어북 부착 검증: `src/lib/creatorLorebook.ts`. 관리자 편집 경로에서만 "이미 부착된 로어북 유지"를 허용하고, 그 외 타인 소유 로어북은 계속 거절한다. 읽기 전용 요약은 `listAttachedCreatorLorebookSummaries`.
- 일반 크리에이터 보상: `creatorPoints`(등급 집계, 채팅 적립), `imageGenerationEconomics`, `trpg/creatorRewards`. 세 곳 모두 공급 연결 `official=0` 행을 제외한다.

## REMOVED

- 이전 후 공식 목록·동기화·공개가 닫히던 동작(구 REGRESSION RISK 2).
- 이전 후 편집기에서 로어북 저장이 거절되던 동작(구 REGRESSION RISK 1).
- 공급 연결 비공개 `official=0` 캐릭터가 일반 크리에이터 `characterCount`·등급·채팅/이미지/TRPG 적립에 들어가던 동작.
- 삭제된 파일은 없다.

## PRESERVED (테스트로 확인)

- #51 승인 원고, Text Lock, 이미지 14장과 순서·URL, Appearance, `visibility=private`, `official=0`, `creator_name`, `nsfw`, 공급 행.
- 공유 로어북 2~9의 내용·ID·소유자(108)와 #50 부착. #50의 제작자, 로어북, 공개 상태.
- 관리자의 일반 캐릭터 #10/#13/#15의 등급·CP·출금 자격. 관리자 계정은 `site_managed=0` 그대로.
- 일반 사용자의 PUT/PATCH 권한, Text Lock, 성인 권한 검사.
- #1595/#1607 원고와 바이블.

## REGRESSION RISKS

1. 로어북 2~9는 계속 108 소유다. 런타임 주입은 `character_id` 부착만 본다. 편집기는 공유 항목을 체크 해제할 수 없는 읽기 전용 고정 표시로 보여 준다. 공식 관리자 저장은 첨부된 타 소유자 ID를 원래 순서로 보존한다. 일부만 빠진 PUT은 거절하고, 목록이 비어 있으면 기존 공유 연결을 다시 붙인다. 관리자 본인 소유 로어북의 추가·삭제는 그대로다. 새 외부 로어북 추가·교체는 거절한다. #50 공유 로어북의 복제·이전·수정은 없다.
2. `publish`는 최종 승인 때 `notifyFollowersOfNewCharacter`를 호출하며 제작자는 관리자 계정이 된다(관리자 계정 팔로워에게 알림). 이번에는 실행하지 않았다. 최종 승인 전에 팔로워 알림 정책을 확인해야 한다.
3. 편집기 PATCH는 기본 상태창 값을 쓴다(런타임상 빈 값과 같음).
4. 공개된 관리자 소유 `official=1` 행은 PATCH도 `official_admin`으로 편집 가능하다(PUT과 같은 기준).
5. CP: `characterCount`는 이전 전후로 같다(공급 연결 비공개 행은 집계 제외). CP 잔액과 출금 이력은 변하지 않는다.
6. `character_clicks`(108, #51, 6회), 월드 #7, `official_supply_world_lorebooks`는 108에 남는다. 해롭지 않다.
7. 되돌리기: 전용 되돌리기 함수는 없다(대상은 항상 관리자). 적용 전 새 `VACUUM INTO` 백업을 만들고, 필요하면 `UPDATE characters SET creator_id=108 WHERE id=51 AND creator_id=1` 한 줄로 복구한다. 이 컬럼 외에는 바뀐 것이 없다.

## PROOF

- 신규 `officialSupply.adminOwnedManagement.test.ts` 11개와 `wolfgangInPlaceSync` 이전 후 2개는 수정 전 코드에서 실패하고(`/opt/cursor/artifacts/before-fix-tests.log`) 수정 후 통과한다.
- 단위/통합 테스트 `src/lib/officialSupply/officialSupply.ownerTransfer.test.ts` 12개 통과. 이미지 CP 제외를 일시 제거하면 9번 테스트가 실패하는 것을 확인했다.
- 기존 관련 테스트 39개(`officialStudioFoundation`, `chatImageGenerationPersistence`, `wolfgangInPlaceSync`, `creatorPointsRewardSpend`) 통과.
- 운영 사본(읽기 전용 직렬화본의 로컬 복사) 실행 로그: dry-run `changedFields=["creator_id"]` (108 → 1), #50 거부 `transfer_requires_private_unlisted`, dry-run 무쓰기, 플래그 없는 apply 거부 `apply_disabled`, apply 후 접근 `admin=true, studio108=false, anon=false`, 프롬프트 sha 동일, 나머지 전부 UNCHANGED, 2회차 dry-run `changedFields=[]`.

## 운영 적용 절차 (승인 후, 이번에는 하지 않음)

1. 기존 WAL 안전 `VACUUM INTO` 백업을 새로 만든다.
2. Railway `OFFICIAL_OWNER_TRANSFER_ENABLED=1`로 배포한다.
3. 실제 관리자 계정으로 로그인한 탭에서 `POST /api/admin/official-characters/owner` `{characterId:51, mode:"dry_run"}`을 호출하고 `changedFields=["creator_id"]`, `fromOwnerId=108`, `toOwnerId=<관리자>`를 확인한다.
4. 같은 본문에 `mode:"apply"`와 dry-run의 `preflightSnapshot`을 넣어 한 번만 호출한다.
5. 플래그를 `0`으로 되돌린다. 읽기 전용으로 #51 행, 공급 행, 로어북, 부착, 이미지, #50, 알림 수를 확인한다.
6. Work 브라우저에서 관리자 계정으로 #51 비공개 RP를 검수한다. 공개와 팔로워 알림은 하지 않는다.
