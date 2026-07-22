# Production First-Smoke Runbook — DeepSeek Cohort Canary

**Status:** PROCEDURE ONLY — do not execute env changes until PR #94 is merged and activation checklist is approved.

## Prerequisites (all must pass first)

1. Railway deploy SUCCESS for revision containing cohort gating + master-flag safety patch
2. Production env baseline confirmed safe (CANARY off, PERCENT unset/0, STAGE D0)
3. Production base chat smoke healthy (no canary env)
4. PR #94 merged (separate approval)

---

## 1. Admin allowlist first (not percentage)

First production actual canary = **one admin test account, allowlist-only**.

Use stable DB **`user.id`** only. Never email, nickname, or display name.

### Target env concept (set only after merge + approval)

```
CANON_INJECTION_ENABLED=1
CANON_INJECTION_DEEPSEEK_CANARY=1
CANON_INJECTION_DEEPSEEK_CANARY_PERCENT=0
CANON_INJECTION_DEEPSEEK_CANARY_USER_IDS=<ADMIN_USER_ID>
CANON_ARCHIVE_DEEPSEEK_SELECTIVE=1
CANON_INJECTION_ROLLOUT_STAGE=D1   # first; D2 only after D1 PASS
```

`PERCENT=0` must stay until allowlist D1 + D2 both pass.

---

## 2. Admin user ID confirmation

Before setting `USER_IDS`, confirm the admin account's numeric `user.id`.

**Safe methods (no new permanent debug endpoints):**

| Method | How |
|---|---|
| Authenticated `/api/auth/me` | Logged-in browser → DevTools Network → GET response includes `user.id` |
| Existing admin tooling | Railway shell / SQLite read on `users` where `is_admin=1` |
| Server-side session | `getSessionUser()` already resolves stable id at request time |

**Do not:**

- Add permanent routes that log raw user ids
- Put user ids in application info logs
- Use email/nickname for allowlist env

Record the confirmed numeric id only in Railway env (`CANON_INJECTION_DEEPSEEK_CANARY_USER_IDS`).

---

## 3. D1 admin smoke

**Env:** STAGE=D1, PERCENT=0, ALLOWLIST=`<ADMIN_USER_ID>`

**Expected for admin account only:**

- FULL_LEGACY canon
- D1.1 SELECTIVE archive
- ACTIVE OFF
- Momentum OFF

**Manual scenes (admin account, 2–3 existing characters, 1–2 turns each):**

| Case | Goal |
|---|---|
| A. Past continuity | Required relationship/event memory retained |
| B. Quiet unrelated | Irrelevant past archive does not resurface |
| C. Long existing chat | Stability in an ongoing thread |

**Check:** no 500/streaming errors, no obvious latency spike, no fallback banners.

No large quality benchmark re-run.

---

## 4. Non-allowlist control (if available)

Same production instance, second non-allowlisted test account:

| Account | Expected |
|---|---|
| Admin (allowlisted) | D1 actual |
| Control (not in USER_IDS) | Exact legacy |

Validates mixed-cohort isolation on one instance.

If no control account exists, skip — do not build new test-account infrastructure.

---

## 5. D2 admin smoke (only after D1 PASS)

Change only:

```
CANON_INJECTION_ROLLOUT_STAGE=D2
```

Keep `PERCENT=0` and `USER_IDS=<ADMIN_USER_ID>`.

**Expected for admin only:**

- CORE + ACTIVE layered canon
- AR-A3 / B1 / B2
- Selective archive
- Momentum Candidate A + P2

---

## 6. D2 admin manual scenes (minimum 4, 1–2 turns each)

| Scene | What to verify |
|---|---|
| A. Cold-start relationship | Short input; depth maintained; Momentum ON |
| B. Active world cue | Indirect cue; relevant canon used; no lore ladder |
| C. Mature existing chat | Multi-turn thread; Momentum OFF; continuity stable |
| D. Quiet scene | ACTIVE=0 acceptable; no unrelated factions/goals |

Do not re-run full D3 matrix in production.

---

## 7. Admin manual quality checklist

Reader judgment only:

- Character voice preserved
- Stays on current cue
- Relationship/emotional depth
- Meaningful progression
- World lore only when needed
- No unrelated setting explosion
- No sudden shortening
- No repetition / godmodding

Natural 2300–2500 char deep scenes = PASS. Sub-2700 is not auto-fail.

---

## 8. Observability cross-check (per turn)

From `[canon-shadow-d0]` / structured metadata (no raw canon/history/user text):

- `canaryActualInjection`, `rolloutStage`
- `cohortEligible`, `cohortEligibilityReason`
- `actualCanonMode`, `actualArchiveMode`
- ACTIVE selected count/chars
- Archive selected count/chars
- Momentum active/reason (if logged)
- Fallback flags
- Token/cost/latency signals

Never log admin raw user id in application logs.

---

## 9. Hard stop — rollback immediately

Stop and set `CANON_INJECTION_DEEPSEEK_CANARY=0` or kill switch if:

- Admin account `cohortEligible=false` when allowlisted
- Non-allowlisted account gets actual canary
- 500 / DB / schema errors
- Repeated fallback
- Knowledge leak / dormant lore ladder
- Severe shortening
- Momentum mature-ON regression
- Cache/cost/latency anomaly
- Status/regenerate/streaming regression

**Do not proceed to percentage rollout.**

---

## 10. Percentage rollout (after allowlist D1 + D2 PASS)

Only after admin allowlist smoke passes on both stages:

1. Optionally keep or remove allowlist
2. Start `PERCENT=1` or `5%` (adjust for traffic volume)
3. Ramp: 5% → 25% → 50% → 100% per stage stability

Low DeepSeek traffic may make 1% statistically meaningless — 5% may be first meaningful step.

**First actual production exposure must remain admin allowlist-only until both D1 and D2 allowlist smokes pass.**

---

## Safety priority (reference)

```
KILL SWITCH
> CANON_INJECTION_ENABLED
> CANON_INJECTION_DEEPSEEK_CANARY
> COHORT / PERCENT / ALLOWLIST
> ROLLOUT STAGE actual mode
```
