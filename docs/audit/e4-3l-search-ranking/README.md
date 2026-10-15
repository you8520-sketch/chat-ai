# E4-3L search / ranking design evidence

- main: `3751b08f364e9e414d9917cedf8c47c663588d00`
- L1 (Quiet Discovery): `697ce12286f6498725924f26faad8e30b6e402ec`
- L2 (Refined Discovery, stacked on L1): `c6e26ac7c467964207c5fe5515d6cbeed5c1453e`

BEFORE, L1 and L2 were each built with `next build` (production) from a separate worktree and served against the
same isolated fixture DB (`scripts/e43l-seed.ts`, all names fictional, real seed portraits). The DB is reseeded between
sweeps. Viewports: 360 / 390 / 768 / 1440 (mobile = touch + 2x DPR). Reduced motion is on for every capture.

Some scenes mutate the fixture (empty / one / three ranking rows); `scripts/e43l-shots.mjs` runs them last.
Ranking rank 1 in the weekly/monthly scenes intentionally has no image (empty-image layout case); every other
boundary scene uses real images.

## Required images (path under each of `BEFORE/`, `L1/`, `L2/`)

| # | Subject | File |
|---|---------|------|
| 1 | 390 search initial | `390/s01-search-initial.png` |
| 2 | 390 search results | `390/s02-search-results-first.png`, `390/s02-search-results-full.png` |
| 3 | genre / tag selected | `390/s03-search-genre-last-selected.png`, `390/s03-search-tag-selected.png`, `390/s03-search-q-genre-full.png`, `390/s03-search-genre-full.png` |
| 4 | empty search | `390/s04-search-empty-query.png`, `390/s04-search-empty-genre.png`, `390/s04-search-empty-combo.png` |
| 5 | long query / long name | `390/s05-search-long-query.png`, `360/s05-search-long-name-creator.png` |
| 6 | official + adult badges | `390/s07-search-badges-admin-full.png` |
| 7 | mobile all-time ranking | `390/r01-ranking-all-full.png` |
| 8 | mobile realtime / weekly ranking | `390/r02-ranking-realtime-full.png`, `390/r02-ranking-weekly-full.png` |
| 9 | top-3 vs regular-list boundary | `390/r03-ranking-top3-boundary.png` |
| 10 | ranking empty | `390/r05-ranking-empty-realtime.png`, `390/r05-ranking-empty-all.png` |
| 11 | 768 | `768/*` |
| 12 | 1440 | `1440/*` |
| 13 | 360 | `360/*` |

Extra: `390/s06-search-cap-top.png` (60 result notice), `390/s06-search-one-result.png`, `390/r04-ranking-admin-adult-full.png`,
`390/r06-ranking-one-item.png`, `390/r06-ranking-three-items.png`, `390/s08-*` / `390/r07-*` (keyboard focus, typing + clear).
Very tall full-page captures of the 60-result page and two near-duplicate ranking variants were dropped to keep the branch small;
their measurements remain in `*/results.json`.

## Measurements

- `BEFORE|L1|L2/results.json`: per scene horizontal overflow, small touch targets / tiny text split into page-owned vs shared `CharacterCard`, out-of-viewport items, rendered ids.
- `probes/probe-*.json`: URL/input sync across history, 40 char / Hangul / special-character input, clear button geometry, permission matrix (guest, SFW user, male-pref viewer, admin, admin with filter on) for search and ranking against an independent SQL (ids, order, numbers, 60 / 50 caps, hidden leak), period switch, detail round trip, keyboard focus walk (no focus covered by fixed UI), reduced motion.
- `logs/playwright-spec-*.log`: `tests/ui/search-ranking.spec.ts` against BEFORE (6 of 7 fail) and L1 / L2 (7 of 7 pass).
- `scripts/`: the harness (`e43l-*`).
