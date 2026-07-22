# DeepSeek Deterministic Cohort Gating — Implementation Report

- Branch: `feat/deepseek-cohort-gating` (from `origin/main` @ `d7d337b`)
- Mode: routing/gating only — **architecture frozen**
- Production enable: **STILL FORBIDDEN** until separate approval
- Env/deploy: **NO changes made**

## Final verdict

**A. COHORT GATING READY FOR PR**

Allowlist layer is included (`CANON_INJECTION_DEEPSEEK_CANARY_USER_IDS`) for precise first-smoke targeting; recommended for Step 1 before percentage-only rollout, but not a blocker.

---

## 1. Current boolean gate exact path (pre-patch)

Before this patch, `resolveCanonInjectionPolicy(modelId)` in `src/lib/canonInjectionPolicy.ts`:

```
canaryActualInjection = deepSeekCanary && rolloutStage !== "D0"
```

With `CANON_INJECTION_DEEPSEEK_CANARY=1` + D1/D2, **100% of DeepSeek traffic** received actual injection — a global boolean gate, not a cohort gate.

Call site: `src/app/api/chat/route.ts` ~788 — policy resolved with model id only.

---

## 2. Stable cohort identity availability

**Available at call site:**

| Source | Field | Stable? |
|---|---|---|
| Authenticated user | `user.id` (route.ts ~774+) | Yes — primary |
| Chat session | `chat.id` | Yes — fallback |

No PII (email/name) used. Logs emit bucket/reason only, never raw user id.

---

## 3. User vs chat sticky decision

**USER-STICKY selected** (`cohortKey = user:${userId}`).

Fallback to `chat:${chatId}` only when `userId` is missing/invalid. Verified in tests: same user + different chats → identical bucket/eligibility.

---

## 4. Percentage implementation

New module: `src/lib/canonInjectionCohort.ts`

- SHA-256 hash of `namespace + cohortKey` → `readUInt32BE(0) % 10000` → bucket `0..9999`
- Namespace: `canon-injection-deepseek-v1` (stable salt)
- Eligibility: `bucket < floor(percent * 100)` (0.01% granularity)
- No `Math.random`, no request-time randomness
- Reuses existing Node `crypto` pattern (same family as `canonPlan/hash.ts`)

---

## 5. Env contract

| Variable | Role | Default |
|---|---|---|
| `CANON_INJECTION_DEEPSEEK_CANARY` | Master coarse switch (unchanged) | off |
| `CANON_INJECTION_DEEPSEEK_CANARY_PERCENT` | Deterministic cohort percent | **0** (unset → 0) |
| `CANON_INJECTION_DEEPSEEK_CANARY_USER_IDS` | Optional comma-separated user ids | unset |
| `CANON_INJECTION_ROLLOUT_STAGE` | Stage semantics (unchanged) | D0 |
| `CANON_INJECTION_ENABLED` | Master compile/shadow enable (unchanged) | off |
| `CANON_INJECTION_KILL_SWITCH` | Instant full legacy (unchanged) | off |

**Actual canary formula:**

```
actualCanary =
  isDeepSeek
  && masterCanaryEnabled
  && rolloutStage != D0
  && cohortEligible

cohortEligible =
  explicitAllowlisted
  OR percentBucketEligible
```

---

## 6. Invalid env fail-safe

`parseDeepSeekCanaryPercent()`:

- unset → 0
- invalid / NaN / negative / >100 → **0** (never auto-100%)
- 100 → 100
- 0 → 0

Safety matrix (verified in tests):

| CANARY | PERCENT | actual |
|---|---|---|
| off | 100 | 0% |
| on | 0 | 0% |
| on | unset | 0% |
| on | 5 | ~5% deterministic |
| on | 100 | 100% |

---

## 7. Optional allowlist adoption

**Adopted:** `CANON_INJECTION_DEEPSEEK_CANARY_USER_IDS` (comma-separated numeric user ids).

- Checked before percent bucket
- Allows Step 1 production smoke on exact test accounts without affecting other users
- Minimal env surface — no new admin subsystem

Recommendation: use allowlist for first production smoke, then switch to 1% → 5% → …

---

## 8. D0/D1/D2 semantics unchanged proof

Stage config in `resolveDeepSeekPolicy()` is **untouched**. Cohort gating only gates `canaryActualInjection`, `shadowOnly`, `actualCanonMode`, `actualArchiveMode`, and `injectionEnabled`.

| Stage | Eligible cohort | Actual behavior |
|---|---|---|
| D0 | n/a | actual OFF; shadow when master enabled |
| D1 | yes | FULL_LEGACY canon + SELECTIVE archive; ACTIVE/Momentum OFF |
| D2 | yes | LAYERED CORE+ACTIVE + AR-A3/B1/B2 + SELECTIVE + Momentum A+P2 |
| any | no | exact legacy payload (FULL_LEGACY + FULL_ALWAYS) |

Existing B2/D3 payload tests pass with `PERCENT=100` + test userId.

---

## 9. Non-canary exact legacy proof

Non-eligible DeepSeek on D1+:

- `canaryActualInjection=false`
- `actualCanonMode=FULL_LEGACY`, `actualArchiveMode=FULL_ALWAYS`
- `injectionEnabled=false` → **no lazy compile / shadow side effects**

CONTROL vs canary-OFF hash equality tests still pass (B2).

---

## 10. Kill switch proof

Priority: **KILL SWITCH > MASTER CANARY > PERCENT/COHORT > STAGE**

On kill switch:

- `forceFullLegacy=true`
- `canaryActualInjection=false`
- `injectionEnabled=false`
- `actualCanonMode=FULL_LEGACY`, `actualArchiveMode=FULL_ALWAYS`

D3 kill-switch payload test passes.

---

## 11. Other-model isolation

Muse/Gemini/HY3 paths unchanged — cohort fields default to `N/A` / false. No percent env affects non-DeepSeek models.

---

## 12. Deterministic tests (A–Q)

File: `src/lib/canonInjectionCohort.test.ts` + updated policy/B2/D3 tests.

| Case | Status |
|---|---|
| A master off + percent100 | pass |
| B master on + percent0 | pass |
| C master on + percent100 + D1 | pass |
| D master on + percent100 + D2 | pass |
| E master on + percent5 bucket | pass |
| F same user ×100 sticky | pass |
| G same user different chats | pass |
| H different users differ | pass |
| I invalid percent → 0 | pass |
| J Muse unchanged | pass |
| K Gemini unchanged | pass |
| L HY3 unchanged | pass |
| M kill switch | pass |
| N D0 actual off | pass |
| O non-eligible legacy | pass |
| P eligible D1 selective | pass (B2) |
| Q eligible D2 architecture | pass (D3) |

**0 API calls.**

---

## 13. Distribution sanity

Synthetic keys `synthetic:0..9999` at percents 1/5/25/50/100 — ratios within tolerance (±0.4% at 1%, ±2% otherwise). All pass.

---

## 14. Observability

`CanonShadowTurnRecord` extended (no PII):

- `masterCanaryEnabled`
- `canaryPercent`
- `cohortEligible`
- `cohortBucket` (numeric, optional null for allowlist)
- `cohortEligibilityReason`
- `canaryActualInjection`

Logged via `[canon-shadow-d0]` info — bucket only, no raw userId.

---

## 15. Changed files

| File | Change |
|---|---|
| `src/lib/canonInjectionCohort.ts` | **new** — percent parse, bucket, allowlist, eligibility |
| `src/lib/canonInjectionCohort.test.ts` | **new** — A–Q + distribution |
| `src/lib/canonInjectionPolicy.ts` | cohort gating + policy fields + injectionEnabled fix |
| `src/app/api/chat/route.ts` | pass `{ userId, chatId }` to resolver |
| `src/lib/canonPlan/shadowD0.ts` | cohort observability fields |
| `src/lib/canonInjectionPolicy.test.ts` | updated for cohort contract |
| `src/lib/canonPlan/canonInjectionB2.test.ts` | PERCENT=100 + test userId for canary ON |
| `src/lib/canonPlan/canonInjectionD3.test.ts` | same |
| `src/lib/canonPlan/canonInjectionB1.test.ts` | kill switch side-effect expectation |
| `src/lib/sceneMomentum/extractor.test.ts` | policy type fields |

---

## 16. Production source delta

Merge of this PR alone **does not activate canary**:

- `CANON_INJECTION_DEEPSEEK_CANARY_PERCENT` unset → 0% actual
- `CANON_INJECTION_DEEPSEEK_CANARY` unset → master off
- Even legacy `CANARY=1` without `PERCENT=100` → **0% actual** (backward-safe fix)

Default production behavior remains D0 / actual OFF / no compile overhead.

---

## 17. PR / commit plan

1. Commit on `feat/deepseek-cohort-gating` (cohort files only — no unrelated WIP)
2. Open PR targeting `main`
3. CI: `npm run typecheck:app` + targeted test suite (53 tests pass locally)
4. **Do not merge/deploy/change env** until separate human approval

Suggested PR title: `feat: DeepSeek deterministic cohort gating for canary rollout`

---

## 18. Deployment prerequisite checklist (ACTIVATION BLOCKERS)

Before any D1 enable in production, human must confirm:

**A.** Railway dashboard: deploy `d7d337b` (or later main containing cohort PR) = **SUCCESS**

**B.** Production env safe state:
- `CANON_INJECTION_DEEPSEEK_CANARY` = unset/off
- `CANON_INJECTION_DEEPSEEK_CANARY_PERCENT` = unset or `0`
- `CANON_INJECTION_ROLLOUT_STAGE` = unset or `D0`
- `CANON_INJECTION_ENABLED` = confirm current safe value

**C.** Production chat healthy (manual smoke)

---

## Suggested rollout after cohort PR merge (NOT EXECUTED)

| Step | Stage | Percent / allowlist |
|---|---|---|
| 0 | D0 | 0% — production smoke |
| 1 | D1 | 1% or explicit test allowlist |
| 2 | D1 | 5% |
| 3 | D1 | 25% |
| 4 | D1 | 100% |
| 5+ | D2 | 1% → 5% → 25% → 50% → 100% |

Adjust percentages if traffic volume makes 1% statistically meaningless.

---

## Rollback paths (priority order)

1. `CANON_INJECTION_KILL_SWITCH=1` — instant full legacy, no side effects
2. `CANON_INJECTION_DEEPSEEK_CANARY=0/unset` — master off → 0% actual
3. `CANON_INJECTION_DEEPSEEK_CANARY_PERCENT=0` — stop cohort without unsetting master

---

## Validation run

```
npm run typecheck:app          → pass
node --conditions=react-server --import tsx --test \
  src/lib/canonInjectionCohort.test.ts \
  src/lib/canonInjectionPolicy.test.ts \
  src/lib/canonPlan/canonInjectionB2.test.ts \
  src/lib/canonPlan/canonInjectionD3.test.ts
→ 53/53 pass, 0 API calls
```
