# E4-3H creator dashboard evidence

Same isolated fixture for all three builds (`scripts/e43h-seed.ts`, fictional users/characters/accounts, isolated SQLite, exchange/withdraw/notice/profile writes stubbed in the browser).

- BEFORE: main `56c9085ee585c75c367d3821c1de701a9384830e` (port 3801)
- Candidate A "Quiet Creator Dashboard": `6ef84221fa5bb417dc975d2bbfe91d44df683411` (`cursor/creator-dashboard-e4-3h-a-78cc`, port 3802)
- Candidate B "Creator Command Center" = PR HEAD: `bd6f9029b8b0c92efb2ee82a2672ffcc31d4a1b1` (`cursor/creator-dashboard-e4-3h-78cc`, port 3803)

`compare/NN-*.webp` is BEFORE | A | B left to right. `raw/{before,a,b}/*.webp` are the individual captures. `data/` holds measurements (`metrics-*`, `direct-*`), the BEFORE/AFTER source-contract proof and the related test logs.

Capture notes:
- Mobile pages are captured with a mobile viewport. BEFORE `pro` pages at 390 render in a ~711px layout viewport because of horizontal overflow (see `data/metrics-before-*`), so those images look zoomed out.
- Full-page captures set the sticky save/action bars to `position: static` so a stitched screenshot does not float them mid-page. Viewport captures keep them sticky.
- "Keyboard" captures shrink the viewport to 390x400 and scroll the focused field into view (no real IME).
- Provider POSTs: 0 in every run. Exchange/withdraw/notice/profile requests were fulfilled by a Playwright route stub; 0 real requests reached the server.
