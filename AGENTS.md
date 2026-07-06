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

### Lint / typecheck / tests
- `npm run typecheck` (`tsc --noEmit`) reports ~95 errors, all confined to `*.test.ts` files (untyped `Module._load` / missing `vitest` typings); there are 0 errors in application source, and `next build` is unaffected.
- Tests use the Node built-in runner and MUST be run with the `react-server` condition, otherwise `server-only` throws:
  `node --conditions=react-server --import tsx --test "src/**/*.test.ts"`
  The suite is not fully green on `main`: 6 files import `vitest` (not a dependency) and a handful of billing/length tests have pre-existing assertion mismatches. The large majority pass.
