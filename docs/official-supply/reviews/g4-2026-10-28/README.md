# G4 — HAV 공식 자동 생성기 실전 제작 (GPT 검수용)

Composer는 캐릭터 **원문을 작성·수정하지 않는다**. 이 폴더는 canonical owner 호출 결과와 provider raw JSON만 담는다.

## Canonical owner (main `8cc96458…`)

| 단계 | Owner | G4 사용 |
| --- | --- | --- |
| Market-fit 브리프 | `generateOfficialPortfolioReplacement` | 최대 2회(1회 재기획), `evaluateUserRelationPremise` 게이트 |
| Part1 → Voice → Bonds | `generateOfficialCharacterBible` | 캐릭터당 3 physical call |
| Voice 보정 | `reviseOfficialCharacterVoice` | QA 실패 시 최대 2회/캐릭터 |
| 컴파일·QA | `compileOfficialDraftFromBible`, `validatePilotBible`, `evaluateRelationBibleContract` | 오프라인 |

슬롯 **direction**은 기획 입력이며 완성 원고가 아니다. G3 로언·이든과 직업·트로프·도입 축 중복 금지.

## 실행

```bash
node --conditions=react-server --import tsx docs/official-supply/reviews/g4-2026-10-28/generate.ts --estimate
OFFICIAL_PILOT_LIVE=1 node --conditions=react-server --import tsx docs/official-supply/reviews/g4-2026-10-28/generate.ts --run --max-usd=0.67
```

`00-portfolio-replacement.json`이 있고 게이트를 통과한 brief가 있으면 브리프 재호출 없이 character 단계만 재개한다.

## GPT 창작 품질 체크리스트 (Cursor는 점수 없음)

1. 첫 장면부터 드러나는 고유 매력  
2. 행동·대사로 드러나는 성격  
3. 행정 절차를 넘는 감정적 긴장  
4. 유저에게 말을 걸 이유가 있는 관계 갈등  
5. 스스로 사건을 움직이는 목표·행동  
6. 고유 말투·호칭·유머·침묵·감정 반응  
7. 변화 가능한 관계·사건  
8. 세계관·능력·과거·현재 일관성  
9. 로맨스 매력과 발전 여지  
10. 유저 행동·감정·결말을 임의 확정하지 않는 도입  

운영 DB 등록·공개·이미지 생성 없음 (GPT 승인 후 별도).
