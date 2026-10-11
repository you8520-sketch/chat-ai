# E3-5 home / new tab exposure parity evidence

Isolated local production builds (isolated SQLite data dir), Chromium via playwright-core, signed-in non-adult viewer (female preference).
BEFORE = `origin/main` @ `29752ed83d16d4907d5969dea8ab4e6899a517d0`; AFTER = branch `cursor/new-tab-official-parity-78cc` @ `0d6251b26adb667501b5c58568bb08afbfacddb5`.
Viewports: `m390` 390x844, `m360` 360x800, `pc1440` 1440x900 (full-page screenshots).

Cases: `mixed` (3 official, 3 ordinary public, 1 private, 1 pending, 1 adult ordinary; BEFORE/AFTER home shows the same 6), `one` (single official), `zero` (no characters).
Files: `{BEFORE,AFTER}-<case>-<viewport>-1-home.png` (home), `...-2-tab-new.png` (after clicking home "더보기"), `{BEFORE,AFTER}-<case>.json` (names, official badge counts, card markers, profile landing for each viewport).
Note: the bottom tab bar visible mid-page in mobile full-page captures is the fixed mobile nav.
