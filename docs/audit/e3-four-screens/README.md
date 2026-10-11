# 하브 4개 주요 화면 디자인 품질 비교 — UI VISUAL AUDIT ONLY

모든 이미지는 **AUDIT ONLY** (기존 디자인, 변경 없음). 코드 수정·신규 PR 없음. Cursor는 디자인 점수를 매기지 않는다.

## 1. 기준 확인
- GitHub `main` 최신: `f338ac6d2affa2a95e05538de04d2ee157d6cd33` (2026-10-11 06:41 UTC, #1533)
- Railway production 배포: GitHub deployment `6992039795` = `f338ac6d`, 상태 `success` (06:45:25 UTC)
- 실제 페이지: `https://hav.chat/api/health` -> `gitCommit: f338ac6`, `gitBranch: main`
- 캡처 기준 SHA = **f338ac6** (main = 배포 = 캡처 일치)
- 캡처 환경: headless Chromium (playwright-core), 비로그인(허가된 테스트 계정 없음, 로그인/우회 시도 없음), GET 페이지 로드만 수행, 데이터 변경 없음. 2026-10-11 UTC.
- 비로그인 상태이므로 취향(성향) 필터는 기본값(전체)이며 "로그인 후 저장" 안내가 표시된다. 로그인 사용자의 추천/취향 결과는 이번 캡처에 포함되지 않았다.

## 2. 실제 데이터 유무 / 기본 필터 / 빈 상태 (production, 비로그인)
| 화면 | 데이터 | 기본 필터 | 빈 상태 |
| --- | --- | --- | --- |
| `/` 홈 | 추천 2건(강이현, 루시안 바스케스), 공모전 0건(섹션 숨김), 신규 2건 | 취향 `전체`, 비로그인 | 3개 섹션이 모두 비면 "아직 공개된 이야기가 없습니다." 카드 + "첫 이야기 만들기" (현재는 미표시) |
| `/tab/new` | 1건 (강이현). 공식 캐릭터는 쿼리에서 제외(`official=0`) | 없음 (최신순 50건) | "표시할 캐릭터가 없습니다." 한 줄 (현재는 미표시) |
| `/tab/ranking` | 기본(실시간 6시간) **0건**, 일간 0건, 주간 0건, 월간 있음, 전체 2건(강이현 24, 루시안 0) | 기간 `실시간`, 취향 `전체` | 기본 화면이 "실시간 기간에 대화가 시작된 캐릭터가 없습니다." 한 줄 |
| `/search` | 검색어 없음 상태: 장르 칩 + 인기 태그 8개 + 안내 문구. 쿼리 `강이현` 1건, 장르 `로맨스 판타지` 1건, 없는 이름 0건 | 장르 `전체` | "검색어를 입력하거나 위 장르·인기 태그를 눌러보세요." / "「…」에 해당하는 결과가 없습니다." |

## 3. 이미지 (모두 AUDIT ONLY, SHA f338ac6)
파일명 규칙: `{page}-{viewport}-1-first` = 첫 화면, `-2-scrollN` = 스크롤 후(화면 높이-60px 단위). 로드 후 networkidle + 1.5초 뒤 캡처.

### 홈 `/`

**m390** (390x844)

<img alt="AUDIT ONLY home-m390-1-first.png" src="https://raw.githubusercontent.com/you8520-sketch/chat-ai/cursor/ui-four-screen-audit-78cc/docs/audit/e3-four-screens/audit-only/home-m390-1-first.png" width="260" /> <img alt="AUDIT ONLY home-m390-2-scroll1.png" src="https://raw.githubusercontent.com/you8520-sketch/chat-ai/cursor/ui-four-screen-audit-78cc/docs/audit/e3-four-screens/audit-only/home-m390-2-scroll1.png" width="260" /> <img alt="AUDIT ONLY home-m390-2-scroll2.png" src="https://raw.githubusercontent.com/you8520-sketch/chat-ai/cursor/ui-four-screen-audit-78cc/docs/audit/e3-four-screens/audit-only/home-m390-2-scroll2.png" width="260" />

**m360** (360x800)

<img alt="AUDIT ONLY home-m360-1-first.png" src="https://raw.githubusercontent.com/you8520-sketch/chat-ai/cursor/ui-four-screen-audit-78cc/docs/audit/e3-four-screens/audit-only/home-m360-1-first.png" width="240" /> <img alt="AUDIT ONLY home-m360-2-scroll1.png" src="https://raw.githubusercontent.com/you8520-sketch/chat-ai/cursor/ui-four-screen-audit-78cc/docs/audit/e3-four-screens/audit-only/home-m360-2-scroll1.png" width="240" /> <img alt="AUDIT ONLY home-m360-2-scroll2.png" src="https://raw.githubusercontent.com/you8520-sketch/chat-ai/cursor/ui-four-screen-audit-78cc/docs/audit/e3-four-screens/audit-only/home-m360-2-scroll2.png" width="240" />

**pc1440** (1440x900)

![AUDIT ONLY home-pc1440-1-first.png](https://raw.githubusercontent.com/you8520-sketch/chat-ai/cursor/ui-four-screen-audit-78cc/docs/audit/e3-four-screens/audit-only/home-pc1440-1-first.png)

![AUDIT ONLY home-pc1440-2-scroll1.png](https://raw.githubusercontent.com/you8520-sketch/chat-ai/cursor/ui-four-screen-audit-78cc/docs/audit/e3-four-screens/audit-only/home-pc1440-2-scroll1.png)

![AUDIT ONLY home-pc1440-2-scroll2.png](https://raw.githubusercontent.com/you8520-sketch/chat-ai/cursor/ui-four-screen-audit-78cc/docs/audit/e3-four-screens/audit-only/home-pc1440-2-scroll2.png)

### 신작 `/tab/new`

**m390** (390x844)

<img alt="AUDIT ONLY new-m390-1-first.png" src="https://raw.githubusercontent.com/you8520-sketch/chat-ai/cursor/ui-four-screen-audit-78cc/docs/audit/e3-four-screens/audit-only/new-m390-1-first.png" width="260" /> <img alt="AUDIT ONLY new-m390-2-scroll1.png" src="https://raw.githubusercontent.com/you8520-sketch/chat-ai/cursor/ui-four-screen-audit-78cc/docs/audit/e3-four-screens/audit-only/new-m390-2-scroll1.png" width="260" />

**m360** (360x800)

<img alt="AUDIT ONLY new-m360-1-first.png" src="https://raw.githubusercontent.com/you8520-sketch/chat-ai/cursor/ui-four-screen-audit-78cc/docs/audit/e3-four-screens/audit-only/new-m360-1-first.png" width="240" /> <img alt="AUDIT ONLY new-m360-2-scroll1.png" src="https://raw.githubusercontent.com/you8520-sketch/chat-ai/cursor/ui-four-screen-audit-78cc/docs/audit/e3-four-screens/audit-only/new-m360-2-scroll1.png" width="240" />

**pc1440** (1440x900)

![AUDIT ONLY new-pc1440-1-first.png](https://raw.githubusercontent.com/you8520-sketch/chat-ai/cursor/ui-four-screen-audit-78cc/docs/audit/e3-four-screens/audit-only/new-pc1440-1-first.png)

![AUDIT ONLY new-pc1440-2-scroll1.png](https://raw.githubusercontent.com/you8520-sketch/chat-ai/cursor/ui-four-screen-audit-78cc/docs/audit/e3-four-screens/audit-only/new-pc1440-2-scroll1.png)

### 랭킹 `/tab/ranking` (기본: 실시간)

**m390** (390x844)

<img alt="AUDIT ONLY ranking-m390-1-first.png" src="https://raw.githubusercontent.com/you8520-sketch/chat-ai/cursor/ui-four-screen-audit-78cc/docs/audit/e3-four-screens/audit-only/ranking-m390-1-first.png" width="260" /> <img alt="AUDIT ONLY ranking-m390-2-scroll1.png" src="https://raw.githubusercontent.com/you8520-sketch/chat-ai/cursor/ui-four-screen-audit-78cc/docs/audit/e3-four-screens/audit-only/ranking-m390-2-scroll1.png" width="260" />

**m360** (360x800)

<img alt="AUDIT ONLY ranking-m360-1-first.png" src="https://raw.githubusercontent.com/you8520-sketch/chat-ai/cursor/ui-four-screen-audit-78cc/docs/audit/e3-four-screens/audit-only/ranking-m360-1-first.png" width="240" /> <img alt="AUDIT ONLY ranking-m360-2-scroll1.png" src="https://raw.githubusercontent.com/you8520-sketch/chat-ai/cursor/ui-four-screen-audit-78cc/docs/audit/e3-four-screens/audit-only/ranking-m360-2-scroll1.png" width="240" />

**pc1440** (1440x900)

![AUDIT ONLY ranking-pc1440-1-first.png](https://raw.githubusercontent.com/you8520-sketch/chat-ai/cursor/ui-four-screen-audit-78cc/docs/audit/e3-four-screens/audit-only/ranking-pc1440-1-first.png)

![AUDIT ONLY ranking-pc1440-2-scroll1.png](https://raw.githubusercontent.com/you8520-sketch/chat-ai/cursor/ui-four-screen-audit-78cc/docs/audit/e3-four-screens/audit-only/ranking-pc1440-2-scroll1.png)

### 검색 `/search` (기본)

**m390** (390x844)

<img alt="AUDIT ONLY search-m390-1-first.png" src="https://raw.githubusercontent.com/you8520-sketch/chat-ai/cursor/ui-four-screen-audit-78cc/docs/audit/e3-four-screens/audit-only/search-m390-1-first.png" width="260" /> <img alt="AUDIT ONLY search-m390-2-scroll1.png" src="https://raw.githubusercontent.com/you8520-sketch/chat-ai/cursor/ui-four-screen-audit-78cc/docs/audit/e3-four-screens/audit-only/search-m390-2-scroll1.png" width="260" />

**m360** (360x800)

<img alt="AUDIT ONLY search-m360-1-first.png" src="https://raw.githubusercontent.com/you8520-sketch/chat-ai/cursor/ui-four-screen-audit-78cc/docs/audit/e3-four-screens/audit-only/search-m360-1-first.png" width="240" /> <img alt="AUDIT ONLY search-m360-2-scroll1.png" src="https://raw.githubusercontent.com/you8520-sketch/chat-ai/cursor/ui-four-screen-audit-78cc/docs/audit/e3-four-screens/audit-only/search-m360-2-scroll1.png" width="240" />

**pc1440** (1440x900)

![AUDIT ONLY search-pc1440-1-first.png](https://raw.githubusercontent.com/you8520-sketch/chat-ai/cursor/ui-four-screen-audit-78cc/docs/audit/e3-four-screens/audit-only/search-pc1440-1-first.png)

![AUDIT ONLY search-pc1440-2-scroll1.png](https://raw.githubusercontent.com/you8520-sketch/chat-ai/cursor/ui-four-screen-audit-78cc/docs/audit/e3-four-screens/audit-only/search-pc1440-2-scroll1.png)

### 데이터 상태별 추가 캡처 (모두 AUDIT ONLY, 390x844 / 360x800 / 1440x900 동일 규칙)

**랭킹 전체 기간 (데이터 있음)**

<img alt="AUDIT ONLY ranking-all-m390-1-first.png" src="https://raw.githubusercontent.com/you8520-sketch/chat-ai/cursor/ui-four-screen-audit-78cc/docs/audit/e3-four-screens/audit-only/ranking-all-m390-1-first.png" width="260" /> <img alt="AUDIT ONLY ranking-all-m360-1-first.png" src="https://raw.githubusercontent.com/you8520-sketch/chat-ai/cursor/ui-four-screen-audit-78cc/docs/audit/e3-four-screens/audit-only/ranking-all-m360-1-first.png" width="260" /> <img alt="AUDIT ONLY ranking-all-pc1440-1-first.png" src="https://raw.githubusercontent.com/you8520-sketch/chat-ai/cursor/ui-four-screen-audit-78cc/docs/audit/e3-four-screens/audit-only/ranking-all-pc1440-1-first.png" width="520" />

**랭킹 월간**

<img alt="AUDIT ONLY ranking-monthly-m390-1-first.png" src="https://raw.githubusercontent.com/you8520-sketch/chat-ai/cursor/ui-four-screen-audit-78cc/docs/audit/e3-four-screens/audit-only/ranking-monthly-m390-1-first.png" width="260" /> <img alt="AUDIT ONLY ranking-monthly-m360-1-first.png" src="https://raw.githubusercontent.com/you8520-sketch/chat-ai/cursor/ui-four-screen-audit-78cc/docs/audit/e3-four-screens/audit-only/ranking-monthly-m360-1-first.png" width="260" /> <img alt="AUDIT ONLY ranking-monthly-pc1440-1-first.png" src="https://raw.githubusercontent.com/you8520-sketch/chat-ai/cursor/ui-four-screen-audit-78cc/docs/audit/e3-four-screens/audit-only/ranking-monthly-pc1440-1-first.png" width="520" />

**랭킹 일간 (빈 상태)**

<img alt="AUDIT ONLY ranking-daily-m390-1-first.png" src="https://raw.githubusercontent.com/you8520-sketch/chat-ai/cursor/ui-four-screen-audit-78cc/docs/audit/e3-four-screens/audit-only/ranking-daily-m390-1-first.png" width="260" /> <img alt="AUDIT ONLY ranking-daily-m360-1-first.png" src="https://raw.githubusercontent.com/you8520-sketch/chat-ai/cursor/ui-four-screen-audit-78cc/docs/audit/e3-four-screens/audit-only/ranking-daily-m360-1-first.png" width="260" /> <img alt="AUDIT ONLY ranking-daily-pc1440-1-first.png" src="https://raw.githubusercontent.com/you8520-sketch/chat-ai/cursor/ui-four-screen-audit-78cc/docs/audit/e3-four-screens/audit-only/ranking-daily-pc1440-1-first.png" width="520" />

**랭킹 주간 (빈 상태)**

<img alt="AUDIT ONLY ranking-weekly-m390-1-first.png" src="https://raw.githubusercontent.com/you8520-sketch/chat-ai/cursor/ui-four-screen-audit-78cc/docs/audit/e3-four-screens/audit-only/ranking-weekly-m390-1-first.png" width="260" /> <img alt="AUDIT ONLY ranking-weekly-m360-1-first.png" src="https://raw.githubusercontent.com/you8520-sketch/chat-ai/cursor/ui-four-screen-audit-78cc/docs/audit/e3-four-screens/audit-only/ranking-weekly-m360-1-first.png" width="260" /> <img alt="AUDIT ONLY ranking-weekly-pc1440-1-first.png" src="https://raw.githubusercontent.com/you8520-sketch/chat-ai/cursor/ui-four-screen-audit-78cc/docs/audit/e3-four-screens/audit-only/ranking-weekly-pc1440-1-first.png" width="520" />

**검색 `강이현` (결과 1건)**

<img alt="AUDIT ONLY search-query-hit-m390-1-first.png" src="https://raw.githubusercontent.com/you8520-sketch/chat-ai/cursor/ui-four-screen-audit-78cc/docs/audit/e3-four-screens/audit-only/search-query-hit-m390-1-first.png" width="260" /> <img alt="AUDIT ONLY search-query-hit-m360-1-first.png" src="https://raw.githubusercontent.com/you8520-sketch/chat-ai/cursor/ui-four-screen-audit-78cc/docs/audit/e3-four-screens/audit-only/search-query-hit-m360-1-first.png" width="260" /> <img alt="AUDIT ONLY search-query-hit-pc1440-1-first.png" src="https://raw.githubusercontent.com/you8520-sketch/chat-ai/cursor/ui-four-screen-audit-78cc/docs/audit/e3-four-screens/audit-only/search-query-hit-pc1440-1-first.png" width="520" />

**검색 결과 0건**

<img alt="AUDIT ONLY search-query-miss-m390-1-first.png" src="https://raw.githubusercontent.com/you8520-sketch/chat-ai/cursor/ui-four-screen-audit-78cc/docs/audit/e3-four-screens/audit-only/search-query-miss-m390-1-first.png" width="260" /> <img alt="AUDIT ONLY search-query-miss-m360-1-first.png" src="https://raw.githubusercontent.com/you8520-sketch/chat-ai/cursor/ui-four-screen-audit-78cc/docs/audit/e3-four-screens/audit-only/search-query-miss-m360-1-first.png" width="260" /> <img alt="AUDIT ONLY search-query-miss-pc1440-1-first.png" src="https://raw.githubusercontent.com/you8520-sketch/chat-ai/cursor/ui-four-screen-audit-78cc/docs/audit/e3-four-screens/audit-only/search-query-miss-pc1440-1-first.png" width="520" />

**검색 장르 `로맨스 판타지`**

<img alt="AUDIT ONLY search-genre-m390-1-first.png" src="https://raw.githubusercontent.com/you8520-sketch/chat-ai/cursor/ui-four-screen-audit-78cc/docs/audit/e3-four-screens/audit-only/search-genre-m390-1-first.png" width="260" /> <img alt="AUDIT ONLY search-genre-m360-1-first.png" src="https://raw.githubusercontent.com/you8520-sketch/chat-ai/cursor/ui-four-screen-audit-78cc/docs/audit/e3-four-screens/audit-only/search-genre-m360-1-first.png" width="260" /> <img alt="AUDIT ONLY search-genre-pc1440-1-first.png" src="https://raw.githubusercontent.com/you8520-sketch/chat-ai/cursor/ui-four-screen-audit-78cc/docs/audit/e3-four-screens/audit-only/search-genre-pc1440-1-first.png" width="520" />

**검색 인기 태그 칩 `아포칼립스` (칩이 실제로 보내는 URL)**

<img alt="AUDIT ONLY search-tag-chip-m390-1-first.png" src="https://raw.githubusercontent.com/you8520-sketch/chat-ai/cursor/ui-four-screen-audit-78cc/docs/audit/e3-four-screens/audit-only/search-tag-chip-m390-1-first.png" width="260" /> <img alt="AUDIT ONLY search-tag-chip-m360-1-first.png" src="https://raw.githubusercontent.com/you8520-sketch/chat-ai/cursor/ui-four-screen-audit-78cc/docs/audit/e3-four-screens/audit-only/search-tag-chip-m360-1-first.png" width="260" /> <img alt="AUDIT ONLY search-tag-chip-pc1440-1-first.png" src="https://raw.githubusercontent.com/you8520-sketch/chat-ai/cursor/ui-four-screen-audit-78cc/docs/audit/e3-four-screens/audit-only/search-tag-chip-pc1440-1-first.png" width="520" />

**검색 `#아포칼립스` 직접 입력 (칩 표기와 동일하게 `#` 입력)**

<img alt="AUDIT ONLY search-hash-typed-m390-1-first.png" src="https://raw.githubusercontent.com/you8520-sketch/chat-ai/cursor/ui-four-screen-audit-78cc/docs/audit/e3-four-screens/audit-only/search-hash-typed-m390-1-first.png" width="260" /> <img alt="AUDIT ONLY search-hash-typed-m360-1-first.png" src="https://raw.githubusercontent.com/you8520-sketch/chat-ai/cursor/ui-four-screen-audit-78cc/docs/audit/e3-four-screens/audit-only/search-hash-typed-m360-1-first.png" width="260" /> <img alt="AUDIT ONLY search-hash-typed-pc1440-1-first.png" src="https://raw.githubusercontent.com/you8520-sketch/chat-ai/cursor/ui-four-screen-audit-78cc/docs/audit/e3-four-screens/audit-only/search-hash-typed-pc1440-1-first.png" width="520" />

## 4. 페이지 간 비교표 (측정값 + 관찰, 점수 없음)
측정: production, 비로그인, 3개 viewport 평균 범위. `H` = 문서 높이(390px 기준).

| 항목 | 홈 `/` | 신작 `/tab/new` | 랭킹 `/tab/ranking` | 검색 `/search` |
| --- | --- | --- | --- | --- |
| 첫 화면 시선 집중 | 이벤트 배너 → `01 추천 캐릭터` 슬래브 제목 + 대형 포스터 카드(첫 카드가 폴드에서 일부 잘림) | 단순 `h1` + 카드 1장(화면 폭의 약 45%) | `h1` + 필터 칩 + 한 줄 안내문(콘텐츠 없음) | `h1` + 검색창 + 장르 칩 20개 + 인기 태그 (콘텐츠 없음, 칩이 화면 대부분) |
| 카드 형태 | 에디토리얼 / 인덱스 변형 (이미지 위 이름 오버레이, 번호) | `CharacterCard` 기본형 (이미지 + 본문 + 태그) | 행(row) 형태 (순위 + 56px 썸네일 + 💬 수) | `CharacterCard` 기본형 + 매치 종류 배지 |
| 문서 높이 H (390) | 1788 | 996 | 844 (빈 상태) / 918 (전체 기간) | 1123 (검색 전) / 1578 (결과 1건) |
| 첫 화면 이미지 수 | 3 | 2 | 1 (로고만) | 1 (로고만) |
| 빈/소량 데이터 | 섹션 숨김 처리, 번호는 고정 | 카드 1장만 좌측 정렬, 우측·하단 공백 | 한 줄 문구만 있고 이동 경로 없음 | 안내 문구 + 칩 제공 (상태 설명 양호) |
| 제목/계층 | 슬래브 + 대형 숫자 | `studioType.heading` | `studioType.heading` + helper | `AppPageShell` 제목 + 설명 |
| 가로 넘침 (3 viewport) | 없음 | 없음 | 없음 | 없음 |
| CLS / LCP | 0~0.01 / 530~640ms | 0~0.01 / 490~510ms | 0~0.01 / 400~420ms | 0~0.01 / 380~460ms |
| 콘솔 오류 / 4xx·5xx / 깨진 이미지 | 0 / 0 / 0 | 0 / 0 / 0 | 0 / 0 / 0 | 0 / 0 / 0 |
| 키보드 포커스 링 (390, Tab 7회) | 모두 표시 | 모두 표시 | 모두 표시 | 모두 표시 |
| reduced-motion 실행 중 애니메이션 | 0 | 0 | 0 | 0 |
| 4.5:1 미만 텍스트 | 장식 숫자 `03` 1개 (56px 대형 텍스트, 4.02:1) | 없음 | 없음 | 없음 |
| 터치 대상 < 36px (390) | 18개 (취향 `전체▾` 30px, `로그인 후 저장`/`취향 설정` 17px, 카드 내 `by …` 15px, 태그 17px) | 9개 (카드 내 태그 21px, `by` 15px, 푸터 링크 18px) | 4개 (`로그인 후 저장` 16px, 푸터 링크 18px) | 32개 (장르·태그 칩 34px 높이 등) |

원본 수치: `e3-prod-metrics.json`, `e3-prod-a11y.json`, `e3-prod-states.json`.

## 5. 실제 결함 vs 취향 개선 (구분)

### A. 실제 관찰된 결함 (재현 가능, 증거 이미지/코드 근거)
| ID | 화면 | 내용 | 근거 |
| --- | --- | --- | --- |
| D1 | 랭킹 + 홈 | 홈 `추천 캐릭터 전체보기` / `공모전 보기`와 상단 `랭킹` 메뉴가 `/tab/ranking`으로 이동하는데, 기본 기간이 `실시간(6시간)`이라 현재 production에서는 **빈 화면 + 한 줄 문구**가 첫 화면이다. 같은 페이지의 `월간`, `전체`에는 캐릭터가 있다. 빈 상태에서 다른 기간·홈으로 안내하는 요소가 없다. | `ranking-*-1-first`, `ranking-all-*`, `ranking-monthly-*`; `characterRanking.ts` `parseRankingPeriod` 기본값 `realtime`; `tab/[tab]/page.tsx` 빈 상태 `<p>` |
| D2 | 홈 | 섹션 번호가 `01` 다음 `03`으로 건너뜀. `공모전 당선작`(02)이 데이터가 없어 숨겨져도 번호는 제목별로 고정되어 있다. | `home-m390-2-scroll1`, `home-pc1440-2-scroll1`; `page.tsx` `SECTION_META` 하드코딩 `index` |
| D3 | 검색 | 검색창 placeholder가 390px·360px에서 잘림(`… (예: ꓸ`, `… 태그 검색 (`). 예시 문구에 `틤작`이라는 오타로 보이는 단어가 있다. | `search-m390-1-first`, `search-m360-1-first`; `TagSearchBar.tsx` placeholder |
| D4 | 검색 | 인기 태그 칩은 `#아포칼립스`로 표시되지만 같은 문구 `#아포칼립스`를 검색창에 입력하면 0건이다(칩은 `#` 없이 `q=아포칼립스`로 이동 → 결과 있음). | `search-tag-chip-*` vs `search-hash-typed-*`; `tagSearch.ts` `sanitizeSearchQuery`는 `#`를 제거하지 않음 |

### B. 불일치(의도 확인 필요, 결함 단정 아님)
| ID | 화면 | 내용 | 근거 |
| --- | --- | --- | --- |
| I1 | 홈 ↔ 신작 | 홈 `신규 캐릭터`는 2건(공식 루시안 포함)인데 그 `더보기`가 가는 `/tab/new`는 1건만 보여준다. `/tab/new`는 `official=0`만 조회한다. | `home-*-2-scroll1` vs `new-*-1-first`; `tab/[tab]/page.tsx` `listableWhere("official=0")`, `homeSections.ts` `fetchNewestCharacters` |

### C. 취향/방향성 개선 (결함 아님)
- 홈은 에디토리얼 카드·대형 숫자 슬래브, 신작·검색은 기본 카드, 랭킹은 행 목록으로 카드 언어가 세 가지다. 홈 이후 화면의 시각적 연결감은 취향 영역이다.
- 신작/검색의 소량 데이터(1~2장)에서 PC 화면 우측 공백이 큼. 데이터가 늘면 해소되는 성격이 크다.
- 검색 첫 화면에서 장르 칩 20개가 화면 대부분을 차지하고 결과는 그 아래에 나온다(결과 1건 시 첫 화면에 카드가 일부만 보임).
- 360px 검색 안내문 마지막 줄에 `요.` 한 글자만 남는 줄바꿈.
- 신작 카드 1장에 키보드 탭 정지점이 8개(이미지·이름·제작자·소개·태그 4개, 이미지/이름은 같은 목적지).
- 작은 텍스트 링크·태그의 터치 크기(15~21px, 장르 칩 34px). 측정값은 사실이나 사용성 영향은 실기기 확인 전 미확정.
- 검색 입력 글자 크기 14px(`text-sm`): iOS Safari는 16px 미만 입력 포커스 시 확대하는 것으로 알려져 있으나 이번 환경(Chromium)에서는 **검증하지 못함**.

### D. 문제 없음 (개선 대상 아님)
레이아웃 이동(CLS ≤ 0.01), 체감 로드(LCP ≤ 0.64초), 콘솔/네트워크 오류 0, 깨진 이미지 0, 가로 넘침 0, 키보드 포커스 링, reduced-motion, 문서당 `h1` 1개, 색 대비(장식 숫자 외 전부 4.5:1 이상), 3개 viewport 전반의 잘림(검색 placeholder 제외) 없음.

## 6. 후보, 영향 범위, 회귀 위험, 재사용 가능성
### 반드시 수정할 후보 (실제 결함)
| 후보 | owner (현재 코드) | 데이터 소스 / empty state | 영향 범위 | 회귀 위험 | 기존 재사용 |
| --- | --- | --- | --- | --- | --- |
| R1 (D1) 랭킹 기본 빈 화면 | `src/app/tab/[tab]/page.tsx` (랭킹 분기·빈 상태), 기간 기본값 `src/lib/characterRanking.ts` | `fetchCharacterRanking` (기간별 `chats` 집계 / `all`은 `total_turns`) | 홈 CTA 2곳, 헤더 메뉴(`HeaderMainNavRow`), `HomeCreateEventBanner`, 메뉴 전환 스펙(`menuTransitionSpec`), `postDeployVerification`, `safetyFilterAccessRoutes.test` | 기본 기간을 바꾸면 URL·테스트·공유 링크 의미가 바뀜(`?p=` 없는 URL). 빈 상태만 보강하면 낮음. 어느 쪽이든 성인/성향 필터(`buildFilter`) 경로는 건드리지 않아야 함 | 같은 파일의 `Empty` 컴포넌트(점선 카드 + `StudioButton`), 홈 빈 상태 카드 패턴, 기존 `ChipLink` |
| R2 (D2) 홈 번호 건너뜀 | `src/app/page.tsx` `SECTION_META` / `SectionHeader` | 섹션별 `chars.length` | 홈 한 파일 | 낮음. 번호를 렌더된 순서로 계산하면 됨. 홈 시각 구조(슬래브·numeral CSS)는 그대로 | 기존 `SectionHeader`, `home-section-num` 스타일 |
| R3 (D3) 검색 placeholder 잘림/오타 | `src/components/TagSearchBar.tsx` (compact 변형은 별도 문구) | 정적 문자열 | `TagSearchBar` 사용처 전체(검색 페이지, 헤더 compact) | 매우 낮음. 문구만 변경, 동작 무변경 | 기존 compact 문구 방식 |
| R4 (D4) `#태그` 입력 0건 | `src/lib/tagSearch.ts` `sanitizeSearchQuery` | `characters.tags` JSON LIKE | `sanitizeSearchQuery` 사용처: `search/page.tsx`, `TagSearchBar.tsx`, `lib/trpg/characterSearch.ts` (TRPG 캐릭터 검색 포함) | 중간. 공유 함수이므로 선행 `#` 제거가 다른 사용처의 쿼리 의미를 바꾸는지 확인 필요(테스트 존재 여부 포함) | 기존 함수 수정만으로 충분, 새 구조 불필요 |

### 선택적 개선 후보 (결함 아님 / 의도 확인 후)
| 후보 | owner | 영향 범위 | 회귀 위험 | 재사용 |
| --- | --- | --- | --- | --- |
| O1 (I1) 홈 `신규 캐릭터`와 `/tab/new` 조회 기준 정렬 | `tab/[tab]/page.tsx` `new` 분기 vs `homeSections.ts` | 신작 목록 노출 대상(공식 캐릭터 포함 여부) | 중간. 노출 정책 변경이므로 제품 결정 필요, 성인/성향 필터 유지 확인 | 기존 `listableWhere`, `fetchNewestCharacters` |
| O2 신작·검색 결과에 홈 카드 변형 적용 | `CharacterCard.tsx`는 `editorial`/`exhibit`/`index` 변형을 이미 지원 | 신작, 검색, 크리에이터/북마크 등 `CharacterCard` 사용처 | 중간~높음(카드 공유). 변형은 기존 prop으로 선택 | 새 컴포넌트 불필요 |
| O3 검색 첫 화면에서 결과를 장르 칩보다 위로 | `search/page.tsx` | 검색 한 파일 | 낮음~중간 | 기존 칩/카드 |
| O4 터치 크기 | `UserPreferenceControls`(홈·랭킹 공유), `CharacterCard` 태그, 검색 칩 | 공유 컴포넌트 다수 | 중간 | 기존 `min-h-*` 패턴 |

새로운 병렬 UI 구조, 전환/애니메이션 시스템은 제안하지 않는다. `MenuTransitionHost`와 D-1/D-2/D-3 마커(`data-character-card` 등)는 카드 변형 변경 시에도 유지되어야 한다(홈·신작·검색 카드는 `CharacterCard`가, 랭킹 행은 페이지가 직접 `characterRevealAttrs`를 사용).

## 7. 개선 효과가 가장 클 것으로 예상되는 화면 후보 (제안, 점수 아님)
**후보: 랭킹 `/tab/ranking`.** 근거 요약:
- 현재 production에서 기본 첫 화면에 콘텐츠가 없는 유일한 화면이고(D1), 홈 CTA 2곳과 상단 메뉴가 모두 이 화면으로 보낸다.
- 같은 화면 안에 `월간`/`전체` 데이터가 있어 데이터 부재가 아니라 기본값·빈 상태 설계 문제로 확인된다.
- 수정은 한 파일(`tab/[tab]/page.tsx`)과 기본 기간 한 곳에 국한되고, 기존 `Empty`/`ChipLink`로 충분하다.

차선 후보: 검색(D3·D4는 작고 안전, 단 R4는 공유 함수), 홈(D2는 단일 파일 소규모). 시각 비교 점수와 최종 선정은 GPT가 이미지를 검토해 결정한다.

## 한계
- 비로그인 production만 캡처했다. 로그인 사용자 취향/추천 결과, 성인 콘텐츠 흐림 상태는 포함되지 않았다.
- production 공개 캐릭터가 2건뿐이라 카드 밀도·긴 목록 상태의 시각 품질은 평가할 수 없다.
- 헤드리스 Chromium 측정이며 실기기(iOS Safari, 실제 터치) 확인은 하지 않았다.
