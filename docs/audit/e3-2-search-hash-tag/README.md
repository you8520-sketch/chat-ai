# E3-2 search `#tag` input evidence

Isolated local production builds (isolated SQLite data dir), Chromium via playwright-core.
BEFORE = `origin/main` search code (06bc210), AFTER = branch `cursor/search-hash-tag-78cc`.

Scenes (per viewport `m390` = 390x844, `m360` = 360x800, `pc1440` = 1440x900):

- `1-chip`: popular-tag chip `#아포칼립스` clicked (the BEFORE `1-chip` image also shows the result card).
- `2-typed-hash`: typed `#아포칼립스` + Enter.
- `3-normal-name`: typed `강이현` + Enter.
- `4-result-card`: AFTER only, signed-in viewer, typed `#아포칼립스` result card (BEFORE typed result is 0 cards).

`BEFORE-matrix.json` / `AFTER-matrix.json` hold the input matrix; `AFTER-card.json` holds the card/click-through check.
