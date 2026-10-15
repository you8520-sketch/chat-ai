# 볼프강 #51 원고 검토 후보 — Draft / 운영 미적용

Refs #1593. 기준 main **65119ae9eecf493b3922923863813203de94013a** (제출 직전 재확인). #1595, #1607 및 #1589 병합 내용은 수정하지 않았다. 이 PR은 후보 원문과 검증 증거의 검토용 전달이다. **병합·운영 적용·공개 승인이 아니다.**

## 비공개 원문 전달

저장소가 public인 것을 GitHub metadata로 확인했다. 비공개 후보·비밀·전체 RP 입력·로컬 렌더를 평문 commit, PR 본문, 댓글, 공개 이미지 URL로 게시하지 않았다.

- 전체 원문/검증 묶음: [`wolfgang-51-editorial-review.tar.gz.gpg`](./wolfgang-51-editorial-review.tar.gz.gpg)
- 암호화: GnuPG symmetric AES-256, salted iterated S2K(65,011,712), integrity protection. 무작위 192-bit passphrase는 요청자와의 대화에서만 전달한다. PR/저장소에는 키가 없다.
- 암호화 파일 SHA-256: `762e4785125c7047f92abcd583760a0b93068f6246b58590344d54f58a098ada`
- 복호화: `gpg --output wolfgang-51-review.tar.gz --decrypt wolfgang-51-editorial-review.tar.gz.gpg` 후 `tar -xzf wolfgang-51-review.tar.gz -C <private-review-directory>`. passphrase는 GPG 입력창에 넣는다. 명령행/PR에 키를 쓰지 않는다.
- 묶음 내부 `FILE-SHA256.json`은 원문별 해시를 제공한다. `README.md`가 검토 순서와 재현 방법을 설명한다. 원문 JSON은 전체를 포함하며 생략하거나 일부만 발췌하지 않았다.

| 요청 산출물 | 암호화 묶음 내부 |
|---|---|
| 승인 원고/수정 후보 전체 원문 | `wolfgang-51-review/approved.source.json`, `candidate.complete.json`; `wolfgang-51-full-comparison.html`에 바이블·draft 모든 필드 양쪽 표시 |
| 중간 main 후보 구분 | `main.source.json`, `main.draft.json` |
| 전체 수정 전후 diff | `approved-to-candidate.source.diff`, `.draft.diff`, `.final-rp.diff` |
| 변경 이유·캐논 표·BEFORE/AFTER/REMOVED/PRESERVED | `QUALITY-REVIEW.md` |
| 실제 저장→최종 RP 조립 증거 | 세 버전의 `.saved-row.json`, `.chunks.json`, `.speech-profile.json`, `.wire.json`, `.final-rp.txt`, `.adult-final-rp.txt` |
| 로어북 전달 | 각 버전 `*.lore-<entryKey>.wire.json` 8건씩. 동적 user/history prefix도 포함 |
| 공개 소개·첫 메시지·코멘트 직접 검토 | `QUALITY-REVIEW.md`, 전체 비교 HTML, `wolfgang-51-surfaces.png`, `wolfgang-51-comment.png` |
| 검증·비용·Text Lock 예상 범위 | `metrics.json`, `regression.log`, `QUALITY-REVIEW.md` |
| 기존 owner 재현 | `reproduce.ts`, `author_candidate.py` (검토 묶음 안의 일회성 scratch; 앱/저장소에 새 검증 시스템을 설치하지 않음) |

## 정본 및 기존 Draft 판별

- 승인 정본은 frozen `pilot-rf-02-approved-c91ba66a.source.json`. 현재 canonical compiler로 계산한 hash가 `inPlaceWolfgang.ts`의 승인 hash 및 기존 #51 sync 영수증의 `c91ba66ab5cd45976c53c4298a7c355fbb286e3f761758d3a6cd5ce14f993dc9`와 일치한다.
- main의 캐릭터 JSON은 #1595 이후 공유 세계/소개/코멘트 후보다. hash `191779182e1430ec94ab4ab6542104ba4db41812180acfa79c94656ca70fea9c`이며 운영 승인 정본으로 간주하지 않았다.
- 새 후보는 main의 재사용 가능한 원고를 기반으로 확인된 문제만 수정했다. 예상 hash `71e66c35f6cb3cafbbabe21502f0aef5a9f3aeb73e4c6bd00c46c7682ab1617f`는 **미승인 측정값**이며 Text Lock을 등록/교체하지 않았다.
- 기존 열린 #1563은 과거 staging 증거, #1525는 이미지 준비, #1425는 QA 거절 상태다. 최신 main의 사용 가능한 원고 후보 Draft가 아니어서 이번 전달용 Draft 하나를 만들었다. 새 유료 제작을 실행하지 않았다.
- 운영 최신 읽기는 하지 못했다. 위의 정본 판별은 저장소/기존 영수증에 대한 것이며 현재 운영과의 일치 증거가 아니다.

## owner/dataflow 확인

`world-bible.json` / author brief → 기존 author prompts·`official-supply-pilot-author.ts` → 캐릭터 `bible` → `compiledOfficialSource.ts` / `bible.compileOfficialDraftFromBible` → `characterText.buildOfficialCharacterFormBody` → `characterFormSave` / creator description compile → `characterChunks.characterSettingInputForRow` / `loadCharacterChunksForPromptReadOnly` → `contextBuilder.buildContext` → provider별 system/history/cache split.

- 공유 세계: `officialSharedWorld.projectOfficialSharedWorld`. World Library 연결은 기존 `ensureOfficialSharedWorldLibraryRow`; 개인 사건은 `currentSituation`; 관계 시작은 `userRelationStart`; 자율 행동은 `rpEngine.selfDrive`.
- `world_id=null`이 곧 세계관 누락을 뜻하지 않는다. 승인 정본의 world snapshot은 compiled public canon을 통해 RP에 1회 전달됨을 로컬 저장 재생으로 확인했다. null을 고치려고 운영에 쓰거나 새로운 주입 경로를 만들지 않았다. 최신 2,738자 공유 정본이 운영에도 존재하는지는 최신 readonly 자료가 필요하다.
- speech source는 `example_dialog` 메타데이터와 `speech_profile`로 파생된다. DB에 없는 speech 개별 컬럼과 빈 source를 비교하지 않았다. 원본 profile 보존과 최종 wire의 metadata 변환은 별도로 계측했다.
- 로어북은 attachment와 keyword activation 후 동적 user/history prefix로도 전달된다. system prompt만 보고 누락으로 판단하지 않았다.

## 확인된 수정 / 보존

후보는 공적 심문 발화와 부하·동료 대상 발화를 구분하고, 기존 사건에서 자율 행동/실패 가능성을 명시하며, 고정 사건 배경과 사용자가 정할 설정을 나눴다. 친밀함 거절과 혐의를 연결하던 문구를 수정하고 공개 안내의 중복을 줄였다. 원문·대사별 변경 근거는 비공개 검토 문서에 있다.

- **BEFORE:** 저장소 승인 원고 + 별도 구분한 main 후보. **AFTER:** 기존 compiler를 사용한 새 미승인 후보.
- **REMOVED:** 중복 안내와 확인된 발화/관계 처리 모순. 삭제 문장을 diff에서 모두 확인할 수 있다.
- **PRESERVED:** 기존 성격·내적 모순·가치관·과거·능력·습관·일상·행동규칙·두 비밀, 핵심 사건과 장면 구조. 새 고유명 NPC/세계 사건/권능을 발명하지 않았다.
- 19개 항목은 작성 보조 기준으로만 썼다. 19개 출력 필드/DB 컬럼, 공통 RP 규칙, schema/compiler/renderer, 성인 인증·안전 owner는 추가하거나 변경하지 않았다.
- source world bible 및 8개 lorebook 원문, #50 source, 이미지 14장의 assetPlan, Appearance Lock, 승인 lock 상수는 파일 변경 0. 운영 소유권은 재조사/재이전하지 않았다.

저장소 세계 정본의 D1-D4, 연표, 에너지 대가·금기, 8개 로어북을 실제 원문으로 대조했다. 예상 밖의 공유 캐논 결정이 필요한 충돌은 발견하지 않았다. 개인의 자율 행동에 대한 새 표현은 기존 사건으로부터 도출한 editorial proposal이며 새 역사적 사실로 소급 확정하지 않았다.

## 직접 검증 결과

| 검증 | 결과 / 정확한 범위 |
|---|---|
| 기존 관련 회귀 | **113 pass / 0 fail**, 6개 기존 파일. 아래 명령 참조 |
| 후보 bible·관계·공개 소개·코멘트·저장 QA | 모두 통과. 품질 점수나 운영 승인으로 간주하지 않음 |
| 공유 세계 일치 | 후보와 #50 source가 동일 2,738자 projection. 로컬 saved `world`도 byte-equal |
| final wire 세계/개인 상황 | 공백 정규화 후 각 1회. 문단 재구성으로 엄격한 연속 byte-equality는 미충족; byte-equal이라고 주장하지 않음 |
| 설정 상한 잘림 | 승인/main/후보 모두 **0자** |
| 본체·상황·관계 전달 | 기존 #1595 방식의 문장 조각별 검출에서 누락 0. compiler의 private speech 재분류로 전체 본체는 연속 문자열로 보존되지 않음 |
| speech 원문 저장 | traits/personality가 saved profile에 전부 보존됨 |
| speech final wire | **미해결**. 기존 metadata 변환 때문에 후보 personality 4개/traits 33개 조각은 원문 그대로 검출되지 않음. 예시/금지 문구는 전달. 이것을 37개 사실 누락으로 해석하지 않음 |
| 상황별 말투 | **미해결**. derived `formal`/반말 금지와 final metadata의 반말이 함께 존재. 한 부하 발화 validator probe 통과만으로 합격 처리하지 않음 |
| 이미지 태그 계약 | source 14개 tag의 마커 파싱/정확 매칭 통과. 합성 URL fixture 검증이며 운영 픽셀·태그 확인은 아님 |
| 로어북 계약 | source 8개 각각 기존 activation owner → 최종 system/history split에서 content 전달. 운영 2~9 최신 원문 대조는 미완료 |
| #50 회귀 | 기존 테스트/고정 source 보존 통과. 최신 운영 #50 행 재조회는 아님 |
| 코멘트 HTML | 기존 sanitizer 출력 불변, Chromium 로컬 DOM/스크린샷 직접 확인. 운영 페이지/CSS 검증은 미완료 |
| 유료 RP/provider 호출 | 0. 운영 DB 쓰기·공개·알림·Text Lock 교체·이미지 생성 0 |

테스트 계약은 canonical regular runner의 `react-server`, `tsx`, `regularTestEgressPolicy` import와 직렬 실행을 재사용했다. 앱 코드 변경이 없어 lint/typecheck 전체 재실행은 하지 않았다. 첫 실행은 snapshot의 구형 node_modules에 sucrase가 없어 실행에 실패했고, 격리 worktree의 `npm ci` 후 아래 검증은 통과했다.

```sh
node --conditions=react-server --import tsx \
  --import ./src/lib/test/regularTestEgressPolicy.ts \
  --test --test-concurrency=1 \
  src/lib/officialSupply/officialSupply.worldIntroCanon.test.ts \
  src/lib/officialSupply/officialSupply.relationStart.test.ts \
  src/lib/officialSupply/officialSupply.wolfgangInPlaceSync.test.ts \
  src/lib/officialSupply/officialSupply.adminOwnedManagement.test.ts \
  src/lib/inlineTaggedAssets.test.ts src/lib/creatorLorebook.test.ts
```

## 토큰·비용 / Text Lock 예상

문자수 기반 `estimateTokens`, 동일 입력·history 없음·DeepSeek V4.1 Flash의 로컬 조립 기준. provider 실측·생성 출력비·결제/CP 변경이 아니다.

| | 승인 정본 | main 후보 | 새 후보 |
|---|---:|---:|---:|
| system 추정 tokens | 13,885 | 15,897 | 16,121 |
| 성인 system | 13,880 | 15,893 | 16,117 |
| 첫 메시지 | 1,393 | 1,393 | 1,357 |
| 첫 메시지 글자 수 | 1,547 | 1,547 | 1,507 |

승인 대비 +2,236 system tokens, main 대비 이번 편집 +224. 저장소 published reference input $0.30/M, cache read $0.006/M 기준 승인 대비 +$0.0006708/턴 또는 cache-hit +$0.000013416/턴. main 대비 각각 +$0.0000672 / +$0.000001344. 실제 tokenizer·캐시·history·출력은 별도다.

승인 대비 예상 lock-covered 변경: tagline/description/greeting, sections의 world·currentSituation·relationshipsAndDrives, speech personality/traits/examples, adultHookSummary, creatorComment. name/gender/age/genres/core/extraCanon/supportingNpcs/secrets 및 Appearance Lock은 보존한다. source 편집 후보와 예상 hash만 만들었으며 기존 승인 hash 상수/공급행은 그대로다.

## 미완료 / STOP

이 Codex 환경에는 `railway` CLI가 없었다. 새 인증·설치·우회·인프라 구축을 하지 않았다. 기존 Cursor Cloud의 검증된 CLI/SSH 경로에서 최신 `/data/app.db` readonly 자료를 받아 다음만 대조해야 한다.

1. 최신 배포 SHA/읽기 시각 + #51 원고·공급 draft/승인 lock 해시, compiled canon/chunks/speech_profile, world/id.
2. 운영 이미지 14개 실제 태그·URL·순서·블러·픽셀과 로어북 2~9의 내용·키워드·부착 순서. #50 보존 해시.
3. 현재 운영 페이지/코멘트의 실제 렌더. 후보 적용 이후의 화면은 이번에 만들 수 없으므로 미완료다.

사용자 제공 기존 경로: enchanting-ambition / production / chat-ai / `/data/app.db`; 마지막 확인 SHA ac67801c. owner-transfer 이전 백업은 최신 사본으로 사용하지 않았다. 비밀키·비밀번호·세션 전달은 요구하지 않는다.

기존 #1595/#1607의 speech 파생·metadata 손실은 회귀만 확인했으며 이 PR에서 새 프롬프트/시스템 수정으로 확장하지 않았다. **원고 무손실·상황별 말투의 전체 합격은 보류**한다. Cursor 작품성 점수는 없다. 실제 원문에 대한 GPT 정성 검토는 암호화 묶음의 QUALITY-REVIEW에 포함한다.

**후보·원문 전체 비교·검증 증거 제출 후 STOP.** GPT/사용자 검토 → 별도 승인 → 운영 비공개 적용 → 실제 RP 원문 평가 순서. 현재 merge, production apply, 새 Text Lock, public release, follower notify, paid RP는 진행하지 않는다.
