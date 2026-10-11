# Local WSL development

Canonical owners stay where they already live. This page only records the
Windows + WSL machine path that reuses them.

| Responsibility | Owner |
|---|---|
| Local startup | `npm run dev` → `scripts/dev-server.ts` → `server.js` |
| Env load | `server.js` calls Next `loadEnvConfig(process.cwd(), process.env.NODE_ENV !== "production")` before `require("next")` |
| DB path | `src/lib/dataDir.ts` (`DATA_DIR` or `./data`) |
| DB init / migrate / seed | `src/lib/db.ts` |
| Local UI fixtures | `src/lib/localDevFixtures.ts` — only when `HAV_LOCAL_UI_FIXTURES=1` |
| Regular tests | `npm run test:regular` + `src/lib/test/regularTestEgressPolicy.ts` |
| Evidence handoff | `.cursor/rules/engineering-workflow.mdc` (`gh` Draft PR / comment) |
| Cloud gotchas | `AGENTS.md` |

## Reuse, do not reinstall

- Work from an isolated git worktree of current `origin/main`. Do not reuse the
  Luna experiment tree or `/opt/cursor/artifacts/luna-summary-journal-v1`.
- Node 22.12+ already on this machine (`nvm`). Install with `npm ci`.
- Copy `.env.example` to gitignored `.env.local`. Keep
  `PORTONE_CHARGE_ENABLED=0` and `NEXT_PUBLIC_PAYMENTS_ENABLED=0`. Do not copy
  Railway production variables or inference keys.
- `scripts/dev-server.ts` pins `DATA_DIR` to the worktree `data/` unless the
  parent shell already set a non-`tmp-*` `DATA_DIR`. `.env.local` `DATA_DIR`
  does not win after that pin. For a clean isolated tree on this machine use
  `DATA_DIR=/home/you7410/hav-local-dev-data npm run dev`. That directory is
  not Railway `/data` and must stay out of the Luna journal tree.
- Windows `npm.cmd` / `dev-server.mdc` port-kill is Windows-only. On WSL use
  `npm run dev` and stop the existing process before a second bind on 3000.
- For homepage / ranking / official-card UI parity, set gitignored
  `HAV_LOCAL_UI_FIXTURES=1` in development only. `src/lib/db.ts` then reuses
  `seed()` and installs official public presentation rows plus synthetic local
  accounts once (`app_meta.local_ui_parity_fixtures_v1`). Later boots reuse that
  marker and do not overwrite local edits. A failed opted-in install aborts
  startup. Do not copy Railway `/data`.
- Local login accounts (`.invalid` only, not production credentials):
  - `local-user@hav.invalid` / `hav-local-dev`
  - `local-admin@hav.invalid` / `hav-local-dev`
  - `local-creator@hav.invalid` / `hav-local-dev`
- Official public SFW images are materialized under `DATA_DIR/uploads` when
  reachable, otherwise the existing `https://hav.chat/uploads/...` stored-asset
  URL is kept. `media/private` originals are never copied.

## Out of scope here

Paid provider POST, production DB copy, Railway env changes, PRECALL reseal,
and Main RP 12-call live runs stay on their existing approval gates.
