# G4 handoff — 실전 자동 생성 증거 (GPT 검수용)

## BEFORE / PROBLEM / AFTER

| | |
| --- | --- |
| **BEFORE** | G2·G3-FIX 병합(`8cc96458`). G3 원고(로언·이든)는 증거 PR #1742에만 전체 raw; main에는 brief+bible 스냅샷만. G4 실전 2종 미생성. |
| **PROBLEM** | 여성향 로판 **신규** 남성 2종을 canonical generator만으로 기획·원고 확보, 관계 계약·Bible/draft QA 통과, GPT 제출용 raw 보존. Composer 창작·운영 등록 금지. |
| **AFTER** | `docs/official-supply/reviews/g4-2026-10-28/`에 **레온(A)·가브리엘(B)** 최초 원고·raw·QA. `generate.ts`는 G3 격리 실행 패턴 재사용. 비공개 증거 repo 미접근 — GitHub PR 경로만. |

## 신규 캐릭터 요약 (브리프·모델 산출, Composer 비창작)

### A — `g4-rofan-a` 레온 (강한 로맨스 긴장형)

- **콘셉트:** 황실 공인 결투 대리인. 도발·능동적 욕망, 결투장에서 유저에게 선택을 강요하는 연하 남성.
- **관계:** `userRelation.type` = **free** (브리프·rpHook 기준, premise QA 통과).
- **원고:** [first-manuscript.md](candidates/g4-rofan-a/first-manuscript.md)
- **보정:** Voice 1회 (`02-voice-repair-1.json`).
- **QA:** bible / draft / relation — OK (`validation.json`).

### B — `g4-rofan-b` 가브리엘 (비밀·관계 역전형, slot14 재기획본)

- **콘셉트:** 황실 왕실 장의관. 죽은 자의 신분으로 산 유저를 둘러싼 기록·의례 역전, 유저 침묵에도 절차를 진행.
- **관계:** `userRelation.type` = **free**.
- **원고:** [first-manuscript.md](candidates/g4-rofan-b/first-manuscript.md)
- **보정:** Voice 1회 (`02-voice-repair-1.json`). 초기 slot14(장례 기록사·가레스 등)는 author gate 실패 — **slot14만 재기획**(`--replan-b-only`) 후 성공.
- **QA:** bible / draft / relation — OK.

## Canonical owner (main `8cc96458`)

- 기획: `generateOfficialPortfolioReplacement` + `evaluateUserRelationPremise` / `gateBriefs`
- 본문: `generateOfficialCharacterBible` → `reviseOfficialCharacterVoice` (≤2/캐릭터)
- QA: `validatePilotBible`, `validatePilotDraftForTextLock`, `evaluateRelationBibleContract`
- 모델: `resolveOfficialAuthorModelId()` → **`gpt-6-luna`** (Cheaper Inference background)

## 비용·토큰 (저장된 provider raw 합산)

| 항목 | 값 |
| --- | --- |
| Physical attempts (saved JSON) | 9 |
| Billed USD (approx) | ~$0.0086 |
| Billed KRW (approx, FX 1353) | ~**12원** |
| Input / output tokens (saved) | 36 499 / 18 528 |

실패 시도(author gate, raw 미저장)는 `/opt/cursor/artifacts/g4-generate*.log` 참고.

## 증거 경로 (제품 repo)

- 실행 스크립트: [generate.ts](generate.ts)
- Raw: `provider-responses/`, `candidates/*/0*.json`
- 조립: `bible.assembled.json`, `draft.compiled.json`, `system-prompt.txt`, `preview-form.json`
- 집계: [cost-usage.json](cost-usage.json), [validation.json](validation.json), [PACKAGE.md](PACKAGE.md)

## 검증 (Cursor)

- `npm run typecheck:app` — pass
- `officialSupply.g3Fix.test.ts` — pass (G3 회귀, 관계·볼프강 후보)

## GPT가 판단할 창작 품질 (점수 없음)

README 10항목 체크리스트 — [README.md](README.md). 특히 A의 결투·욕망 노출, B의 역전·자발적 사건 진행, FREE 계약과 rpHook 일치.

## 등록 BLOCKER

- **GPT 문학 승인 전** G2 관리자 비공개 초안 등록·이미지·공개 **금지** (이번 run 미실행).
- `you8520-sketch/hav-rp-evidence-private` — **미러 불가** (Cloud `gh` repo not found).
