# E4-3F creator editor — evidence

Evidence only. No application code lives on this branch.

| Item | SHA |
| --- | --- |
| BEFORE (base of both candidates) | `d981d1c0a3aa1e2f8b4264df9b3dba847d6aeb8e` |
| Candidate A `cursor/creator-editor-e4-3f-78cc` (PR head) | `ac243b0c9276ca2c22281aa573a8ffb1e25ed92a` |
| Candidate B `cursor/creator-editor-e4-3f-cand-b-78cc` (A + guidance) | `d2262e17f27cc1be2d022ad55b37e432c0644ae2` |

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
