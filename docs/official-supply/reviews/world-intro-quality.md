# Official shared world / public intro / creator comment — quality review (PR #1595)

Scope: Lucian #50 (`pilot-rf-03`) and Wolfgang #51 (`pilot-rf-02`), shared `worldKey` `pilot-rf-erendel`.
Tracking: Issue #1593. Standard: `docs/official-supply/gpt-editorial-standard.md` (updated in this PR).
Status: **Draft, source-only.** Nothing here touches production #50/#51, the 14 images, Appearance Lock, the 8 shared lorebooks, approved Text Locks, the production DB, paid models, public release or follower notification. #1589 topics (ownership, asset storage, lorebook editing, CP) are not in this PR.

Confirmed PR head before this update: `2760f727` (`c9bcafbd` is the local base of this work: the cap change). Base `main` was merged at `59fb6ddc`; the final head is the PR head shown on GitHub.

## 1. Owner map (one responsibility = one owner)

| Responsibility | Owner | Change |
| --- | --- | --- |
| Shared world canon | `pilot/world-bible.json` (single source) | D1-D4 canon fixed; leadership/relations/publicView/history/knowledge edited, no new people or events |
| World projection | `officialSharedWorld.projectOfficialSharedWorld` | rewritten deterministic projection (see 2); band 2,000-3,000; `officialDraftUsesSharedWorld` predicate |
| World Library row / `world_id` | `ensureOfficialSharedWorldLibraryRow` / `findOfficialSharedWorldLibraryRow` | unchanged; `staging.ts` and `inPlaceSync.ts` now call it for every draft that uses the shared split, not only `compact_rp_v1` |
| Draft compile | `bible.compileOfficialDraftFromBible` | `usesSharedWorld` bible flag lets a legacy-standard manuscript (Wolfgang) use the shared world + `currentSituation` split without adopting compact content caps |
| Public intro / creator comment | `publicProfileText.ts` | authored `detailedDescription` / `creatorComment` (bible fields) replace the fixed three-paragraph template; gates updated; no new renderer or security rule |
| Text Lock | `characterText.computeTextLockHash` | covers `creatorComment` (omitted when undefined, so existing hashes do not change) |
| RP setting cap | `characterFormLimits.CHARACTER_SETTING_SOURCE_LIMIT` -> `characterParser.buildCombinedCharacterSettingSource` | see 4 |
| QA | `characterText.evaluateOfficialStagedSaveLength` | `rp_setting_truncated` blocking error for new drafts |

No parallel world writer, no second world injection, no new check system. `world-bible.json` is the only fact owner; the world body is derived, not authored twice.

## 2. Canon (D1-D4) and the shared world

Adopted canon, applied in `world-bible.json` and asserted in `officialSupply.worldIntroCanon.test.ts`:

| # | Canon |
| --- | --- |
| D1 | Alexei von Valkenheim is the bedridden former duke (전대공). Wolfgang is the current head of the house (가주 대공) and northern wall commander. |
| D2 | '전장의 늑대' is Alexei's epithet. '전장의 도살자' is what Wolfgang's enemies call him. |
| D3 | Open hostility toward the Empire is the house's political stance. Careful execution of orders is Wolfgang's personal judgment style. |
| D4 | The north owns the mines but depends on central refining and suffers ration shortage. |

Remaining D2 note (FOLLOW-UP, not changed): Wolfgang's approved greeting contains "전장의 도살자라고 불리던 북부대공" without naming who calls him that. The greeting is a protected approved text; the shared world, intro and comment are explicit about the enemy epithet.

Timeline (5y/3y/1y/6m), magic ranks, the 침식 마법 taboo and the 의무 결속령 were cross-checked and are consistent across bible, Lucian and Wolfgang.

Projection: deterministic, 2738 characters, identical for both characters. It covers era and regions, a dated event sequence, four factions with purpose/leaders/external relations/public view, magic with costs and taboos, society and culture, and the current imperial pressure (beneficiaries / threatened parties). It contains no user address and no character-local incident (asserted).

## 3. BEFORE / AFTER original text

### 3.1 Shared world (`characters.world`)

**Before - Lucian (2156 chars, shared projection)**

```text
에테르노스 제국은 로맨스 판타지 세계다. 제국력 784년, 번영의 정점에서 맞이한 황혼기 (빅토리아풍 후기 제국 양식)의 무대이며, 마도공학(에테르 공학) 혁명기, 증기 기관과 마도 수정이 결합된 화려한 도시 문명 위에서 마도 귀족 중심의 입헌 군주제 과두정 및 길드 연합이 공존한다. 주요 지역은 제국 수도 '아르카디아', 서부 해상 무역권 '벨로체', 북부 방벽 요새 '발켄하임', 남부 곡창지대 '플로라'이다.

3년 전 발발한 '공허의 밤' 사태로 제국 최대의 에테르 정제탑이 폭파되며 황태자가 전사하고, 중앙 에너지망의 40%가 손실되어 황실의 통제력이 급격히 흔들리기 시작함. 제국의 생명줄인 에테르 에너지가 해마다 줄어들고 있어 배급제가 시행되고 있다는 사실. 황실, 북부 철혈 연맹, 메르카토르 상단, 판도라 학술원이 제국의 패권을 두고 경쟁 중이라는 점. 북부 혹한의 방벽 너머에는 잔혹한 마수들이 도사리고 있어 방벽이 무너지면 제국이 멸망한다는 상식. 판도라 학술원의 허가를 받지 않은 독자적인 고대 마법 연구는 엄격히 금지되어 있다는 점.

태양의 옥좌 (황실 및 근위대). 황권 강화 및 에테르 통제권 수복, 반역 가문의 색출과 숙청. 절대적 위엄을 지녔으나 점차 가혹해지는 법령 때문에 민중의 불안과 원망을 사고 있음. 북부 군벌과 팽팽한 긴장 관계, 상업 길드를 재정적으로 압박하며 통제하려 함. 발켄하임 철혈 연맹 (북부 군벌 및 방벽 귀족). 북부의 자치권 수호 및 황실의 과도한 에테르 수탈 저지. 거칠고 잔혹하다는 평가를 받지만 국경을 방어하는 영웅으로서 평민들의 지지가 높음. 황실에 공공연한 적대감을 드러내며, 학술원과 비밀리에 기술 제휴를 맺음. 메르카토르 골드 길드 (상업 및 마도공학 연합). 신흥 자본을 통한 정치적 입지 확보 및 제국 전역의 에너지 시장 독점. 화려한 기술 혁신을 이끄는 부의 상징이나 탐욕스러운 고리대금업자 집단으로 비판받음. 황실과 귀족들에게 거액의 부채를 빌려주며 배후에서 조종, 학술원의 연구를 후원함. 판도라 학술원 (아카데미 및 수사청). 에테르 고갈의 근원 규명 및 고대 룬 문명의 봉인 해제. 오만하고 비밀스러운 엘리트 집단이지만 제국 최고의 지성으로 선망받음. 모든 세력의 견제를 받으며 표면적 중립을 유지하나 내부 파벌 분열이 심함.

에테르 사용: 사용자의 심장 박동과 혈류에 비례하여 에테르가 소모되며, 과사용 시 뇌 손상과 혈관 동결 발생. 대가: 체온 급락, 마력 고갈 증후군, 감정 둔화 또는 과도한 집착 등의 인격 변형 부작용. 사회적 영향: 마력 등급이 신분과 혼처의 가치를 결정하는 계급 지표로 작용하여 혈통주의를 극단화함. 금기: 인체 연성을 통한 생체 에테르 핵 추출, 타인의 마력을 강제로 흡수하는 '침식 마법'.

계급: 순혈 마도 귀족(상류층) - 공인 마도사 및 길드 거두(신흥 계급) - 일반 평민 - 무마력자 및 부채 노예(최하층)로 엄격히 나뉨. 결혼: 혈통 보존과 마력 증폭을 위한 정략결혼이 기본 규범이며, 혼인 전 마력 적합도 측정이 필수임. 가문 간 동맹을 깰 경우 막대한 위약금과 사회적 매장이 따름. 법: 마도 범죄는 특수 수사청이 관할하며, 귀족에 대한 평민의 마력 공격은 즉결 처형 사유임. 고위 귀족 간의 분쟁은 명예 결투재판을 통해 해결 가능.

황실이 가문의 세력 균형을 강제 재편하기 위해 대귀족 간 '의무 결속령(강제 정략혼 법안)'을 공포하고, 다가오는 건국제 무도회에서 대규모 혼약 발표를 예고함. 이득을 보는 쪽: 에테르 대체 정제 기술을 독점한 '메르카토르 상업 길드'와 독자적인 고대 마력석 광산을 보유한 북부 군벌 발켄하임 가문이 막대한 부와 정치적 실권을 장악함. 위협받는 쪽: 에테르 분배권에 의존하던 중하층 황도 귀족들과 빈민가 '로우 아르카디아'의 시민들이 에너지 빈곤과 신종 마력 오염병에 노출되어 생존을 위협받음.

플레이어는 정해진 단일 운명에 얽매이지 않고, 원하는 세력에 발을 걸치거나 경계선에 선 이방인으로서 각 진영의 핵심 인물들과 치명적인 관계망을 형성할 수 있습니다. 가능한 입장: 몰락해가는 가문을 재건하려는 귀족 혹은 황실의 정략혼 상대 / 판도라 학술원에 갓 배속된 이단 수사청의 신임 특무관 / 메르카토르 길드와 계약을 맺고 특수 임무를 수행하는 마도공학 용병 / 북부 철혈 요새에서 수도로 파견된 냉혹한 전령이자 감시자 / 주요 귀족 저택에 잠입한 신분 위장 시종 및 정보원.
```

**Before - Wolfgang (1193 chars, bible worldContext + personalSituation + userEntry, `world_id=null`)**

```text
에테르노스 제국은 세계의 에너지가 사그라드는 황혼기에 놓여 있다. 3년 전 ‘공허의 밤’ 사태로 제국 최대의 에테르 정제탑이 폭파되고 황태자가 전사했으며, 중앙 에너지망의 40%가 손실됐다. 황실은 남은 에테르의 배분을 통제하려 하지만 각 지역의 자치와 귀족들의 이해관계가 커져 명령은 예전만큼 빠르게 관철되지 않는다. 에테르는 사용자의 심장 박동과 혈류에 따라 소모되며, 과용은 뇌 손상과 혈관 동결을 부른다. 체온 급락, 마력 고갈 증후군, 감정 둔화나 과도한 집착도 사용자를 잠식할 수 있다. 인체 연성을 통한 생체 핵 추출과 타인의 마력을 강제로 빼앗는 침식 마법은 금기다. 솔라리스 유리온실은 황실의 비공식 외교와 에테르 관측을, 메르카토르 거래소와 지하 암시장은 에테르 채권과 불법 정수 거래를 맡는다. 판도라 대도서관 심연의 아카이브에서는 고갈 원인과 금서를 연구한다. 북부의 검은 방벽은 마수 전선과 철혈 연맹의 군사 본부를 함께 품어, 보급난과 권력 다툼이 가장 먼저 병사들의 생명에 닿는 곳이다.

볼프강은 북부 방벽을 지키는 발켄하임 가주 대공으로, 전선에서 회수한 금지 마석을 흑철 요새 봉인고에 격리해 두었다. 마석을 넘겨달라는 황실과 귀족의 압력이 커지던 중, 마석 사건의 당사자를 증거 보존 이전에 처형하라는 긴급 명령서가 도착한다. 그 문서에는 볼프강의 서명과 인장이 있으나 정작 그는 발령한 적이 없다. 마석 인계 기록도 운송 경로 한 부분과 시각이 맞지 않는다. 그는 유저를 범인으로 단정하거나 황실 지시대로 처형하지 않고, 두 문서를 요새 집무실에서 직접 대조하려 한다. 증거는 유저에게 불리하게 조작되었을 수도, 유저가 아직 말하지 않은 진실을 가리킬 수도 있다. 볼프강은 외부 감찰관의 간섭을 막되 유저가 진술·침묵·서류 확인 중 어떤 방식으로 대응할지는 남겨 둔다. 명령과 증거가 충돌할수록 과거 성문을 닫았던 기억 때문에 누구의 목숨을 걸고 결론 내리는 일에 집착에 가까울 만큼 신중해진다.

유저의 성별·신분·직업·과거 관계는 페르소나에 따라 자유롭다. 이 장면에서 확정되는 것은 금지 마석 사건의 관련자로 황실 서류에 이름이 적혀 있고, 볼프강이 그 서류의 진위를 확인하고자 요새 집무실에서 만나려 한다는 사실뿐이다. 유저는 진술하거나 침묵하거나 문서를 검토할 수 있고, 의심을 반박하거나 새로운 증거를 제시할 수도 있다. 처음부터 유죄·피해자·연인 중 어느 하나로 결론 내리지 않는다.
```

**After - both (2738 chars, identical)**

```text
에테르노스 제국은 로맨스 판타지 세계다. 제국력 784년, 번영의 정점에서 맞이한 황혼기의 무대이며, 마도공학(에테르 공학) 혁명기, 증기 기관과 마도 수정이 결합된 화려한 도시 문명 위에서 마도 귀족 중심의 입헌 군주제 과두정 및 길드 연합이 공존한다. 주요 지역은 제국 수도 '아르카디아', 서부 해상 무역권 '벨로체', 북부 방벽 요새 '발켄하임', 남부 곡창지대 '플로라'이다.

사건의 순서. 5년 전 태양의 눈 침묵: 황궁 지하 중심 핵 '태양의 눈'의 출력이 원인 불명으로 40% 이상 급감해 에테르 품귀와 계급 간 갈등이 극대화됐다. 3년 전 공허의 밤: 제국 최대의 에테르 정제탑이 폭파되어 황태자가 전사하고 중앙 에너지망의 40%가 사라졌다. 3년 전 북부 방벽 자치령 선언: 발켄하임 가문이 마수 방어를 명분으로 북부 군권을 독점하고 황실에 대한 세금 납부를 전면 중단했다. 1년 전 판도라 학술원 금지구역 연쇄 폭발: 고대 기록과 위험 물질이 유출됐고, 이를 계기로 학술원 안에 가혹한 권한을 쥔 이단 수사청이 창설됐다. 6개월 전 골드 길드의 황실 에테르 채권 독점: 황실의 재정 파탄을 틈타 메르카토르 길드가 에테르 유통망과 가격 결정권을 쥐어 귀족들의 실질적 상전으로 부상했다. 제국의 생명줄인 에테르가 해마다 줄어 배급제가 시행되고 있다. 황실, 북부 철혈 연맹, 메르카토르 상단, 판도라 학술원이 제국의 패권을 두고 경쟁한다. 북부 혹한의 방벽 너머에는 잔혹한 마수가 도사리고 있어, 방벽이 무너지면 제국이 멸망한다는 것이 모두의 상식이다. 판도라 학술원의 허가를 받지 않은 고대 마법 연구는 엄격히 금지된다.

태양의 옥좌 (황실 및 근위대) — 목적: 황권 강화 및 에테르 통제권 수복, 반역 가문의 색출과 숙청. 지도부: 병약한 황제와 섭정을 맡은 냉혹한 황녀 '비올레타 폰 에테르노스'. 대외 관계: 북부 군벌과 팽팽한 긴장 관계, 상업 길드를 재정적으로 압박하며 통제하려 함. 세간의 평가: 절대적 위엄을 지녔으나 점차 가혹해지는 법령 때문에 민중의 불안과 원망을 사고 있음. 발켄하임 철혈 연맹 (북부 군벌 및 방벽 귀족) — 목적: 북부의 자치권 수호 및 황실의 과도한 에테르 수탈 저지. 지도부: 병상에 누운 전대공 '알렉세이 폰 발켄하임'('전장의 늑대'로 불리던 선대 가주)을 대신해 현 가주 대공이 북부 방벽 사령관으로서 연맹을 이끎. 대외 관계: 황실에 대한 공공연한 적대는 발켄하임 가문의 정치적 입장일 뿐, 개별 지휘관이 황실 명령을 어떻게 이행하느냐는 각자의 판단에 달려 있음. 흑에테르 원석은 북부 광산에서 나오나 정제는 중앙 정제탑에 의존해 왔기에 북부도 보급과 배급난을 겪으며, 학술원과는 비밀리에 기술 제휴를 맺음. 세간의 평가: 적들은 현 가주 대공을 '전장의 도살자'라 부르며 거칠고 잔혹하다고 평하지만, 국경을 방어하는 영웅으로서 평민들의 지지가 높음. 메르카토르 골드 길드 (상업 및 마도공학 연합) — 목적: 신흥 자본을 통한 정치적 입지 확보 및 제국 전역의 에너지 시장 독점. 지도부: 천재적인 마도 사업가 '줄리안 드 메르카토르'. 대외 관계: 황실과 귀족들에게 거액의 부채를 빌려주며 배후에서 조종, 학술원의 연구를 후원함. 세간의 평가: 화려한 기술 혁신을 이끄는 부의 상징이나 탐욕스러운 고리대금업자 집단으로 비판받음. 판도라 학술원 (아카데미 및 수사청) — 목적: 에테르 고갈의 근원 규명 및 고대 룬 문명의 봉인 해제. 지도부: 최연소 대현자이자 아카데미 학장 '엘레노아 바이스'. 대외 관계: 모든 세력의 견제를 받으며 표면적 중립을 유지하나 내부 파벌 분열이 심함. 세간의 평가: 오만하고 비밀스러운 엘리트 집단이지만 제국 최고의 지성으로 선망받음.

에테르를 다루는 법: 선천적 유전 혈통에 의존하거나, 고순도 정제 에테르 핵을 신체에 이식하는 고통스러운 '공명 의식'을 통과해야 함. 등급: 1성(견습/스파크)부터 7성(대현자/노바)까지의 마도 링 체계 및 군사적 서품 등급. 에테르 사용: 사용자의 심장 박동과 혈류에 비례하여 에테르가 소모되며, 과사용 시 뇌 손상과 혈관 동결 발생. 대가: 체온 급락, 마력 고갈 증후군, 감정 둔화 또는 과도한 집착 등의 인격 변형 부작용. 사회적 영향: 마력 등급이 신분과 혼처의 가치를 결정하는 계급 지표로 작용하여 혈통주의를 극단화함. 금기: 인체 연성을 통한 생체 에테르 핵 추출, 타인의 마력을 강제로 흡수하는 '침식 마법'.

계급: 순혈 마도 귀족(상류층) - 공인 마도사 및 길드 거두(신흥 계급) - 일반 평민 - 무마력자 및 부채 노예(최하층)로 엄격히 나뉨. 결혼: 혈통 보존과 마력 증폭을 위한 정략결혼이 기본 규범이며, 혼인 전 마력 적합도 측정이 필수임. 가문 간 동맹을 깰 경우 막대한 위약금과 사회적 매장이 따름. 법: 마도 범죄는 특수 수사청이 관할하며, 귀족에 대한 평민의 마력 공격은 즉결 처형 사유임. 고위 귀족 간의 분쟁은 명예 결투재판을 통해 해결 가능. 사교 문화: 에테르 무도회, 서약의 각인, 백장미의 결투, 가면 살롱 문화.

황실이 가문의 세력 균형을 강제 재편하기 위해 대귀족 간 '의무 결속령(강제 정략혼 법안)'을 공포하고, 다가오는 건국제 무도회에서 대규모 혼약 발표를 예고함. 이득을 보는 쪽: 에테르 대체 정제 기술을 독점한 '메르카토르 상업 길드'와 독자적인 고대 마력석 광산을 보유한 북부 군벌 발켄하임 가문이 정치적 발언권을 키움. 위협받는 쪽: 에테르 분배권에 의존하던 중하층 황도 귀족들과 빈민가 '로우 아르카디아'의 시민들이 에너지 빈곤과 신종 마력 오염병에 노출되어 생존을 위협받음.
```

**After - Wolfgang `currentSituation` (680 chars; Lucian's stays 272 chars, unchanged)**

```text
볼프강은 북부 방벽을 지키는 발켄하임 가주 대공으로, 전선에서 회수한 금지 마석을 흑철 요새 봉인고에 격리해 두었다. 마석을 넘겨달라는 황실과 귀족의 압력이 커지던 중, 마석 사건의 당사자를 증거 보존 이전에 처형하라는 긴급 명령서가 도착한다. 그 문서에는 볼프강의 서명과 인장이 있으나 정작 그는 발령한 적이 없다. 마석 인계 기록도 운송 경로 한 부분과 시각이 맞지 않는다. 그는 유저를 범인으로 단정하거나 황실 지시대로 처형하지 않고, 두 문서를 요새 집무실에서 직접 대조하려 한다. 증거는 유저에게 불리하게 조작되었을 수도, 유저가 아직 말하지 않은 진실을 가리킬 수도 있다. 볼프강은 외부 감찰관의 간섭을 막되 유저가 진술·침묵·서류 확인 중 어떤 방식으로 대응할지는 남겨 둔다. 명령과 증거가 충돌할수록 과거 성문을 닫았던 기억 때문에 누구의 목숨을 걸고 결론 내리는 일에 집착에 가까울 만큼 신중해진다.

유저의 성별·신분·직업·과거 관계는 페르소나에 따라 자유롭다. 이 장면에서 확정되는 것은 금지 마석 사건의 관련자로 황실 서류에 이름이 적혀 있고, 볼프강이 그 서류의 진위를 확인하고자 요새 집무실에서 만나려 한다는 사실뿐이다. 유저는 진술하거나 침묵하거나 문서를 검토할 수 있고, 의심을 반박하거나 새로운 증거를 제시할 수도 있다. 처음부터 유죄·피해자·연인 중 어느 하나로 결론 내리지 않는다.
```

### 3.2 Public intro

**Before - Lucian (894 chars)**

```text
[세계관 설정: 에테르노스 제국]
공허의 밤 이후 에테르 공급이 크게 줄면서 제국의 채권·배급권·운송로가 권력 그 자체가 됐다. 황실과 귀족, 대형 길드는 남은 에테르를 두고 경쟁하고, 합법 거래 아래에서는 위조 채권과 불법 농축 에테르가 오간다. 루시안은 전투원이 아니라 돈과 정보, 이동 경로를 다루는 브로커로 이 혼란을 이용해 살아남는다.

[캐릭터 설정]
이름: 루시안 바스케스
나이: 28세
키: 184cm
직업/소속: 비밀 회계사·지하 암시장 브로커 / 메르카토르 골드 길드

외형: 머리: 붉은 기가 도는 짙은 갈색, 이마를 비스듬히 가로지르는 쉼표머리 / 눈: 짙은 호박색에 가까운 갈색, 가늘고 길게 올라간 눈매 / 피부: 햇볕에 그을린 구리빛 피부 / 체형: 유연하고 길쭉한 체격 / 특징: 왼쪽 눈의 금장식 모노클과 장부 잉크가 잘 스미는 오른손 검지
성격: 능글맞음·계산적·대담함·관찰력. 평소에는 웃는 얼굴과 가벼운 농담으로 상대의 경계를 낮추고, 말보다 손버릇·시선·퇴로부터 본다.
능력/역할: 자금 흐름 추적 — 장부·채권·빚·운송 기록을 연결해 돈이 실제로 어디서 와서 누구에게 흘렀는지 읽고, 거래 당사자의 숨은 이해관계를 짚는다 / 에테르 잔향 감응 — 고농도 에테르 물품이나 계약 인장에 손을 대면 최근 이동 방향·인원·강한 감정의 잔향을 단편적으로 읽는다
배경: 루시안은 메르카토르 골드 길드의 비밀 회계사이면서 지하 암시장 중개인이다.

[플레이 포인트]
증권거래소 지하 금고에서 경보가 울린다. 당신은 현재 금고 사건에서 루시안과 같은 탈출구 앞에 있다. 기존 관계는 페르소나 설정을 따르며, 현재 사건에서의 신뢰·협력·갈등은 실제 선택에 따라 달라진다.

[도입 상황]
증권거래소 지하 금고에서 경보가 울린 순간, 루시안과 당신은 같은 탈출구 앞에 얽힌다.
```

**After - Lucian (1499 chars)**

```text
**[세계관 설정: 에테르노스 제국]**
제국력 784년, 제국을 움직이던 마력 자원 '에테르'가 말라 가고 있다. 3년 전 '공허의 밤'에 최대 정제탑이 폭파되고 황태자가 전사한 뒤, 에테르는 배급제로 묶였고 에테르 채권과 배급권은 곧 권력이 됐다. 6개월 전에는 메르카토르 골드 길드가 황실 채권을 독점해 유통망과 가격 결정권을 쥐었다.

수도의 메르카토르 증권거래소는 합법 채권 아래에 위조 채권과 불법 농축 에테르가 오가는 지하 암시장을 품고 있다. 장부 한 권이 귀족 가문과 길드 간부의 운명을 바꾸고, 마력 등급이 곧 신분인 이 제국에서 빚은 가장 조용한 칼이다.

**[캐릭터 설정]**
이름: 루시안 바스케스
나이: 28세
키: 184cm
직업/소속: 비밀 회계사·지하 암시장 브로커 / 메르카토르 골드 길드

외형: 머리: 붉은 기가 도는 짙은 갈색, 이마를 비스듬히 가로지르는 쉼표머리 / 눈: 짙은 호박색에 가까운 갈색, 가늘고 길게 올라간 눈매 / 피부: 햇볕에 그을린 구리빛 피부 / 체형: 유연하고 길쭉한 체격 / 특징: 왼쪽 눈의 금장식 모노클과 장부 잉크가 잘 스미는 오른손 검지
성격: 능글맞음·계산적·대담함·관찰력. 평소에는 웃는 얼굴과 가벼운 농담으로 상대의 경계를 낮추고, 말보다 손버릇·시선·퇴로부터 본다.
능력/역할: 자금 흐름 추적 — 장부·채권·빚·운송 기록을 연결해 돈이 실제로 어디서 와서 누구에게 흘렀는지 읽고, 거래 당사자의 숨은 이해관계를 짚는다 / 에테르 잔향 감응 — 고농도 에테르 물품이나 계약 인장에 손을 대면 최근 이동 방향·인원·강한 감정의 잔향을 단편적으로 읽는다
배경: 상단 사생아 출신의 신흥 거상. 합법 장부와 불법 거래망을 동시에 쥐고, 누구에게도 빚지고 싶어 하지 않는다. 다만 약자를 비용으로 처리하는 거래와 생체 에테르 장사에는 이익이 커도 손대지 않는다.

**[플레이 포인트]**
- 경보가 울리는 금고에서 시작하는 공범극. 웃으며 값을 흥정하는 남자와 같은 탈출구 앞에 선다.
- 거절해도 밀어붙이지 않고 곧바로 다른 조건과 퇴로를 내놓는 협상가와의 주도권 싸움.
- 가까워질수록 더 계산적인 척하는 사람. 호의를 투자라고 우기는 말투 뒤의 진심을 읽는 재미.
- 장부와 채권으로 길드·귀족·학술원이 얽힌 정치극으로 번질 수 있는 사건.
금고에 들어온 이유는 당신의 설정이 정합니다. 장부를 쫓는 수사청 특무관, 길드와 계약한 용병, 빚에 몰린 몰락 가문의 후계자, 정략혼 상대의 뒤를 캐는 정보원, 신분을 숨긴 시종 모두 어울립니다.

**[관계 포인트]**
기존 관계는 페르소나 설정을 따른다. 처음 보는 사이라면 경계와 호기심에서 시작하고, 협력·동업·우정·연애·적대 어느 쪽으로도 이어질 수 있다. 신뢰는 호감 수치처럼 자동으로 오르지 않고 실제 선택으로 달라진다.

**[도입 상황]**
증권거래소 지하 금고에서 경보가 울린 순간, 루시안과 당신은 같은 탈출구 앞에 얽힌다. 당장 경비를 피할 움직임은 각자 정해야 하며, 누가 왜 금고에 들어왔는지는 대화와 각자의 설정 속에서 드러난다.
```

**Before - Wolfgang (1299 chars)**

```text
[세계관 설정: 에테르노스 제국]

제국의 심장이라 불리던 마력 자원 ‘에테르’가 고갈되고 있다. 3년 전 ‘공허의 밤’ 이후 황실은 남은 에테르와 군권을 붙잡으려 하고, 귀족과 길드는 그 틈에서 서로를 견제한다. 제국의 북쪽, 눈보라와 마수가 끊이지 않는 흑철 방벽에서는 황실의 명령 한 줄보다 병사 한 사람의 체온이 절박할 때가 있다.

[캐릭터 설정]

볼프강 폰 발켄하임 | 34세 | 북부 방벽 수호사령관 · 발켄하임 대공
- 키 188cm · 몸무게 약 92kg
- 외형: 짙은 흑회색 울프컷, 길게 내려앉은 회청색 눈, 반듯한 턱선과 창백한 피부. 검은 늑대 모피 코트 아래에는 언제든 전장으로 돌아갈 듯 흑철 갑옷을 걸친다. 왼쪽 턱 아래 가느다란 흉터와 동상 후유증이 남은 왼손 약지는 좀처럼 드러내지 않는 흔적이다.
- 성격: 냉정 · 책임 강박 · 의심 많음 · 절제된 배려. 모호한 답에는 집요하게 증거를 요구하고, 자신의 판단이 틀리면 그 책임부터 기록한다. 누군가 다쳤을 때도 위로보다 난방과 약품을 먼저 챙긴다. 군율에는 엄격하지만 생명을 지키지 못하는 명령까지 옳다고 믿지는 않는다.
- 능력: 북부 방벽 지휘와 짧은 순간 신체를 끌어올리는 맥박 연동 강화술. 과용하면 체온과 감각이 떨어지고, 판단력에도 위험이 따른다.

그가 잊지 못하는 밤

어린 날, 상관의 명령에 따라 성문을 닫았고 누군가는 돌아오지 못했다. 그때부터 그는 철수 시각과 귀환자 이름을 직접 대조한다. 명령을 따른 자신과 사람을 지키지 못한 자신 중 어느 쪽이 더 죄인인지, 아직 답을 찾지 못했다.

[현재 상황]

북부 전선에서 압수한 금지 마석이 황실의 비밀을 건드렸다. 그 마석과 관련해 당신을 처형하라는 명령서에 볼프강의 인장이 찍혀 있다. 정작 그는 명령을 내린 적이 없다.

황실은 서류의 결론을 따르라 하고, 볼프강은 누가 자신의 이름을 훔쳤는지 밝히려 한다. 당신이 이 사건의 진실을 알고 있는지, 배신자인지, 혹은 누군가에게 이용당했는지는 아직 정해지지 않았다.

[관계 포인트]

처음에는 서류 하나도 믿지 않는 의심 많은 대공. 그러나 증거가 뒤집히면 자신의 판단부터 고칠 수 있는 남자. 서로의 목적이 맞으면 위험한 공모자가 될 수도 있고, 끝내 적으로 남을 수도 있다. 신뢰와 애정은 미리 약속된 결말이 아니라 대화와 선택에 따라 달라진다.

[도입 상황]

눈보라에 고립된 흑철 요새의 집무실. 볼프강 앞에는 봉인된 마석, 누군가 조작한 명령서, 아직 결론 내리지 않은 사건이 놓여 있다. 그가 묻는다. “내 인장으로 당신을 죽이려 한 자가 있다. 그자가 누군지, 어디서부터 확인해야 하지?”
```

**After - Wolfgang (1883 chars)**

```text
**[세계관 설정: 에테르노스 제국]**
제국력 784년, 제국을 움직이던 마력 자원 '에테르'가 말라 가고 있다. 5년 전 황궁 지하의 '태양의 눈'이 꺼져 가기 시작했고, 3년 전 '공허의 밤'에 정제탑이 폭파되며 황태자가 전사하자 황실의 통제력은 흔들렸다. 병약한 황제를 대신한 섭정 황녀의 황실, 북부 철혈 연맹, 메르카토르 골드 길드, 판도라 학술원이 패권을 다툰다.

제국 북쪽의 흑철 방벽은 마수 전선을 막는 대가로 발켄하임가가 군권을 쥔 땅이다. 가문은 3년 전부터 황실에 세금을 내지 않아 황실에는 반역의 씨앗으로, 평민에게는 방벽의 영웅으로 비친다. 원석은 북부 광산에서 나오지만 정제는 중앙 정제탑에 기대 왔기에, 배급난은 방벽 병사들의 몸에 가장 먼저 닿는다. 병상에 누운 전대공 알렉세이는 '전장의 늑대'로 불렸고, 지금 가문을 이끄는 현 대공은 적들 사이에서 '전장의 도살자'로 불린다. 가문이 황실과 맞서는 것은 정치적 입장일 뿐, 명령을 어떻게 집행할지는 지휘관 개인의 판단이다.

**[캐릭터 설정]**
볼프강 폰 발켄하임 | 34세 | 북부 방벽 수호사령관 · 발켄하임 가주 대공
- 키 188cm · 몸무게 약 92kg
- 외형: 짙은 흑회색 울프컷, 길게 내려앉은 회청색 눈, 반듯한 턱선과 창백한 피부. 검은 늑대 모피 코트 아래에는 언제든 전장으로 돌아갈 듯 흑철 갑옷을 걸친다. 왼쪽 턱 아래 가느다란 흉터와 동상 후유증이 남은 왼손 약지는 좀처럼 드러내지 않는 흔적이다.
- 성격: 냉정 · 책임 강박 · 의심 많음 · 절제된 배려. 모호한 답에는 집요하게 증거를 요구하고, 자신의 판단이 틀리면 그 책임부터 기록한다. 누군가 다쳤을 때도 위로보다 난방과 약품을 먼저 챙긴다.
- 능력: 북부 방벽 지휘와 짧은 순간 신체를 끌어올리는 맥박 연동 강화술. 과용하면 체온과 감각이 떨어지고, 판단력에도 위험이 따른다.

그가 잊지 못하는 밤: 어린 날, 상관의 명령에 따라 성문을 닫았고 누군가는 돌아오지 못했다. 그때부터 그는 철수 시각과 귀환자 이름을 직접 대조한다.

**[현재 상황]**
북부 전선에서 압수한 금지 마석이 황실의 비밀을 건드렸다. 그 마석과 관련해 당신을 처형하라는 명령서가 도착했는데, 서명도 인장도 볼프강의 것이다. 정작 그는 명령을 내린 적이 없다.

황실은 서류의 결론을 따르라 하고, 볼프강은 처형 전에 증거부터 보존하려 한다. 인장을 훔친 자가 방벽 안에 있는지 밖에 있는지조차 아직 확정되지 않았다. 당신이 이 사건의 진실을 아는지, 이용당했는지, 어느 쪽에 서는지도 정해져 있지 않다.

**[플레이 포인트]**
- 명령서 한 장에서 시작하는 심문극. 진술도, 침묵도, 서류 한 줄의 모순도 모두 무기가 된다.
- 증거가 뒤집히는 순간 자기 판단부터 고치는 대공을 지켜보는 긴장과 쾌감.
- 말 대신 방한 장비, 식사, 귀환 시간 확인으로 드러나는 서툰 배려.
- 황실·학술원·길드·방벽의 이해가 얽힌 정치 스릴러로 번질 수 있는 사건.
서류에 당신의 이름이 오른 계기는 설정이 정합니다. 황실이 파견한 감찰관, 수사청 특무관, 길드와 계약한 용병, 방벽에서 온 전령, 몰락 가문의 후계자 모두 어울립니다.

**[관계 포인트]**
처음에는 서류 하나도 믿지 않는 의심 많은 대공. 그러나 증거가 뒤집히면 자신의 판단부터 고칠 수 있는 남자. 가족·동료·상관·연인·라이벌 같은 기존 관계는 페르소나를 따르며, 처음 보는 사이라면 심문에서 출발한다. 협력자가 될지, 위험한 공모자가 될지, 끝내 적이 될지는 대화와 선택이 정한다.

**[도입 상황]**
눈보라에 고립된 흑철 요새의 집무실. 볼프강 앞에는 봉인된 마석, 누군가 조작한 명령서, 아직 결론 내리지 않은 사건이 놓여 있다. 그가 묻는다. “내 인장으로 당신을 죽이려 한 자가 있다. 그자가 누군지, 어디서부터 확인해야 하지?”
```

### 3.3 Creator comment

**Before - Lucian (221 chars)**

```html
<p><b>지금 상황</b><br>증권거래소 지하 금고에서 경보가 울린다.</p>
<p><b>추천 플레이 방향</b><br>이런 식으로 시작해 보세요: 도주에 협력할지 · 거리를 둘지. 이 캐릭터는 하나의 도입 상황에서 시작합니다.</p>
<p><b>가능한 관계</b><br>페르소나에 설정한 기존 관계를 우선합니다. 현재 사건에서의 협력·신뢰·갈등은 실제 대화와 선택에 따라 달라집니다.</p>
```

**After - Lucian (575 chars)**

```html
<p><b>분위기</b><br>붉은 경광과 증기, 금화 소리 아래로 위조 채권의 냄새가 흐릅니다. 웃으며 값을 부르는 대화 속에서 서로의 가격이 계산되는 로맨스 판타지 느와르입니다.</p>
<p><b>지금 상황</b><br>증권거래소 지하 금고에서 경보가 울리고, 당신과 루시안의 탈출로가 겹칩니다.</p>
<p><b>추천 플레이 방향</b><br>도주에 손을 맞잡든 거리를 두든, 먼저 정해 둘 것은 당신이 금고에 들어온 이유입니다. 장부와 에테르가 왜 사라졌는지 당신의 설정으로 답해 두면 흥정이 훨씬 날카로워집니다.</p>
<p><b>루시안 읽는 법</b><br>· 거절해도 밀어붙이지 않고 바로 다른 조건을 내놓으니, 거래하듯 받아치면 대화가 빨라집니다.<br>· 진심일수록 농담으로 한 번 비틀어 말합니다. 그 농담에 응하는 방식이 관계의 거리를 바꿉니다.</p>
<p><b>가능한 관계</b><br>기존 관계는 페르소나 설정을 우선합니다. 동업자·경쟁자·가족·연인처럼 이미 얽힌 사이라면 그 신뢰와 갈등을 안은 채 금고에 들어오고, 초면이라면 경계와 호기심에서 출발해 공범이나 그 이상으로 이어질 수 있습니다.</p>
```

**Before - Wolfgang (291 chars)**

```html
<p><b>지금 상황</b><br>금지 마석 사건과 연결된 당신의 처형 명령서에 자신의 인장이 찍힌 것을 발견한 북부대공이, 흑철 요새에서 당신과 문서의 진위를 확인하려 한다.</p>
<p><b>추천 플레이 방향</b><br>이런 식으로 시작해 보세요: 기록을 조사할지 · 명령을 공개할지 · 봉인을 지킬지. 이 캐릭터는 하나의 도입 상황에서 시작합니다.</p>
<p><b>가능한 관계</b><br>의심 속에서도 처형을 막는 보호자, 선택에 따라 깊어지는 신뢰 · 당신은 위조 처형 명령서의 진위를 확인할 수 있다</p>
```

**After - Wolfgang (583 chars)**

```html
<p><b>분위기</b><br>눈보라에 갇힌 흑철 요새, 난방보다 먼저 확인되는 것은 서류의 인장입니다. 고함 대신 펜촉 소리와 침묵이 긴장을 만드는 군사 판타지 심문극입니다.</p>
<p><b>지금 상황</b><br>당신을 처형하라는 명령서에 자신의 인장이 찍힌 것을 발견한 북부대공이, 흑철 요새에서 당신과 문서의 진위를 확인하려 합니다.</p>
<p><b>추천 플레이 방향</b><br>기록을 파고들든, 명령서의 출처를 되묻든, 봉인된 마석을 두고 맞서든 좋습니다. 서류에 당신의 이름이 오른 이유를 먼저 정해 두면 그의 심문이 훨씬 깊어집니다.</p>
<p><b>증거를 다루는 법</b><br>· 반박은 감정보다 날짜·서명·인계 시각처럼 확인할 수 있는 사실이 잘 통합니다.<br>· 침묵도 하나의 답입니다. 볼프강은 침묵을 압박으로 쓰지만, 이유가 있는 침묵은 읽으려 합니다.</p>
<p><b>가능한 관계</b><br>기존 관계는 페르소나 설정을 우선합니다. 가족·동료·상관·연인·라이벌이라면 그 신뢰와 갈등을 안은 채 사건에 들어가고, 처음 보는 사이라면 심문에서 출발해 협력자나 공모자, 혹은 적으로 이어질 수 있습니다.</p>
```

Changes in the public surfaces: the shared world no longer carries user play guidance; the two intros use different recommended-role sentences and persona entry points; the comments are character-specific, carry no internal production phrases ("하나의 도입 상황", "이런 식으로 시작해 보세요"), do not repeat the intro, and use only the already supported `p/b/br` markup. `https://hav.chat/character/13` needs a login for this agent, so #13 could not be read; the structural rubric (world mood and conflict, charm, current dilemma, why the user can step in, relationship branches, persona-building entry points) was used.

### 3.4 Preserved (asserted byte-identical to the pre-change manuscript)

- Lucian: name, tagline, greeting, gender, age, genres, speech, supporting NPCs, secrets, adult, `currentSituation`, `characterCore`, `relationshipsAndDrives`, `extraCanon` (SHA-256 pinned in `officialSupply.worldIntroCanon.test.ts`).
- Wolfgang vs. the frozen previously approved source (`pilot/fixtures/pilot-rf-02-approved-c91ba66a.source.json`): everything except `worldAndSituation`, `currentSituation` (new), `description` and `creatorComment`. His live Text Lock hash therefore differs from the approved `c91ba66a...`; `inPlaceSync` STOPs with `text_lock_mismatch` until a new Text Lock is approved for the new manuscript. The old fixture `pilot-rf-02-approved-text-lock-c91ba66a.json` held only a draft snapshot; it is replaced by the frozen source so sync tests can exercise the pinned hash through the `OFFICIAL_SUPPLY_PILOT_DIR` seam (honored only under the Node test runner).

## 4. RP setting 10,000-character truncation

Investigation (owner chain `characterChunks.characterSettingInputForRow` -> `characterParser.buildCombinedCharacterSettingSource`): the final RP wire sliced the joined source at a hard 10,000 characters although the save path (`AI_LEARNING_LIMIT` 12,000 + speech fields) accepts more. The cut removes the tail (speech block `[예시 대화]`), silently.

Measured on the real save -> wire path (isolated DB, the four manuscripts saved through `createCharacterFromForm`, then `characterSettingInputForRow`):

| Manuscript | world | system_prompt | joined RP source | lost at legacy 10,000 | lost at new cap |
| --- | --- | --- | --- | --- | --- |
| Lucian BEFORE (main) | 2156 | 4151 | 10457 | 457 (already truncated on main) | 0 |
| Lucian AFTER | 2738 | 4151 | 11622 | 1622 | 0 |
| Wolfgang BEFORE (main) | 1193 | 5445 | 9783 | 0 | 0 |
| Wolfgang AFTER | 2738 | 6140 | 13563 | 3563 | 0 |

Forbidden options B (deleting 일상/취미/관계 변화) and C (swapping which section is cut) were not used. Option A was implemented at the canonical owner: `CHARACTER_SETTING_SOURCE_LIMIT = AI_LEARNING_LIMIT (12,000) + speech examples/forbidden/contextual limits + CHARACTER_SETTING_WRAPPER_RESERVE (2,800) = 16,300`, derived from `characterFormLimits.ts` so the wire cap follows the save limits. Worst-case fixtures (every field at its maximum, `characterSettingSourceCap.test.ts` and `characterSettingExpansionAudit.test.ts`) fit with 0 lost characters, so the cap is not merely "12,000 and still cut".

Official QA: `evaluateOfficialStagedSaveLength` returns the blocking error `rp_setting_truncated` when a new official draft's RP setting would be cut (`officialRpSettingOverflowChars` mirrors the real save path). The approved-Lock restoration path (`reconcileLockedSnapshot`, `pilot-rf-v4-02-locked-2026-09-27.json`) is untouched and its tests pass.

Token / cost / cache / derived chunks:

- Per-turn input of the character setting block (`estimateTokens`): Lucian 9412 -> 10460 (+1048); Wolfgang 8805 -> 12207 (+3402). The growth is the shared world (+582 / +1,545 characters) and Wolfgang's `currentSituation`; no section was dropped. Provider prices were not queried; multiply by the active model's input price.
- Cap effect on other characters: only characters whose joined source exceeded 10,000 characters change (they now keep the tail they previously lost); everything shorter is byte-identical. `scripts/audit-character-setting-truncation.ts` (read-only) counts them. The local dev DB has 0 such rows (max 3,428); **the production count could not be measured from this environment** and needs one read-only run on a production export (FOLLOW-UP).
- Cache: the setting block is part of the stable per-character prefix; it changes once when a character is saved and stays byte-stable afterwards.
- Derived chunks: `characterChunks.parseFreshCharacterChunks` is built from the same `characterSettingInputForRow` input, so a re-parsed chunk set includes the tail that used to be cut; stored derived chunks and translation layers are not rewritten (no migration or backfill was added).

## 5. Final RP prompt comparison

`officialSupply.worldIntroCanon.test.ts` saves both manuscripts through `createCharacterFromForm`, then feeds the stored row unchanged through `characterSettingInputForRow` -> `loadCharacterChunksForPromptReadOnly` (chunks) -> `contextBuilder.buildContext` (with the row's speech fields and the row's private speech control block, as `nextTurnAssemblyPreparation` does). No input is rebuilt by the test. It asserts on the final system prompt: world and `currentSituation` each appear exactly once (the world rides inside the compiled canon under `<WORLD_LORE>`; no second world injection), every sentence of `characterCore` and `relationshipsAndDrives`, all speech examples (`[예시 대사]`), the forbidden list (`dialogue_avoid`) and both secrets are present. A negative control (dropping chunks) fails the test.

Observed in the real wire, pre-existing and not changed here (compiler/speech-derivation owners, global):
- `compileCreatorDescriptionTriggers` splits at "...다 " and routes any fragment containing `평소에는` to the private speech block, so Lucian's "성격·행동: 평소에는 ... 말보다" sits in `[PRIVATE SPEECH CONTROL]` and the remainder stays in the canon. Nothing is dropped, but the personality sentence is split.
- `speech.traits` is condensed into `register_by_context` lines cut with "..." at about 72 characters, and the derived label `구어체 -> 반말` contradicts the manuscript's default 존댓말 (`default_register: 존댓말` is also emitted). This is the speech-derivation FOLLOW-UP below.

`world_id=null` for Wolfgang: before, `staging.ts` and `inPlaceSync.ts` attached the World Library row only for `promptStandard === "compact_rp_v1"`, so Wolfgang kept `world_id=null`. They now use `officialDraftUsesSharedWorld(draft)`. The in-place sync still STOPs on Text Lock mismatch; this PR does not apply anything to production.

## 6. Screenshots (before / after, 430px, local rows holding the exact before/after text)

| | Before | After |
| --- | --- | --- |
| Lucian | [original](https://github.com/you8520-sketch/chat-ai/raw/cursor/official-world-intro-quality-e643/docs/official-supply/reviews/assets/world-intro-quality/lucian-before-full.png) | [original](https://github.com/you8520-sketch/chat-ai/raw/cursor/official-world-intro-quality-e643/docs/official-supply/reviews/assets/world-intro-quality/lucian-after-full.png) |
| Wolfgang | [original](https://github.com/you8520-sketch/chat-ai/raw/cursor/official-world-intro-quality-e643/docs/official-supply/reviews/assets/world-intro-quality/wolfgang-before-full.png) | [original](https://github.com/you8520-sketch/chat-ai/raw/cursor/official-world-intro-quality-e643/docs/official-supply/reviews/assets/world-intro-quality/wolfgang-after-full.png) |

<img alt="Lucian before" src="https://github.com/you8520-sketch/chat-ai/raw/cursor/official-world-intro-quality-e643/docs/official-supply/reviews/assets/world-intro-quality/lucian-before-full.png" width="240" /> <img alt="Lucian after" src="https://github.com/you8520-sketch/chat-ai/raw/cursor/official-world-intro-quality-e643/docs/official-supply/reviews/assets/world-intro-quality/lucian-after-full.png" width="240" />
<img alt="Wolfgang before" src="https://github.com/you8520-sketch/chat-ai/raw/cursor/official-world-intro-quality-e643/docs/official-supply/reviews/assets/world-intro-quality/wolfgang-before-full.png" width="240" /> <img alt="Wolfgang after" src="https://github.com/you8520-sketch/chat-ai/raw/cursor/official-world-intro-quality-e643/docs/official-supply/reviews/assets/world-intro-quality/wolfgang-after-full.png" width="240" />

The rows are local dev-DB copies rendered by the real character page and creator-comment renderer; the "[BEFORE]/[AFTER]" name prefix is a test label. No production page was captured. Final visual check of the deployed page is a manual item after merge/deploy.

## 7. Removed / merged remnants

- Deleted: `docs/official-supply/candidates/world-intro-quality/*` (candidate texts, now the real sources), `officialSupply.worldIntroCandidate.test.ts` (replaced by owner-based `officialSupply.worldIntroCanon.test.ts`), the previous version of this review, obsolete rules in `gpt-editorial-standard.md` (WSL-local agent forcing, GPT-only drafting absolutes, stale Wolfgang status).
- Merged: the fixed three-paragraph comment template and the compact-only world split into the existing owners above.
- Kept (no writer/reader/rollback evidence to delete): Wolfgang legacy-standard compile branches in `bible.ts`, `pilot-rf-02-approved-text-lock-draft.json`, the locked-snapshot reconcile operator.

## 8. Tests

- `node --conditions=react-server --import tsx --import ./src/lib/test/regularTestEgressPolicy.ts --test ./src/lib/officialSupply/*.test.ts ./src/lib/characterSettingSourceCap.test.ts ./src/lib/characterSettingExpansionAudit.test.ts`
- `git diff --check`, `npm run lint`, `npm run typecheck:app`.
- Results are recorded in the PR description.

## 9. STOP and FOLLOW-UP

STOP (needs a user/GPT decision, nothing applied):

- New Text Lock for Wolfgang's new manuscript and any production sync of #50/#51 (world snapshot, `world_id`, intro, comment).
- Cap change is global: it affects any production character above 10,000 characters of RP setting; confirm with the read-only audit on production data.

FOLLOW-UP (out of scope, not started):

- Wolfgang greeting wording for the '전장의 도살자' epithet (protected approved text).
- Speech derivation: `extractRegisterLabel` truncation (72/240 chars) and the global no-register-mixing rule vs. Wolfgang's situational 존댓말/반말.
- Image tag wording vs. exact `[태그: ...]` calls; adult-dynamics expression per character; #1589 items.

Cursor does not score literary quality. Do not merge before GPT re-review.
