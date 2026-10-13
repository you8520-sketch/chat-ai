# E4-3F creator editor — evidence

Evidence only. No application code lives on this branch.

| Item | SHA |
| --- | --- |
| BEFORE (base of both candidates) | `d981d1c0a3aa1e2f8b4264df9b3dba847d6aeb8e` |
| Candidate A (earlier head of `cursor/creator-editor-e4-3f-78cc`, not selected) | `ac243b0c9276ca2c22281aa573a8ffb1e25ed92a` |
| Candidate B selected, previous PR head (`cursor/creator-editor-e4-3f-cand-b-78cc`) | `d2262e17f27cc1be2d022ad55b37e432c0644ae2` |
| Final PR head `cursor/creator-editor-e4-3f-78cc` (B + completion-copy fix) | `708ed27ad2b758eff4573b567ca1351383e704f3` |

## Layout

- `compare/` BEFORE | A | B side-by-side composites (`NN-name.webp`), plus time-ordered scenes (`40-42`) and the B-only desktop guide rail (`50-*`).
- `raw/before|a|b/` one webp (q93) per captured state, `data.json` (measured metrics per state), `capture.log`.
- `scripts/e43f-*` capture harness (seed, lib, capture, rail, compose).
- `logs/` production build logs and validation output (`git diff --check`, `lint`, `typecheck:app`, related tests).

## How it was captured

Three isolated production builds of the same data set (separate `NEXT_DIST_DIR`, shared throw-away `DATA_DIR`, no provider keys) served on three ports; Chromium via `playwright-core`. `POST/PUT/PATCH /api/characters` are stubbed so nothing is persisted and no provider is called (`providerPostsTotal 0`). Drafts are injected into `localStorage` using the editor's real draft key. The soft keyboard is **emulated** by shrinking the viewport to 508px and setting the `data-keyboard-open` attribute the app already reads.

States: widths 360 / 390 / 576 / 640 / 768 / 1024 / 1440 (overflow, clipped control, bar overlap and tap-target metrics in `data.json -> matrix`); new/empty, new/valid, exactly 12,000 saves (1 request), 12,001 rejected (0 requests); missing required; long input; image none / 1 / many / representative change; widget basic / direct; draft save and restore; edit with images, without images, long text, minor and other-user fixtures; keyboard open (textarea and short field); tab switching.

## Measured (from `data.json`)

- No horizontal overflow and no clipped control at any of the 7 widths in BEFORE, A, B.
- Controls under the tap-target threshold at 390: BEFORE 1, A 0, B 0.
- 12,001 rejection: A and B move focus to the AI meter (`ai_total`) and show one inline message plus the bar message; BEFORE only shows the bar message and focus stays on the button.
- Page height, 390 valid 12,000 input: BEFORE 6285, A 6920, B 6385 (A is taller: larger inputs, labels, meter).
- Desktop guide rail (B, `rail-*` in `raw/b`): sticky, ends above the save bar at 1024x800, 1280x720, 1440x900 once scrolled; the card preview is reached by scrolling inside the rail at 900px height.

## Not verified / limits

- Real iOS Safari and Android Chrome were not run. The keyboard scenes are viewport emulation only.
- Unauthorized `?edit=` ids render a blank editor on main as well (pre-existing, not changed here).
- `officialCharacterAdmin.1367.test.ts` has 3 failing tests that fail identically on BEFORE `d981d1c0` (Lucian in-place sync); unrelated to this change.
- The 12,000-limit tests pass on A and B; the old 10,000 limit is not present anywhere.
- Cursor does not score A against B.

## Final correction (E4-3F final fix)

- Completion copy changed to "필수 항목은 모두 입력했어요. 저장 전 분량과 다른 조건도 확인해 주세요." (`RequirementSummary`). Required list and progress unchanged; no savability calculation added.
- `raw/b/` and `compare/` were regenerated from the final build (`708ed27a`). `raw/before`, `raw/a` are unchanged from the first capture; A therefore still shows the old copy.
- `compare/12-over-12000-390.webp` previously showed three 404 pages (the stubbed save redirected to a non-existent page). It is replaced by the state just before saving 12,000 characters (`raw/limit-*`). `compare/12b-limit-12001-before-save-390.webp` is the 12,001 state. `13-over-12001-rejected-390.webp` is unchanged in intent.
- `raw/limit-*/limit-data.json`: with all required items filled, 12,000 -> 1 save request, 12,001 -> 0 save requests and the 12,000-char error; B copy never says it can be saved (`claimsSavable: false`), old A copy does (`true`).
- B design unchanged: matrix and tab/bar metrics identical to the first B capture except 640px valid-12,000 page height +20px (the new sentence wraps one extra line).
- `logs/lucian-baseline-*.log`: the 3 `officialCharacterAdmin.1367` Lucian failures are identical on `d981d1c0` and current main.
