# E3-4 home section numbering evidence

Isolated local production builds (isolated SQLite data dir), Chromium via playwright-core.
BEFORE = `origin/main` @ `d75518cc3e24f44e84151a32eb0c718ec48e7dfc`; AFTER = branch `cursor/home-section-numbering-78cc` @ `6f3bd68546d2144448545d74932341f258350cca`.
Full-page screenshots at `m390` (390x844), `m360` (360x800), `pc1440` (1440x900).

Cases (`{BEFORE,AFTER}-<case>-<viewport>.png` / `.json`):
- `A-all`: recommended + contest + new (contest picks seeded)
- `B-no-contest`: recommended + new (no contest picks)
- `C-contest-new-only`: signed-in viewer who already engaged every character (recommended excludes engaged ids) + contest + new
- `D-new-only`: same viewer, no contest picks
- `F-empty`: no characters
- recommended-only is not reachable from data (new shares the same pool and is larger); covered by the unit test.
