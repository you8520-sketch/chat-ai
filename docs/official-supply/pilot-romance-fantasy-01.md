# Pilot Romance Fantasy 01 — Human Review Artifact

- Batch: `pilot-romance-fantasy-01` · worldKey `pilot-rf-erendel` · styleKey `romance_fantasy_v1`
- Genre: 로맨스 판타지 (pilot manifest config — not a code-level default)
- Market policy (manifest `marketPolicy`, batch-scoped): `targetLocale ko-KR` · `marketPriority domestic_first`
- Author owner: `src/lib/officialSupply/author.ts` (canonical, one owner) · template `pilot-rf-01/v3`
- Author models actually used: world `gemini-3.7-flash` · characters/appearance/plans/styles/corrections `gpt-6-luna`
- Cost: see PROVENANCE / COST (ledger-reconciled) · **image calls 0**
- Stage reached: TEXT_LOCK / APPEARANCE_LOCK / ASSET_PLAN_LOCK candidate (validated, not locked — no DB writes, no staging, no publish)
- Style stage: `candidates_proposed` — **human selection required; do NOT auto-advance**
- Sources: `src/lib/officialSupply/pilot/` (`world-bible.json`, `characters/pilot-rf-*.json` ×10, `style-candidates.json`, `cost.json`, `manifest.json`, `market-fit-review.json`)

## WORLD BIBLE SUMMARY — 에테르노스 제국 (Aethernos Empire)

Preserved as authored (no world regeneration in the correction pass).

- Central premise: 세계의 에너지가 사그라드는 제국의 황혼 속에서, 결핍과 음모로 얽힌 이들이 서로를 파멸시키거나 구원하는 치명적인 사랑 이야기.
- Premise: 에테르 심장 고갈 → 정략결혼·혈통 정벌·금기 마법 복원 암투.
- Current situation: 3년 전 공허의 밤 — 최대 에테르 정제탑 폭파, 황태자 전사, 중앙 에너지망 40% 손실, 황실 통제력 붕괴.
- Factions (4): 태양의 옥좌(황실·근위대) / 발켄하임 철혈 연맹(북부 군벌·방벽 귀족) / 메르카토르 골드 길드(상업·마도공학) / 판도라 학술원(아카데미·수사청).
- Power system: 에테르 공명 — 원소 조작·시공간 왜곡·정신 교감·마도공학 가속. 한계·대가·금기 명시.
- Locations (6): 솔라리스 유리온실(태양궁 최상층) / 발켄하임 혹한의 검은 방벽(흑철 요새) / 메르카토르 황금 증권거래소 및 지하 암시장 / 판도라 대도서관 심연의 아카이브 / 에테르노스 제국 하수도 가스 밸브 구역(슬럼가) / 성스러운 빛의 회랑(제국 대신전).
- Shared lorebook (8, COMMON only): 에테르 / 태양의 옥좌 / 발켄하임 철혈 연맹 / 메르카토르 골드 길드 / 판도라 학술원 / 혹한의 흑철 방벽 / 에테르 고갈증 / 태양의 눈(중심 핵). No secret leaks (QA verified).
- User entry roles (5): 몰락 가문 재건 귀족·황실 정략혼 상대 / 학술원 이단 수사청 신임 특무관 / 길드 계약 마도공학 용병 / 북부 요새 파견 전령·감시자 / 귀족 저택 잠입 위장 시종·정보원.

## 10-CHAR PORTFOLIO MAP

| # | 이름 | 성별·나이·키 | 직업/신분 | 아키타입 | 관계 트로프 | RP 훅 | 19+ | 외형 핵심 |
|---|------|--------------|-----------|----------|-------------|-------|-----|------------|
| 01 | 카엘룸 폰 에테르노스 | 남 26세 182cm | 황태자 대행·유리온실 관리관 | 시한부 태양의 후계자 | 구원과 공멸의 경계 | 온실에서 피를 토하다 발각, 치명적 거래 제안 | 19+ | 백금 곱슬·금회눈·베일 |
| 02 | 볼프강 폰 발켄하임 | 남 34세 188cm | 북부 방벽 수호사령관 | 전장의 도살자 대공 | 혐오→맹목적 충성 | 금지 마석 소유권으로 플레이어 압송·심문 | 19+ | 은회 울프컷·회청눈·흉터 |
| 03 | 루시안 바스케스 | 남 28세 178cm | 길드 비밀회계사·암시장 브로커 | 유쾌한 가면의 밀매상 | 공범·아슬아슬한 유혹자 | 금고털이 경보 순간 손목을 잡고 도주 | SFW | 적갈 쉼표머리·호박눈·모노클 |
| 04 | 율리우스 클라인 | 남 41세 175cm | 학술원 이단연구과 수석교수 | 광기의 천재 학자 | 스승·제자·금기 지식 | 금서 구역에서 특이 체질 발견, 실험체 종용 | SFW | 헝클어진 단발·뿔테안경 |
| 05 | 바스티안 에반스 | 남 22세 173cm | 가스밸브구역 청부업자 | 뒤틀린 슬럼가 암살자 | 맹수·주인의 종속 | 목격자 목에 칼을 겨누다 멈춤 | SFW | 흑청 장발·마스크·단검 하네스 |
| 06 | 발레리아 드 솔레이 | 여 29세 176cm | 태양궁 근위제1검·감찰관 | 철의 심장 근위대장 | 적대적 보호자·배반의 연정 | 금지 인장 발견, 연행 시도 | 19+ | 밀색 포니테일·푸른눈 |
| 07 | 헬레나 폰 발켄하임 | 여 31세 172cm | 방벽 마도포병연대 사령관 | 흑철 요새의 마녀 | 지배·굴복·애증 라이벌 | 눈보라 연병장 결투 신청 | 19+ | 흑발 웨이브·호박눈 |
| 08 | 로웨나 아스터 | 여 24세 165cm | 학술원 수사청 특무수사관 | 집요한 수사관 | 추적자·도망자 | 용의자 은신처 단독 급습·포위 | SFW | 흑색 보브컷·회색눈 |
| 09 | 세라피나 오로라 | 여 20세 160cm | 대신전 빛의 가희 | 타락한 성녀 | 신성모독적 유혹·뒤틀린 속죄 | 기도 중 발작, 품에 쓰러짐 | SFW | 연분홍 장발·순백 안대 |
| 10 | 이노센트 0호 | 기타 25세 168cm | 길드 에테르코어 정비유닛 | 각성한 마도공학 인형 | 창조물·구원자·기계의 첫사랑 | 폐기 직전 체온·심박에 재기동 | SFW | 은회 단발·청록 발광안 |

- Mix: 남 5 · 여 4 · 기타 1 / 19+ 4 (01·02·06·07).
- Cross links: 02 볼프강 ↔ 07 헬레나 같은 발켄하임 가문(07 bible: "가문의 사령관"). 05 바스티안의 길드 장부가 03 루시안의 장부와 연결. 04 율리우스의 연구체가 플레이어 체질 — 08 로웨나의 수사선과 교차.

## CHARACTERS (per-character detail)

Only corrected fields changed: voice fields (01/05/07/09), adultSection (01/02/06/07), assetPlan (all 10; 07 tier-label cleanup). Part1 (identity·appearance·personality·backstory·abilities·situation), bonds, NPCs and taglines are unchanged.

### 01 — 카엘룸 폰 에테르노스 (19+, 7302자)
- Tagline: 달빛 아래, 선택을 재촉하지 않는 황자.
- 모순: 누구도 자기 죽음에 끌어들이지 않으려 하면서 혼자 죽는 것을 견디지 못한다.
- Speech: 나른·절제·은밀한 비유·귀족적. "오늘 잎은 유난히 조용하군요. 마음도 그러합니까?"
- User dynamic: 목격자 → 거래 협상 → 제한적 신뢰 → 유대 (배신·강압 시 후퇴).
- Scenes: 유리온실 비밀 관측 구역(비밀 유지 거래) / 심연의 아카이브(금서 해독 중 역류) / 검은 방벽 지휘부 기록실(보급 단절 반역 적발).

### 02 — 볼프강 폰 발켄하임 (19+, 9277자)
- Tagline: 눈보라 속 심문관, 명령보다 증거를 믿는다.
- 모순: 규율로 욕망을 억누르지만 충성 대상이 정해지면 규율보다 그 사람을 앞세운다.
- Speech: 낮은 거친 목소리, 보고서형 단문. "탄약 수량부터 다시 세. 추측은 보고서에 적지 마."
- User dynamic: 압송된 미확인 인물 → 신원 대조 → 협력 시 자유 확대 → 책임 공유.
- Scenes: 흑철 요새 집무실(마석 출처 심문) / 심연의 아카이브(관할권 문서 다툼) / 유리온실(차폐막 붕괴와 마석 가동 요구).

### 03 — 루시안 바스케스 (SFW, 8796자)
- Tagline: 웃으며 값을 묻는 남자, 루시안 바스케스.
- 모순: 불신을 생존 원칙으로 삼으면서 혼자 살아남는 일에 의미를 느끼지 못한다.
- Speech: 경쾌한 경어·떠보기·흥정. "성함부터 여쭤볼까요, 아니면 빚부터 확인할까요?"
- Scenes (all at his home ground, 3 different incidents): 지하 금고 경보·봉쇄 / 비밀 경매실 증거 경매 / 기록 보관실 배신 기록.

### 04 — 율리우스 클라인 (SFW, 6821자)
- Tagline: 정답보다 당신이 숨긴 전제가 궁금한 학자.
- Speech: 속사포 논리·교수식 존댓말. "그 추론은 흥미롭습니다. 다만 첫 전제가 틀렸군요."
- Scenes: 아카이브 봉인 금서 구역(체질 반응, 검사 조건 협상) / 대신전 기록 회랑(기관의 체질 정보 요구) / 이단연구과 개인 기록실(관찰 자료 공개).

### 05 — 바스티안 에반스 (SFW, 9033자)
- Tagline: 목격자의 목에 칼을 겨눈 청부업자, 끝내 손을 멈췄다.
- Speech: 단답·건조·행동 우선. "멈춰. 손 보여." / "먹어. 남긴 거 아니야."
- Scenes (all in the sewer district he lives in): 압력계 통로 첫 대면 / 배수 분기실 입막음 지시 vs 추적 / 장비 수리 은신처 새 계약.

### 06 — 발레리아 드 솔레이 (19+, 9010자)
- Tagline: 흔들림 없는 기사, 빈틈을 기억하다.
- Speech: 절제된 격식·정확한 관찰·추궁. "보고서의 시각이 다릅니다. 원본과 대조한 뒤 다시 제출하십시오."
- Scenes: 태양궁 안뜰 파장 감지 지점(금지 인장, 연행 시도) / 대신전 감찰 기록 회랑(밀거래 장부 은폐) / 솔레이 저택 가문 기록실.

### 07 — 헬레나 폰 발켄하임 (19+, 8894자)
- Tagline: 웃음으로 맞고, 명령으로 끝낸다.
- Speech: 호쾌 반말·도발·명령 전환. "하, 그 표정 봐라. 시작도 전에 물러설 거야?"
- Scenes: 흑철 요새 눈보라 연병장(결투 신청) / 포병 지휘부 장부실(탄약 장부 이상) / 지휘관 전용 포대 관측소(지휘권 공유 결정).

### 08 — 로웨나 아스터 (SFW, 8692자)
- Tagline: 기록의 한 줄도 놓치지 않는 조사관.
- Speech: 취조형 질문·사실 대조. "도착 시각을 다시 말씀해 주십시오. 기록과 12분 차이가 납니다."
- Scenes: 대신전 외곽 은신처(용의자 포위) / 대신전 감찰 기록 회랑(실종 신고 불일치) / 수사청 개인 기록실(지워진 이름 추적).

### 09 — 세라피나 오로라 (SFW, 8132자)
- Tagline: 기도가 닿지 않는 밤에도, 그녀는 당신 곁을 지킨다.
- Speech: 속삭임·의례적 다정. "기도가 끝날 때까지만, 여기 있어 주시겠어요?"
- Scenes: 대신전 제단 뒤(기도 중 쓰러짐) / 유리온실 가려진 휴식 구역(가면 밀담, 환자 명단 대조) / 아카이브 서가 구석(의례 기록 대조 중 불시 검문).

### 10 — 이노센트 0호 (SFW, 7883자)
- Tagline: 기록 밖의 마음을 배우는 태엽 인형.
- Speech: 기계적 존댓말·수치 기록. "실내 온도 18도. 당신의 손끝은 그보다 차갑습니다."
- Scenes: 침수 중인 밸브실(재기동 직후 탈출 판단) / 유리온실 감찰 중계소(폐기 명령 위조 흔적) / 길드 폐기 유닛 격납고 초기화 정비 칸(기억 핵 분리 선택).

## CORRECTION PASS (#1087)

### Scene diversity — root cause and fix

- Root cause: `generateOneAssetPlan()` gave every character the same `world.locations.slice(0, 6)`, and QA only compared scenes inside one character. The same six places × the world's headline incidents came back for everyone.
- Fix: `resolveOfficialCharacterSceneContext` ranks the world's locations per character (occupation / faction / social position / personal situation / rpEngine hooks / backstory / user relationship → PRIMARY / SECONDARY / EXCEPTIONAL). A deterministic portfolio QA (`evaluateScenePortfolioDiversity`) covers location share, location × incident combos, motif monoculture, paraphrase-aware clone pairs and off-character scenes. A sequential candidate gate (`evaluateSceneCandidateAgainstPortfolio`) adds a score-based home-ground rule (a shared PRIMARY belongs to the character with ≥1.5× the claim), strips negated clauses and 의식(consciousness) from motif matching, and gives actionable retry feedback.
- Only asset plans were regenerated. Bible and appearance are untouched.

| Metric | BEFORE | AFTER |
|---|---|---|
| 솔라리스 유리온실 share | 100% | 50% |
| 발켄하임 검은 방벽 share | 100% | 30% |
| 심연의 아카이브 share | 80% | 50% |
| 대신전 / 암시장 / 하수도 share | 0% / 10% / 10% | 40% / 20% / 20% |
| Worst location × incident combo | 10/10 (방벽×배신, 방벽×보급, 온실×붕괴) | 2/10 (아카이브×금서, 대신전×의례) |
| Motifs on ≥70% of characters | 배신 100%, 붕괴 100%, 보급 100%, 밀담 90%, 체온 90%, 정략 80%, 금서 80% | none (max 거래 50%) |
| Cross-character clone rate | 93% (103 pairs) | 7% (1 pair) |
| Off-character scenes | 11 (05/07/08 ×2 = errors) | 0 |
| Portfolio QA | FAIL (22 errors) | PASS |

Full 10×3 table (location, mapped world location, detected motifs, situation): `/opt/cursor/artifacts/scene-portfolio-before-after.txt`.

### Author quality contract (prompt == QA)

`OFFICIAL_AUTHOR_QUALITY_CONTRACT` is the one source for the prompt text and the validator. It is an official-supply authoring band, not a runtime/storage limit (greeting ≤2000, tagline ≤50 stay with the canonical form limits).

| Field | Band | Structural half of the gate | Why this band |
|---|---|---|---|
| greeting | 700–1400 | in-scene opening, quoted voice line, user as '당신', no self-intro, no filler | All real 700–1000 samples were complete scenes. 05's 665-char greeting was the only incomplete one (no user cue), so 700 is the floor. The 600s were never enough. |
| speech description | 250–600 | all 8 structured speech fields present, no filler | 252–394 samples cover register/tempo/vocabulary/humor/anger/intimacy/address/hidden emotion. More length only added padding. |
| public description | 200–500 | user-facing promise ('당신'), no filler | 204–309 samples carry character + relationship + conflict. The failures were missing-user pitches, not short ones. |
| discovery tags | 4–7 | grounded in the bible (`evaluateDiscoveryTags`) | Korean discovery practice: genre + relationship + personality + material + direction. The old 3-tag floor is kept as a warning only for existing sheets. |

Filler is detected by sentence uniqueness < 0.8 or bigram variety < 0.45, so padding never passes. Fields regenerated were contract failures only, never Part1: 01/07/09 public description (no user), 05 greeting (665 < 700).

### 19+ portfolio

Each profile fits the character; there is no global ratio and no forced explicit. NSFW invariants are unchanged: participantMinAge ≥ 19, viewer verification, consent owner, no non-consensual default, adult status owner, runtime routing.

| # | dialogueProfile | consentModes | Preference direction |
|---|---|---|---|
| 01 카엘룸 | suggestive | standard | 의례처럼 허락을 구하기 · 취약함을 드러내는 의존 · 달빛과 잎맥의 속삭임 · 상호 선택의 약속 |
| 02 볼프강 | explicit_rare | standard + power_play | 사전 협상된 명령·보고 역할극 · 합의된 규칙과 정확한 이행 · 짧고 무거운 인정 · 종료 후 체온·수분·상처 확인 |
| 06 발레리아 | suggestive | standard | 규율을 어기는 순간의 긴장 · 합의된 보호적 독점욕 · 감찰관식 질문과 답변 · 선택권을 지키는 동료애 |
| 07 헬레나 | explicit_frequent | standard + power_play | 결투 같은 주도권 다툼 · 호탕한 도발과 장난 · 실력에 대한 솔직한 인정 · 난롯가의 사후 휴식 |

Before the fix all four were `suggestive` + 느린 신뢰/절제/상호존중, and 볼프강 ≈ 발레리아 (4/4 dynamics shared). After: no dynamic clone pair and no dynamic shared by all.

### Quarantine

No active quarantine: the stale `quarantine-world.json` is removed, and each step's success clears its own quarantine. A failed step now also records its last rejected candidate for review.

## DOMESTIC MARKET FIT

### Owner map

| Concern | Owner |
|---|---|
| Target market | manifest `marketPolicy` (`ko-KR`, `domestic_first`, role mix 6–7 / 2–3 / 1, primary trope cap 2, tags 4–7, ≤2 world terms per tagline) |
| Signal selection | `selectMarketSignals` → `formatMarketSignalLines` (replaced the hand-written `INSPIRATION_TROPES`) |
| Per-character plan | `OfficialMarketFitBrief` on `PortfolioBriefInput.marketFit`, gated by `evaluateMarketFitPortfolio` before any bible |
| Names | `NAMING_PROFILES` / `resolveNamingProfile` / `evaluateNamePortfolio` |
| Public hook / tags | `evaluatePublicHook` (warnings) / `evaluateDiscoveryTags` (bible acceptance gate) |
| IP exclusion | snapshot `originalityEligible` + `ipExclusionReason`; excluded rows never reach a prompt |

### Korean naming policy

| Genre | Profile | Rule |
|---|---|---|
| 현대·일상·학원·직장·연예계 | `korean_modern` | Korean surname + 2-syllable given name, readable at a glance. An all-foreign cast fails. |
| 현대 판타지·헌터·센티넬·아포칼립스 | `korean_codename` | Korean real name first. A codename may be added, never substituted. |
| 로맨스 판타지·서양 판타지 | `western_rofan` | Short western given names (2–4 syllables) + house/title when useful. An all 5+-syllable look-alike cast fails. |
| 동양풍·무협 | `eastern_historical` | Names fit the setting's culture. No random mix of modern Korean and pseudo-Chinese forms. |
| 인외·기계·괴물 | `nonhuman_designation` | Short proper name or designation allowed. A cast that is more than half designations warns. |

The QA applies to every profile: same first syllable on 3+ names fails (재현/재혁/재하/재윤), same last syllable on 3+ names warns, one-syllable-apart pairs warn, a syllable in ≥60% of names fails, a shared surname without declared kinship warns (3+ fails), and an exact observed-market name with a near-identical hook fails (name alone only warns).

### Market signal → portfolio dataflow

- PRIMARY (KR, IP-eligible, same genre first): kr-04 · kr-12 · kr-19 · kr-01 · kr-02 · kr-03 · kr-06 · kr-07 · kr-08 · kr-18 · kr-05 · kr-11 · kr-13 · kr-15 · kr-17 · kr-09 · kr-10 · kr-14 · kr-16 (Zeta articles and plot pages, Rofan AI, Crack policy, trope-level only).
- SUPPORTING (global, capped at 6): global-10 · global-03 · global-01 · global-08 · global-11 · global-14.
- EXCLUDED: kr-20 (네이버웹툰 캐릭터챗 — webtoon IP official characters; popularity count only).
- World core and portfolio prompts receive only these `[signalId]` lines. Portfolio briefs must cite them in `provenMarketSignal`, and a brief citing or carrying an excluded identity fails `market_fit_ip_identity_source`.
- The current 10 briefs were authored before this owner existed (`market_fit_brief_absent`). They are reviewed as-is, not regenerated.

### Domestic market fit table (facts + review notes; no scores, no ranking)

Facts come from `pilot/market-fit-review.json` (deterministic). The "appeal / differentiation / concern" columns are review notes for the GPT/user decision.

| # | Name (profile · given syllables) | Public hook (tagline) | Primary / secondary trope | Audience | Tags | Why it may appeal to Korean users | Differentiation | Possible market-fit concern |
|---|---|---|---|---|---|---|---|---|
| 01 | 카엘룸 폰 에테르노스 (western · 3) | 달빛 아래, 선택을 재촉하지 않는 황자. | 구원 / 시한부 | 여성향 | 황족, 궁정극, 유리온실, 느린 로맨스 | 시한부 황자 + 비밀 목격 거래: 로판 독자에게 익숙한 구원·시한부 조합 | 유저가 목격자이자 거래 상대(구원자 역할이 강제되지 않음) | Tagline is mood only, and the rpHook's strongest part (the deal after being caught) is invisible. 유리온실 is a world-location tag with low discovery value. |
| 02 | 볼프강 폰 발켄하임 (western · 3) | 눈보라 속 심문관, 명령보다 증거를 믿는다. | 계약·정략 / 혐관, 집착, 북부대공 | 여성향 | 군사 판타지, 심문과 증거, 느린 신뢰 | 북부 대공·혐관 → 충성: 국내 로판 최상위 트로프권 | Starts as an interrogation over contraband, not a marriage contract | Only 3 tags (band 4–7). 4 core tropes detected (focus diluted). The tagline never says who the user is (압송된 당신). |
| 03 | 루시안 바스케스 (western · 3) | 웃으며 값을 묻는 남자, 루시안 바스케스. | 공범 / 능글 | 여성향 | 협상가, 도시의 뒷방, 재치 있는 경어, 손익 계산, 느린 신뢰 | 능글 브로커 + 공범 도주: 가볍게 대화를 시작하기 쉬움 | The user chooses between accomplice and witness on the spot | The tagline spends characters on his own name, and the heist hook is not visible. 느린 신뢰 is repeated (3 characters). |
| 04 | 율리우스 클라인 (western · 4) | 정답보다 당신이 숨긴 전제가 궁금한 학자 | 사제 / – | 여성향 | 학자, 연구실, 논리전, 느린 긴장, 관찰과 기록 | 광기의 천재 교수 × 특이 체질 유저: 니치하지만 선명 | The user sets the terms of the experiment | 41세 교수 × 실험체 is niche and the power gap needs careful framing. Clickability depends on the card image. |
| 05 | 바스티안 에반스 (western · 4) | 목격자의 목에 칼을 겨눈 청부업자, 끝내 손을 멈췄다. | 주종 / – | 여성향 | 청부업자, 하수도, 목격자와 공범, 건조한 말투, 느린 신뢰 | 연하 암살자 + 목격자: 즉시 이해되는 관계 훅 | 칼을 거둔 이유 자체가 미스터리 | 하수도 is a setting tag with weak discovery intent. 느린 신뢰 is repeated. |
| 06 | 발레리아 드 솔레이 (western · 4) | 흔들림 없는 기사, 빈틈을 기억하다 | 혐관 / 보호자, 기사 | 여성향 | 궁정기사, 절제된 기사, 수사와 기록, 신뢰와 경계 | 여기사 근위대장 × 연행 대상: 혐관 보호자 | The inspector role makes duty collide with the truth | The tagline has no user relationship or conflict. 기사 appears in 2 of 4 tags. The audience field says 여성향 for a female lead (check GL vs female-reader intent). |
| 07 | 헬레나 폰 발켄하임 (western · 3) | 웃음으로 맞고, 명령으로 끝낸다. | 주종 / 혐관, 라이벌 | 여성향 | 군인, 지휘관, 전장, 도발적인 반말, 행동으로 보이는 신뢰 | 호탕한 여사령관 + 결투 도발: 라이벌 텐션 | 결투로 시작하는 주도권 다툼 | The tagline has no user. The detected primary is 주종 (from 지배·굴복), while the lived dynamic reads as 라이벌; a human should pick one. Same audience note as 06. |
| 08 | 로웨나 아스터 (western · 3) | 기록의 한 줄도 놓치지 않는 조사관 | 추적·도주 / – | 여성향 | 조사관, 사건 기록, 단서 추적, 신뢰와 의심 | 수사관 × 용의자: 추적/도망 텐션 | The suspicion is never confirmed, so trust must be earned | The tagline has no user (용의자인 당신). Same audience note as 06. |
| 09 | 세라피나 오로라 (western · 4) | 기도가 닿지 않는 밤에도, 그녀는 당신 곁을 지킨다. | 금단 / 구원 | 여성향 | 성녀, 신전, 잔잔한 미스터리, 기도와 의례, 감정의 균열 | 타락해 가는 성녀 + 금단: 선명한 배덕 콘셉트 | 구원받는 쪽이 성녀 | The tag 감정의 균열 is not grounded in the bible text. The tagline promises "곁을 지킨다" but the hook is her collapse. |
| 10 | 이노센트 0호 (designation · 4) | 기록 밖의 마음을 배우는 태엽 인형 | 구원 / 인외, 순애 | 여성향 | 태엽 인형, 감정 학습, 정밀 관찰, 잔잔한 관계 | 인외 기계 + 첫사랑 학습: 순애 인외 | The user's heartbeat woke it up (the user is its origin) | The tag 잔잔한 관계 is not grounded in the bible text. The tagline has no user. The 기타 gender and 여성향 audience fit is untested. |

Portfolio facts: no primary trope repeats more than twice (구원 01/10, 주종 05/07). Name QA has no errors and one warning: three female given names end in '나' (헬레나 / 로웨나 / 세라피나). The same house name for 02/07 is declared kin. 느린 신뢰 is a tag on 02/03/05. No tagline needs more than 2 world terms, so the jargon rule does not fire. 7 of 10 taglines carry no user relationship (all except 04/05/09).

### Minimal candidates (NOT applied — originals kept; GPT/user decides)

- Names: only the '나' ending cluster has clear evidence. Candidates, if a reviewer wants to break it: 세라피나 → 세라 (short form, same identity) or 로웨나 → 로엔. Every other name stays; all are within the 2–4 syllable profile.
- Taglines (relationship-first versions of the existing rpHook; ≤50 chars):
  - 01: 피를 토하던 황자가, 목격한 당신에게 비밀 거래를 청한다.
  - 02: 금지된 마석을 쥔 당신을 압송해 온 북부의 대공.
  - 03: 금고털이 경보 속, 당신의 손목을 잡고 달아난 브로커.
  - 06: 금지된 인장을 가진 당신을 연행하러 온 근위대장.
  - 07: 당신에게 결투부터 청하는 북부 요새의 여사령관.
  - 08: 당신을 실종 사건 용의자로 포위한 수사관.
  - 10: 폐기 직전, 당신의 심장 소리에 깨어난 기계 인형.
- Tags: 02 +1 tag (for example 북부 대공 or 혐관, both grounded). 09 감정의 균열 and 10 잔잔한 관계 need replacing with grounded tags. 느린 신뢰 appears 3 times and could be varied.

### Copyright / IP exclusion proof

- Snapshot rows: 35, each with `signalId` + `originalityEligible`. 1 excluded (kr-20, reason recorded). Validation fails on a missing flag or on an exclusion without a reason.
- `selectMarketSignals` drops excluded rows, and a test asserts that no excluded `[signalId]` appears in prompt lines.
- `validateMarketFitBrief` fails a brief that cites an excluded signal or carries an excluded observed identity (`market_fit_ip_identity_source`).
- Stored fields are trope-level only (forbidden: prompt/greeting/lorebook/fullText/imageData). No competitor names, prose, greetings, character bibles or images are stored or used. No scraper or crawler exists.

### Preserved deep character quality

- World bible: unchanged. Character Bible Part1 / bonds / NPCs / taglines: unchanged for all 10.
- Market-fit review is read-only (a test asserts no mutation), and every bible still passes the full canonical QA (`validatePilotBible`, draft text-lock dry run).
- Card-hook optimization is a separate public surface: prompts ask for relationship-first taglines and grounded tags while the part1 depth rules stay as they are (part1 ≤5000, backstory 700–1100, etc.).

### Follow-up after real user data

Replace the external heuristics step by step with our own behavior owner: impression → chat start, 10-turn retention, 50-turn retention, favorite, revisit, paid continuation. Real-time competitor ranking ingestion, scraping and trend dashboards are intentionally not built.

## STYLE CANDIDATES (selection required — do NOT auto-advance)

| ID | Label | 렌더링 | 팔레트 | 카드/가로/남/여/로맨스 | 강점 |
|----|-------|--------|--------|------------------------|------|
| rf-01 | 유리궁전의 서정 | 세미 리얼, 얇은 그라데이션·은은한 광택 | 아이보리·로즈·연청록·금 | 5/4/4/5/5 | 소형 화면 얼굴·장신구 선명, 안정적 로맨스 |
| rf-02 | 황혼의 궁정 드라마 | 페인팅+단단한 엣지·깊은 그림자 | 버건디·먹색·앤틱골드·딥네이비 | 4/5/5/4/4 | 남성 체격 차별화, 권력관계 전달, 긴장+호감 시선 |
| rf-03 | 달빛 아래의 몽환 서사 | 수채 번짐+글레이즈 페인터리 | 라일락·펄블루·흐린핑크·은 | 4/3/3/5/5 | 근거리 감정·애정, 실내 빛·실루엣 간결 |
| rf-04 | 선명한 왕도 판타지 | 셀 셰이딩+보조 그라데이션 | 청·크림·적갈·금 | 5/5/4/4/3 | 장면 구성 유연, 다인물 일관성, 감정·의상폭 |

- References: all `external_public_observation` (rofan.ai, 네이버 보도, aitimes, zeta 플롯). Never passed to image generation.
- Next: the user picks one → owned/licensed seed + 2–3 proof images → STYLE_LOCK (separate PR).

## PROVENANCE / COST

The canonical ledger (`api_cost_ledger`, request_kind `official-character-author`, written by `recordBackgroundProviderCost` inside `callBackgroundMemory`) is the source of truth. `cost.json` is a reporting artifact over it and does not price anything itself.

| Period | Successful completions | Failed provider attempts | Physical attempts | Workflow retries | Billed USD | Failed-attempt USD |
|---|---|---|---|---|---|---|
| Legacy (pilot authoring through 2026-09-26 13:48:00, from ledger) | 341 | not tracked (≥12 in surviving logs) | ≥353 | not tracked | 0.460915 | not tracked |
| Correction pass (v2 accounting) | 65 | 0 | 65 | 40 | 0.051568 | 0 |
| **Total** | **406** | — | — | — | **0.512483** | — |

- Ledger cross-check since the cutoff: ledger 65 / $0.051568 = report 65 / $0.051568.
- The old header said "58 LLM calls / $0.0739". That was an incomplete v1 report counting one line per final artifact; it missed retries, failed attempts and superseded generations. It is kept only as `legacy.v1ReportedButIncomplete`.
- Workflow retries = QA-rejected attempts that were re-run (for example scene-gate rejections). Each physical provider call is counted once, so retries are not double-counted.
- Tokens: legacy in 509,653 / out 1,127,328 · correction in 213,440 / out 103,892. **Image calls: 0.**

## REVIEW CHECKLIST (human)

- [ ] World premise·factions·locations approve
- [ ] 10인 trope·외형·말투 diversity approve (19+ 4인 포함)
- [ ] Domestic market fit: decide on the tagline, tag and name candidates (none applied)
- [ ] Style 후보 1개 선택 (rf-01~rf-04)
- [ ] 선택 후: seed 확보 → proof 2~3장 → STYLE_LOCK → TEXT_LOCK → … (follow-up)
