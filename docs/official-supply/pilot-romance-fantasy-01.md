# Pilot Romance Fantasy 01 — Human Review Artifact

- Batch: `pilot-romance-fantasy-01` · worldKey `pilot-rf-erendel` · styleKey `romance_fantasy_v1`
- Genre: 로맨스 판타지 (pilot manifest config — not a code-level default)
- Market policy (manifest `marketPolicy`, batch-scoped): `targetLocale ko-KR` · `marketPriority domestic_first`
- Cast intent (manifest `castIntent`, batch-scoped): `female_oriented` · male romance targets first · **8 male / 1 female / 1 other**
- Author owner: `src/lib/officialSupply/author.ts` (canonical, one owner) · template `pilot-rf-01/v3`
- Author models actually used: world `gemini-3.7-flash` · characters/appearance/plans/styles/corrections `gpt-6-luna`
- Cost: see PROVENANCE / COST (ledger-reconciled) · **image calls 0**
- Stage reached: TEXT_LOCK / APPEARANCE_LOCK / ASSET_PLAN_LOCK candidate (validated, not locked — no DB writes, no staging, no publish)
- Style stage: `candidates_proposed` — rf-02 is the human-selected leading proof direction only (no safe seed yet)
- Sources: `src/lib/officialSupply/pilot/` (`world-bible.json`, `characters/pilot-rf-*.json` ×10, `style-candidates.json`, `cost.json`, `manifest.json`, `market-fit-review.json`)

## WORLD BIBLE SUMMARY — 에테르노스 제국 (Aethernos Empire)

Preserved as authored. World fields were never regenerated; only the portfolio briefs of slots 06–08 were re-planned (`portfolioRevisions` in `world-bible.json`).

- Central premise: 세계의 에너지가 사그라드는 제국의 황혼 속에서, 결핍과 음모로 얽힌 이들이 서로를 파멸시키거나 구원하는 치명적인 사랑 이야기.
- Premise: 에테르 심장 고갈 → 정략결혼·혈통 정벌·금기 마법 복원 암투.
- Current situation: 3년 전 공허의 밤 — 최대 에테르 정제탑 폭파, 황태자 전사, 중앙 에너지망 40% 손실, 황실 통제력 붕괴.
- Regions: 수도 아르카디아 / 서부 해상 무역권 벨로체 / 북부 방벽 요새 발켄하임 / 남부 곡창지대 플로라.
- Factions (4): 태양의 옥좌(황실·근위대) / 발켄하임 철혈 연맹(북부 군벌·방벽 귀족) / 메르카토르 골드 길드(상업·마도공학) / 판도라 학술원(아카데미·수사청).
- Locations (6): 솔라리스 유리온실(태양궁 최상층) / 발켄하임 혹한의 검은 방벽(흑철 요새) / 메르카토르 황금 증권거래소 및 지하 암시장 / 판도라 대도서관 심연의 아카이브 / 에테르노스 제국 하수도 가스 밸브 구역(슬럼가) / 성스러운 빛의 회랑(제국 대신전).
- Shared lorebook (8, COMMON only): 에테르 / 태양의 옥좌 / 발켄하임 철혈 연맹 / 메르카토르 골드 길드 / 판도라 학술원 / 혹한의 흑철 방벽 / 에테르 고갈증 / 태양의 눈(중심 핵). No secret leaks (QA verified).

## 10-CHAR PORTFOLIO MAP

| # | 이름 | 성별·나이·키 | 직업/신분 | 관계 트로프 | RP 훅 | 19+ | Status |
|---|------|--------------|-----------|-------------|-------|-----|--------|
| 01 | 카엘룸 폰 에테르노스 | 남 26 · 182cm | 황태자 대행·유리온실 관리관 | 구원과 공멸의 경계 | 온실에서 피를 토하다 발각, 치명적 거래 제안 | 19+ | preserved |
| 02 | 볼프강 폰 발켄하임 | 남 34 · 188cm | 북부 방벽 수호사령관 | 혐오→맹목적 충성 | 금지 마석 소유권으로 압송·심문 | 19+ | preserved |
| 03 | 루시안 바스케스 | 남 28 · 178cm | 길드 비밀회계사·암시장 브로커 | 공범·아슬아슬한 유혹자 | 금고털이 경보 순간 손목을 잡고 도주 | SFW | preserved |
| 04 | 율리우스 클라인 | 남 41 · 175cm | 학술원 이단연구과 수석교수 | 스승·제자·금기 지식 | 금서 구역에서 특이 체질 발견, 실험 종용 | SFW | preserved |
| 05 | 바스티안 에반스 | 남 22 · 173cm | 가스밸브구역 청부업자 | 맹수·주인의 종속 | 목격자 목에 칼을 겨누다 멈춤 | SFW | preserved |
| 06 | **에드릭** | 남 31 · 186cm | 대신전 이단심문관 겸 서품 성기사 | 혐관·구원 | 이단 혐의로 심문하던 당신을 처형대 대신 비밀 예배실에 숨긴다 | 19+ | **new** |
| 07 | **테오** | 남 28 · 181cm | 황실 마도공학 현장 총책임자(태양의 눈·정제탑) | 능력 의존·공동 생존 | 핵 폭주를 멈출 당신의 공명에 생존 계약을 내민다 | SFW | **new** |
| 08 | **노엘 벨로체** | 남 26 · 183cm | 몰락한 벨로체 해상 귀족 후계자·외교 인질 | 혐관에서 공조 | 항로 기록을 내놓는 대신 당신이 그의 귀국 조건을 협상하라 요구 | 19+ | **new** |
| 09 | 세라피나 오로라 | 여 20 · 160cm | 대신전 빛의 가희 | 신성모독적 유혹·뒤틀린 속죄 | 기도 중 발작, 품에 쓰러짐 | SFW | preserved |
| 10 | 이노센트 0호 | 기타 25 · 168cm | 길드 에테르코어 정비유닛 | 창조물·구원자·기계의 첫사랑 | 폐기 직전 체온·심박에 재기동 | SFW | preserved |

- Mix: **8 male / 1 female / 1 other** (before: 5M / 4F / 1O) · 19+ 4 (01·02·06·08).
- Removed: 발레리아 드 솔레이(06), 헬레나 폰 발켄하임(07), 로웨나 아스터(08). Their sheets were deleted (history in git), and dangling relationship entries in the kept sheets were dropped deterministically.
- Royal/ducal leads: 01 황자 and 02 대공 only. 08 is a hostage noble, deliberately not a prince.

## CAST CORRECTION (8M / 1F / 1O)

- **Why**: the 5M/4F/1O mix was a systems stress test. The first Korea-first female-oriented rofan launch batch leads with male romance targets (kr-37: selected rofan characters on a female-oriented platform are male-led; kr-25/kr-29/kr-33: female-oriented romance and 후회남 tags).
- **Owner**: `OfficialCastIntent` (`targetAudience`, `romanceTargetProfile`, `desiredGenderMix`, `rationale`) in the batch manifest, checked by `evaluateCastIntent`. It is not a genre rule: BL, GL, simulation and ensemble batches declare their own mix, and `evaluateWorldDiversity` never pushes toward 50:50 (its single-gender hint is silenced for intended single-gender batches). The portfolio prompt no longer says "전원 단일 성별 금지 / 성별 분산".
- **Flow for 06–08 only**: `replace-slots` (portfolio brief + market-fit brief, gated) → Character Bible → compile → draft QA → adult plan → Appearance Lock → Asset Plan → scene QA → market review.
- **Replacement gate**: valid market-fit brief (eligible signals, twist, relationship-first) · rpHook states the user relationship · new names clean in full-cast name QA · primary trope ≤2 · no occupation/hook/silhouette/speech clone · ≤2 royal/ducal leads · cast intent exact.

### 06 — 에드릭 (19+, 8342자)
- Role: 대신전 이단심문관 겸 서품 성기사. 대신전의 심문권을 위임받아 황실 법정에도 출입한다.
- Tagline: 당신을 심문하는 성기사, 처형대에서 숨긴 보호자
- Primary trope: 혐관·구원 (secondary: 성직자와 피의자, 금지된 보호) · marketRole proven · signals kr-36, kr-39, kr-41.
- User relationship: 금지된 에테르 사용 혐의로 심문받는 당신 → 처형 대신 비밀 예배실에 숨겨진 피의자이자 단서의 협력자.
- Contradiction: 증거보다 감정을 앞세우지 않겠다고 서약했지만, 한 번 지키기로 하면 상대의 의사까지 대신 결정하며 자신을 희생한다.
- Adult: `suggestive` · `standard` — 금욕 서약의 균열, 죄책과 갈망의 대치, 금지된 보호의 선택, 서로의 판단을 존중하는 친밀함.
- Appearance: 짙은 밤색 짧은 머리, 짙은 회색 눈(빛을 받으면 은색 테), 186cm의 곧고 절제된 체형, 은빛 흉갑 위 검은 심문관 외투.
- Speech: 낮고 절도 있는 존댓말. 감정이 깊어질수록 호칭이 더 정중해진다. "당신을 처형대에 넘기지 않겠습니다. 대신 진실을 증언해 주십시오."
- RP engine: 증언 대조와 심문 준비, 예배실에서의 교대·식사 / 중기: 증거 공개 vs 내부 고발자 보호 / 장기: 제도 안의 개혁 또는 이탈.
- Scenes: 대신전 비밀 예배실(첫 대면, 보호의 이유) / 하수도 밸브 구역 관찰 통로(증거 공개 vs 협력자 보호) / 봉인 기록실(개혁 또는 이탈).
- Abilities: 서약검술 · 심문과 증거 대조 · 서약 인장과 제한적 에테르 방벽 · NPC 린(32).

### 07 — 테오 (SFW, 7714자)
- Role: 황실 마도공학 현장 총책임자. 태양의 눈과 정제탑 가동 권한을 가지며, 핵 상태를 황실에 직접 보고한다.
- Tagline: 핵을 살릴 현장 책임자, 당신과 생존 계약을 맺다
- Primary trope: 능력 의존·공동 생존 (secondary: 계약 동맹, 위험한 공동 연구) · marketRole proven_twist · signals kr-40, kr-08.
- User relationship: 에테르 핵과 공명하는 유일한 협력자인 당신 → 생존을 보장받는 회로 진입 계약자.
- Contradiction: 사람을 소모품으로 만들지 않으려 모든 위험을 떠안지만, 그 독단이 동료의 선택권을 빼앗는다.
- Distinct from 율리우스: not a professor or theorist but a hands-on operator who shuts down and repairs machines himself. Distinct from 이노센트: a crown engineer, not a guild unit.
- Appearance: 짙은 청동색 중간 길이 머리, 짙은 호박색 눈(과열광 아래 금빛 테), 181cm 탄탄한 실무자 체격, 걷어 올린 작업복·내열 앞치마·공구 벨트.
- Speech: 동료에게 쓰는 짧은 반말과 현장 지시. 약속할 때는 말을 고른다. "손 떨려? 그럼 잠깐 교대해. 고집 부리다 둘 다 다치진 말자."
- RP engine: 수치·증상 점검과 위험 한계 협의, 교대 사이 일상 / 중기: 숨긴 고장 원인과 기관들의 회로 통제 다툼 / 장기: 책임과 결정을 나누는 법을 배운다.
- Scenes: 하수도 감압 계기 발판(증기 폭주 경보) / 대신전 공개 회랑(공명자를 이단으로 모는 폭동) / 정제탑 수동 차단실(재가동 강행 여부).
- NPC 마라 벤(34), 이렌 솔(27).

### 08 — 노엘 벨로체 (19+, 7247자)
- Role: 몰락한 벨로체 해상 귀족 가문의 후계자. 휴전 협상이 끝날 때까지 황실 감시 아래 수도에 머무는 외교 인질(왕자 아님).
- Tagline: 휴전을 협상해야 하는 적국 귀족 인질, 노엘
- Primary trope: 혐관에서 공조 (secondary: 외교 인질, 정치적 강제 근접) · marketRole proven · signals kr-35, kr-39, kr-33.
- User relationship: 황실 협상관인 당신 ↔ 휴전 조건을 두고 맞서는 인질. 당신이 그의 귀국 조건을 쥐고, 그는 양쪽을 살릴 항로 정보를 쥔다.
- Contradiction: 호의를 믿지 않으면서도 자신의 정보와 귀국의 운명을 상대에게 맡겨야 한다.
- Adult: `explicit_frequent` · `standard` — 조건을 건 유혹, 상호 약점의 균형, 실리로 위장한 진심, 거래형 도발, 약속 이행으로 쌓는 신뢰.
- Appearance: 바람에 바랜 모래빛 머리, 짙은 바다색 눈, 183cm 마른 장신, 목까지 여민 감청색 코트와 항해용 나침반 끈.
- Speech: 매끄러운 존댓말, 비꼬듯 여유롭다가 가문 이야기에선 짧고 솔직해진다. "가문 이야기는 여기까지 하시죠. 그건 협상의 조건이 아닙니다."
- RP engine: 조건과 증거를 맞바꾸는 협상·약속 이행 확인 / 중기: 기록의 진위와 황실·방벽·길드의 개입 / 장기: 동맹·경쟁·동행자, 귀국 여부를 함께 결정.
- Scenes: 태양궁 최상층 외교 접견 데크(검증 가능한 항로 구간 제시) / 대신전 사절단 서명 검증대(위조 사본 공개) / 외교 인질관 잠금 검증실(공개 범위 결정).
- Name note: the brief said "노엘"; the bible author added the house name 벨로체. The brief was synced (`portfolioRevisions[].nameSync`), and a gate now rejects any bible whose name differs from its brief.
- World note: 벨로체 is one of the listed regions. The bible frames it as a defeated maritime power under a truce, an extension of the world rather than a contradiction. Worth a reviewer glance.

### Preserved characters (01–05, 09, 10)

Only human-approved public-surface changes and the cast cleanup touched them:

| # | Tagline (current) | Tag change | Cast cleanup |
|---|---|---|---|
| 01 | 피를 토하던 황자가, 목격한 당신에게 비밀 거래를 청한다. | – | 3 relationships to removed characters dropped |
| 02 | 금지된 마석을 쥔 당신을 압송해 온 북부의 대공. | 느린 신뢰 → 혐관, + 북부대공 | same |
| 03 | 금고털이 경보 속, 당신의 손목을 잡고 달아난 브로커. | – | same |
| 04 | 정답보다 당신이 숨긴 전제가 궁금한 학자 (kept) | – | same |
| 05 | 목격자의 목에 칼을 겨눈 청부업자, 끝내 손을 멈췄다. (kept) | – | same |
| 09 | 기도가 닿지 않는 밤에도, 그녀는 당신 곁을 지킨다. (kept) | 감정의 균열 → 금단 | same |
| 10 | 폐기 직전, 당신의 심장 소리에 깨어난 기계 인형. | 잔잔한 관계 → 순애 | same |

Byte parity against `59870714` (`/opt/cursor/artifacts/preserved-slot-parity.txt`) shows the brief, the appearance lock, the asset plan and every core bible field byte-identical for all seven. Core fields are identity, appearance, personality, contradiction, values, backstory, abilities, habits, dailyLife, situation, speech, behaviorRules, userRelationship, secrets, rpEngine, greeting, NPCs, nsfw and adultSection. The only differences are the approved tagline/tag edits and `otherRelationships` (9→6; 10→7 for 10). The compiled draft's relationship section and hidden-relationship secrets change accordingly.

Review finding (not changed): 04's tag `느린 긴장` was only lexically supported by a relationship entry to a removed character. Human review said not to churn tags, so it stays and is surfaced here.

## CORRECTION PASS (#1087)

### Scene diversity

- Root cause (first pass): every character got the same `world.locations.slice(0, 6)`, and QA only compared scenes within one character.
- Owner: `resolveOfficialCharacterSceneContext` (per-character PRIMARY/SECONDARY/EXCEPTIONAL) + `evaluateScenePortfolioDiversity` (portfolio QA) + `evaluateSceneCandidateAgainstPortfolio` (sequential gate with the score-based home-ground rule).
- This pass fixed three mapping/motif bugs:
  - A scene maps to a world location only when it names the place itself. The parenthetical parent building ("유리온실 (태양궁 최상층)") no longer pulls every 태양궁 room onto the greenhouse.
  - Prefix matches on location names allow at most one extra syllable, so generic 에테르 no longer lands on 에테르노스.
  - 예배실/예배당 name a place, not a ritual incident.

| Metric | First pass BEFORE | Now (final cast) |
|---|---|---|
| Largest location share | 100% (유리온실, 방벽) | 50% (유리온실) |
| Worst location × incident combo | 10/10 | 2/10 (아카이브×금서) |
| Cross-character clone rate | 93% (103 pairs) | 0% |
| Off-character scenes | 11 | 0 |
| Portfolio QA | FAIL (22 errors) | PASS (0 warnings) |

The new 06–08 do not reproduce the old greenhouse/fort/archive triple (06: 대신전 예배실·하수도·자기 기록실 / 07: 하수도·대신전 회랑·정제탑 / 08: 외교 접견 데크·대신전 검증대·인질관).

### Author quality contract (prompt == QA)

`OFFICIAL_AUTHOR_QUALITY_CONTRACT`: greeting 700–1400 · speech 250–600 · public description 200–500 · discovery tags 4–7. Each band is paired with a structural check and a filler detector. When a freshly generated bible misses only these voice fields or its tags, the same bible is now repaired through `reviseOfficialCharacterVoice` (tags added as a revisable field) instead of discarding Part1 and bonds. 06 needed one tag repair.

### 19+ portfolio

| # | dialogueProfile | consentModes | Preference direction |
|---|---|---|---|
| 01 카엘룸 | suggestive | standard | 의례처럼 허락을 구하기 · 취약함을 드러내는 의존 · 달빛과 잎맥의 속삭임 |
| 02 볼프강 | explicit_rare | standard + power_play | 사전 협상된 명령·보고 역할극 · 짧고 무거운 인정 · 사후 체온·수분·상처 확인 |
| 06 에드릭 | suggestive | standard | 금욕 서약의 균열 · 죄책과 갈망의 대치 · 금지된 보호의 선택 |
| 08 노엘 | explicit_frequent | standard | 조건을 건 유혹 · 상호 약점의 균형 · 거래형 도발 · 약속 이행으로 쌓는 신뢰 |

Adult candidates were chosen by fit. 06's vow-versus-desire conflict and 08's political seduction between equals carry an adult dynamic; 07's survival partnership stays SFW. `evaluateAdultPortfolioDiversity` passes, with no dynamic clone and nothing shared by all. The old 06/07 profiles were not copied: 06 has no power play, and 08 is explicit_frequent with standard consent, framed as negotiation rather than 헬레나's duel. participantMinAge ≥ 19, canonical consent modes, no cnc.

### Quarantine

No active quarantine. Failed steps record their last rejected candidate, and a success clears the file.

## DOMESTIC MARKET FIT

### Domestic source update (7 sites, manual_curated only)

| Platform | Automation / ToS | What was stored |
|---|---|---|
| Crack | unclear (unchanged) | Originals guidance: character/story/world appeal before adult-only (kr-38); visual: 2:3 profile as first impression + multiple style options (vt-10) |
| Caveduck | **not_checked** (terms docs exist, automation clause not reviewed) | 소꿉친구·재회, 연상, 다크 판타지 구원, 인외 (kr-21..kr-24) |
| Rofan AI | unclear (unchanged) | relationship-first female-oriented curation: 혐관·순애·후회·구원·정략·환생·북부대공 (kr-39) |
| Plaitoon | **not_checked** | 집착·후회남, 사내 연애, 피겨 경쟁→파트너, 책 속 세계 빙의 (kr-25..kr-28) |
| Zeta | restricts_automation (unchanged) | plot/world-level play, high-difficulty romance and survival inference (kr-40) |
| WHIF | **not_checked** | BL 집착, 가이드버스, 재벌·후회남 (kr-29..kr-31); **licensed webnovel/webtoon IP row kr-32 is IP-excluded** |
| Melting | **not_checked** | landing categories (로판·BL·마피아·연상·혐관·학원·집착·순애·스포츠·인외·구원·성인), 황실 순애, 혐관 다인물, 배덕 구원 (kr-33..kr-36); reviewer observation that selected rofan leads are male-coded (kr-37) |

Stored: genre, relationship trope, archetype, broad world mechanic, category/tag wording, trope-level hook structure, and 10 abstract visual-trend observations (`visualTrends`). **Not stored**: any competitor character name, prompt, greeting, description, dialogue, lorebook, image, image URL or IP content. Some public pages showed featured character names and quoted lines; none were recorded. There is no scraper and no automated collection, and a missing automation check is recorded as `not_checked`, never inferred.

### Market signal → portfolio dataflow

`selectMarketSignals` (KR primary: 39 eligible signals; global supporting: 6; excluded: kr-20 Naver Webtoon, kr-32 WHIF licensed IP) → `[signalId]` lines in the portfolio-replacement prompt → each new brief cites its signals in `provenMarketSignal` → `validateMarketFitBrief` rejects excluded or unknown ids.

### Domestic market fit — new characters

| # | Relationship hook (tagline) | Tags | Proven trope + twist | Why it may appeal | Possible concern |
|---|---|---|---|---|---|
| 06 에드릭 | 당신을 심문하는 성기사, 처형대에서 숨긴 보호자 | 로맨스 판타지, 성기사, 이단심문관, 금지된 보호, 심문과 증언, 신앙의 흔들림 | 성직자·기사 × 혐관·구원; twist: the inquisitor is risking judgment for his own choice to protect the suspect | 성직자/기사 역할 어휘가 카드에서 바로 읽히고, 금지된 보호는 여성향 로판의 강한 훅 | Shares the temple ground with 09 세라피나. Their scenes and dynamics are distinct, but the card pair should read as two different experiences. |
| 07 테오 | 핵을 살릴 현장 책임자, 당신과 생존 계약을 맺다 | 마도공학, 현장 책임자, 공동 생존, 계약 동맹, 기술 의존, 위험한 공동 연구 | 계약 × 공동 생존; twist: not a scholar but a hands-on operator, and each needs the other to survive | 계약 관계 + 능력 의존은 이해가 빠르고, 연하 실무자 반말 톤이 다른 존댓말 캐릭터들과 대비 | "마도공학" is less proven in Korean rofan discovery than 마탑/마법사. It is marked proven_twist for that reason. |
| 08 노엘 벨로체 | 휴전을 협상해야 하는 적국 귀족 인질, 노엘 | 로맨스 판타지, 외교 인질, 몰락 귀족, 혐관에서 공조, 정치 협상, 불신과 신뢰 | 혐관 × 강제 근접; twist: a defeated foreign heir, where the user decides his return and he holds the information both sides need | 신분·정치 긴장 속 강제 근접은 로판 인기 구도이고, 대등한 거래형 긴장이 성인 톤과 맞물림 | The tagline ends on his name rather than the user. A reviewer may prefer a 당신-led version. 혐관 is also 06's primary (2 of 10, at the cap). |

Portfolio facts: primary tropes are 구원 ×2 (01/10), 혐관 ×2 (06/08) and every other trope ×1. Name QA has no errors or warnings (the '나' cluster disappeared with 헬레나/로웨나). No tag is repeated on 3+ characters. Speech overlap is at most 0.18 against a 0.5 clone threshold. Royal/ducal leads are 01 and 02.

Preserved characters: see the table in CAST CORRECTION. Their earlier market-fit notes still apply, except that the approved taglines and tags are now in place.

### Copyright / IP exclusion proof

- 56 snapshot rows, each with `signalId` + `originalityEligible`; 2 excluded (kr-20, kr-32) with recorded reasons. Excluded ids never appear in prompt lines (tested).
- New briefs cite only eligible KR signals (06: kr-36/39/41 · 07: kr-40/08 · 08: kr-35/39/33).
- New names 에드릭 / 테오 / 노엘 벨로체 are not taken from any stored competitor data (no competitor names are stored).
- Visual trends are validated as attribute-only (no URLs, image files or artist/work targets).

## STYLE STATUS

- **rf-02 황혼의 궁정 드라마** is recorded as the human-selected leading proof direction (`style-candidates.json` → `humanReview`). **rf-04** is the fallback.
- Canonical stage stays **`candidates_proposed`**. `approveStyleCandidate()` requires a platform-owned or licensed seed, none exists, and the owner is not bypassed. No STYLE_LOCK.
- rf-02 proof interpretation, from the abstract domestic visual trends vt-01..vt-10:
  - painterly/semi-real webtoon finish
  - brighter face exposure, so burgundy/navy shadow doesn't eat the face
  - clean skin and stronger eye catchlights
  - card-size facial readability at 2:3 bust/half-body
  - differentiated male jaw/body types across the 8 male leads, with equal quality for the female lead
  - legible court/uniform status cues without microdetail outranking the face
- No image was generated, and no competitor image was passed anywhere.

| ID | Label | 렌더링 | 팔레트 | 카드/가로/남/여/로맨스 |
|----|-------|--------|--------|------------------------|
| rf-01 | 유리궁전의 서정 | 세미 리얼, 얇은 그라데이션·은은한 광택 | 아이보리·로즈·연청록·금 | 5/4/4/5/5 |
| rf-02 | 황혼의 궁정 드라마 | 페인팅+단단한 엣지·깊은 그림자 | 버건디·먹색·앤틱골드·딥네이비 | 4/5/5/4/4 |
| rf-03 | 달빛 아래의 몽환 서사 | 수채 번짐+글레이즈 페인터리 | 라일락·펄블루·흐린핑크·은 | 4/3/3/5/5 |
| rf-04 | 선명한 왕도 판타지 | 셀 셰이딩+보조 그라데이션 | 청·크림·적갈·금 | 5/5/4/4/3 |

## PROVENANCE / COST

The canonical ledger (`api_cost_ledger`, request_kind `official-character-author`, written by `recordBackgroundProviderCost` inside `callBackgroundMemory`) is the source of truth; `cost.json` only reports on it.

| Period | Successful completions | Failed provider attempts | Physical attempts | Workflow retries | Billed USD | Failed-attempt USD |
|---|---|---|---|---|---|---|
| Legacy (through 2026-09-26 13:48:00, from ledger) | 341 | not tracked (≥12 in logs) | ≥353 | not tracked | 0.460915 | not tracked |
| First correction pass | 65 | 0 | 65 | 40 | 0.051568 | 0 |
| Cast correction (06–08 replacement) | 52 | 5 (provider 503s) | 57 | 20 | 0.056509 | 0 |
| **Total** | **458** | — | — | — | **0.568992** | — |

- Ledger cross-check since the cutoff: ledger 117 / $0.108077 = report 117 / $0.108077.
- The cast correction's 52 successes break down as 2 portfolio replacement (world_bible task), 10 part1 + 11 voice (one tag repair) + 10 bonds, 2 adult profiles, 3 appearance locks and 14 asset plans. The part1/bonds count exceeds 3 because rejected full attempts were re-run.
- Tokens (v2 report, both correction passes): in 353,853 / out 236,084. **Image calls: 0 · staging 0 · publish 0.**

## REVIEW CHECKLIST (human)

- [ ] Approve new 06 에드릭 / 07 테오 / 08 노엘 벨로체 (hooks, voices, adult profiles for 06/08)
- [ ] 08 tagline: keep "…적국 귀족 인질, 노엘" or ask for a 당신-led version
- [ ] 04 tag `느린 긴장`: keep (current) or replace with a grounded tag
- [ ] Style: obtain a platform-owned/licensed seed → canonical rf-02 approval → 3 proofs → human image review → STYLE_LOCK (follow-up)
