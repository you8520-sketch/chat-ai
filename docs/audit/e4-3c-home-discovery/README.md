# E4-3C home discovery and responsive layout — evidence

Isolated fixture only (`scripts/e43c-seed.ts`): 20 public official test characters (1 adult), 6 contest picks,
test users (normal, admin filter ON, admin filter OFF) plus a guest. No production data.
Each variant is a production build (`next build`) served from its own dist dir against the same SQLite fixture.

- `images/*-before-A-B.webp` composites, always left to right BEFORE / A / B (PC first-screen composite is stacked top to bottom)
- `images/640-bug-zoom-before-after.webp` the 640px defect, enlarged
- `images/raw/{before,A,B}-*.webp` single frames (m390 = 390px mobile, pc1440, w576/w640/w768/w1024)
- `data/e43c-probe-*.json` 9 widths x 4 user states: glyph-wrapping, horizontal overflow, CTA clipping, first-screen metrics, row peek
- `data/e43c-probe-sweep-*.json` extra widths 600..1280 (the defect is not only at 640)
- `data/e43c-flow-*.json` behaviour: links, drag/touch scroll, keyboard, D-1 reveal, adult visibility, reduced-motion, Tab order
- `data/e43c-tests-*.log` lint, typecheck:app, targeted node tests per variant; `data/regression-test-on-main-before.log` the new contract against current main
- `data/build-tail-*.log` build exit codes
- `scripts/` harness
