# E4-3J — 공개 크리에이터 프로필 / Quiet Creator Gallery

검수 대기용 Draft. 기본안은 C1이며, C2는 같은 정보 구조에서 헤더만 달리한 비교안입니다. 디자인 점수·최종 선정·자동 병합·운영 배포를 수행하지 않았습니다.

## BEFORE / PROBLEM

- 제작자 정체성·소개가 별도 카드에 나뉘고 공지 안에 다시 카드가 중첩됩니다.
- 모든 공지가 본문 전체로 펼쳐져 작품 진입을 밀어냅니다.
- 선물 버튼 높이 38px. 동일 fixture의 회귀 테스트에서 44px 기준 실패.
- 로그인한 댓글 입력 상태에서 문서 폭 442px. 360px 회귀 테스트 실패 및 390px 원본 스크린샷/geometry 확인.
- 공개 작품 0개일 때 작품 영역 자체가 없어 상태를 알기 어렵습니다.

## AFTER / REMOVED / PRESERVED

- 닉네임·기존 배지·제작 수·HTML 소개를 하나의 헤더에 배치. 44px 조용한 액션.
- 최신 구조화 공지를 우선 표시. 긴 공지는 160자 미리보기와 native details로 전문 접근, 짧은 최신 공지는 기본 펼침. 이전 공지는 native details로 모두 접근 가능.
- 구조화 공지가 있으면 HTML 공지를 숨기는 기존 우선순위 유지. 공지가 없으면 영역 생략.
- 기존 정렬 결과의 처음 2개를 '인기 작품', 나머지를 '더 둘러보기'로 분할. 작품당 한 번 렌더링. 공개 조회 SQL·좋아요/생성일 정렬·24개 제한 그대로.
- 작품 0개 안내. 댓글·본인 설정은 작품 아래. 공유 카드 변경 없음.
- 댓글 입력에 min-width:0과 44px 높이 적용. 선물 모달은 작은 높이·keyboard inset에 맞춰 내부 스크롤, 초점 복귀·Tab 순환·배경 스크롤 잠금 보완.
- 삭제: 소개용 외곽 카드, 광점 장식, amber 공지 배지, 공지별 중첩 카드, 작품보다 앞선 댓글 설정 블록.
- 보존: 공식/파트너 판정, 성인 블러·이동 링크, 공개 범위, 선물 대상/수수료/자격/확인/로그인 이동/요청, 댓글 읽기·쓰기·신고·차단·비공개·검수 owner, HTML sanitizer, DB 스키마.

## Canonical OWNER MAP

| 책임 | 정본 | 확인 결과 |
| --- | --- | --- |
| 프로필 서버 조회·표현 | `src/app/creator/[id]/page.tsx` | 조회부는 import 외 그대로. 표현만 변경 |
| 소개/레거시 공지 저장·정제 | `src/app/api/creator/route.ts`, `src/lib/creatorProfileHtml.ts` | PATCH → sanitizeCreatorHtml → users. 기존 출력 sink 두 곳 유지. 클라이언트 입력/새 HTML 경로 없음 |
| 구조화 공지 | `src/lib/creatorNotices.ts` | 생성일/id 내림차순, 최대 20개 그대로 |
| 공개 작품 | `src/lib/characterVisibility.ts` + 페이지 SQL | 일반 제작자는 official=0 추가, 공식 스튜디오는 기존 분기 그대로 |
| 제작 수 | 페이지 COUNT SQL | 비공개·검수 중 포함, 일반 제작자는 official=0. 공개 작품 수로 바꾸지 않고 '제작 캐릭터'로 명확화 |
| 공식·파트너 | `siteManagedAccounts.ts`, `partnerTier.ts`, 기존 Badge 컴포넌트 | 계정 기반 공식/활성 파트너 판정 그대로 |
| 카드·이미지·링크·성인 표시 | `CharacterCard.tsx`, `characterAssets.ts`, `chatLinks.ts`, `adultVerification.ts` | 공유 카드 무수정, 같은 blurNsfw/loggedIn 전달 |
| 선물 | `CreatorGiftPanel.tsx`, `pointGifts.ts`, `pointGiftsShared.ts`, `/api/points/gift` | 표현·모달 수명주기만 변경, 정책/POST 그대로 |
| 댓글 | `profileComments.ts`, `commentPolicy.ts`, `commentReports.ts`, `ProfileCommentSection.tsx`, `CommentsEnabledToggle.tsx` | 서버 판정/액션 그대로, 공유 입력 폭/높이만 수정 |
| 디자인·폰트 | `studioDesign.ts`, `layout.tsx`, Pretendard | 기존 토큰·폰트 재사용. route CSS는 .creator-gallery 범위 |

## REGRESSION RISKS

- `CreatorGiftPanel`은 캐릭터 페이지 등에서도 사용하므로 모달 스크롤/초점 보완은 공유 사용처에 적용됩니다. 선물 제출 로직은 수정하지 않았습니다.
- `ProfileCommentSection`의 min-width/터치 크기 보완도 공유 사용처에 적용됩니다. 서버 댓글 정책은 수정하지 않았습니다.
- native details를 닫으면 해당 공지 본문은 접힙니다. 제목·날짜·최신 미리보기와 이전 공지 접근은 유지됩니다.
- 상단 제작 수와 갤러리 개수는 서로 다른 기존 계약입니다. 24개 밖 작품의 조회/페이지 기능은 추가하지 않았습니다.

## PROOF

동일한 격리 SQLite fixture. 운영 계정·운영 DB 사용 없음. 실제 선물·댓글 등록·신고·차단 호출 없음. 모든 작품 이미지는 저장소에 이미 있는 style-seed 이미지로 구성한 테스트 데이터입니다.

- 일반/공식/파트너, 방문자/본인, 공지 0/1/3/긴 본문/레거시 HTML, 소개 없음/긴 HTML/긴 URL/pre, 작품 0/1/8/24(공개26개로 LIMIT 검증), 비공개·검수 대기 제외, 긴 이름·제목, 성인 블러 on/off, 댓글 허용/비허용·비공개·검수, 로그인 이동, 모달 열기·닫기·Escape·360×360 리사이즈·초점 복귀, 검색 페이지 공유 카드.
- 360/390/768/1440px. viewport height 900px, 모달/입력 회귀는 작은 높이로 추가 확인.
- BEFORE: 선물 38px → C1/C2: 44px. 댓글 문서 폭 442px → C1/C2: 화면 안에 유지.
- 원본 PNG는 보정/합성하지 않은 Playwright 캡처입니다. 로컬 개발 서버의 Next 개발 표시가 일부 화면에 포함됩니다. 운영 사이트 캡처가 아닙니다.

### 검증 결과

| 확인 | 결과 |
| --- | --- |
| git diff --check | 통과 |
| npm run lint / npm run typecheck:app | 통과 |
| npm run build | 통과. Next 15.5.25 production 번들·타입 검사·121개 정적 페이지 생성 완료. 타입 오류 무시 옵션이나 설정 변경 없음 |
| 최종 C1 기능 회귀 | 12개 통과. production 빌드를 localhost에서 실행하고 새 격리 DB로 다시 확인 |
| C1 원본 촬영 | 독립 체크아웃에서 1개 촬영 시나리오 통과. 초기 병행 촬영의 시간 초과는 별도 로그에 남기고 모달 표시 대기 및 격리 환경에서 재촬영 |
| C2 회귀 | 최종 고유 작품 fixture에서 전체 13개 통과 |
| npm run typecheck | 실패. 수정 전/후 2,164건, 오류 위치·코드 추가/삭제 0건. 기존 characterAssets 테스트의 union 출력 순서 차이 1건은 같은 오류 |
| npm run test:regular | 전체 실행 완료: 13,034 통과 / 283 실패 / 3 취소 / 1 건너뜀 (총 13,321개, 파일 병렬 6). 실패 파일 119개는 [집계](proof/regular-summary.json)에 기록. 무관한 영역을 이 PR에서 수정하지 않음 |

- [수정 전 두 결함 실패](proof/before-defects.txt), [같은 검사 수정 후 2개 통과](proof/after-defects.txt), [production UI 12개](proof/production-ui.txt), [C1 촬영](proof/c1-evidence-stable.txt), [C2 최종 13개](proof/c2-final-ui.txt), [production build](proof/build.txt), [전체 타입 검사 기준 비교](proof/full-typecheck-summary.json).
- [조회·권한 블록 동일성](proof/owner-invariants.json), [원본 PNG SHA-256](proof/png-sha256.json).
- BEFORE/C1/C2는 같은 helper 해시를 사용합니다. 일반 갤러리의 8개 작품은 제목·이미지가 서로 다르며, 잔액은 새 DB에서도 유료 1,000P / 무료 0P로 고정됩니다. [fixture 기록](proof/fixture-reproducer.json)과 각 `source.json`에 해시를 남겼습니다.

### 실제 SHA와 변경 파일

| 구분 | SHA |
| --- | --- |
| 시작 전 조회한 최신 main / BEFORE 화면 소스 | `ac67801c5a3c0c2e25a8e5ae69dc68ba5a60add2` |
| 작업 중 재조회한 main | `65119ae9eecf493b3922923863813203de94013a` |
| C1 화면 소스 | `f183afbc5aa8a0e65be309dbd34d9e8cdb232921` |
| C2 화면 소스 | `c1b608b33a1e5ce80bce4373164b244a4fbe8061` |
| production build 소스 | `30ff40ec1752faa18a2f66e637351c333e7b14b9` |
| 최종 C1 기본 구현 / 동일 증상 재검증 | `b1d4494bed86ddd544cbe53c2d060d2bbcccc77a` |
| 아래 PNG 원본을 보관한 증거 커밋 | `7ed76af1b5d0f1f630296322b63e35bed6a4dd96` |

시작 기준 main 이후 추가된 #1618은 RP 유료 실행기 seal 및 테스트 2개 파일이며 이번 UI owner와 겹치지 않습니다. 이 Draft의 기준 분기는 시작 시점의 main입니다. C1 화면·production build·최종 fixture 커밋 사이의 `src/`는 동일하며 차이는 테스트·증거입니다. C2는 헤더 CSS만 다른 같은 정보 구조입니다. runtime 디자인 선택 플래그 없이 C1을 기본안으로 복원했고 C2 커밋은 이 브랜치 이력에 보존했습니다.

실제 제품 변경 파일은 아래 4개입니다.

- `src/app/creator/[id]/page.tsx`: 정보 배치·접기·작품 표시 분할·빈 상태.
- `src/app/creator/[id]/creator-gallery.css`: 이 페이지의 표시·줄바꿈·터치 영역.
- `src/components/CreatorGiftPanel.tsx`: 모바일 모달 높이·스크롤·초점·터치 크기.
- `src/components/ProfileCommentSection.tsx`: 입력 최소 폭·터치 높이·모바일 글자 크기.

정규 실행에서는 npm 스크립트의 조건·import·glob을 유지하고 파일 병렬도만 6으로 지정했습니다. `package.json`은 원래 상태로 복원했습니다.

검증 파일은 `tests/ui/creator-gallery.spec.ts`, `tests/ui/helpers/creatorGalleryFixture.ts`. 나머지는 이 감사 폴더의 원본 PNG·기록입니다.

### GitHub 원본 PNG — BEFORE / C1 / C2

모든 링크는 위 증거 커밋에 고정된 원본 PNG이며, 15개 장면 × 3안 = 45장입니다. 후보의 실제 화면 소스 SHA와 증거 저장 SHA를 구분했습니다.


## 검증 한계 / FOLLOW-UP

- 실제 iOS/Android 소프트 키보드·Safari·보조공학은 미검증. Chromium 화면 높이 리사이즈로 모달/입력 영역을 검증했습니다.
- 운영 DB 콘텐츠·운영 선물/댓글 변경·배포 후 시각 검증은 수행하지 않았습니다.
- 수동 대표작·아바타·팔로우·DB/API 추가는 범위 밖으로 유지했습니다.
- 전체 정규 suite의 수정 전후 완주 비교는 수행하지 않았습니다. 전체 타입 검사는 기준과 위치·코드가 동일함을 확인했고, 정규 suite의 변경하지 않은 영역 실패는 분리 보고합니다.

| 화면 | BEFORE | C1 | C2 |
| --- | --- | --- | --- |
| 390px 모바일 전체 | [BEFORE PNG](https://raw.githubusercontent.com/you8520-sketch/chat-ai/7ed76af1b5d0f1f630296322b63e35bed6a4dd96/docs/audits/creator-gallery-e4-3j/BEFORE/regular-390.png) | [C1 PNG](https://raw.githubusercontent.com/you8520-sketch/chat-ai/7ed76af1b5d0f1f630296322b63e35bed6a4dd96/docs/audits/creator-gallery-e4-3j/C1/regular-390.png) | [C2 PNG](https://raw.githubusercontent.com/you8520-sketch/chat-ai/7ed76af1b5d0f1f630296322b63e35bed6a4dd96/docs/audits/creator-gallery-e4-3j/C2/regular-390.png) |
| 768px 태블릿 전체 | [BEFORE PNG](https://raw.githubusercontent.com/you8520-sketch/chat-ai/7ed76af1b5d0f1f630296322b63e35bed6a4dd96/docs/audits/creator-gallery-e4-3j/BEFORE/regular-768.png) | [C1 PNG](https://raw.githubusercontent.com/you8520-sketch/chat-ai/7ed76af1b5d0f1f630296322b63e35bed6a4dd96/docs/audits/creator-gallery-e4-3j/C1/regular-768.png) | [C2 PNG](https://raw.githubusercontent.com/you8520-sketch/chat-ai/7ed76af1b5d0f1f630296322b63e35bed6a4dd96/docs/audits/creator-gallery-e4-3j/C2/regular-768.png) |
| 1440px PC 전체 | [BEFORE PNG](https://raw.githubusercontent.com/you8520-sketch/chat-ai/7ed76af1b5d0f1f630296322b63e35bed6a4dd96/docs/audits/creator-gallery-e4-3j/BEFORE/regular-1440.png) | [C1 PNG](https://raw.githubusercontent.com/you8520-sketch/chat-ai/7ed76af1b5d0f1f630296322b63e35bed6a4dd96/docs/audits/creator-gallery-e4-3j/C1/regular-1440.png) | [C2 PNG](https://raw.githubusercontent.com/you8520-sketch/chat-ai/7ed76af1b5d0f1f630296322b63e35bed6a4dd96/docs/audits/creator-gallery-e4-3j/C2/regular-1440.png) |
| 360px 모바일 전체 | [BEFORE PNG](https://raw.githubusercontent.com/you8520-sketch/chat-ai/7ed76af1b5d0f1f630296322b63e35bed6a4dd96/docs/audits/creator-gallery-e4-3j/BEFORE/regular-360.png) | [C1 PNG](https://raw.githubusercontent.com/you8520-sketch/chat-ai/7ed76af1b5d0f1f630296322b63e35bed6a4dd96/docs/audits/creator-gallery-e4-3j/C1/regular-360.png) | [C2 PNG](https://raw.githubusercontent.com/you8520-sketch/chat-ai/7ed76af1b5d0f1f630296322b63e35bed6a4dd96/docs/audits/creator-gallery-e4-3j/C2/regular-360.png) |
| 긴 소개·공지·제목 / 390px | [BEFORE PNG](https://raw.githubusercontent.com/you8520-sketch/chat-ai/7ed76af1b5d0f1f630296322b63e35bed6a4dd96/docs/audits/creator-gallery-e4-3j/BEFORE/long-390.png) | [C1 PNG](https://raw.githubusercontent.com/you8520-sketch/chat-ai/7ed76af1b5d0f1f630296322b63e35bed6a4dd96/docs/audits/creator-gallery-e4-3j/C1/long-390.png) | [C2 PNG](https://raw.githubusercontent.com/you8520-sketch/chat-ai/7ed76af1b5d0f1f630296322b63e35bed6a4dd96/docs/audits/creator-gallery-e4-3j/C2/long-390.png) |
| 긴 소개·공지·제목 / 1440px | [BEFORE PNG](https://raw.githubusercontent.com/you8520-sketch/chat-ai/7ed76af1b5d0f1f630296322b63e35bed6a4dd96/docs/audits/creator-gallery-e4-3j/BEFORE/long-1440.png) | [C1 PNG](https://raw.githubusercontent.com/you8520-sketch/chat-ai/7ed76af1b5d0f1f630296322b63e35bed6a4dd96/docs/audits/creator-gallery-e4-3j/C1/long-1440.png) | [C2 PNG](https://raw.githubusercontent.com/you8520-sketch/chat-ai/7ed76af1b5d0f1f630296322b63e35bed6a4dd96/docs/audits/creator-gallery-e4-3j/C2/long-1440.png) |
| 소개·공지·공개 작품 없음 | [BEFORE PNG](https://raw.githubusercontent.com/you8520-sketch/chat-ai/7ed76af1b5d0f1f630296322b63e35bed6a4dd96/docs/audits/creator-gallery-e4-3j/BEFORE/empty-390.png) | [C1 PNG](https://raw.githubusercontent.com/you8520-sketch/chat-ai/7ed76af1b5d0f1f630296322b63e35bed6a4dd96/docs/audits/creator-gallery-e4-3j/C1/empty-390.png) | [C2 PNG](https://raw.githubusercontent.com/you8520-sketch/chat-ai/7ed76af1b5d0f1f630296322b63e35bed6a4dd96/docs/audits/creator-gallery-e4-3j/C2/empty-390.png) |
| 공개 작품 1개 | [BEFORE PNG](https://raw.githubusercontent.com/you8520-sketch/chat-ai/7ed76af1b5d0f1f630296322b63e35bed6a4dd96/docs/audits/creator-gallery-e4-3j/BEFORE/single-390.png) | [C1 PNG](https://raw.githubusercontent.com/you8520-sketch/chat-ai/7ed76af1b5d0f1f630296322b63e35bed6a4dd96/docs/audits/creator-gallery-e4-3j/C1/single-390.png) | [C2 PNG](https://raw.githubusercontent.com/you8520-sketch/chat-ai/7ed76af1b5d0f1f630296322b63e35bed6a4dd96/docs/audits/creator-gallery-e4-3j/C2/single-390.png) |
| 공식 스튜디오 | [BEFORE PNG](https://raw.githubusercontent.com/you8520-sketch/chat-ai/7ed76af1b5d0f1f630296322b63e35bed6a4dd96/docs/audits/creator-gallery-e4-3j/BEFORE/official-390.png) | [C1 PNG](https://raw.githubusercontent.com/you8520-sketch/chat-ai/7ed76af1b5d0f1f630296322b63e35bed6a4dd96/docs/audits/creator-gallery-e4-3j/C1/official-390.png) | [C2 PNG](https://raw.githubusercontent.com/you8520-sketch/chat-ai/7ed76af1b5d0f1f630296322b63e35bed6a4dd96/docs/audits/creator-gallery-e4-3j/C2/official-390.png) |
| 파트너·24개 작품 갤러리 | [BEFORE PNG](https://raw.githubusercontent.com/you8520-sketch/chat-ai/7ed76af1b5d0f1f630296322b63e35bed6a4dd96/docs/audits/creator-gallery-e4-3j/BEFORE/partner-1440.png) | [C1 PNG](https://raw.githubusercontent.com/you8520-sketch/chat-ai/7ed76af1b5d0f1f630296322b63e35bed6a4dd96/docs/audits/creator-gallery-e4-3j/C1/partner-1440.png) | [C2 PNG](https://raw.githubusercontent.com/you8520-sketch/chat-ai/7ed76af1b5d0f1f630296322b63e35bed6a4dd96/docs/audits/creator-gallery-e4-3j/C2/partner-1440.png) |
| 레거시 HTML 공지 | [BEFORE PNG](https://raw.githubusercontent.com/you8520-sketch/chat-ai/7ed76af1b5d0f1f630296322b63e35bed6a4dd96/docs/audits/creator-gallery-e4-3j/BEFORE/legacy-390.png) | [C1 PNG](https://raw.githubusercontent.com/you8520-sketch/chat-ai/7ed76af1b5d0f1f630296322b63e35bed6a4dd96/docs/audits/creator-gallery-e4-3j/C1/legacy-390.png) | [C2 PNG](https://raw.githubusercontent.com/you8520-sketch/chat-ai/7ed76af1b5d0f1f630296322b63e35bed6a4dd96/docs/audits/creator-gallery-e4-3j/C2/legacy-390.png) |
| 로그인 방문자 전체 | [BEFORE PNG](https://raw.githubusercontent.com/you8520-sketch/chat-ai/7ed76af1b5d0f1f630296322b63e35bed6a4dd96/docs/audits/creator-gallery-e4-3j/BEFORE/community-390.png) | [C1 PNG](https://raw.githubusercontent.com/you8520-sketch/chat-ai/7ed76af1b5d0f1f630296322b63e35bed6a4dd96/docs/audits/creator-gallery-e4-3j/C1/community-390.png) | [C2 PNG](https://raw.githubusercontent.com/you8520-sketch/chat-ai/7ed76af1b5d0f1f630296322b63e35bed6a4dd96/docs/audits/creator-gallery-e4-3j/C2/community-390.png) |
| 댓글 입력 영역 | [BEFORE PNG](https://raw.githubusercontent.com/you8520-sketch/chat-ai/7ed76af1b5d0f1f630296322b63e35bed6a4dd96/docs/audits/creator-gallery-e4-3j/BEFORE/comments-390.png) | [C1 PNG](https://raw.githubusercontent.com/you8520-sketch/chat-ai/7ed76af1b5d0f1f630296322b63e35bed6a4dd96/docs/audits/creator-gallery-e4-3j/C1/comments-390.png) | [C2 PNG](https://raw.githubusercontent.com/you8520-sketch/chat-ai/7ed76af1b5d0f1f630296322b63e35bed6a4dd96/docs/audits/creator-gallery-e4-3j/C2/comments-390.png) |
| 선물 모달 | [BEFORE PNG](https://raw.githubusercontent.com/you8520-sketch/chat-ai/7ed76af1b5d0f1f630296322b63e35bed6a4dd96/docs/audits/creator-gallery-e4-3j/BEFORE/gift-390.png) | [C1 PNG](https://raw.githubusercontent.com/you8520-sketch/chat-ai/7ed76af1b5d0f1f630296322b63e35bed6a4dd96/docs/audits/creator-gallery-e4-3j/C1/gift-390.png) | [C2 PNG](https://raw.githubusercontent.com/you8520-sketch/chat-ai/7ed76af1b5d0f1f630296322b63e35bed6a4dd96/docs/audits/creator-gallery-e4-3j/C2/gift-390.png) |
| 본인·댓글 설정 | [BEFORE PNG](https://raw.githubusercontent.com/you8520-sketch/chat-ai/7ed76af1b5d0f1f630296322b63e35bed6a4dd96/docs/audits/creator-gallery-e4-3j/BEFORE/owner-390.png) | [C1 PNG](https://raw.githubusercontent.com/you8520-sketch/chat-ai/7ed76af1b5d0f1f630296322b63e35bed6a4dd96/docs/audits/creator-gallery-e4-3j/C1/owner-390.png) | [C2 PNG](https://raw.githubusercontent.com/you8520-sketch/chat-ai/7ed76af1b5d0f1f630296322b63e35bed6a4dd96/docs/audits/creator-gallery-e4-3j/C2/owner-390.png) |

## 재현

기본 `playwright.config.ts`의 격리 production 서버를 사용할 때:

```sh
npm ci
npm run build
npx playwright test tests/ui/creator-gallery.spec.ts --grep-invert evidence
```

직접 격리 서버를 실행하고 촬영할 때, 서버와 테스트에 같은 별도 DB 경로를 지정합니다. runtime 키를 비우며 운영 DB를 연결하지 않습니다.

```sh
DATA_DIR=/tmp/hav-creator-gallery-e4-3j \
TURSO_DATABASE_URL= TURSO_AUTH_TOKEN= TURSO_DATABASE_TURSO_AUTH_TOKEN= \
OPENROUTER_API_KEY= CHEAPER_INFERENCE_API_KEY= OPENAI_API_KEY= \
HAV_LOCAL_UI_FIXTURES=0 npm run dev:next -- --hostname 127.0.0.1 -p 3100

PLAYWRIGHT_SKIP_WEB_SERVER=1 \
PLAYWRIGHT_BASE_URL=http://127.0.0.1:3100 \
PLAYWRIGHT_DATA_DIR=/tmp/hav-creator-gallery-e4-3j \
CREATOR_GALLERY_EVIDENCE_DIR=/tmp/hav-creator-gallery-evidence \
npx playwright test tests/ui/creator-gallery.spec.ts
```

Chromium이 별도 경로에 있다면 `PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH`를 지정합니다. 이 환경에서는 `/usr/bin/chromium`을 사용했습니다. 원본 비교 화면은 `source.json`의 화면 소스 커밋을 기준으로 합니다.

Draft 제출 후 GPT 검수 대기. 자동 병합·운영 배포 없음.
