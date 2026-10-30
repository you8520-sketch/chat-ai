# G5-1G — 로판 parity 복구 + 박은지 draft QA 재평가

**HEAD:** (this commit) · **prior:** `50aceff5` · **G5-1D baseline:** `2ae39783`

## BEFORE / PROBLEM

1. **MUST FIX 1:** G5-1F full-scale `society` bullet gained `. 키=영역명·값=설명 문자열`, breaking byte parity with G5-1D `authorPrompts.ts` for rofan/absent plan and other full genres.
2. **MUST FIX 2:** `g5-modern-comedy-e` (박은지) `draftQaOk: false` — `findAdultTermsInText` hit **`사정을`** eojeol in unchanged `draft.compiled.json` (ordinary circumstance object particle, not sexual ejaculation in context).

## AFTER

1. Full path restores **literal** G5-1D lines: `factions 3~6`, `society … 중)`, `culture 3~6`. Scene path unchanged.
2. `ORDINARY_SAJEONG_EOJEOL` adds **`을|를`**. Bare `사정`, `사정했다`, `가족 사정` (second eojeol `사정`) still block.

## REMOVED

- Full-scale society suffix `. 키=영역명·값=설명 문자열` (scene-only hint remains on scene path).

## PRESERVED

- Scene `worldScale` for `현대/일상`; stored 박은지 bible/raw/text lock/files **not rewritten**.
- Provider call ledger (45/46); no new paid calls.
- RELATED: royal density, 오지은 FREE — untouched.

## REGRESSION RISKS

- Allowing `사정을`/`사정를` eojeols follows the same particle allowlist model as `사정은`/`사정도`; sexual disambiguation remains eojeol-bound (not semantic NL).

## PROOF

| Check | Evidence |
|---|---|
| Pre-fix failure | `50aceff5` full society line included `키=영역명`; `scripts/tmp-g5-1g-repro` (local) showed `hits ['사정']` from `사정을` |
| Post-fix rofan bytes | `officialSupply.genreProfile.test.ts` — SHA256 `73919ae9…` matches `git show 2ae39783` authorPrompts+genreProfile with same market as `compose(undefined)` (`scripts/compare-rofan-baseline.mts`) |
| Scene kept | `officialSupply.worldScale.test.ts` — `현대/일상` still `factions 1~2` |
| 박은지 re-eval | `characterAdultText.g2.test.ts` — saved draft blob `[]`; `validation.json` `draftQaOk: true` with `draftQaReevalNote` (manuscript unchanged) |
| Tests | `npm run lint`, genreProfile + worldScale + characterAdultText.g2 |

**STOP** — GPT 재검수.
