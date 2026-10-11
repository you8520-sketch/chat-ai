# E3-3 search bar placeholder evidence

Isolated local production builds (isolated SQLite data dir), Chromium via playwright-core.
BEFORE = `origin/main` @ `60034387d9788472ff1ec971ccec3b761a1c3fb5`; AFTER = branch `cursor/search-placeholder-78cc` @ `c427a18e0a4b9c6db8a7d783797f7336ea176e4d`.
Viewports: `m360` 360x800, `m390` 390x844, `pc1440` 1440x900.

- `1-default` full viewport, `1b-default-bar` search bar crop (default state)
- `2a-typed-bar` `#아포칼립스` typed, `2b-typed-result` after Enter
- `3-long-bar` 56-char input (maxLength 40)
- `4-cleared-bar` after clearing
- `5-keyboard-focus-bar` focus reached by Tab
- `*-metrics.json` placeholder width vs input inner width, URL/results per scene
