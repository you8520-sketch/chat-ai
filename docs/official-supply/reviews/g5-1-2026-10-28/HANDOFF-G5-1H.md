# G5-1H — 성인어 검사 안전 회귀 복구 · G5-1 제출 정리

**Prior HEAD:** `1428f0c3` · **G5-1G change reverted:** `사정을|를` on `ORDINARY_SAJEONG_EOJEOL`

## BEFORE / PROBLEM

G5-1G allowed eojeols `사정을`/`사정를` unconditionally. Same spelling covers ordinary “circumstances” and sexual ejaculation; particle-only allowlist weakens shared adult blocking.

## AFTER

- `characterAdultText.ts`: restored G5-1D/G5-1F allowlist (no `을|를`). `사정`, `사정을`, `사정했다`, split evasions still block; `사정은`/`사정도`/… still allow.
- **박은지** stored `draft.compiled.json`, manuscripts, raw, text lock **unchanged**.
- `validation.json`: `g5-modern-comedy-e` **`draftQaOk: false`** again with `draftQaReevalNote` preserving G5-1G `1428f0c` brief true record.

Candidate draft QA failure ≠ generic engine failure; approved copy may use existing selective Voice repair later.

## REMOVED

- G5-1G `을|를` ordinary-사정 allowlist.

## PRESERVED

- G5-1F scene `worldScale`, G5-1G rofan worldCore SHA256 parity (`73919ae9…`).
- G3/G4/G5 evidence files, provider ledger (45/46), no new API calls.
- RELATED: royal density, 오지은 FREE — untouched.

## REGRESSION RISKS

- 박은지 remains `draftQaOk: false` until manuscript or voice repair changes public text (by design).

## PROOF

- `characterAdultText.g2.test.ts`: blocks `사정을`; g5-modern-comedy-e blob flags `사정`; `사정은` clean.
- `officialSupply.genreProfile.test.ts` + `worldScale.test.ts`: unchanged pass.
- `npm run lint`

**STOP** — Ready-for-review evidence pack for GPT; no merge/deploy/G5-2.
