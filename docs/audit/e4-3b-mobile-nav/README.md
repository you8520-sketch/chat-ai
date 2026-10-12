# E4-3B mobile navigation and fixed UI — evidence

Isolated fixture only (`scripts/e43b-seed.ts`): 8 public official test characters, 1 adult test character,
3 test users (normal, admin filter ON, admin filter OFF) plus a guest, 1 test chat room, 1 test TRPG campaign.
No production data or real conversation text.

- `images/` BEFORE / candidate A / candidate B comparisons (mobile composites, PC single frames, timelines)
- `data/probe-*.json|log` full matrix: 9 widths x 4 user states x 9 pages (guest skips auth-only pages)
- `data/fixed-*.json|log` fixed-UI behaviour checks (save bar, simulated keyboard, safe-area, Tab order, cinematic marker, rooms)
- `data/build-tail-*.log`, `data/tests-targeted-*.log`
- `scripts/` harness used to produce all of the above
