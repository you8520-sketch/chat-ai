# Phase E-2 post-deploy audit — AUDIT ONLY captures

Every image here is labelled **AUDIT ONLY**: there is no fix, so there is no BEFORE/AFTER.
All captures were taken on 2026-10-11 (UTC) with headless Chromium (playwright-core), no video.

- Verified deployed SHA: `f338ac6` on `https://hav.chat` (`/api/health` -> `gitCommit":"f338ac6"`, `gitBranch":"main"`). It contains merge commit `58bfdb5a` of PR #1529.
- `prod-*` images: the real deployment `https://hav.chat`, logged out (no permitted test credentials were available, so no login or bypass was attempted).
- `iso-*` images: an isolated local production build (`next build`, `NODE_ENV=production`) of the same SHA `f338ac6` with a throw-away local DB and a seeded test user. These are the only way to show authenticated D-2 / D-3 screens without touching production data.
- Capture timing is a target. Headless screenshot latency drifts by tens of ms, so frames are sampled "about" at the stated time. Where timing mattered, the delay was stabilised with an injected route delay.

## Production (`https://hav.chat`, SHA f338ac6, logged out)

| File | Viewport | Timing | What it shows |
| --- | --- | --- | --- |
| `prod-m390-chats-logged-out.png` | 390x844 | after redirect settled | `/chats` without a session lands on the login page (`/login?redirect=/chats`), no veil |
| `prod-pc1440-chats-logged-out.png` | 1440x900 | after redirect settled | same at desktop |
| `prod-pc1440-menu-0-home-before.png` | 1440x900 | before click | home before the menu move (+500 ms RSC delay injected on `/tab/ranking`) |
| `prod-pc1440-menu-1-click.png` | 1440x900 | about click+60 ms | right after click: veil covers the old home from below |
| `prod-pc1440-menu-2-title-split.png` | 1440x900 | about click+240 ms | destination title "RANKING" assembled, screen split starting |
| `prod-pc1440-menu-3-reveal.png` | 1440x900 | reveal start+80 ms | split opening, real ranking page behind it |
| `prod-pc1440-menu-4-settled.png` | 1440x900 | arrived and settled | final `/tab/ranking`, veil gone |

`prod-audit-results.json`: 20/20 checks passed (deployed SHA, bundle carries D-2/D-3 markers, `/chats` login redirect at 390/360/1440, logged-out card has no veil, repeated menu moves, rapid clicks without veil gap, back/forward/re-entry, keyboard Enter and Tab, reduced-motion, nothing covers the viewport after the transition).

## Isolated build of f338ac6 (authenticated flows)

390x844 unless noted. D-2 = chat resume, D-3 = TRPG entry.

| File | Timing | What it shows |
| --- | --- | --- |
| `iso-m390-01-list.png` | load | `/chats` list: character cards + TRPG cards |
| `iso-m390-02-picker-multi.png` | picker open | multi-room picker, rename/delete buttons visible |
| `iso-m390-single-02-picker-single.png` | picker open | single-room picker with the "이어서 대화" link and image circle |
| `iso-m390-multi-03-click.png` | click+40 ms | D-2 right after click: ink opens from the image circle |
| `iso-m390-multi-04-name-forming.png` | click+240 ms | D-2 crest/portrait frame opening |
| `iso-m390-multi-05-name.png` | reveal+60 ms | D-2 portrait + name (RESUME) |
| `iso-m390-multi-06-split.png` | click+500 ms | D-2 split opening over the real room |
| `iso-m390-multi-07-room.png` | settled | exact room (`chat=871370`) |
| `iso-m390-01-trpg-list.png` | load | TRPG card in the list |
| `iso-m390-trpg-03-click.png` | click+40 ms | D-3 right after click: ink from the D20 crest |
| `iso-m390-trpg-04-crest.png` | click+240 ms | D-3 crest expanding |
| `iso-m390-trpg-05-title.png` | reveal+20 ms | D-3 crest + campaign title |
| `iso-m390-trpg-06-split.png` | reveal+130 ms | D-3 split opening over the real campaign |
| `iso-m390-trpg-07-room.png` | settled | exact campaign (`/trpg/98`) |
| `iso-m390-back-to-list.png` | after browser Back | back from a room returns to the list, picker closed, no veil |
| `iso-m390-imgfail404-picker.png` | picker open | thumbnail image forced to 404: the circle renders the emoji fallback |
| `iso-m390-imgfail404-d2-click.png` | click+220 ms | same failure: D-2 uses the colour+glyph scene, no broken image |
| `iso-m390-imgfail404-single-d2-click.png` | click+220 ms | single-room variant of the same |
| `iso-pc1440-01-list.png` (1440x900) | load | desktop list |
| `iso-pc1440-02-picker.png` (1440x900) | picker open | desktop picker |
| `iso-pc1440-05-name.png` (1440x900) | reveal | desktop D-2 name |
| `iso-pc1440-07-room.png` (1440x900) | settled | desktop room |

Result files: `isolated-audit-extra-results.json` (25/25 passed), `isolated-imgfail-404.json`, `isolated-db-counts.txt` (chat/message/TRPG table counts identical before and after the audit run).
