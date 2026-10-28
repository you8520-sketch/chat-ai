# G3 handoff (GPT 검수)

## 정책 준수

- **Composer 원문 창작 없음.** 이름·성격·서사·대사·도입부는 `gpt-6-luna` provider `text` 필드 그대로(`provider-responses/`, `candidates/*/0*.json`).
- **브리프 기획 경로:** `generateOfficialPortfolioReplacement` — pilot `official-supply-pilot-author.ts --step=replace-slots`와 동일 owner. G3는 pilot world 파일을 수정하지 않고 슬롯 11·12만 격리 기획.
- **본문 생성:** `generateOfficialCharacterBible` (Part1→Voice→Bonds) + 필요 시 `reviseOfficialCharacterVoice` (이든 1회).

## BEFORE / PROBLEM / AFTER

| | |
| --- | --- |
| **BEFORE** | main `f55b104b…` pilot 세계(`world-bible.json`) 위 신규 2슬롯 검증 요청. 운영 등록·이미지 없음. |
| **PROBLEM** | HAV 공식 자동 생성기의 실제 산출 품질을 GPT가 원문 기준으로 검수해야 함. |
| **AFTER** | 증거 패키지 `docs/official-supply/reviews/g3-2026-10-28/` — 로언(`g3-rofan-a`), 이든(`g3-rofan-b`). `first-manuscript.md` + raw JSON. |

## 비용·호출 (artifact 집계)

- 약 **8** physical calls, **~$0.008** (~**12 KRW** @1500), 상한 1,000 KRW 이내.
- Voice repair: **이든** 1회 (`02-voice-repair-1.json`). **로언** 0회.

## QA (자동, 수정 없이 기록)

| 후보 | bible QA | draft QA | relation QA |
| --- | --- | --- | --- |
| 로언 | OK | **FAIL** `sfw_public_text_has_adult_terms` | OK |
| 이든 | OK | OK | OK |

로언 draft QA 실패는 GPT/파이프라인 검토용 **관측값**이며, Cursor가 원문을 고치지 않았다.

## GPT가 볼 파일

1. `candidates/g3-rofan-a/first-manuscript.md`, `candidates/g3-rofan-b/first-manuscript.md`
2. `provider-responses/00-portfolio-replacement.json` (브리프 최초 raw)
3. `validation.json`, `cost-usage.json`, `PACKAGE.md`
