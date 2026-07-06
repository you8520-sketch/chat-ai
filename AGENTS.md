# AGENTS.md

## Cursor Cloud specific instructions

Single Next.js 15 (App Router) app — an AI character chat platform (Korean UI, "하비 AI"). React 19 + TypeScript + Tailwind v4, SQLite via `better-sqlite3`. There is only one service. Standard commands live in `README.md` and `package.json` `scripts`; the notes below are only the non-obvious gotchas.

### Runtime / env
- Requires Node 22.12+ (`.node-version` = 22.12.0; the VM has 22.x). `better-sqlite3` compiles natively (Python3 + gcc/make are present).
- Local config lives in `.env.local` (gitignored, not committed). The update script creates it from `.env.example` if missing. It sets `PORTONE_CHARGE_ENABLED=0` / `NEXT_PUBLIC_PAYMENTS_ENABLED=0`, which disables payments and auto-skips adult verification for dev. Without `.env.local` those defaults are unset and some flows behave differently.
- `data/app.db` is auto-created, migrated, and seeded on first boot (gitignored; persists in the VM snapshot).

### Run (dev)
- `npm run dev` starts a custom server (`server.js` via `tsx`, wrapped by `scripts/dev-server.ts`) on port 3000. Dev uses the `.next-dev` build dir; production `next build` uses `.next` (kept separate so build and dev don't clash).
- The port-3000 auto-kill in `scripts/dev-server.ts` is Windows-only. On this Linux VM it does NOT free the port, so to restart you must first stop the running dev process (Ctrl-C in its terminal); otherwise the new one fails to bind. The workspace "dev-server" rule mentioning `npm.cmd`/PowerShell is Windows-specific and does not apply here.
- Payout/training schedulers are disabled by default in dev (see `server.js`).

### LLM key (chat replies need it)
- The interactive chat (`POST /api/chat`) calls OpenRouter directly and requires a non-empty `OPENROUTER_API_KEY`; without it the chat streams a graceful error `401 ... OPENROUTER_API_KEY is not configured`. The README's "works with demo responses without a key" only covers background summarize/memory tasks, NOT the user-facing chat reply.
- `MOCK_MODE=1` (plus any non-empty dummy `OPENROUTER_API_KEY`) short-circuits the network with a canned reply, but that canned text is short and gets rejected by the response-length guard — so `MOCK_MODE` alone is NOT enough to produce a saved chat turn. Use a real `OPENROUTER_API_KEY` to demo an actual AI reply. Everything else (signup → 2,000P, opening a character, starting a chat, the character greeting, sending a message) works with no key.

### Home/listing shows no characters (expected on fresh seed)
- Seeded characters have `official=0` and `creator_id NULL`, but `listableWhere()` (`src/lib/characterVisibility.ts`) only lists `official=1` or characters with a real creator — so Home/신작/랭킹 render empty and `/tab/ranking` throws a JSON error. This is pre-existing app behavior, not a broken environment. You can still open any public+approved character directly at `/character/<id>` (e.g. `/character/2`) — `canAccessCharacter()` allows it — and chat normally.

### Validation
- Standard checks for code changes are:
  1. `git diff --check`
  2. `npm run lint`
  3. `npm run typecheck:app`
- `npm run lint` currently runs the app-only TypeScript validation because this repo has no ESLint configuration or ESLint dependency installed. If a real ESLint setup is added later, prefer `"lint": "eslint ."` (or `next lint` only for a Next.js version/config that still supports it).
- `npm run typecheck:app` uses `tsconfig.app.json` to validate application/runtime source while excluding tests/specs and known test-only typing gaps.
- `npm run typecheck` (`tsc --noEmit`) is a known issue on `main`: it reports errors confined to test files (untyped `Module._load`, missing `vitest` typings, `.ts` extension test imports, and a few pre-existing test fixture type mismatches). When reporting validation, explicitly separate these pre-existing full-typecheck errors from any new errors introduced by the current change.
- Tests use the Node built-in runner and MUST be run with the `react-server` condition, otherwise `server-only` throws:
  `node --conditions=react-server --import tsx --test "src/**/*.test.ts"`
  The suite is not fully green on `main`: 6 files import `vitest` (not a dependency) and a handful of billing/length tests have pre-existing assertion mismatches. The large majority pass.
