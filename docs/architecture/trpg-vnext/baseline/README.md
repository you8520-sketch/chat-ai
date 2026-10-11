# TRPG vNext Phase 0 — 기준선 (baseline @ `796d279f`)

모든 수치는 **현재 main 코드**를 provider 호출 0 · DB 쓰기 0 으로 실행해 얻었다.
RP 문장 품질은 측정하지 않았다 (Cursor는 RP 품질 점수를 매기지 않는다).

## 재현

```bash
node --conditions=react-server --import tsx \
  --import ./src/lib/test/regularTestEgressPolicy.ts \
  scripts/trpg-vnext-baseline.ts
# -> docs/architecture/trpg-vnext/baseline/baseline-796d279f.json
```

입력 fixture (모두 Cursor가 제안한 *메커닉 해석* 라벨 — GPT/사용자 승인 전까지 게이트로 쓰지 않는다):
- `../fixtures/action-corpus.json` — 한국어 행동 32건. **text-only baseline probe** 이며 보편 oracle 이 아니다(A11 A15 A18 R06 R11 은 장면 의존 → context pair 로 보완).
- `../fixtures/action-context-pairs.json` — context-grounded pair 10그룹/22멤버, `proposed-not-approved`, `gate:false`.
- `../fixtures/outcome-contract-cases.json` — 서버 결과 계약 O01–O20 **명세**(현재 main 에서는 실행 불가; Slice 1a/1b 테스트의 청사진). H1–H10 은 이 러너가 실제 실행.

## P1 — HP / 아이템 / 상태 권한 (실제 `resolveRoundMechanics` + `mergeMechanicsOwnedDelta`)

| id | 상황 | GM 구조화 출력 | 시작 → 결과 | 계약상 기대 | 판정 |
|---|---|---|---|---|---|
| H1 | PC가 소리만 듣는다 | hp=8 | 30 → **8** | 30 | DEFECT |
| H2 | PC 공격 실패, GM이 반격 피해를 hp에 안 씀 | hp 생략 | 30 → 30 | 30 (정당한 피해 근거가 서버에 없음) | DECISION_NEEDED |
| H3 | PC 공격 실패, GM hp=22 | hp=22 | 30 → 22 | 22 | PRESERVED (H1과 같은 코드 경로) |
| H4 | 행동 제출 없는 좌석(렌)에 hp=12 | hp=12 | 30 → **12** | 30 | DEFECT |
| H5 | mechanics incomplete 경로 + hp=8 | hp=8 | 30 → **8** | 30 | DEFECT |
| H6 | HP 10 PC가 듣기만, GM hp=30 | hp=30 | 10 → **30** | 10 | DEFECT (무료 전회복) |
| H7 | GM이 `conditions:["중독"]` 추가 | condition | `derivePostGmOngoingSeeds` → POISON seed | seed 없음 | DEFECT (GM 문자열이 서버 DOT를 자가 승인) |
| H8 | GM이 `inventoryAdd:["용의 심장"]` | item | 인벤토리에 **추가됨** | 출처 필요 | DECISION_NEEDED |
| H9 | referee ON 상태 서버 피해 vs GM 완화 hp | hp=29 | 30 → 26 (서버) | 26 | PRESERVED |
| H10 | 서버 회복 vs GM 낮은 stale hp | hp=3 | 10 → 14 (회복 floor) | 14 | PRESERVED |

요약: DEFECT 5 (H1 H4 H5 H6 H7) · DECISION_NEEDED 2 (H2 H8) · PRESERVED 3 (H3 H9 H10).
핵심: **H1과 H3은 같은 코드 경로**라서 현재 owner는 "정당한 전투 피해"와 "근거 없는 피해"를 구분할 수 없다.

## P2 — 행동 의미 → 굴림 필요 여부 (`resolveTrpgActionCheckDecision`, 31건 채점 + 1건 clarify)

probe 문맥: `localScene=null`, `intent=null` (운영에서는 둘 다 전달되므로 절대 비율은 참고치).

| 조건 | 정답 수 / 31 | 비고 |
|---|---|---|
| actionType `free` (칩 없음) | 23 | no_roll 20건 중 **7건 오롤**(A04 A05 A07 A11 A13 A14 A15), roll 11건 중 1건 누락(R10) |
| actionType `attack` 칩 | 11 | no_roll 20건 **20건 전부 오롤**, roll 11건은 전부 롤 |
| clarify 경로 | 없음 | C01(`그를 처리한다.`)에 대한 되묻기 owner 부재 |

## P2b — context pair (`action-context-pairs.json`, 참고용 · 게이트 아님)

현재 owner(`resolveTrpgActionCheckDecision`)는 `localScene` 만 받고 장면 사실(`facts`)은 받을 수 없다. 러너는 각 fixture 장면의 `localScene` 투영만 전달한다.

- 비교 가능한 18 멤버(필수/불필요 라벨이 있는 것) 중 라벨 일치 11 (라벨 미승인이므로 정확도 아님).
- 같은 문장·다른 기대 4쌍(CP01 CP02 CP08 CP09) 중 현재 owner 결과가 갈리는 쌍 **1** (CP01, `routine_traversal` 경로).
- 대상 부재(CP02b)·단언된 사실(CP10b)·부정문(CP04a)도 굴림으로 판정됨 → 대상 존재/부정을 입력으로 쓰지 않음.
- 모호·고위험(CP07) 되묻기 경로 없음.

## P3 — 장기 기억 가시성 / 시간순서 (`memoryHorizon`, 이벤트 5건 · R5/R20/R50/R100)

가정: 운영은 RAW 3라운드 밖으로 밀린 라운드만 seal 하므로 probe는 `roundEnd <= current-3` 이벤트만 사용한다.

- R5 sealed 이벤트 0건 → 3라운드 직전(R3) 관계 사실은 recall에 없음 (RAW 창에만 의존).
- R100 GM recall 순서 = R45, R12, R60, R30, R3 → **시간순 아님** (점수순; 동점 tie-break만 roundEnd 오름차순).
- "은색 열쇠 획득(R12)"과 "분실(R45)"이 **둘 다** recall 됨 → supersede/상태 해소 없음.
- `eventVisibleToViewer`: viewerKind는 `gm | bot` 뿐 → **인간 참가자별 시점 없음**. GM은 `actor_only` 비밀 열람 가능(설계 의도), 유나 bot은 렌의 배신 비밀을 못 봄(정상).
- `knownParticipantIds`는 저장(`persistMemoryEvents`)되지만 가시성 판정에는 **읽히지 않음**.

## P3b — 기억 identity / GM 가시성 표시

- `memoryEventFingerprint` 는 라운드를 포함하지 않는다: 같은 문장의 재획득·재화해는 같은 fingerprint → `persistMemoryEvents` 의 `INSERT OR IGNORE ... UNIQUE(campaign_id, fingerprint)` 로 **버려진다**.
- `formatMemoryLines` 출력은 `- R30: 렌은 몰래 길드에 파티 위치를 넘겼다.` — `actor_only` 사실도 scope/knower 표시가 없다(GM 이 누가 아는지 구분 불가).

## 전체 TRPG 회귀 baseline

canonical regular runner (`regularTestEgressPolicy`) @ `796d279f`: tests 2049 · pass 2016 · **fail 32** · skipped 1 (전체 로그는 PR 아티팩트).
이 PR은 runtime 코드를 바꾸지 않으므로 이 숫자는 그대로여야 한다. 분류(상세는 RFC §11.3): **GATE-1** `postGmOngoingTrust.test.ts` 파싱 불가(1a/1b 필수 선행), **GATE-2** `gmProviderRetry` F/G/H(멱등성 증명 테스트), 봇 좌석 drift, 나머지 무관. 실패 목록(중복 제거, 작업과 무관한 기존 문제):

- `src/lib/trpg/postGmOngoingTrust.test.ts` — **파싱 불가** (`gmText(participantId?: number, conditions?[], {` 구문 오류, 커밋 `ae26a4b5` 이후). GM condition→DOT owner의 유일한 trust 테스트가 실행되지 않는다.
- engine 봇 좌석 테스트(`calls the bot seat before the GM and keeps them as two Pro turns`, `lets the second companion see the first companion's action`): mock 내부 assertion 불일치로 ERROR_RECOVERY (런타임 경로는 ACTION_INPUT 완료 — test drift).
- `gmProviderRetry` F/G/H (`empty completion` / ERROR_RECOVERY), 원인 미분류.
- TRPG UI/scroll/scenario/model-routing 계열 다수 (이름은 아티팩트 로그 참조).
