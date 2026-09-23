# Durable Scheduler Run Registry — P1 BUGFIX / OPERABILITY

## Classification

`ROOT_CAUSE_UNCONFIRMED` until regression, typecheck, and production build pass on the Draft PR.

## BEFORE

Production background scheduling is registered from `server.js` after HTTP listen.

Time-slot batch schedulers:

- finance daily — 12:00 Asia/Seoul
- payout monthly — 15th 03:00 Asia/Seoul
- training daily — 04:00 Asia/Seoul
- training weekly — Sunday 05:00 Asia/Seoul

Each scheduler used a process-local boolean such as `running = false` to prevent overlap.

That protects only one Node process.

It does not protect against:

- overlapping/restarted workers that share the canonical DB
- future shared-DB multi-worker topologies
- two independently booted app processes
- restart after a scheduled instant
- crash while a batch is running
- durable audit of completed/failed/missed slots

## PRODUCTION PATH AUDIT

Railway production service currently uses:

- region: sfo
- replicas: 1
- payout scheduler: disabled by `DISABLE_PAYOUT_SCHEDULER=1`
- training pipeline: disabled
- finance scheduler: enabled

Current deployment boot log registers:

`[finance-scheduler] registered — cron "0 12 * * *" (Asia/Seoul)`

The previous production deployment was alive at the 2026-09-23 finance slot and logs prove:

- provider reconciliation at 2026-09-23 12:00 KST
- daily finance snapshot saved
- model pricing tracker invoked

Therefore the first durable-registry deployment must not retroactively run the same current slot again.

## ROOT CAUSE

The schedule trigger and the execution ownership boundary were conflated.

`node-cron` decided when to wake a process, while a process-local boolean also acted as the execution lock.

There was no durable `job + schedule slot` identity shared across replicas/restarts.

## AFTER

### Canonical schedule owner

`schedulerDefinitions.ts`

One structured definition owns:

- cadence
- hour/minute
- day-of-month/day-of-week where applicable
- safe retry policy
- stale reclaim policy
- stale timeout

Cron strings are derived from that owner.

### Canonical execution owner

`scheduler_run_slots`

Identity:

`job_name + slot_key`

Durable states:

- `RUNNING`
- `SUCCEEDED`
- `FAILED`
- `STALE_BLOCKED`

Execution metadata:

- trigger kind
- execution token
- attempt count
- start / heartbeat / finish timestamps
- error
- compact result summary

### Fencing

Every claimed attempt receives a new execution token.

Heartbeat and finish updates require the matching token.

If a stale safe job is reclaimed, the older worker cannot later overwrite the new attempt's durable result.

### Recovery wake policy

The cron expression remains the normal wake owner. Each enabled scheduler also registers a lightweight 5-minute recovery poll.

The poll does not execute business logic directly. It only asks the durable registry whether the latest actually due slot is:
- missing, or
- RUNNING with a stale heartbeat.

If so, it invokes the normal durable claim path with trigger_kind=`runtime_recovery`.

FAILED rows are intentionally **not** retried by the 5-minute poll, preventing retry storms. A safe FAILED finance/payout row may be retried once through boot recovery or a manual trigger.

This closes both:
- process restarted before a RUNNING row becomes stale, and
- healthy process missed a node-cron wake without restarting.

### Recovery policy

#### finance_daily

- failed retry: allowed for the same KST date
- stale reclaim: allowed for the same KST date
- missing catch-up: same KST date only
- reason: finance/pricing observations are time-sensitive; replaying yesterday with today's provider/catalog data would create false historical evidence

#### payout_monthly

- failed retry: allowed
- stale reclaim: allowed
- missing catch-up: latest actually due monthly slot
- reason: individual payout execution already has durable exactly-once provider state

#### training_daily

- failed retry: blocked automatically
- stale reclaim: blocked automatically
- missing catch-up: latest actually due slot before any claim exists
- reason: an interrupted analysis may already have consumed AI/provider cost

#### training_weekly

- failed retry: blocked automatically
- stale reclaim: blocked automatically
- missing catch-up: latest actually due slot before any claim exists
- reason: export creates run-id-specific files; blind replay can duplicate exports

Unsafe stale jobs become `STALE_BLOCKED` and remain visible for manual review.

## ACTIVATION BASELINE

The registry stores one `activated_at` timestamp.

A schedule instant earlier than registry activation is `PRE_ACTIVATION`, not `MISSING`.

This prevents the first deployment from replaying an old slot that may already have run under the previous scheduler implementation.

After activation, recovery resolves the latest actually due slot and then applies the job's canonical catch-up policy.

- finance: automatic recovery only when the due slot is the same KST date as execution
- payout: latest actually due monthly slot may recover
- training: an unclaimed latest-due slot may start, but FAILED work never auto-retries and stale work becomes STALE_BLOCKED

This deliberately leaves an older missing finance slot visible as MISSING instead of manufacturing historical finance/pricing evidence from newer data.

## OWNER MAP

| Responsibility | Canonical owner |
|---|---|
| schedule definitions + enablement + catch-up policy | `schedulerDefinitions.ts` |
| cron wake registration | each `src/cron/*Scheduler.ts` |
| slot ownership | `scheduler_run_slots` |
| stale / failed reclaim policy | `schedulerDefinitions.ts` + `schedulerRunRegistry.ts` |
| execution fencing | `schedulerRunRegistry.ts` |
| job business logic | existing finance / payout / training job owner |
| scheduler observability | durable registry read model |
| admin display | existing `/admin/finance` page |

## REMOVED / NORMALIZED

Removed as execution owners:

- finance `running`
- payout `running`
- training `dailyRunning`
- training `weeklyRunning`

Per-process `scheduledTask` references remain only to prevent duplicate timer registration inside one process. They do not own cross-process execution.

Payout cron expression is now derived from the shared canonical schedule definition instead of a second hardcoded schedule owner.

## PRESERVED

- finance 12:00 KST schedule
- payout 15th 03:00 KST schedule
- training 04:00 / Sunday 05:00 schedules
- payout individual exactly-once execution
- model pricing tracker daily claim
- training business logic and output format
- finance reconciliation/snapshot order
- feature-disable environment behavior
- no destructive migration
- no pricing / payment / provider contract changes

## EXCLUDED SYSTEMS

### derived-cache worker — KEEP

It already has the correct owner for its workload:

- durable SQLite queue
- atomic pending → processing claim
- lease timestamp
- stale lease recovery
- retry/backoff

A time-slot registry would duplicate that owner.

### web-push delivery — FOLLOW-UP

The web-push outbox is durable, but delivery selection currently uses a process-local `deliveryRunning` guard and reads unsent rows without a durable per-row claim.

Current Railway has one replica. Railway's current volume caveat explicitly states that replicas cannot be used with volumes, and this service mounts /data for SQLite. Therefore multi-replica safety is not claimed for the current volume topology.

Before multi-replica scale, web-push should get its own item-level delivery claim/lease. It should not be forced into the time-slot scheduler registry.

## ADMIN OBSERVABILITY

Existing `/admin/finance` receives a read-only background scheduler table showing:

- job / cron
- current slot
- durable state
- last heartbeat/finish
- attempt count
- trigger kind
- last error

States include:

- normal completed
- running
- failed
- stale
- stale blocked
- due slot missing
- intentionally disabled
- pre-activation

No new parallel Ops system is created in this PR.

## REGRESSION MATRIX

Canonical CI owner: `.github/workflows/validate-scheduler-durability.yml`.

The existing Main RP startup workflow remains unchanged and does not own scheduler validation.

`schedulerRunRegistry.test.ts` must prove:

1. existing cron expressions are unchanged
2. deterministic KST slot resolution
3. same job+slot has one owner
4. completed slot cannot execute twice
5. finance/payout failed slots may safely reclaim
6. training failed slot does not auto-retry
7. stale finance reclaim changes execution token
8. old fenced worker cannot overwrite reclaimed attempt
9. stale training becomes `STALE_BLOCKED`
10. two async callers execute job body once
11. pre-activation due slot is not backfilled
12. post-activation missing due slot is boot-recoverable
13. finance previous-day missing slot remains visible but is not auto-replayed with newer data
14. existing safe FAILED slot is boot-recoverable while training FAILED is not
15. stale safe slot is boot-recoverable and visible as STALE
16. stale unsafe training transitions to STALE_BLOCKED
17. runtime recovery catches MISSING/stale RUNNING without retrying FAILED rows
18. same-day finance recovery is allowed while cross-day finance recovery is blocked
19. payout retains latest-due catch-up across month boundaries
20. disabled jobs never recover and render DISABLED instead of MISSING
21. custom server and admin observability use the same canonical enablement owner
22. admin overview omits execution fencing tokens/result payloads
23. cron schedulers no longer use process-local running flags as execution owners
24. derived-cache keeps its existing item lease owner

## CHANGE BUDGET

### MUST FIX NOW

- durable job-slot identity
- atomic claim
- execution fencing
- heartbeat
- safe/unsafe stale policy
- latest-actually-due slot resolution across day/month/week boundaries
- job-specific catch-up policy (finance same-day only)
- post-activation boot recovery
- 5-minute runtime recovery wake for eligible MISSING/stale RUNNING slots
- canonical scheduler enablement owner
- admin read-only observability
- regression gate

### REQUIRED CLEANUP

- remove process-local running execution ownership
- centralize duplicated schedule definitions

### SAFE OPTIONAL

- compact completed-run retention policy after real history volume is observed

### SEPARATE FOLLOW-UP

- web-push item-level delivery claim/lease
- future Ops Inbox consumption of `FAILED / STALE_BLOCKED / MISSING`
- alerting policy after scheduler history exists

## STOP CONDITIONS

Stop rather than widen this PR if:

- a scheduler's side effects prove non-idempotent despite the policy above
- a destructive DB migration becomes necessary
- provider billing or payout semantics must change
- enabling currently-disabled payout/training would be required
- web-push or derived-cache would need to be redesigned in the same PR


## RAILWAY VOLUME / REPLICA LIMIT

Current Railway documentation, Volumes → Caveats:

> Replicas cannot be used with volumes.

The production chat-ai service mounts the persistent /data volume for SQLite and currently has one replica.

Therefore:

- this PR does **not** claim current Railway multi-replica capability
- the durable registry is authoritative for restart/crash/missed-slot recovery on the canonical SQLite DB
- it also supports multiple workers only when they share the same canonical database
- a future move to actual multi-replica Railway deployment requires a shared database/storage architecture review first
