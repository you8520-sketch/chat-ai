# G3 — HAV 공식 자동 생성기 실제 품질 검증 (GPT 검수용)

Composer는 캐릭터 **원문을 작성·수정하지 않는다**. 이 폴더는 canonical owner 호출 결과와 provider raw JSON만 담는다.

## 자동 기획·생성 owner (main `f55b104b…`)

| 단계 | Canonical owner | G3에서의 사용 |
| --- | --- | --- |
| Market-fit 브리프 (슬롯 교체) | `generateOfficialPortfolioReplacement` — `scripts/official-supply-pilot-author.ts --step=replace-slots`와 동일 API | `generate.ts`가 격리 출력만; pilot `world-bible.json` **미수정** |
| Part1 → Voice → Bonds | `generateOfficialCharacterBible` — pilot `--step=character`와 동일 | 캐릭터당 3 physical call |
| 선택 Voice 보정 | `reviseOfficialCharacterVoice` — pilot `voice-fix`와 동일 | QA 실패 시 최대 2회/캐릭터 |
| 컴파일·QA | `compileOfficialDraftFromBible`, `validatePilotBible`, `evaluateRelationBibleContract` | 오프라인 |

G3 슬롯 **direction** 문자열은 manifest `replacement.slots[].direction`과 같은 **기획 입력**이며, 완성 브리프·원고가 아니다.

## 실행

```bash
node --conditions=react-server --import tsx docs/official-supply/reviews/g3-2026-10-28/generate.ts --estimate
OFFICIAL_PILOT_LIVE=1 node --conditions=react-server --import tsx docs/official-supply/reviews/g3-2026-10-28/generate.ts --run --max-usd=0.67
```

`00-portfolio-replacement.json`이 있으면 브리프 재호출 없이 character 단계만 재개한다(최초 브리프 raw 보존).

## 증거 레이아웃

- `provider-responses/` — 모델 raw text (수정 없음)
- `candidates/<key>/brief.json` — 브리프 스냅샷
- `candidates/<key>/01-part1.json`, `02-voice.json`, `03-bonds.json`, `02-voice-repair-*.json`
- `bible.assembled.json`, `draft.compiled.json`, `first-manuscript.md`, `system-prompt.txt`
- `cost-usage.json`, `validation.json`, `PACKAGE.md`

운영 DB 등록·공개·이미지 생성 없음.
