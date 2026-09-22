# Architecture / Tooling / Operations Investigation Report

**Classification:** `ARCHITECTURE_RESEARCH_COMPLETE`  
**Investigated main (baseline):** `f13ea612fc942418a0271f05db209b76ecc077c2`  
**Branch:** `cursor/architecture-ops-investigation-4604`  
**Date:** 2026-09-22 (UTC)  
**Scope:** Investigation only — no production behavior changes, no Jev/Reticle installation.

**Correction pass (2026-09-22):** Payout external-side-effect risk, subscription renewal demo-path finding, idempotency proof scope, follow-up priority, Reticle wording, LOCAL PROOF vs GitHub CI disclosure. **Production diff remains 0.**

---

## Executive Summary

This investigation treats **current main execution code** (`server.js` → `runBackgroundInitialization()`, API routes, lib owners) as source of truth — not README or historical PR text.

| Area | Finding | Classification |
|------|---------|----------------|
| **A. Runtime Verification Layer** | Playwright exists (4 UI specs) but mocks `/api/chat` SSE; no console/5xx/session canaries. Reticle/jev-ra **not in repo** — not recommended currently; no proven incremental value over extending Playwright (absence ≠ incompatibility). | `AUTOMATION_VALUE_CONFIRMED` (extend existing) |
| **B. Provider-neutral Decision Plane** | Bounded LLM decisions exist (comment moderation, post-turn shared initial, vision, TRPG referee). Memory ranking/dedupe is **deterministic** today. Shadow-only decision model could add value for moderation/memory **comparison** — not enforcement. | `VALUE_UNCONFIRMED` (needs shadow harness + call-frequency data) |
| **C. Operations Automation** | Single-process `node-cron` + `setInterval` schedulers run in production via `npm run start`. Strong idempotency on chat billing settlement and model-pricing tracker DB claim. **Payout has EXTERNAL SIDE EFFECT DUPLICATION RISK** under concurrent replicas (transfer before exclusive DB transition). Subscription renewal is a **demo/placeholder path** without payment-provider charge. No Ops Inbox surface. | `AUTOMATION_VALUE_CONFIRMED` (Ops Inbox + job observability — **after** financial exactly-once) |
| **D. Bounded dev-agent workflow** | Cursor subagent patterns (investigator/worker/reviewer) align with repo's existing split (explore vs implement). Project-local rules in `.cursor/rules/` and `AGENTS.md` already encode key constraints. No global Codex config change needed. | `AUTOMATION_VALUE_CONFIRMED` (documentation-only refinement) |

**Long-term target fit:** NORMAL → admin action 0; SAFE FAILURE → auto detect/recover; AMBIGUOUS → Ops Inbox; HIGH-RISK → human approval — **architecturally compatible** but **not yet implemented**. Largest gaps: **payout/subscription financial exactly-once**, unified exception surface, scheduler observability, runtime API/UI divergence detection.

---

## 0. Tooling Verification (Package vs Production Path)

| Tooling (package.json / deps) | Production entrypoint | Actually runs in prod? | Evidence |
|------------------------------|----------------------|------------------------|----------|
| `node-cron` | `src/cron/{finance,payout,training}Scheduler.ts` via `server.js:runBackgroundInitialization()` | **Yes** (when not disabled by env) | Cron registered after HTTP listen; logs `[*-scheduler] registered` |
| Playwright | `npm run test:ui` → `playwright.config.ts` | **CI/dev only** — not production runtime | `webServer: npm run prod` on port 3001 |
| `payout:run` script | `scripts/run-payout-once.ts` → `processPayoutQueue()` | **Manual**; same owner as cron | `src/lib/payoutQueue.ts` |
| `training:analyze` | `scripts/training-daily-analysis.ts` | **Manual**; same owner as cron | `src/lib/training/dailyAnalysis.ts` |
| `training:export` | `scripts/training-weekly-export.ts` | **Manual**; same owner as cron | `src/lib/training/weeklyExport.ts` |
| Railway `/health` | `railway.toml` → `healthcheckPath = "/health"` | **Yes** | `src/app/health/route.ts` returns `{ status: "ok" }` only |
| Railway on-failure restart | `railway.toml` → `restartPolicyType = "on_failure"` | **Yes** (platform) | No app code |
| Web push intervals | `src/lib/webPush.ts` → `startWebPushSchedulers()` | **Yes** (if VAPID configured) | `server.js:118-124` |
| Derived-cache worker | `src/lib/derivedCache/wakeupScheduler.ts` | **Yes** (unless disabled) | `server.js:147-155`; DB lease in `jobs.ts` |
| Subscription renewal | `POST /api/cron/subscription-renew` → `processDueRenewals()` | **Demo/placeholder** — extends `sub_until` + FREE points; **no billing-key / payment-provider charge in path** | Also called on `/points` and `/api/points/subscribe` — **DO NOT enable external cron until real recurring-payment owner confirmed** |
| Separate worker / queue infra | — | **No** | All jobs in single Next custom server process |

**Canonical scheduler:** `node-cron` in `server.js` boot path — **not assumed from dependency alone**; verified via `start*Scheduler()` calls post-listen.

---

## 1. CURRENT OWNER MAP

Legend: **M**=Manual, **A**=Automatic, **S**=Semi-automatic

### Provider health / timeout / retry

| RESPONSIBILITY | CANONICAL OWNER | TRIGGER | EXECUTION PATH | MODE | FAILURE VISIBILITY | RETRY OWNER | IDEMPOTENCY | AUDIT TRAIL | ADMIN ACTION | DUPLICATE OWNER | DEAD PATH |
|----------------|-----------------|---------|----------------|------|-------------------|-------------|-------------|-------------|--------------|-----------------|-----------|
| Main RP DeepSeek failover | `deepseekProviderFailover.ts` → `executeDeepSeekWithProviderFailover` | Per chat turn | OpenRouter fetch | A | Console telemetry `logDeepSeekFailoverTelemetry` | Same function (1 backup attempt) | Per-request | Telemetry logs | Rare | TRPG: `trpg/replySuggestions.ts` (separate stack) | — |
| Background flash failover | `deepseekProviderFailover.ts` → `executeDeepSeekBackgroundWithProviderFailover` | Post-turn helpers | Background LLM | A | Console | Max 2 attempts | Per-request | Telemetry | No | — | — |
| Deploy liveness | `src/app/health/route.ts` | Railway probe | HTTP GET `/health` | A | Railway restart | Platform | N/A | None | No | Rich metadata at `/api/health` (not probed) | — |
| Provider cost reconcile | `providerCostReconciliation.ts` → `reconcileCheaperInferenceUsage` | Daily finance cron + admin | Finance scheduler / admin API | A/S | Console + finance UI | Finance job | Snapshot upsert | `provider_cost_*` tables | Manual reconcile route | — | — |

### Billing / pricing / promotion

| RESPONSIBILITY | CANONICAL OWNER | TRIGGER | MODE | IDEMPOTENCY | ADMIN ACTION |
|----------------|-----------------|---------|------|-------------|--------------|
| Turn charge settlement | `chatBillingSettlement.ts` → `settleChatTurnBillingExactlyOnce` | Assistant finalize | A | **Yes** — idempotent key per turn | No |
| Final charge sync | `chatBillingFinalCharge.ts` | Post-settlement | A | Yes | No |
| Site promotion read | `sitePromotion.ts` → `resolveActiveSitePromotion` | Billing/UI read | A | Read-time expiry | No |
| Site promotion activation | `officialProviderPromotion.ts` → `createOfficialProviderPromotion` | Verified promo insert | S | Activation idempotent by campaign | **No HTTP admin route found** — lib/test/manual |
| Model pricing tracker | `modelPricingTracker.ts` → `runModelPricingTracker` | Finance cron 12:00 KST | A | **Yes** — `claimTrackerRun` DB lock | Review events in DB/admin |
| Daily finance snapshot | `adminFinance.ts` → `saveDailyFinanceSnapshot` | Finance cron | A | **Yes** — `ON CONFLICT(snapshot_date)` | Finance admin page |

### Notifications

| RESPONSIBILITY | CANONICAL OWNER | TRIGGER | MODE | FAILURE VISIBILITY |
|----------------|-----------------|---------|------|-------------------|
| In-app notifications | `userNotifications.ts` | Domain events | A | User feed |
| Web push delivery | `webPush.ts` → `flushWebPushOutbox` | 60s interval + request `after()` | A | Console; dead sub cleanup |
| Point expiry push | `webPush.ts` → `queueExpiringPointPushes` | Boot + 6h | A | Console |

### Moderation / comments / refunds

| RESPONSIBILITY | CANONICAL OWNER | TRIGGER | MODE | ADMIN ACTION |
|----------------|-----------------|---------|------|--------------|
| Banned words (deterministic) | `commentBannedWords.ts` | Comment submit | A | Manage words admin |
| AI comment verdict | `commentModeration.ts` → `moderateCommentWithAi` | Banned word + `ai_check=1` | A | Fail → BLOCK |
| Comment reports / blind | `commentReports.ts` | User reports | A/S | Admin queue |
| Character listing moderation | `characterModerationAdmin.ts` | Admin review | M | Admin UI |
| Report refund auto | `refund.ts` + `refundAutoValidation.ts` | User report | A | Over-limit → admin queue |
| Report refund review | `refund.ts` → `reviewReportRefund` | Admin | M | Admin UI |

### Payout / training / memory

| RESPONSIBILITY | CANONICAL OWNER | TRIGGER | MODE | OBSERVABILITY |
|----------------|-----------------|---------|------|---------------|
| Payout batch | `payoutQueue.ts` → `processPayoutQueue` → `processSingleWithdrawal` | Cron 15th 03:00 KST | A | Console JSON only; **EXTERNAL SIDE EFFECT DUPLICATION RISK** (see §5.1) |
| Daily training analysis | `training/dailyAnalysis.ts` | Cron 04:00 KST | A | `training_analysis_runs` table |
| Weekly training export | `training/weeklyExport.ts` | Cron Sun 05:00 KST | A | Console + filesystem export |
| Memory post-turn update | `memory-manager.ts` → `scheduleMemoryUpdate` | After chat turn | A | Health telemetry logs |
| Episodic retrieval/injection | `episodicMemoryFacts.ts` → `getEpisodicMemoryForPrompt` | Chat context build | A | Telemetry |

### Session / DB / cleanup

| RESPONSIBILITY | CANONICAL OWNER | TRIGGER | MODE | GAP |
|----------------|-----------------|---------|------|-----|
| Session auth | `auth.ts` → `createSession`, `getSessionUser` | Login | A | **No expired-session purge cron** |
| DB migrate/seed | `db.ts` → `initializeDatabase` | First access | A | — |
| Derived cache jobs | `derivedCache/jobs.ts` → `drainDerivedCacheJobs` | Wakeup scheduler | A | DB lease 15min stale recovery |
| Chat owned data cleanup | `chatOwnedDataCleanup.ts` | Chat delete | A | — |
| Subscription renewal | `subscription.ts` → `processDueRenewals` | Page visit / manual POST to cron route | S | **Demo path** — no PortOne/billing-key charge; grants FREE points; **not production-ready for external cron** |

---

## 2. ONE-PERSON OPERATIONS INVENTORY

| Task | Classification | Rationale |
|------|----------------|-----------|
| Daily finance snapshot | **DETERMINISTIC_AUTO** | Cron + idempotent DB upsert; admin need not trigger |
| Model pricing tracker | **AUTO_WITH_GUARDRAILS** | DB claim lock; margin floor breaches need human review |
| Payout batch | **HUMAN_APPROVAL_REQUIRED** (until exactly-once fix) | External transfer precedes exclusive DB transition; concurrent replicas can double-send |
| Promotion expiry enforcement | **DETERMINISTIC_AUTO** | Read-time `endsAt` check |
| Promotion activation | **HUMAN_APPROVAL_REQUIRED** | Official provider verification |
| Comment AI moderation | **SHADOW_DECISION** | LLM verdict active but conservative fallback; semantic ambiguity |
| Report refund over daily limit | **HUMAN_APPROVAL_REQUIRED** | Money |
| Character moderation queue | **HUMAN_APPROVAL_REQUIRED** | Listing approval |
| Comment report review | **HUMAN_APPROVAL_REQUIRED** | Destructive/blind actions |
| Provider outage detection | **OBSERVABILITY_ONLY** today | Failover logs exist; no aggregated alert |
| Provider cost anomaly | **OBSERVABILITY_ONLY** | Finance UI; no auto alert |
| Web push failure | **DETERMINISTIC_AUTO** (partial) | Dead sub cleanup; no admin alert on spike |
| Subscription renewal | **HUMAN_APPROVAL_REQUIRED** (until real payment owner) | Demo/placeholder — no provider charge; enabling external cron would grant free points without payment |
| Session expiry cleanup | **NOT_WORTH_AUTOMATING** alone | Low urgency; follow-up if DB bloat |
| Post-deploy critical flow | **AUTOMATION_CANDIDATE** | No canary; `/health` does not exercise chat |
| Memory regression | **OBSERVABILITY_ONLY** | Test suite exists; no runtime monitor |
| DB backup state | **HUMAN_APPROVAL_REQUIRED** | Railway volume; no in-app backup owner found |

---

## 3. OPS INBOX — Value Assessment (Design Only)

**Verdict:** High value for 1-person ops. Today admin must visit 12+ admin pages (`src/app/admin/*`) and Railway logs separately.

**Minimum viable Ops Inbox item schema (proposed):**

```typescript
type OpsInboxItem = {
  id: string;
  whatHappened: string;
  when: string; // ISO
  subsystem: string; // e.g. "payout", "finance", "moderation"
  status: "open" | "acknowledged" | "resolved";
  automaticActionsTaken: string[];
  evidence: { kind: "log" | "db_row" | "metric"; ref: string }[];
  suggestedAdminAction?: string;
  retryState?: { attempts: number; nextRetryAt?: string };
  canonicalOwner: string; // file::function
};
```

**Natural ingestion sources (reuse, do not duplicate telemetry):**

- `training_analysis_runs` (status, started_at)
- `model_pricing_tracker_runs` / `_attempts` (status, error_summary)
- `finance_daily_snapshots` (snapshot_date, updated_at)
- `withdrawal_requests` WHERE status IN ('PENDING','FAILED')
- `comment_reports` / admin moderation queues
- Scheduler console patterns (structured log migration follow-up)

**Not in this PR:** Implementation.

---

## 4. AUTOMATION SAFETY MODEL (Applied to Current System)

| Job | Current stage | Promotion path |
|-----|---------------|----------------|
| Finance snapshot | AUTO_SAFE | Already deterministic + idempotent |
| Model pricing tracker | AUTO_SAFE (observe) + HUMAN (margin breaches) | Events are HOLD — no auto price change |
| Payout | **BLOCKED for scale** until exactly-once | External `sendMoneyToUser` before `markApproved`; CP rollback not proven exactly-once on ambiguous provider outcomes |
| Comment AI block | SHADOW candidate | Today: production BLOCK on ambiguity — consider shadow compare before enforcement change |
| Memory episodic rank | DETERMINISTIC | Decision model → SHADOW only |
| Point grant / refund approve | HUMAN_APPROVAL | Must stay |

**Kill switches present:** `DISABLE_*_SCHEDULER`, `DISABLE_MODEL_PRICING_TRACKER`, `DISABLE_DERIVED_CACHE_WORKER`, `DISABLE_WEB_PUSH`, `MEMORY_FEATURE_ENABLED`, `MOCK_MODE`.

---

## 5. SCHEDULER / CRON AUDIT

### Registration map

| Job | Cron / interval | TZ | Boot registration | In-process lock | DB idempotency |
|-----|-----------------|----|--------------------|-----------------|----------------|
| Finance | `0 12 * * *` | Asia/Seoul | `startFinanceScheduler` | `running` boolean | Snapshot date UPSERT; tracker `claimTrackerRun` |
| Payout | `0 3 15 * *` | Asia/Seoul | `startPayoutScheduler` | `running` boolean | **Does NOT guarantee transfer exactly-once** — see §5.1 |
| Training daily | `0 4 * * *` | Asia/Seoul | `startTrainingScheduler` | `dailyRunning` | Fingerprint skip in `training-db.ts` |
| Training weekly | `0 5 * * 0` | Asia/Seoul | same | `weeklyRunning` | Append export files |
| Web push flush | 60s | — | `startWebPushSchedulers` | `deliveryRunning` | Outbox row state |
| Web push expiry scan | 6h | — | same | — | Dedup via notification ids |
| Derived cache | setTimeout wakeup | — | `startDerivedCacheWakeup` | drain coalesce | `locked_at` lease |
| Subscription renew | HTTP route only | — | **Not in server.js** | None in route | **Demo path — no payment charge** |

### 5.1 Payout — EXTERNAL SIDE EFFECT DUPLICATION RISK

**Verified execution path (`src/lib/payoutQueue.ts`):**

```
listPendingWithdrawals()          // SELECT … WHERE status='PENDING' (no claim)
  → processSingleWithdrawal(row)
    → sendMoneyToUser(...)        // EXTERNAL side effect FIRST (payoutGateway.ts — simulation today)
    → markApproved(… WHERE status='PENDING')   // exclusive DB transition AFTER transfer
```

**Critical finding:** The `WHERE status='PENDING'` update guards **DB row exclusivity**, not **external money transfer exactly-once**. If two processes/replicas read the same PENDING row concurrently, both can call `sendMoneyToUser()`; only one `markApproved()` succeeds — the other throws or leaves an orphan transfer.

**Additional ordering risks (single process too):**

- Provider success → crash before `markApproved` → row stays PENDING → retry may re-send.
- Provider timeout but transfer actually completed → ambiguous outcome; CP rollback path may not be exactly-once.

**Do not assume** a simple `PROCESSING` DB flag alone fixes this without provider-level idempotency/reconciliation.

**Payout BUGFIX follow-up must investigate:**

- Provider idempotency key support
- Provider transaction lookup / reconciliation API
- Send success → DB finalize crash recovery
- Provider timeout but transfer actually completed
- Stale `PROCESSING` recovery semantics
- Manual retry safety
- CP rollback exactly-once on ambiguous failures

**Current gateway note:** `payoutGateway.ts` header states simulation ("가상 구현"); risk is structural and applies when real PortOne/Toss integration replaces simulation.

### 5.2 Subscription renewal — demo/placeholder path

**Verified path (`src/lib/subscription.ts` → `processDueRenewals()`):**

- Queries users with `sub_auto_renew=1` and expired `sub_until`
- Extends `sub_until` by one month
- Calls `creditPoints(..., "FREE", …)` — **no PAID charge**
- Sends `notifyPaymentSuccess` notification
- **No billing-key token read, no PortOne/payment-provider charge call in this function**

**Subscribe route context (`src/app/api/points/subscribe/route.ts`):** Comment explicitly states "모의 결제 — 실서비스에서는 빌링키·정기결제 연동". Calls `processDueRenewals()` then `activateSubscription()` without payment capture.

> **DO NOT ENABLE EXTERNAL SUBSCRIPTION CRON** on `/api/cron/subscription-renew` until the real recurring-payment owner and exactly-once billing path are confirmed.

**Required follow-up before any external cron:**

- Actual recurring payment provider owner
- Billing key / token storage owner
- Charge-before-renew ordering
- Charge idempotency key
- Provider reconciliation on timeout/ambiguous success
- Payment failure behavior (grace period, dunning)
- Point grant exactly-once (dedupe by billing event id)
- Notification timing relative to confirmed payment

**Opportunistic callers today:** `src/app/points/page.tsx`, `src/app/api/points/subscribe/route.ts` — side effect is free renewal/grant, not missed-schedule compensation for real billing.

### 5.3 Multi-replica / Railway risks (non-payout)

- **In-process mutex:** Finance/training `running` flags prevent overlap **within one process only** — duplicate cron triggers if N replicas.
- **Derived cache worker:** DB lease — structurally safer for multi-replica.
- **Model pricing tracker:** DB claim via `claimTrackerRun` — multi-replica safe for daily claim.
- **Deploy/restart:** Cron re-registers on boot; missed schedules **not backfilled**.
- **Payout:** See §5.1 — **EXTERNAL SIDE EFFECT DUPLICATION RISK** (distinct from cron duplicate alone).

---

## 6. RUNTIME VERIFICATION FINDING

### Existing stack

- **Playwright:** 4 specs under `tests/ui/`; production mode on port 3001; isolated `PLAYWRIGHT_DATA_DIR`.
- **Strengths:** Scroll-follow UX, layout, asset display, settings flush rollback (partial stale-state).
- **Weaknesses:** Chat SSE **mocked** (`buildMockChatSseBody` in `chat-live-follow.spec.ts`); **zero** `page.on('console')` handlers; no session reload tests; no background API 5xx assertions.

### Gap matrix

| Scenario | Unit/runtime tests | Playwright E2E |
|----------|-------------------|----------------|
| API 500 while UI OK | Partial (billing/stream unit) | **Gap** |
| Silent console error | — | **Gap** |
| Stale client state | Partial (settings rollback) | **Gap** (navigation) |
| Route transition failure | — | **Gap** |
| Streaming/final divergence | `chatStreamEofReconcile.test.ts` | **Gap** (mocked SSE) |
| Login/session persistence | — | **Gap** |
| Status widget lifecycle | Call graph tests | **Gap** |

### Reticle / jev-ra

- **Not present in repository.** No production bundle contamination risk from this investigation.
- **Assessment:** Not recommended currently; no proven incremental value over extending existing Playwright. **Absence from repo is not an incompatibility proof** — current investigation did not demonstrate Reticle would add value beyond Playwright + existing unit/route canaries.
- **Recommendation:** Extend existing Playwright — add global `console` + `response` listeners and one **unmocked** canary using `MOCK_MODE` + fixture user. Do **not** add parallel browser automation framework.

### Safe proof executed (LOCAL PROOF only — see §20)

---

## 7. DECISION PLANE CANDIDATES

(Excludes Main RP generation and user-selected Main RP model.)

| Candidate | Current owner | Model | Frequency | Failure impact | Deterministic replaceable? | Shadow candidate? |
|-----------|---------------|-------|-----------|----------------|---------------------------|-------------------|
| Comment ALLOW/BLOCK | `commentModeration.ts` | Gemini 3.1 Flash | Per flagged comment | Wrong block/allow | Partial (banned words only) | **Yes** |
| TRPG mechanics referee | `trpg/mechanicsReferee.ts` | DeepSeek V4 Flash | Per mechanics call | Wrong rule application | Partial | Yes |
| Asset vision classify | `vision.ts` | Qwen vision | Per upload | Wrong tags/moderation flags | Partial (hard reject rules) | Yes |
| Status widget extract | `statusWidget/extract.ts` | Luna (background) | Per turn (if enabled) | Widget stale/wrong | No (generation) | No |
| Post-turn shared initial | `postTurnSharedInitial/run.ts` | Luna | Per eligible turn | Multi-consumer impact | No | Partial (episodic section only) |
| Episodic fact extract | Via shared initial | Luna | Per turn | Memory pollution | Partial | **Yes** (shadow relevance only) |
| Appearance compile | `appearanceCompiler.ts` | DeepSeek Flash | On compile | Missing appearance | Skip on fail | Low priority |

---

## 8. DECISION PLANE ROLE BOUNDARY

| Plane | Current examples | Must remain |
|-------|------------------|-------------|
| **GENERATION** | Main RP, rolling summary, suggested replies prose, TRPG GM | User-selected Main RP owner unchanged |
| **DECISION** | Comment verdict, mechanics referee, vision flags | Shadow-first for new models |
| **DETERMINISTIC** | Billing settlement, points, permissions, adult verification, episodic lane merge/rank/dedupe, promotion expiry | Decision model must **not** own pricing/points/security |

**Architecture fit:** Clean separation already partially exists. Risk: post-turn shared initial **bundles** decision-like episodic extraction with generative widget — splitting would reduce blast radius but increase latency/cost (tradeoff).

---

## 9. MEMORY FINDING

### Production dataflow (canonical)

```
POST /api/chat/route.ts
  → runPostTurnSharedInitial (episodic section) OR relationship-only path
  → scheduleMemoryUpdate (memory-manager.ts)
  → reconcileSharedEpisodicFactsForTurn (memory-episodic-shared.ts)
  → persistEpisodicMemoryFactsBestEffort (episodicMemoryFacts.ts)

Context build:
  getEpisodicMemoryForPrompt
    → fetchEpisodicMemoryCandidateRows (lanes: recent, relevance, milestone)
    → mergeEpisodicCandidateLanes
    → evaluateEpisodicRetrievalGuard
    → resolveLatestFactsByLogicalKey / dedupe
    → compareFactsForPrompt (rank)
    → budget cap → prompt block
```

### Legacy / dead path

- `memory-episodic-extract.ts` → `extractAndPersistEpisodicFactsForSealedBatch` — **no production caller in src/**; tests only.

### Decision model integration rule

- **Reject** dual memory owners. Shadow compare on **same candidate set** only; production selector unchanged.
- Decision model must **not** DROP: critical facts, relationship milestones, canonical relationship state, reset boundaries, latest authoritative state.

---

## 10. MODERATION FINDING

| Layer | Owner | Type |
|-------|-------|------|
| Account/age/point eligibility | `profileComments.ts`, policies | Deterministic |
| Banned words | `commentBannedWords.ts` | Deterministic |
| Semantic insult/harassment | `commentModeration.ts` | LLM (production active on ai_check hits) |
| Report threshold blind | `commentReports.ts` | Deterministic count |
| Asset vision | `vision.ts` + `characterListingModeration.ts` | LLM + deterministic rules |
| Admin review | `adminCommentReports.ts`, `characterModerationAdmin.ts` | Human |

**Shadow feasibility:** Synthetic/redacted fixtures sufficient. **Do not** enable auto-block/delete changes in this PR.

---

## 11. HELPER MODEL ROUTING FINDING

- **Central background model:** `BACKGROUND_OPENROUTER_MODEL` → Luna (`src/lib/ai.ts`).
- **Failover:** DeepSeek CI → Gemini via `executeDeepSeekBackgroundWithProviderFailover` (max 2 attempts).
- **Coalescing win:** `runPostTurnSharedInitial` — one call serves widget + relationship + episodic + suggestions.

| Helper | Decision vs generation | Cheap-then-large candidate? | Cost evidence |
|--------|------------------------|----------------------------|---------------|
| Post-turn shared initial | Mixed | Possible split | **VALUE_UNCONFIRMED** — no production call-frequency dashboard |
| Comment moderation | Decision | Already small model | Low volume assumed |
| Rolling summary | Generation | No | — |
| Suggested replies | Generation | No | — |

**Main RP auto-routing:** Explicitly out of scope.

---

## 12. LOCAL DECISION MODEL (JevBERT / typed-decision-bert)

- **Not a production dependency candidate** at this stage.
- Useful concepts to borrow: typed decision contract, bounded output enum, model-independent validation, health/readiness separation.
- GPU / separate inference deployment → **SEPARATE FOLLOW-UP**.

---

## 13. PRIVACY BOUNDARY

If external Decision provider added (shadow only):

| Data class | Could be sent in shadow? | Notes |
|------------|-------------------------|-------|
| Raw RP | **No** (production) | Synthetic fixtures only |
| NSFW content | **No** | Redacted fixtures |
| Character prompt | Partial (redacted) | Shadow harness |
| User/episodic memory | **No** | Candidate text only, redacted |
| Account identifiers | **No** | — |
| Credentials/secrets | **Never** | — |

---

## 14. DEVELOPMENT AGENT WORKFLOW

| Principle | Current state | Value |
|-----------|---------------|-------|
| Read-only investigator | Cursor `explore` subagent | **Confirmed** — use for owner maps |
| Implementation worker | Primary agent | **Confirmed** |
| Independent reviewer | `bugbot`, `security-review` subagents | **Confirmed** on demand |
| Parallel independent tasks | Task tool | **Confirmed** — used in this investigation |
| Sequential dependent tasks | Default agent flow | **Confirmed** |
| Same-file multi-writer | Not enforced by tooling | **Risk** — branch discipline required |

**No global Codex/Cursor config changes.** Optional: extend `AGENTS.md` with ops-investigation checklist (follow-up).

---

## 15. OPS AUTOMATION CANDIDATE MAP

| Candidate | Classification |
|-----------|----------------|
| Provider outage detection | OBSERVABILITY_ONLY → AUTOMATION_CANDIDATE (alert) |
| Provider latency anomaly | OBSERVABILITY_ONLY |
| Provider error spike | OBSERVABILITY_ONLY |
| Cost anomaly | OBSERVABILITY_ONLY |
| Billing drift | OBSERVABILITY_ONLY (canary tests exist) |
| Price source update | ALREADY_AUTOMATED (tracker) + HUMAN for margin breaches |
| Promotion expiration | ALREADY_AUTOMATED (read-time) |
| Stale promotion visibility | ALREADY_AUTOMATED |
| Notification failure | OBSERVABILITY_ONLY |
| Web push failure | PARTIALLY AUTOMATED (dead sub cleanup) |
| Payout failure | OBSERVABILITY_ONLY (admin payout page) |
| Refund anomaly | HUMAN_APPROVAL_REQUIRED |
| Moderation queue | HUMAN_APPROVAL_REQUIRED |
| DB health | OBSERVABILITY_ONLY (`/api/health` metadata) |
| Session persistence | OBSERVABILITY_ONLY |
| Backup state | HUMAN_APPROVAL_REQUIRED |
| Dead/stale records | AUTOMATION_CANDIDATE (session purge) |
| Scheduled cleanup | ALREADY_AUTOMATED (derived cache, orphan messages) |
| Memory regression | OBSERVABILITY_ONLY (tests) |
| Post-deploy health | OBSERVABILITY_ONLY (`/health` shallow) |
| Critical user-flow canary | AUTOMATION_CANDIDATE (Playwright extension) |

---

## 16. AUTO-REMEDIATION LIMITS

| Detect | Auto-remediate? |
|--------|-----------------|
| Provider health failure | Detect yes; contract/price change **no** |
| Stale derived cache | **Yes** (lease + retry) |
| Expired promotion UI state | **Yes** (read-time null) |
| DB destructive deletion | **No** |
| Ambiguous moderation | Shadow / human |
| Money/points/security/adult | Deterministic / human |

---

## 17. OBSERVABILITY GAPS

| Job | last run | last success | last failure | next expected | Gap |
|-----|----------|--------------|--------------|---------------|-----|
| Finance snapshot | `finance_daily_snapshots.updated_at` | Same | Console only | 12:00 KST daily | No admin widget |
| Model pricing tracker | `model_pricing_tracker_attempts` | DB | DB `error_summary` | With finance | **Good** |
| Payout | Console logs | Console | Console | 15th 03:00 KST | **No DB run table** |
| Training daily | `training_analysis_runs` | DB | DB status | 04:00 KST | Partial |
| Training weekly | Console + filesystem | Console | Console | Sun 05:00 KST | **No DB run table** |
| Web push | None persisted | — | Console | 60s | **Gap** |
| Subscription renew | None | — | — | N/A (demo path) | **No real billing run record**; external cron **must not** be enabled yet |

**Principle:** Automation without durable success/failure record = **not complete**.

---

## 18. DEAD / DUPLICATE SYSTEM

| Item | Classification | Evidence |
|------|----------------|----------|
| `extractAndPersistEpisodicFactsForSealedBatch` | **KEEP** (test/legacy API) | No src caller; tests depend |
| Duplicate scheduler scripts (`scripts/run-payout-once.ts` etc.) | **KEEP** | Intentional manual entry to same lib owner |
| `/health` vs `/api/health` | **KEEP** | Railway uses minimal `/health`; rich probe separate |
| Subscription renew on page load | **FOLLOW-UP** | Opportunistic demo renewal — not a substitute for real billing cron |
| TRPG vs main failover stacks | **KEEP** | Document as split owners |
| Reticle/jev-ra | **N/A** | Not in repo; not evaluated as production dependency |

---

## 19. REGRESSION RISKS (Simulation Analysis)

| Scenario | Current behavior | Risk |
|----------|------------------|------|
| Normal run | Jobs fire on schedule | Low |
| Server restart | Cron re-registers; no backfill | Missed window if down at cron time |
| Redeploy | Same | Medium for payout/finance |
| Process crash mid-payout | `sendMoneyToUser` may succeed; row stays PENDING | **EXTERNAL SIDE EFFECT DUPLICATION RISK** on retry |
| Provider timeout | Failover / user error | Low for UX |
| DB failure | Jobs log error, continue where best-effort | Medium |
| Double execution (2 replicas) | Payout: duplicate **external transfer** possible; finance/training: duplicate cron work | **Critical (payout)** if scaled |
| Concurrent execution (same process) | Skipped via mutex | Low |
| Stale derived cache lock | 15min stale reclaim | Low |
| Feature flag OFF | Schedulers respect DISABLE_* | Low |
| Billing double event | `settleChatTurnBillingExactlyOnce` | **Low** — tested |

---

## 20. SAFE FEASIBILITY PROOFS

### LOCAL PROOF vs GitHub CI

| Environment | Status |
|-------------|--------|
| **GitHub Actions CI on PR #1002 branch** | **No workflow runs reported** on `cursor/architecture-ops-investigation-4604` at correction-pass time (`gh pr checks` → "no checks reported"). **Do not describe CI as green.** |
| **Local Cursor VM execution** | Proofs below executed locally during investigation/correction pass |

### LOCAL PROOF (executed)

| Proof | Scope | Command | Local result |
|-------|-------|---------|--------------|
| **Model pricing tracker claim/reclaim idempotency** | `claimTrackerRun` + `finishTrackerRun` only — **NOT** finance/payout/training schedulers | `npx tsx scripts/audit/model-pricing-tracker-claim-reclaim-idempotency-proof.ts` | LOCAL PASS — duplicate day `SKIPPED_DUPLICATE`; failed day reclaimed |
| Model pricing tracker unit tests | Tracker persistence + classifier integration | `node --conditions=react-server --import tsx --test src/lib/modelPricingTracker.test.ts` | LOCAL PASS — 70 tests |
| Chat billing settlement unit tests | Turn billing idempotency (separate from payout) | `node --conditions=react-server --import tsx --test src/lib/chatBillingSettlement.test.ts` | LOCAL PASS |
| Runtime verification inventory | Read-only Playwright gap scan | `npx tsx scripts/audit/runtime-verification-inventory.ts` | LOCAL PASS — 4 specs; gaps listed |
| App typecheck | Static validation | `npm run typecheck:app` | LOCAL PASS |

### Not executed (do not report as PASS)

- Full Playwright suite (`npm run test:ui`) — not run in correction pass
- GitHub Actions workflows — no runs on this PR branch
- Production shadow decision; Reticle evaluation
- Payout/subscription exactly-once integration tests — **out of scope for audit PR**

---

## 21. CHANGE BUDGET COMPLIANCE

| Category | Delivered |
|----------|-----------|
| MUST DO NOW | Owner map, ops inventory, scheduler audit, runtime gaps, decision candidates, automation map, regression analysis |
| SAFE PROOF | Model-pricing-tracker claim/reclaim proof script + inventory script + selected local unit tests |
| SEPARATE FOLLOW-UP | Payout exactly-once BUGFIX, subscription real billing owner, Ops Inbox, Playwright canaries, shadow moderation/memory |

---

## SYSTEM DELTA

### BEFORE

- Implicit knowledge of schedulers in `server.js` without consolidated ops map.
- No single document tying admin pages to canonical owners.
- Runtime verification gaps undocumented.

### PROBLEM (structural, 1-person ops friction)

1. **Payout EXTERNAL SIDE EFFECT DUPLICATION RISK** — transfer before exclusive DB finalize; not fixed by cron mutex alone.
2. **Subscription renewal is demo/placeholder** — free points without payment-provider charge; external cron must not be enabled.
3. **No Ops Inbox** — admin polls finance, payout, moderation, refunds, logs separately.
4. **Shallow health check** — `/health` does not detect chat/API failures.
5. **Scheduler observability split** — only pricing tracker + training have durable run records.
6. **Runtime tests mock chat** — production SSE/500 divergence undetected in CI.

### AFTER (this PR + correction pass)

- Added investigation report (this document) with corrected payout/subscription/idempotency/proof findings.
- Added read-only proof scripts under `scripts/audit/`.
- **No production behavior change. Production diff = 0** (docs + audit scripts only).

### REMOVED

- Nothing from production. Renamed audit proof script for accurate scope.

### PRESERVED

- All schedulers, billing, memory, moderation production paths unchanged.

### PROOF

- `git diff main...HEAD` — docs and `scripts/audit/` only; no `src/` production changes.
- Local proofs documented in §20; **GitHub CI not run on PR branch**.

---

## FOLLOW-UP OPTIONS (Revised priority)

### P0 — FINANCIAL SAFETY

1. **Payout external-side-effect exactly-once investigation/fix** — provider idempotency, claim-before-send ordering, reconciliation, stale PROCESSING, CP rollback exactly-once. Do not assume PROCESSING flag alone suffices.
2. **Subscription recurring-payment owner investigation** — billing key owner, charge-before-renew, idempotency, reconciliation, failure behavior, point-grant exactly-once. **Do not enable external cron until complete.**

### P1 — RUNTIME / OPERATIONS SAFETY

3. **Durable scheduler run registry / observability** — generalize `model_pricing_tracker_runs` pattern to payout/finance/training.
4. **Playwright runtime canary** — console/5xx listeners + one unmocked flow.

### P2 — ONE-PERSON OPERATIONS UX

5. **Ops Inbox MVP** — high long-term value; implement **after** P0 financial exactly-once paths are understood/fixed.

### P3 — EXPERIMENTAL DECISION PLANE

6. **Shadow moderation harness** — fixture-only.
7. **Shadow episodic relevance harness** — same candidate set; no production DROP authority.

---

## Final Classification

**`ARCHITECTURE_RESEARCH_COMPLETE`**

Correction pass confirms **production behavior unchanged**.

Sub-area notes:

- Runtime verification extension: `AUTOMATION_VALUE_CONFIRMED`
- Ops Inbox + job observability: `AUTOMATION_VALUE_CONFIRMED` (priority **after** P0 financial safety)
- Decision plane (Jev/shadow): `VALUE_UNCONFIRMED` until shadow metrics
- typed-decision-bert production: `NOT_COMPATIBLE` at current stage (GPU/inference deployment required)
- Reticle: **Not recommended currently** — no proven incremental value over extending existing Playwright; absence from repo is not an incompatibility proof (`VALUE_UNCONFIRMED` for incremental benefit)
