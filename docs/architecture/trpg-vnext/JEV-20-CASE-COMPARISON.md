# JEV 20-case comparison (Korean TRPG)

- 모델: `typesafe/jev-1.14-20261014`
- 호출: 4 Decisions requests (action/commitment/ending 3-way/ending binary)
- 비용: $0.001479324 (약 2.0–2.2원)
- 원본: `hav-rp-evidence-private` PR #54, `cases/trpg-r0-2026-10-31-fun-progression/jev/`
- fixture: `fixtures/jev-20-korean-trpg-cases.json`
- script: `scripts/trpg-jev-20-case-comparison.ts`

## 방법

20개 실제 한국어 TRPG 사례의 gold label과 근거를 **JEV 호출 전에** 고정했다. 같은 입력·문맥을 현재 분류기와 JEV에 주었다. JEV를 정답으로 가정하지 않았고, 숫자·권한·AP·HP·DB는 서버 소유로 남겼다.

## 결과

| 차원 | 현재 | JEV |
|---|---:|---:|
| action | 13/20 (65%) | **18/20 (90%)** |
| commitment | 17/20 (85%) | **18/20 (90%)** |
| ending 3-way | 18/20 (90%) | **6/20 (30%)** |
| ending binary | — | **19/20 (95%)** |

ending binary는 human 19/19, 긴 봇 복합문 0/1이었다.

## 현재 분류기의 오류

- `문 앞에서 잠시 기다린다.` → `force_attempt` (`문을?\s`가 “문 앞”에 걸림)
- `그가 칼을 들고 다가온다는 것을 알아차린다.` → `force_attempt`
- `"문을 부수겠어!" 하고 소리친다.` → talk로 남지 않음
- `주인이 내미는 메밀 봉투를 받아 든다.` → item take로 잡지 못함
- `경비병을 속여 통과하려 한다.` → movement가 social attempt보다 먼저 잡힘

## JEV의 오류

- 긴 봇 잠금(대사 + 문 안쪽에서 물러섬) → action `talk` (gold `wait_stay`)
- `문밖으로 나가지 않고 안쪽에 남아 상황을 지켜본다` → `observe` (gold `wait_stay`; stay+observe)
- `선물은 사양하고 문밖으로 나간다` → commitment `negated` (gold `committed`)
- `그가 칼을 들고 다가온다는 것을 알아차린다` → commitment `mentioned` (gold `committed`)
- 긴 봇 잠금 + `<<<INTENT>>>` → binary ending `noul=0.10` (gold farewell)

## 결론

- JEV는 **action/commitment typed proposal**로만 채택 후보.
- 대체 대상은 `actionSemantics.ts` / `movementDeclaration.ts` / `actionCheck.ts`의 regex·lexicon 의미 게이팅이다.
- `dice.ts`, `explorationMap.ts` / `explorationStore.ts`, `engineSheets.ts` / `inventory.ts`, auth/billing/idempotency는 대체하지 않는다.
- JEV를 추가 차단기로 두지 않는다. low confidence/모호성은 한 번의 clarification 또는 보수적 no-op으로 처리한다.
- JEV 3-way ending은 채택하지 않는다. binary ending도 human 명시적 작별의 보조 신호로만 쓰고, 최종 종료는 서버 `EndingDecision`이 소유한다.

## 재현

```powershell
node --conditions=react-server --import tsx scripts/trpg-jev-20-case-comparison.ts --dry-run
node --conditions=react-server --import tsx scripts/trpg-jev-20-case-comparison.ts --live
node --conditions=react-server --import tsx scripts/trpg-jev-20-case-comparison.ts --ending-binary-only
```
