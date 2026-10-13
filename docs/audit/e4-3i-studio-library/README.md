# E4-3I studio library evidence

Images were captured with Playwright (Chromium) on production builds served against an isolated SQLite DATA_DIR with fictional users, works, worlds and lorebooks only. Non-GET `/api/**` requests were stubbed in the browser (DELETE / share POST); 0 paid-provider requests were made.

- `before/` — base main `f641c1296642a82db63b57a29592ddedf7078ebb`
- `a/` — Candidate A `89da785917f60fa63923fd1a2009fea3bc86ce64`
- `b/` — Candidate B (PR HEAD) `959e04e139c83f9fb39ead5943947bb6bba7a0d6` (`b01`–`b13` are B-only scenes)
- `proof/` — measurement logs and scene logs (fixtures/session tokens are not included)
