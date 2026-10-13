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

## REMOVED

- 없음. 삭제하거나 대체한 코드는 없다.

## PRESERVED (테스트와 운영 사본 증거로 확인)

- #51 승인 원고, Text Lock, 이미지 14장, `images`, Appearance, `visibility=private`, `official=0`, `creator_name`, `updated_at`.
- 로어북 8개(2~9)와 부착 순서, 공급 행, 공급 에셋 행, #50, 나머지 캐릭터, 월드, 행 수.
- 최종 RP 프롬프트(`buildContext` system prompt)와 로어북 주입 블록이 이전 전후로 바이트 단위로 같다.
- 알림, 팔로워 알림, 새 캐릭터 생성, 공개 변경은 없다.

## REGRESSION RISKS

1. 로어북 2~9는 계속 108 소유다. 런타임 주입은 `character_id` 부착만 보므로 채팅에는 영향이 없다. 단, 일반 편집기에서 관리자가 #51을 저장하면 `validateCreatorLorebookAttachmentIds`가 거절한다. 테스트가 이 알려진 한계를 고정해 둔다. 후속 선택지는 (a) #51 전용 복제 로어북, (b) #50까지 이전(공개 캐릭터의 제작자 링크가 바뀌므로 별도 승인)이다.
2. #51은 `/admin/official-characters` 목록(공식 또는 사이트 관리 소유만 노출)에서 빠진다. 기존 공식 관리 게이트(`canAdminManageOfficialCharacter`, `inPlaceSync`, `publish`의 `owner_not_site_managed`)는 #51에 대해 닫힌 채로 실패한다. 이전 후 #51 Text Lock 재동기화나 공식 공개는 불가하다. 공개는 이번 범위에서 금지이고, 닫힌 게이트는 108 기준 로어북 매핑에서 중복 로어북이 생기는 것도 막아 준다. 소유 모델 재설계는 별도 후속이다.
3. CP: 비공개 #51은 소유자 본인만 쓸 수 있으므로 자기 소비는 `creator_id === consumer`로 적립 0이다. `official=1`은 채팅 적립 0, TRPG 0, 이미지 0이다. 운영 사본에서 관리자 등급은 `sprout 4%`, 공개 캐릭터 3개, `totalChats` 21 그대로이고 `characterCount`만 4에서 5로 늘어난다. CP 잔액과 출금 이력은 변하지 않는다.
4. 관리자 `내 캐릭터`·스튜디오에 #51이 비공개로 보인다(의도). 공개 제작자 페이지는 `listableWhere`로 비공개를 숨긴다.
5. `character_clicks`(108, #51, 6회), 월드 #7, `official_supply_world_lorebooks`는 108에 남는다. 해롭지 않다.
6. 되돌리기: 전용 되돌리기 함수는 없다(대상은 항상 관리자). 적용 전 새 `VACUUM INTO` 백업을 만들고, 필요하면 관리자가 `UPDATE characters SET creator_id=108 WHERE id=51 AND creator_id=1` 한 줄로 복구한다. 이 컬럼 외에는 바뀐 것이 없다.

## PROOF

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
