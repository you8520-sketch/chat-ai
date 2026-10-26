# P5 — #50/#51 r2 재승인 패키지 (미적용)

상태: **GPT 원고 승인 전**. 운영 원고·Text Lock·이미지·로어북·적용 게이트는 바꾸지 않았다. 유료 모델 호출 없음.

| 기준 | 값 |
| --- | --- |
| 측정 main | `ba14f3d76441a13b1fa92c501abe2c66ca039209` |
| 재사용한 P1 후보 | `433acb5c2263288adf0d1bbee2a73ad7fdc74300` `docs/official-supply/reviews/text-audit-p1/` |
| 이 패키지의 추가 문장 | 볼프강 제작자 코멘트 「지금 상황」만 지정 중립문 |

문학적 점수는 없다. 아래 숫자는 현재 main owner를 격리 DB에서 다시 실행한 결과다. 토크나이저는 호출하지 않았다. 글자 수·UTF-8 바이트만 실측이다.

## 정본과 소비 경로

1. 바이블 JSON → `compileOfficialDraftFromBible` (`bible.ts`) → draft.
2. 볼프강 파일 선택 (`compiledOfficialSource.ts` `wolfgangCharacterFilePath`): `DATA_DIR/official-supply/approved/pilot-rf-02.source.json`이 있으면 그 파일이 운영 source다. 없으면 테스트 컨텍스트에서만 저장소 `pilot/characters/pilot-rf-02.json`을 읽는다. 이 머신에는 영구 source 파일이 없었다. BEFORE 해시는 코드에 고정된 `WOLFGANG_IN_PLACE_TARGET.approvedTextLockHash`와 같다.
3. 루시안 source는 저장소 `pilot/characters/pilot-rf-03.json`이다. 별도 영구 source 파일 owner는 없다.
4. Text Lock = `computeTextLockHash` (`characterText.ts`). 포함: name, tagline, description, greeting, gender, age, genres, sections, speech, supportingNpcs, secrets, adult, creatorComment.
5. 공개 페이지 (`character/[id]/page.tsx`): 카드 `tagline`, 상세 소개 `description`, 첫 메시지 `greeting`, 플레이 안내 `creator_comment`. `bible.publicProfile.description`(짧은 pitch)은 화면·draft에 들어가지 않는다.
6. Main RP 시스템 프롬프트: 저장 행 → `loadCharacterChunksForPromptReadOnly` + `buildPrivateSpeechControlBlock` + `buildContext`. 이번 측정에서 greeting·tagline·creator comment는 시스템 프롬프트에 **포함되지 않았다**.
7. `#1729` `recompile`은 저장된 원고를 유지한 채 컴파일 JSON/청크만 갱신한다. r2 원고 반영 경로가 아니다.

## 루시안 #50 (`pilot-rf-03`)

### 변경 (r2 유지)

| 항목 | BEFORE | AFTER | 근거 |
| --- | --- | --- | --- |
| selfDrive | 없음. 관계 블록이 RP에 없다 | goal/ownMove/setback 245자 | `situation.personalSituation`의 금고·장부·농축 에테르·직접 수사. ownMove는 퇴로·자금 추적·잔향·브로커. setback은 능력 limit/cost(잔향 혼선, 체온·왼쪽 눈, 빚·약점) |
| greeting | 813자 | 872자. 장부 수납 직후 「서가 맨 아래의 빈 칸…」. 손을 내민 뒤 「머리 위에서 봉쇄 장치가 한 칸 더 내려왔다.」 | 서가·봉쇄 장치는 원 인사말에 있다. 빈 칸의 내용·원인은 특정하지 않음. 기존 대사·순서는 유지 |
| tagline | `금고 경보 속, 비밀 장부를 든 브로커와 당신은 같은 탈출로에 갇혔다.` (39) | `금고 경보가 울린 밤, 장부를 쥔 브로커가 당신 앞에 탈출로를 연다.` (38) | 표시 owner는 tagline. 「갇혔다」는 유저 상태를 고정하고 인사말(따라오거나 갈라선다)과 어긋남 |
| creator comment | 지금 상황이 소개 문장을 반복 | 시간 압박 + 시작 행동 3개(손 맞잡기 / 오른쪽에서 묻기 / 갈라서기). 「이미 준비」 없음 | 인사말의 선택지. 유저 선택 선결정 없음 |
| behaviorRules | 분노 시 더 낮고 공손, 호감을 투자라고 둘러댐 | 삭제 | 같은 문장이 성격·말투·예시에 남음. 와이어 `투자` 6→5, `더 낮고 공손` 1→0 |

말투·성격 본문은 바꾸지 않았다. 상세 소개 `description` 길이는 1258→1258로 같다. 상세 「도입 상황」은 원래 `같은 탈출로에 서 있다`이며 `갇혔다`가 아니다.

### Text Lock

- BEFORE `c3fda3e51f981b31066f3707ac8b580235092632a85a5d543d935093ca0b742f`
- AFTER `5091707b7280546bec61d9e7547e619e1737be473ee70ea64dcdbc79f99be744`

### RP 시스템 프롬프트

- 글자 15575 → 15708. UTF-8 바이트 33292 → 33612. 토크나이저 없음.
- 추가된 블록은 `[관계·갈등·행동원리]`의 자기 추진 한 덩어리다. setback 두 문장은 컴파일러가 줄바꿈으로 나눴고 둘 다 남는다.
- 삭제된 행동 규칙 두 줄은 말투 블록에 남아 있다.
- 인사말·태그라인·제작자 코멘트는 시스템 프롬프트에 없다. diff: `DIFF-pilot-rf-03.system.diff`.

### 게이트 (후보)

`validateCharacterBible`, `evaluateRelationBibleContract`, `evaluateOfficialPublicDescription`, `evaluateOfficialCreatorComment`, `evaluateOfficialStagedSaveLength` 오류 0. `evaluatePublicHook` 경고 0→0 (`maxTaglineWorldTerms: 2`).

### 유저 선결정

selfDrive goal/ownMove에 `당신` 없음. 코멘트는 세 갈래를 모두 허용한다. 인사말의 마지막 질문은 유지.

## 볼프강 #51 (`pilot-rf-02` / 공급 키 `pilot-rf-v4-02`)

### 변경 (r2 + 코멘트 중립문)

| 항목 | 변화 | 근거 |
| --- | --- | --- |
| backstory residue #1 | 흉터와 믿음이 한 주어로 ‘금이 갔다’ → 흉터는 남고 믿음에 금이 감 | 사실 동일, 호응만 수정 |
| residue #3 | `플레이어가 마석의 소유권을 주장하면 적대적 심문` → `소유권을 주장하는 이에게는 먼저 근거를 요구` | 도입은 유저를 죄인으로 단정하지 않음. 유저 행동 고정 제거 |
| secrets[0] | `숨기기보다 … 추적하지만 … 함구` → `조용히 추적하고 있지만 … 함구` | 추적과 함구는 유지. 모순 접속만 정리 |
| secrets[1] | **원문 유지** | 보급 판단과 병력 명단 버릇의 연결을 삭제하지 않음 |
| speech examples | 6줄. 분노는 날짜·서명·인계 시각. 당황은 용건으로 돌림. 친밀은 식사·난로. `내 얼굴을 봐`와 겹치는 탄약 대사 제외 | `angryStyle` / `hiddenEmotionStyle` / `intimateStyle`. 난로는 기존 인사말 |
| behaviorRules 장갑·명단 | 삭제 | 성격·습관·비밀 #2에 버릇이 남음. 와이어 `장갑 잠금쇠` 2→1, `병력 명단` 4→3 |
| tagline·greeting·세계·과거 사건·외형·description | 불변 | greeting 1411, tagline 37, description 1554, relationships 293 |
| creator comment | 지정 문장으로 교체 | 아래 |

제작자 코멘트 「지금 상황」:

`처형 명령서에는 볼프강의 서명과 인장으로 보이는 흔적이 남아 있지만, 그는 자신이 내린 명령이 아니라고 말합니다.`

이 문장은 서명을 진품으로도 위조로도 단정하지 않고, 명령 주체를 정하지 않는다. 「그가 말했다」까지만 적는다. P1 r2 문장(`인장이 찍혀 있지만…`)은 이 패키지에서 이 문장으로 바뀌었고, 그 때문에 P1에 적힌 후보 해시 `06c8595f…`는 **폐기**한다.

### 삭제되며 다른 필드에 없는 문장

행동 규칙에서 빠진 `이를 감추려 말수를 줄이지만, 핵심 보고는 미루지 않는다`는 후보 바이블과 AFTER 와이어에 없다. 장갑·명단 버릇과 별개다. r2를 유지하면서 이 한 절은 정보로 남지 않는다. 복원 여부는 GPT 판단이며, 이 패키지는 그 절을 다시 넣지 않았다.

### Text Lock

- BEFORE `e22ba966bdeab1babb331bdc916fe43a0e0d4e8adb3f5f2ba32f969c28ba2af2` (승인 핀과 동일)
- AFTER `d60bda95100fc9219d6fee29e9743404d87209612fb4117d358d01c5801c238b`

### RP 시스템 프롬프트

- 글자 17566 → 17558. UTF-8 바이트 38117 → 38099. 토크나이저 없음.
- 저장 system prompt 문자 5157 → 5154.
- greeting·tagline·creator comment는 시스템 프롬프트에 없다.
- diff: `DIFF-pilot-rf-02.system.diff`.

### 공개 페이지에서 그대로인 상충

상세 소개 「현재 상황」은 후보에서도 `서명도 인장도 볼프강의 것이다. 정작 그는 명령을 내린 적이 없다.`
「도입 상황」은 `인장이 찍혔으나 자신이 서명하지 않은`.
인사말은 `정갈한 서명 아래 … 인영은 그의 것이었다. 하지만 그는 명령을 내린 적이 없었다.`
태그라인은 인물의 주장(`내 인장이 있습니다. 서명한 적은 없습니다.`)으로 유지.

코멘트만 중립이다. 상세 소개·인사말의 상충은 이 후보가 고치지 않는다.

### 게이트

루시안과 동일하게 오류 0, publicHook 경고 0→0.

## 미확정 canon (이번 패키지가 결정하지 않음)

1. 처형 명령서의 서명이 볼프강 자필인지, 위조인지.
2. 인장이 그의 것인지, 도용인지.
3. 실제 명령자가 누구인지. `인장을 훔친 자`는 현행 상세 소개에 가설로 남아 있고, 후보가 그 문장을 지우거나 확정하지 않는다.
4. 비밀 #2 삭제 여부. 후보는 유지.
5. 볼프강 행동 규칙의 `핵심 보고는 미루지 않는다`를 복구할지.

루시안 후보는 이 결정과 분리되어 있다.

## 재승인 후 적용 계획 (실행하지 않음)

새 저장소·병렬 Text Lock owner는 만들지 않는다. `#1729` recompile만으로는 원고가 바뀌지 않는다.

1. GPT가 이 패키지 원문(후보 바이블 + 공개 JSON + 와이어 diff)을 승인한다.
2. 루시안: `pilot/characters/pilot-rf-03.json`의 bible을 후보로 교체. 기존 in-place **전체** sync가 저장된 description/greeting/tagline/creator comment/system prompt와 supply `text_lock_hash`를 새 해시로 맞춘다. `#50` official·public·승인, 이미지 14슬롯, 로어북, 채팅은 그 sync의 기존 보존 규칙에 맡긴다. 해시 불일치 시 기존 게이트가 거절한다.
3. 볼프강: 영구 파일 `DATA_DIR/official-supply/approved/pilot-rf-02.source.json`과 `WOLFGANG_IN_PLACE_TARGET.approvedTextLockHash`를 **같은 변경**에서 새 해시 `d60bda95…`로 맞춘다. 핀만 바꾸거나 파일만 바꾸면 `assertWolfgangApprovedLocks`가 기동을 거절한다. 공급 키는 `pilot-rf-v4-02`, 캐릭터는 `#51`, `official=0` / `private` / `approved` 유지. 그 다음 기존 in-place 전체 sync.
4. 롤백: 이전 바이블 바이트와 이전 해시(`c3fda3e5…`, `e22ba966…`)로 같은 owner를 되돌린다. 이미지·로어북 행은 이 경로의 대상이 아니다.
5. 반영 후 검증: 저장 원고 해시 = 새 Text Lock, 같은 입력으로 전체 sync를 다시 실행하면 no-op, 공개 페이지 tagline/greeting/comment가 이 패키지 AFTER와 일치, description의 볼프강 상충 문장은 승인 범위에 없으면 그대로인지 확인.

이 환경은 운영 DB와 영구 볼프강 source를 읽지 않았다. 적용 직전에 영구 source의 Text Lock이 여전히 `e22ba966…`인지 읽기 전용으로 한 번 더 맞춘다. 다르면 STOP.

## 파일

- `candidates/pilot-rf-03.candidate.bible.json`
- `candidates/pilot-rf-02.candidate.bible.json` (코멘트 중립문 반영)
- `wire/*.before.public.json`, `wire/*.after.public.json` — 공개 페이지로 저장되는 네 필드
- `wire/*.system.txt` — 동일 페르소나 `기록관`, 유저 메시지 `상황을 알려 줘.`, 완료 턴 0의 Main RP 시스템 프롬프트
- `DIFF-pilot-rf-03.system.diff`, `DIFF-pilot-rf-02.system.diff`
- `summary.json` — 게이트·길이·해시
- `build-package.ts` — 위 측정의 재실행 스크립트. 프로덕션 코드가 아니다.
