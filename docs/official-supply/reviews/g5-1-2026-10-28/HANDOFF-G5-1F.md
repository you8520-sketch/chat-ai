# G5-1F — scene `worldScale` 구현 및 현대/일상 실측 (박은지)

작성: 2026-10-29 KST · HEAD `d6fd7ae492bae71991acaa3d0fec126610a03cae` (실측 성공 커밋)

## BEFORE / PROBLEM

- 모든 장르에 동일한 world QA 하한(factions 3–6, locations 5–10, …) → 현대/일상 3편(박수진·최하늘·오지은)이 행정·기록·권한 실무로 수렴.
- G5-1E 설계 C안: `현대/일상`만 scene 깊이, 로판·나머지 full 유지.

## AFTER

- `genreProfile.ts`: `worldScale: "full" | "scene"`, `OFFICIAL_WORLD_SCALE_LIMITS`, `현대/일상`만 scene.
- `authorPrompts.ts`: core/atlas 개수·scene `powerSystem`·society 평면 객체 안내.
- `bible.ts`: `validateWorldBible(..., worldScale?)` 기본 full; `normalizeWorldSocietyField`로 `society.domains[]` 수용.
- `author.ts`: atlas·QA에 동일 scale 전달.
- 실측 후보: **`g5-modern-comedy-e` / 박은지 (수도반장)**.

### Scene 세계 (성공 run, call 40–45)

| 항목 | 값 |
|---|---|
| 세계명 | 오늘도 3층은 공사 중 |
| factions | 2 (모퉁이동 3층 주민들, 강문식 가족) |
| society | 2 flat keys |
| locations | 3 |
| lorebook | 1 |
| 직업 | 동네 반찬가게 + 야간 온라인 주문 (민원 실무자 아님) |
| 첫 사건 | 공동 수도 역류 → 테이프·물통·임시 세탁 규칙 (예약표/영수증 검토 아님) |

프롬프트 증거: `provider-responses/40-g5-modern-comedy-e-world_bible.prompt.json` (`factions 1~2`, scene power note).

## REMOVED

- 없음 (새 runner·블랙리스트·점수기 없음).

## PRESERVED

- 로판 `compose(undefined)` vs explicit rofan 바이트 동일 (`officialSupply.genreProfile.test.ts`).
- 호출 순서 core → atlas → portfolio → character, JSON 키, Text Lock owner.
- G3/G4/G5 기존 후보 원고·lock 미변경.
- 왕족 밀도·오지은 FREE 피치: **이번 PR에서 수정하지 않음** (RELATED).

## REGRESSION RISKS

- `society.domains[]` 모델 출력 → coercion 없으면 scene QA 실패 (1차 run 37–39에서 발생, `normalizeWorldSocietyField`로 해결).
- scene이라도 `biggestEvent`에 재개발·점검 맥락이 남을 수 있음 (배경 vs 첫 플레이 분리는 GPT 판정).
- `draftQaOk: false` — public/greeting의 `사정은`(RELATED, G5-1D allowlist와 동일 계열) → `sfw_public_text_has_adult_terms`. bible/relation/lorebook QA는 통과.

## PROOF

| 경로 | 내용 |
|---|---|
| `candidates/g5-modern-comedy-e/world-bible.json` | scene 세계 |
| `candidates/g5-modern-comedy-e/brief.json` | 최종 브리프 |
| `candidates/g5-modern-comedy-e/first-manuscript.md` | greeting·public |
| `candidates/g5-modern-comedy-e/system-prompt.txt` | compiled system |
| `candidates/g5-modern-comedy-e/bible.assembled.json` | QA 입력 |
| `provider-responses/40–45-g5-modern-comedy-e-*.json` | 성공 run (6 calls) |
| `provider-responses/37–39-g5-modern-comedy-e-*.json` | 1차 world QA 실패 증거 |
| `validation.json` | `g5-modern-comedy-e` row |
| `cost-usage.json` | `physicalCalls: 45`, cap 46 |

### 비용 (ledger)

- 누적 physical calls: **45 / 46** (36 기존 + 9 이번 작업: world 3+3, character pipeline 3).
- `thisProcessAccounting` (2차 run): billed **$0.005137** (~₩7 @1500).
- `billedCostUsdKnownOnly` cumulative: **$0.044032** (~₩66).
- unknown cost: call 8–9 (historical g5-modern-comedy part1 failures).

## GPT 품질 판정용 (Cursor 점수 없음)

이전 3명 대비 **관찰만** 기록:

1. 첫 사건이 서류·예약표·영수증 **검토만**은 아님 — 역류·테이프·물통 **행동** 중심.
2. 코미디가 **은지의 규칙·바닥 테이프·농담→정리**로 전개.
3. 직업·활동이 **반찬가게/온라인 주문**으로 **다름**.
4. 별명·말투(수도반장, 수도꼭지 비유)가 greeting에 **노출**.
5. `bibleQaOk`·`relationQaOk` true; `draftQaOk` false (adult term scanner, 위 RELATED).

**STOP** — 추가 생성 없음. GPT 재검수 대기.
