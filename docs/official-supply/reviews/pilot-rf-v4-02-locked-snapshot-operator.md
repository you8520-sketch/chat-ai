# Wolfgang v4 locked snapshot — operator preparation (NO LIVE WRITE)

Follow-up to [PR #1530 comment 6105710112](https://github.com/you8520-sketch/chat-ai/pull/1530#issuecomment-6105710112).

This note is the execution plan and sanitized live evidence for a future one-target CAS. It does not run production CAS.

**Do not call `reviewAnchor`. Do not POST images. Do not generate the 13 RP slots. Do not stage, publish, or merge from this document.**

## BEFORE

| Item | Value |
|---|---|
| Public `hav.chat` `/api/health` `gitCommit` | `34608ea` |
| Container `RAILWAY_GIT_COMMIT_SHA` | `34608ea5a742119bc2922584fb079dac8f26266b` |
| `origin/main` | same SHA (#1530 merged) |
| Native SSH | existing unlocked WSL `ssh-agent` (`hav-windows`). No `railway.exe` key path. |
| Inspect handle | `better-sqlite3` `{ readonly: true, fileMustExist: true }` + `PRAGMA query_only=ON` |
| `OfficialSupplyStore` during inspect | not instantiated (constructor runs DDL) |
| Container `/app/scripts/official-supply-*.ts` | present; `tsx` present |
| This operator script on current deploy | **absent** (`official-supply-reconcile-locked-snapshot.ts` is this PR) |
| `/data` free | 95 021 473 792 bytes (~88.5 GiB) against 1.34 GiB used |

## PROBLEM

`OfficialSupplyStore.reconcileLockedSnapshot` is on main and in the running container source, but there is no one-target operator that:

1. reads the exact live `draft_json` / `asset_plan_json` strings as CAS preimage
2. defaults to a genuine read-only inspect
3. refuses `/data/app.db` apply until a later live-write approval

`updateDraft` / `lockAssetPlan` / `reviewAnchor` remain the wrong owners. The 2026-09-27 fixture is not byte-authority for SQLite JSON.

## Live read-only matrix (`pilot-rf-v4-02`, 2026-10-11)

Raw `draft_json` / `asset_plan_json` bodies are not published here.

| Field | Live value |
|---|---|
| stage | `asset_plan_locked` |
| world / style / batch | `pilot-rf-erendel` / `romance_fantasy_v4` `style_locked` / `pilot-romance-fantasy-04-cluster-b` `active` |
| `is_style_proof` | 1 |
| `updated_at` | `2026-09-27 15:46:39` |
| text hash | `13b5d5aa3ba731b7d7ee080028b0425a65e6b49b9759664100852bc40f172726` (old) |
| approved text hash | `6ff02833cfd45a542866aa1afa749486d94362eff5358e10f995b8f77fabd5fd` |
| Appearance Lock | `1c3ccd134203a6dea6ae869c27cc443c42ff5498d1d0130c6f9765407c24dcc3` |
| public copy lengths | tagline 27 / description 227 / greeting 848 |
| approved copy lengths | 37 / 1299 / 1547 |
| hook `처형 명령서` / 보호자 | false / false |
| stale needles | `압송`, `수갑`, `플레이어와 함께`, `차가운 심문` present; `character_plus_required_partner` absent |
| `imageSubjects` slots | 0 / 14 |
| live `draft_json` SHA-256 | `2f7d4f653e02ef3fceb7e2e02a551853c38fcb14db81f14985d219c5d92b4858` |
| live `asset_plan_json` SHA-256 | `f2f3371754d767041275186b1db50d09fa85e8529c5bd3faecf36fb4d398bc44` |
| approval / staging | empty |
| replacements | 0 |
| in-flight / started non-rep | none |
| rep id | 435 |
| rep URL | `/uploads/official-pilot-rf-v4-02__rep-a1.webp` |
| rep status / attempts / lease | `generated` / 1 / none |
| rep moderation | checked, `adultFlagged=false`, `moderationReject=false` |
| kept WebP SHA-256 | `a66c49d4d947209206b70a284c99f2e26ef868934ed5426818042c29ba3a45f1` |
| other 13 slots | `planned`, attempts=0, no URL, ids 436–448 |
| sibling official characters | 39 other rows (not mutated) |

Verdict: **ready for a later one-target CAS**. Not authorized in this PR.

## OWNER MAP

| Responsibility | Owner | This PR |
|---|---|---|
| Locked snapshot write | `OfficialSupplyStore.reconcileLockedSnapshot` | unchanged |
| Inspect / apply gate | `lockedSnapshotReconcileOperator` + `scripts/official-supply-reconcile-locked-snapshot.ts` | added |
| Approved source | `loadCompiledOfficialCharacterSource("pilot-rf-02")` → `buildPilotClusterBStyleProofDraft` + #1510 plan | no new prose |
| Consistent SQLite snapshot | `VACUUM INTO` (`src/lib/sqliteBackupRestore.synthetic.test.ts`) | reused; no production backup created |
| Railway volume backup | Railway Backups tab | optional extra, not a substitute |
| Anchor / 13 images / publish | existing later owners | not called |

## AFTER (code only)

Default CLI is inspect or `NOT_RUN`. Inspect never instantiates `OfficialSupplyStore`. Apply requires `apply` argv **and** `OFFICIAL_LOCKED_SNAPSHOT_APPLY=1`, reads preimage from the same SQLite file, then calls the existing Store method once.

Fail-closed gates after GPT #1533 review:

1. Apply refuses Railway `RAILWAY_ENVIRONMENT_NAME=production` and any path whose `realpath`/inode resolves to `/data/app.db`, unless all three Wolfgang-only confirm envs are exact: `OFFICIAL_LOCKED_SNAPSHOT_PRODUCTION_CAS=1`, `OFFICIAL_LOCKED_SNAPSHOT_PRODUCTION_DRAFT_KEY=pilot-rf-v4-02`, `OFFICIAL_LOCKED_SNAPSHOT_PRODUCTION_CONFIRM=pilot-rf-v4-02`. That override still uses `OfficialSupplyStore.reconcileLockedSnapshot` and still requires backup + deploy SHA match. It does not open Lucian or any other draft.
2. `ready_for_cas` requires the observed live `draft_json`/`asset_plan_json` SHA-256 pair. Hook-only or plan-only drift STOPs. `already_current` requires the full compiled draft+plan, including hook.
3. Backup must be a distinct `VACUUM INTO` file whose Wolfgang row and 14 asset rows match the live pre-CAS source. Integrity-only unrelated SQLite is rejected.
4. Apply requires independently provided `OFFICIAL_LOCKED_SNAPSHOT_EXPECTED_DEPLOY_SHA` and matching `RAILWAY_GIT_COMMIT_SHA`. Inspect still reports runtime SHA.

## Backup / restore plan (future apply precondition)

1. Confirm `/data` free space >> `app.db` size. Observed free ~88.5 GiB.
2. On the live container, snapshot with `VACUUM INTO` to a new file. Do **not** `cp /data/app.db` while WAL is on. Installed driver is libsql; `Database.backup()` is not implemented.
3. Open the snapshot `{ readonly: true, fileMustExist: true }`, `PRAGMA integrity_check=ok`, no `-wal` sibling.
4. Keep that file until GPT/user approve one CAS. This PR does not create that file.
5. If CAS must be undone: restore from that snapshot or a Railway volume backup using `docs/RAILWAY_SQLITE_RECOVERY.md`. Do not invent an in-process rollback writer.

## NEXT APPROVAL REQUIRED

1. Merge this operator (GPT).
2. Deploy so `/app/scripts/official-supply-reconcile-locked-snapshot.ts` exists next to `tsx`.
3. Re-run inspect on live `/data/app.db`. STOP if hashes/stage/rep drift.
4. Create a `VACUUM INTO` snapshot and record its path + integrity.
5. After GPT/user approval of this production-CAS gate and a matching deploy: one live apply with `apply` + `OFFICIAL_LOCKED_SNAPSHOT_APPLY=1` + independently observed `OFFICIAL_LOCKED_SNAPSHOT_EXPECTED_DEPLOY_SHA` + existing verified backup path + the three Wolfgang confirm envs. Re-inspect first; STOP on hash/stage/rep drift. Do not create a second backup if the existing PASS file still matches live.
6. Later, separately: `reviewAnchor`, 13 paid images, publish.

## POST=0 / PROD WRITE=0

This turn: native SSH inspect only. POST 0. reviewAnchor 0. production CAS 0. publish 0.
