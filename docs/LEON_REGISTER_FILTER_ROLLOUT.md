# Leon register filter — prod rollout & rollback (Step 7.6c, Stage 1)

> **STATUS 2026-07-03: BLOCKED at the "which DB does Railway actually use" check.**
> The Railway account has TWO chat-ai projects, and neither is a valid rollout target:
>
> | Project | Status | Volume | DB contents |
> |---------|--------|--------|-------------|
> | `enchanting-ambition` (chat-ai-production-**3e84**) | ● Online, HTTP 200 | **none** — `/data` is ephemeral, wiped every deploy | 9 seed characters (id 1–9), **no Leon id=18**, 0 users, 0 messages |
> | `romantic-reprieve` (chat-ai-production-**56d9**) | ● **Failed** — every deploy since 2026-06-23 failed `/health` healthcheck, URL returns 404 | `data` volume at `/data`, 49 MB used (the real data lives here) | unreadable — no running instance to SSH into |
>
> `--apply-db` must NOT run until one target is fixed: either repair `romantic-reprieve`'s
> failing deploys (real DB, dead service) or attach the volume / migrate data to
> `enchanting-ambition` (live service, throwaway DB). Applying to the ephemeral DB would
> silently vanish on next deploy.

Stage 1 scope: `EXAMPLE_DIALOG_SCENE_FILTER` + Leon id=18 tagged `example_dialog` only.
Stage 2 (`SPEECH_LOCK_NARRATION_LEXICON`) is deployed separately, days later — never together.

## What Stage 1 changes

| Piece | Value | Where |
|-------|-------|-------|
| env flag | `EXAMPLE_DIALOG_SCENE_FILTER=1` | Railway service Variables |
| DB | Leon id=18 `example_dialog` = bracket-tagged rewrite (6 `[공적]/[사적]/[침대]` tags) | Railway `/data/app.db` |
| Blast radius | Leon only — untagged characters pass through filter unchanged (tested: `exampleDialogSceneFilter.test.ts` "passes through untagged legacy examples") | — |

## Deploy order

1. Confirm the DB Railway actually reads:
   `railway run node -e "console.log(process.env.DATA_DIR)"` → must be `/data`.
   Then `railway run node -e "const D=require('better-sqlite3');const r=new D(process.env.DATA_DIR+'/app.db',{readonly:true}).prepare('SELECT id,name,substr(example_dialog,1,40) h FROM characters WHERE id=18').get();console.log(r)"` — name must be `레온`.
2. Apply DB (idempotent, aborts if id=18 is not 레온):
   `railway run npm exec tsx -- scripts/step76c-prod-leon-rollout.ts --apply-db`
3. Set `EXAMPLE_DIALOG_SCENE_FILTER=1` in Railway Variables → redeploy.
4. Post-deploy verify (same harness as staging, n=12 × 2 scenes):
   `railway run npm exec tsx -- scripts/step76c-prod-leon-rollout.ts --verify --n=12`
   Expected (local baseline 2026-07-03): pooled ≈41.7%, **leon-private-1 58.3% / drift 0**, leon-private-0 ≈25% (hard scene — matches holdout tagged 25%, not a rollout failure).
5. If results differ sharply from the local baseline → suspect Railway env first
   (env var not loaded, stale build cache, different DB) and stop before Stage 2.

## Rollback (Stage 1)

Fastest (config only, no deploy of code):

1. Railway Variables → set `EXAMPLE_DIALOG_SCENE_FILTER=0` (or delete the var) → redeploy.
   Filter is checked per-request (`isExampleDialogSceneFilterEnabled()`); with the flag off the
   tagged block is injected whole (tags visible to model but inert — same shape staging ran
   without filter).
2. Full revert (restore original DB value): Leon's pre-rollout `example_dialog` was **empty**
   (confirmed in `tmp-leon-setting-dump.txt` audit before staging apply). To fully revert:
   `railway run node -e "const D=require('better-sqlite3');new D(process.env.DATA_DIR+'/app.db').prepare(\"UPDATE characters SET example_dialog='' WHERE id=18 AND name='레온'\").run()"`
   Then clear `setting_chunks` staleness is automatic (hash mismatch → re-parse on next load).

## Stage 2 (separate date)

- Pre-req: Stage 1 stable for several days; Group A implementation + unit tests done
  (done 2026-07-03: `src/lib/speechLock/narrationLexicon*.ts`, 5/5 tests).
- Enable `SPEECH_LOCK_NARRATION_LEXICON=1` (Leon-only by default;
  `SPEECH_LOCK_NARRATION_LEXICON_LEON_ONLY=0` widens to all characters).
- Verify with n≥12 before calling it live. Rollback = flag off (per-request check, no code revert).
