# Current-main Autonomy Map

**Classification:** `AUTONOMY_COVERAGE_AUDIT_COMPLETE`
**EXACT MAIN:** `e0880d43e47e412f1de77c86cc04d4ec864e2785`
**Production behavior change:** none. This document and its lock test do not rerun workflows, grant permissions, or add a scheduler.

Historical baseline under audit: Draft PR #1002 (`cursor/architecture-ops-investigation-4604`, investigated main `f13ea612fc942418a0271f05db209b76ecc077c2`, 2026-09-22). That PR is not closed or merged here.

PR-level disposition: **`SUPERSEDED_BY_CURRENT_MAIN` candidate**. The open draft still describes a tree with no Ops Inbox, no `scheduler_run_slots`, a demo subscription grant, and payout transfer-before-claim. Those execution paths are not current main. Merging #1002 would publish a stale owner map. Close/merge is a human decision; this audit only records the evidence.

## Machine-checked inventory

Scheduled workflows are whatever `scanScheduledWorkflowDefinitions` reads from `.github/workflows`. In-process jobs are `SCHEDULER_DEFINITIONS`. The lock test fails if this block drifts.

<!-- autonomy-inventory:scheduled-workflows -->
.github/workflows/code-health-monthly-cleanup.yml
.github/workflows/code-health-weekly-audit.yml
.github/workflows/decision-model-radar-weekly.yml
.github/workflows/domain-ssl-monitor.yml
.github/workflows/main-rp-monthly-cache-audit.yml
.github/workflows/main-rp-supply-radar.yml
.github/workflows/memory-research-cycle.yml
.github/workflows/validate-rp-active-model-quality.yml
<!-- /autonomy-inventory:scheduled-workflows -->

<!-- autonomy-inventory:schedulers -->
finance_daily safeFailedRetry=true safeStaleReclaim=true
main_rp_cache_ttl_monthly safeFailedRetry=true safeStaleReclaim=true
payout_monthly safeFailedRetry=true safeStaleReclaim=true
training_daily safeFailedRetry=false safeStaleReclaim=false
training_weekly safeFailedRetry=false safeStaleReclaim=false
<!-- /autonomy-inventory:schedulers -->

<!-- autonomy-inventory:github-rerun -->
authority=ACTUATE
permission=actions:write
retrySafety=REVIEW_REQUIRED
humanGate=YES
implemented=NO
<!-- /autonomy-inventory:github-rerun -->

<!-- autonomy-inventory:pr-1002 -->
ops_inbox FIXED
scheduler_run_registry FIXED
automation_health SUPERSEDED
finance_scheduler_retry SUPERSEDED
payout_scheduler_console_only FIXED
payout_transfer_before_claim FIXED
training_scheduler SUPERSEDED
memory_automation SUPERSEDED
code_health_automation SUPERSEDED
supply_radar SUPERSEDED
provider_cost_monitoring SUPERSEDED
admin_automation_reports FIXED
web_push_no_ledger SUPERSEDED
runtime_deploy_health STILL_TRUE
subscription_demo_grant FIXED
in_process_mutex_only SUPERSEDED
playwright_canary STILL_TRUE
reticle_absent STILL_TRUE
decision_plane_unconfirmed STILL_TRUE
shallow_health STILL_TRUE
no_backup_owner STILL_TRUE
no_domain_cert_owner STILL_TRUE
github_failed_job_rerun UNKNOWN
<!-- /autonomy-inventory:pr-1002 -->

`github_failed_job_rerun` is `UNKNOWN` as a #1002 finding because #1002 did not investigate Actions rerun. The current-main fact is recorded in the github-rerun block: permission is Actions write, no workflow grants it, and no safe automatic target was proven.

## #1002 DELTA

| #1002 claim | Status | Current-main evidence |
| --- | --- | --- |
| No Ops Inbox | FIXED | `src/app/admin/ops/page.tsx`, `src/lib/adminOpsInbox.ts`. Observes scheduler, payout, point refund, finance anomaly, web push, GitHub scheduled conclusions. Does not rerun them. |
| Payout/finance/training have no DB run table | FIXED | `scheduler_run_slots` via `src/lib/schedulerRunRegistry.ts`. Boot recovery uses `shouldAttemptBootRecovery`. |
| Payout calls `sendMoneyToUser` before an exclusive DB transition | FIXED | `executeWithdrawalPayout` claims `payout_transfer_attempts` first. `markAttemptDispatched` runs before `provider.transfer`. `DISPATCHED` / `RECONCILIATION_REQUIRED` do not call `transfer()` again. Unknown provider results stay `RECONCILIATION_REQUIRED`. |
| Subscription cron grants free points with no provider charge | FIXED | `POST /api/cron/subscription-renew` returns 503. `processDueRenewals` is absent from `src/`. |
| Web push failure is console-only | SUPERSEDED | `web_push_outbox` stores attempts. Ops Inbox has a `web_push` source. Delivery retry stays inside `src/lib/webPush.ts`. |
| No admin automation report hub | FIXED | `/admin/automation-reports` reads GitHub schedule runs, code health, scheduler overview, finance anomalies, memory research, supply drafts. |
| In-process `running` flag is the only duplicate-cron guard | SUPERSEDED | Shared SQLite slot claim (`INSERT OR IGNORE`) is the durable guard. A second database would not share that claim; this repo has one app DB owner (`src/lib/db.ts`). |
| `/health` is `{ status: "ok" }` and is not a chat canary | STILL_TRUE | `src/app/health/route.ts`. Railway `healthcheckPath` is still `/health`. `/api/health` adds SHA and flags and is still not the probe. |
| Playwright is not a production failure canary | STILL_TRUE | UI specs live under `tests/ui/`. No scheduled workflow runs them against production. |
| Reticle is not a production dependency | STILL_TRUE | Not in the repo. No new recommendation. |
| Decision-plane enforcement is unconfirmed | STILL_TRUE | Weekly decision radar benchmarks and writes a ledger branch. It does not change the production route. |
| No backup owner | STILL_TRUE | No backup/restore scheduler or admin owner in this repo. |
| No domain/certificate owner | STILL_TRUE | No certbot, DNS, or certificate workflow in this repo. Platform concern, not an app scheduler. |
| Automation Health, code health, memory research, supply radar | SUPERSEDED | They did not exist as current-main systems in the #1002 baseline. They are live owners now, listed below. Not copies of the #1002 design. |

## OWNER MAP

One responsibility, one canonical owner. Manual scripts that call the same function are entrypoints, not second owners.

| Responsibility | Canonical owner | Not a second owner |
| --- | --- | --- |
| In-process slot claim, failed retry, stale reclaim | `claimSchedulerRun` in `src/lib/schedulerRunRegistry.ts` | Per-cron files only call it |
| Payout transfer | `executeWithdrawalPayout` in `src/lib/payoutExecution.ts` | `processPayoutQueue`, `scripts` manual run |
| Point-charge refund transfer | `src/lib/pointChargeRefundExecution.ts` | PortOne webhook wakes lookup |
| Report refund review | `reviewReportRefund` in `src/lib/refund.ts` | Admin page |
| Chat turn billing | `settleChatTurnBillingExactlyOnce` | — |
| Finance snapshot, cost reconcile, pricing tracker, anomaly notify | `src/cron/financeScheduler.ts` calls the lib owners on one slot | Tracker claim is `modelPricingTracker.ts`, not a second cron |
| Training analysis / export | `src/cron/trainingScheduler.ts` | Manual scripts call the same libs |
| Main RP cache TTL economics | `runMainRpCacheTtlMonthlyAudit` via `mainRpCacheTtlAuditScheduler.ts` | GitHub monthly cache audit is a different job (usage API, artifacts) |
| GitHub schedule observation | `fetchGithubScheduledAutomationProjection` | Automation Health classifies the same projection read-only; Ops Inbox emits incidents from the latest completed conclusion. Neither actuates. |
| Scheduled automation health | `buildScheduledAutomationHealthReport` | Weekly code-health audit renders it. It does not rerun. |
| Ops incident list | `listAdminOpsIncidents` | Automation reports page does not own the incident schema |
| Admin web push | `queueUserWebPush` after `user_notifications` insert | No second push transport |
| Supply draft notice | `startAdminSupplyDraftNotificationScheduler` | Does not create the draft; supply radar does |
| Memory runtime | chat/memory libs (`memory-manager`, episodic facts, reconcile) | Memory research cycle is outside the production process |
| Code health ledger / cleanup Draft PR | weekly and monthly workflows | Not a Railway scheduler |
| DB schema | `initializeDatabase` in `src/lib/db.ts` | — |
| Deploy liveness | Railway `/health` | App does not restart itself |
| hav.chat DNS/TLS observation | `src/lib/domainSslMonitor.ts` | Post-deploy SHA verification; Railway certificate issuance |

Duplicate-owner notes, not refactors:

- Automation Health (`WARNING` on one failure, `FAILING` at two, plus `STALE`/`MISSING`) and Ops Inbox (latest non-success conclusion is critical) both read GitHub schedule runs. Neither actuates. Unifying them would change admin severity. FOLLOW-UP only.
- Two cache audits are different data and different side effects. KEEP both.
- `/health` and `/api/health` are intentionally different. KEEP.
- `safeFailedRetry` for `payout_monthly` retries the scheduler slot through `executeWithdrawalPayout`. That is the existing money-movement retry owner. A second automatic retry is not added.

## CAPABILITY ENVELOPE

Authority is the furthest action the current owner actually takes. Retry safety names the existing owner or says the automatic rerun was not proven. `SAFE_PROVEN` is not used for GitHub schedule rerun.

| Operation | Authority | Side effect | Retry safety | Permission | Provider cost | Human gate | Kill switch | Admin visibility |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| GitHub failed-job rerun | ACTUATE if it existed | would re-enter the failed job's own side effect | REVIEW_REQUIRED | Actions write, absent | depends on the job | YES | none | run URL only |
| CI validate workflows | OBSERVE | NONE beyond the check | REVIEW_REQUIRED | `contents: read` | none on the validate set | YES to merge | path filters | GitHub checks |
| Code-health weekly | DETECT | LEDGER_WRITE on `code-health-ledger` | REVIEW_REQUIRED | contents read; persist job contents write; actions read | none (keys blanked) | YES | workflow dry_run | `/admin/automation-reports` |
| Code-health monthly | PROPOSE | LEDGER_WRITE + DRAFT_PR | REVIEW_REQUIRED | contents write, pull-requests write on the PR job | none | YES, never auto-merge | dry_run, create_pr | automation reports |
| Memory research cycle | PROPOSE | LEDGER_WRITE + DRAFT_PR; monthly live job is opt-in PROVIDER_CALL | REVIEW_REQUIRED | contents/pull-requests write on PR jobs | research job 0; live job uses a benchmark secret | YES | dry_run, run_live_experiments | automation reports |
| Decision model radar | INVESTIGATE | PROVIDER_CALL + LEDGER_WRITE | REVIEW_REQUIRED | contents read; persist contents write | benchmark key | YES | dry_run | automation reports |
| Active Main RP quality schedule | INVESTIGATE | PROVIDER_CALL on the live job | NEVER_AUTO_RETRY | contents read | benchmark keys, two cases | YES | schedule vs PR | GitHub artifacts |
| Admin RP qualification fixture | OBSERVE | NONE (read-only JSON) | REVIEW_REQUIRED | admin session | none | YES | admin auth | `GET /api/admin/rp-qualification-fixture` |
| Supply radar | PROPOSE | PROVIDER_CALL on day-1 qualification; DRAFT_PR for a provider switch | NEVER_AUTO_RETRY | contents write, pull-requests write, actions read | radar/benchmark keys; day-1 also `OPENROUTER_API_KEY` | YES to merge | schedule split | automation reports + supply draft notification |
| Monthly cache audit (GitHub) | OBSERVE | ARTIFACT_ONLY + usage API read | REVIEW_REQUIRED | contents read | usage/reporting key, generation calls asserted 0 | YES | dry_run | artifact / summary |
| finance_daily | ACTUATE | PRODUCTION_DB_WRITE, PROVIDER_CALL for usage reconcile, USER_NOTIFICATION on anomaly | SAFE_EXISTING_OWNER | in-process | usage reconcile | YES for margin/price edits | `DISABLE_FINANCE_SCHEDULER`, `DISABLE_MODEL_PRICING_TRACKER` | finance page, Ops Inbox, automation reports |
| main_rp_cache_ttl_monthly | OBSERVE | PRODUCTION_DB_WRITE of the audit result only | SAFE_EXISTING_OWNER | in-process | none in the scheduler owner | YES to apply a TTL change | `DISABLE_MAIN_RP_CACHE_TTL_AUDIT` | automation reports |
| payout_monthly | ACTUATE | EXTERNAL_MONEY_TRANSFER | SAFE_EXISTING_OWNER for the slot; no second retry | in-process; provider port | transfer fee is the transfer | YES when state is `RECONCILIATION_REQUIRED` | `DISABLE_PAYOUT_SCHEDULER` | payout page, Ops Inbox |
| training_daily / weekly | ACTUATE | PRODUCTION_DB_WRITE / export files | REVIEW_REQUIRED (`safeFailedRetry: false`) | in-process | model calls only if the training lib makes them while enabled | YES | `DISABLE_TRAINING_PIPELINE` and `ENABLE_TRAINING_PIPELINE` must both allow it | Ops Inbox on FAILED/STALE/MISSING |
| Web push delivery | ACTUATE | USER_NOTIFICATION | SAFE_EXISTING_OWNER (`attempts` cap, backoff) | VAPID | push service | no per message | `DISABLE_WEB_PUSH`, `DISABLE_WEB_PUSH_DELIVERY` | Ops Inbox stuck rows |
| Supply draft notification | DETECT | USER_NOTIFICATION | SAFE_EXISTING_OWNER (dedupe by ref) | public GitHub read | none | no | process stays up with the server | notifications |
| Derived cache wakeup | ACTUATE | PRODUCTION_DB_WRITE | SAFE_EXISTING_OWNER (lease) | in-process | none | no | `DISABLE_DERIVED_CACHE_WORKER` | no dedicated ops card |
| Chat billing settlement | ACTUATE | BILLING_OR_POINTS | SAFE_EXISTING_OWNER (idempotent key) | request | none | no | billing routes | point history |
| Point-charge refund | ACTUATE | BILLING_OR_POINTS + provider refund | SAFE_EXISTING_OWNER (attempt row, lookup after dispatch) | PortOne | provider refund call | YES on reconciliation | attempt state | Ops Inbox `point_refund` |
| Report refund | ACTUATE within policy; else PROPOSE | BILLING_OR_POINTS | REVIEW_REQUIRED for the admin queue | admin session | none | YES over the auto limit | admin review | `/admin/report-refunds` |
| Comment / character moderation | DETECT then human ACTUATE | PRODUCTION_DB_WRITE on admin action | HUMAN_ONLY for the decision | admin session | AI comment check only when `ai_check=1` | YES | banned-word list | comment reports, character moderation |
| Model route / published price | PROPOSE via tracker and supply draft | ROUTE_OR_PRICE_CHANGE only if a human merges or edits | NEVER_AUTO_RETRY | admin or PR merge | tracker reads prices | YES | pricing admin | `/admin/pricing`, supply drafts |
| Memory runtime | ACTUATE | PRODUCTION_DB_WRITE | existing mutation owners, not a cron retry | request | chat inference is separate | no for ordinary turns | `MEMORY_FEATURE_ENABLED` | chat UI, not Ops Inbox |
| Railway restart | ACTUATE by the platform | DEPLOYMENT | platform `on_failure` only | Railway | none | no | railway.toml | `/health` body is only `ok` |
| Dependency npm audit | DETECT | NONE | REVIEW_REQUIRED | contents read on PR | none | YES | path filter on package files | GitHub check |
| Backup / restore | — | — | UNKNOWN | — | — | YES | no owner | no admin surface |
| Domain / certificate issuance | — | — | UNKNOWN | Railway | — | YES | Railway renews the custom-domain cert | no mutation owner |
| hav.chat DNS/TLS observation | OBSERVE | NONE | REVIEW_REQUIRED | `contents: read` | none | YES | schedule + dry_run dispatch | `/admin/automation-reports` + Ops Inbox on failed schedule |

`SAFE_EXISTING_OWNER` means the current claim/reclaim code is the retry owner and this audit did not add another. It does not mean a blind external rerun is safe. Payout and refund keep `RECONCILIATION_REQUIRED` instead of a second transfer when the provider outcome is unknown.

## Autonomy classification

| Domain | Operation | Class | Why |
| --- | --- | --- | --- |
| GitHub CI | path-filtered validate | AUTOMATED | Runs on matching PRs. Merge stays human. |
| GitHub schedule | eight workflows above | PARTIAL | They run themselves. Failed-job rerun is manual. Draft PRs are not merged. |
| In-process schedulers | five `SCHEDULER_DEFINITIONS` jobs | AUTOMATED | Cron plus slot claim. Training does not auto-retry failure. |
| Railway | restart on failed health | PARTIAL | Platform restarts the process. The probe does not see chat failures. |
| Provider supply | radar + draft | PARTIAL | Draft PR only. Switch is a merge. |
| Provider routing | live chat route | AUTOMATED for the request failover that already exists | Changing the pinned route is not automatic. |
| Pricing | tracker inside finance cron | PARTIAL | Detects and records. Does not publish a new price by itself. |
| Billing | turn settlement | AUTOMATED | Idempotent per turn. |
| Payout | monthly batch | PARTIAL | Automatic claim and transfer. Unresolved provider state waits. |
| Refund | point charge / report | PARTIAL | Attempt machine exists. Admin queue remains. |
| Finance / margin | daily snapshot + anomaly | PARTIAL | Writes the snapshot and can notify. Does not change prices. |
| Model registry | `chatModels` and admin pricing | MANUAL | Code or admin edit. |
| Memory runtime | per turn | AUTOMATED | Inside the chat request. |
| Memory research | weekly/monthly cycle | PARTIAL | Draft PR, no merge. |
| RP / model quality | monthly live evidence | PARTIAL | Evidence only. |
| RP / model quality | admin qualification fixture export | MANUAL | `GET /api/admin/rp-qualification-fixture` reads a sanitized fixture. No scheduler, no provider call, no route change. |
| Prompt quality | no scheduled owner | MANUAL | Tests exist; no production auditor owns prompt edits. |
| Code health | weekly + monthly | PARTIAL | Ledger and optional cleanup draft. |
| DB / schema | boot migration | AUTOMATED | `initializeDatabase`. No separate migration cron. |
| Auth / session | login and OAuth callback | AUTOMATED for the request | No expired-session purge cron. |
| Cache | derived-cache worker + two audits | PARTIAL | Worker repairs stale jobs. TTL and usage audits do not change the route. |
| User-facing errors | request handlers | PARTIAL | Logged per request. No single production error inbox. |
| Admin reports / Ops Inbox | read models | AUTOMATED as observation | They do not actuate. |
| Notifications | in-app + web push | AUTOMATED | Existing outbox retry. |
| Character supply | moderation and create-migration pages | MANUAL | Admin actions. |
| Moderation | banned words automatic; reports reviewed | PARTIAL | AI comment check can block. Listing decisions are human. |
| Backup / recovery | none in repo | MANUAL | Gap. |
| Domain / certificate issuance | Railway | MANUAL | Mutation gap. Observation is `domainSslMonitor`. |
| Dependency update | npm audit on package PRs | PARTIAL | No scheduled bump or auto-merge. |

## COVERAGE GAPS

Not implemented in this PR.

| Gap | Class | Note |
| --- | --- | --- |
| GitHub failed-job automatic rerun | PERMISSION_BLOCKED, SAFE_ACTUATION_GAP | Actions write is absent. No workflow was proven side-effect free. Human gate stays. |
| `/health` does not detect chat, billing, or scheduler failure | OBSERVABILITY_GAP | Railway only sees `{ status: "ok" }`. |
| Backup and restore | OWNER_GAP | No canonical owner. |
| Domain and certificate issuance | OWNER_GAP | Railway issues and renews the custom-domain cert. Repo observation is `domainSslMonitor`. |
| Prompt quality drift | OWNER_GAP | No scheduled production owner. |
| Production request server failures | ALREADY_COVERED | `ops_request_incidents` aggregates stable signatures. `listAdminOpsIncidents` projects them as source `request`. 4xx and expected auth or validation failures stay out. |
| Autonomy map on an admin page | ADMIN_VISIBILITY_GAP | Would be a second projection of this audit. Left as FOLLOW-UP so the report does not become a configuration owner. |
| Automation Health vs Ops Inbox severity | INVESTIGATION_GAP | Both observe. They do not actuate, so they are not merged here. |
| Live quality, decision radar, supply day-1 | COST_BLOCKED | A rerun spends provider calls. |
| Payout, refund, price, route, deploy | HUMAN_ONLY_BY_DESIGN | Existing owners already move money or write production state under their own claim rules. |
| Scheduler slot retry, billing idempotency, web push outbox, Ops Inbox, automation reports | ALREADY_COVERED | Current owners. |

## Admin surface

`/admin/automation-reports` is the read-only hub for GitHub schedule groups, code health cards, scheduler overview, finance anomalies, memory research, supply drafts, post-deploy verification, and the hav.chat DNS/TLS observer. `/admin/ops` is the incident list. Both already have owners. This audit does not add a table, a queue, or a second classifier.

A later read-only rendering of this map could import the same facts the lock test checks. It is FOLLOW-UP because it is not required to prove the map, and a stored copy would be a second state owner.

## SAFE TO DELETE / KEEP / FOLLOW-UP

SAFE TO DELETE: none. #1002 is a disposition candidate, not a branch this PR deletes.

KEEP: `schedulerRunRegistry` retry flags, payout and refund attempt rows, Automation Health read-only contract, Ops Inbox "do not auto rerun" text, both health routes, both cache audits, supply draft poller, web push outbox.

FOLLOW-UP, not started:

- GitHub automatic rerun
- First live `deployment_status` run of `.github/workflows/post-deploy-verification.yml` after the public-page step is on `main`. That step runs only after SHA/health VERIFIED, inside the same event workflow. It is not a scheduled workflow and it is not part of the scheduled inventory above.
- stale Draft PR janitor
- deployment recovery, auto rollback, AI repair
- new auto-actions
- admin rendering of this map
- unifying Automation Health and Ops Inbox severity
- human close of PR #1002 after reading this delta

## REGRESSION RISKS

The only execution-path edit is `.github/workflows/validate-ops-inbox.yml`, which gains a path filter and one test step. Production request, scheduler, payout, billing, and prompt code are unchanged.
