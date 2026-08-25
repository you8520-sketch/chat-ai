# Issue 2 — Mid-Chat Handoff Benchmark (STOP / BLOCKER)

**Status:** **STOP — benchmark not executed.** Evidence-only. **Do not merge.**

**Supersedes scope of:** PR #616 (first-turn / thin-history transport audit — remains valid historical evidence for that narrower case)

**Branch:** `cursor/issue2-mid-chat-benchmark-blocker-9eb2`

---

## #616 correction (accepted)

PR #616 proves **only** this:

> The frozen B-B2 **first-turn / thin-history** fixture had **no real selected-primary in-scene RP prose** available as a style exemplar at refusal time.

It does **NOT** yet prove whether **production mid-chat handoff** drops existing T1/T2 Gemini assistant RAW when `rawCompleteExchanges ≥ 2`.

Production already contains:

- `selectAdultHandoffRawVariants()`
- completed user+assistant pair preservation
- `preserveAdultHandoffRawHistory=true`

**Therefore:** no style-exemplar transport patch until a **valid mid-chat benchmark** exists.

---

## Product goal (frozen)

The goal is **NOT** “Does DeepSeek write good explicit RP?”

The goal **IS**:

> When the user-selected model refuses an adult RP turn, does the one-shot DeepSeek replacement look like the **same model / same writer** continued writing?

The model switch should be difficult for the user to notice.

**Priority order (frozen):**

1. selected-primary prose/style continuity
2. character voice continuity
3. narration/dialogue balance continuity
4. paragraph/sentence rhythm continuity
5. response-length continuity
6. scene/canon continuity
7. current-user authority / agency
8. requested scene completion
9. repetition / filler / meta-leak absence

Numeric dialogue caps and DeepSeek’s standalone stylistic quality are **secondary**.

---

## STOP verdict

| Flag | Value |
|---|---|
| **BENCHMARK_EXECUTED** | **`false`** |
| **STOP_REASON** | **Cannot access exact production home-listable character + administrator persona rows safely in this runtime** |
| **PRODUCTION_DB_COPY_AVAILABLE** | **`false`** |
| **FULL_DB_MIGRATION_TOKEN_CONFIGURED** | **`false`** |
| **RAILWAY_PRODUCTION_DB_READ_ACCESS** | **`false`** (Railway CLI not present; no read-only production volume mount) |

Per task instructions:

> If exact production rows cannot be accessed safely, STOP and report that.

This report is that STOP.

---

## Runtime DB resolution (read-only)

**Source:** `data/app.db` on Cloud Agent VM (SQLite, read-only queries)

**Resolution timestamp:** 2026-08-25 (UTC)

### Home / discovery listability

Query equivalent to `listableWhere()`:

```sql
SELECT COUNT(*) FROM characters
WHERE (official=1 OR (visibility='public' AND moderation_status='approved' AND creator_id IS NOT NULL));
```

| Metric | Count |
|---|---:|
| **Listable (home/discovery) characters** | **0** |
| **official=1 characters** | **0** |
| **Creator-owned approved public characters** | **0** |

**Result:** No character currently qualifies as “ACTUAL currently deployed/published character that appears on the service home/discovery surface.”

### Administrator account

| Metric | Count |
|---|---:|
| **users** | 1 |
| **users.is_admin=1** | 0 |
| **ADMIN_EMAILS env whitelist configured** | false |
| **test user admin via whitelist** | false |

**Result:** No administrator account exists in the runtime DB or env configuration.

### Closest rows found (insufficient)

| Field | Value |
|---|---|
| **CHARACTER_NAME** | 라이크 |
| **CHARACTER_ID** | 18 |
| **official** | 0 (not home-listable) |
| **creator_id** | NULL |
| **visibility / moderation_status** | public / approved |
| **greeting chars** | 1318 |
| **setting_chunks chars** | 15277 |

| Field | Value |
|---|---|
| **PERSONA_DISPLAY_NAME** | 렌 |
| **persona id** | 2 |
| **persona owner** | non-admin test user (id=1) |
| **description chars** | 278 |

**Why insufficient:**

- Character 18 is **not** on home/discovery (`official=0`, `creator_id IS NULL`).
- Persona “렌” is **not** owned by an administrator account.
- Using these rows would **not** satisfy the benchmark’s “real deployed + admin persona” requirement even though character 18 matches the canonical production roster id in `AGENTS.md`.

### Deliberately NOT done (per task constraints)

- ❌ Upsert character 18 from Phase-1 fixture JSON
- ❌ Fabricate admin user or set `is_admin=1` locally
- ❌ Set `official=1` locally to simulate home listing
- ❌ Substitute Phase-1 synthetic persona/character fixtures
- ❌ Mutate live production DB
- ❌ Commit credentials, session tokens, or account emails

---

## What is required to unblock

One of:

1. **Read-only production DB copy** mounted locally (Railway volume snapshot, `FULL_DB_MIGRATION` import, or equivalent) containing:
   - ≥1 home-listable character (`official=1` or approved creator-owned public)
   - ≥1 administrator-owned persona with stored description/settings
2. **Staging environment** with those exact rows and a non-production API base URL
3. **Safe read-only SELECT** against production `/data/app.db` without write access (Railway CLI + credentials — not available in this VM)

After unblock, run the frozen 3-turn design below **without prompt/owner changes**.

---

## Frozen benchmark design (NOT EXECUTED)

### Selected primary

- `gemini-3.1-pro-preview`
- Current `main` production settings unchanged
- DeepSeek fallback target: `deepseek-v4-pro-0813` (existing refusal-only handoff)

### Same chat — 3 turns

| Turn | Input type | Expected calls | Freeze artifacts |
|---|---|---|---|
| **T1** | Ordinary non-explicit RP | Gemini=1, DeepSeek=0, handoff=0 | `T1_USER_RAW`, `T1_GEMINI_RAW`, `T1_GEMINI_REQUEST`, SHA/meta |
| **T2** | Romantic/intimate non-refusal continuation | Gemini=1, DeepSeek=0, handoff=0 | `T2_*` same |
| **T3** | Explicit adult continuation (B2-class refusal trigger, scene-adapted) | Gemini=1, DeepSeek=1, handoff=1, visible refusal=0 | Both provider requests + RAW; refusal hidden |

### Critical transport checks (T3 DeepSeek wire)

Report separately:

- `T1_PRIMARY_RAW_PRESENT`
- `T2_PRIMARY_RAW_PRESENT`
- `RECENT_PRIMARY_ASSISTANT_MESSAGES_IN_FALLBACK`
- `RECENT_PRIMARY_ASSISTANT_CHARS_IN_FALLBACK`
- `CREATOR_OPENING_PRESENT`
- `GEMINI_REFUSAL_PRESENT_IN_FALLBACK_CONTEXT` (must be **false**)

Print **actual** DeepSeek provider role/order map.

### Active handoff owner map (T3)

Read-only provider-order map for instructions that **actually enter the wire**, classified as STYLE / LENGTH / DIALOGUE / AGENCY / SCENE_STATE / LAYOUT / ADULT_PROSE / OTHER. List inactive legacy under `INACTIVE_LEGACY_NOT_IN_WIRE`.

### Objective source metrics

For T1 Gemini, T2 Gemini, T3 DeepSeek:

- `visible_chars`, `paragraph_count`, `dialogue_blocks`, `dialogue_blocks_per_1000_chars`, `dialogue_ratio`, `max_consecutive_dialogue`
- `median_narration_paragraph_chars`, `median_dialogue_paragraph_chars`
- `PRIMARY_MEDIAN_VISIBLE_CHARS = median(T1, T2)`
- `HANDOFF_LENGTH_RATIO = T3 / PRIMARY_MEDIAN` (number only, no PASS/FAIL)

### Decision tree (observation only — no implementation)

| Case | Condition | Action |
|---|---|---|
| **A** | T1/T2 Gemini RAW present in DeepSeek wire | `TRANSPORT_ARCHITECTURE_MID_CHAT = PRESENT` → freeze output, STOP for human style comparison |
| **B** | T1/T2 RAW absent/destroyed | `TRANSPORT_ARCHITECTURE_MID_CHAT = BROKEN` → report first controlling divergence, STOP (no fix) |

### Next-turn routing check (post-T3, code/state only)

- `NEXT_TURN_PRIMARY_EXPECTED = gemini-3.1-pro-preview`
- `ADULT_MODEL_STICKINESS` expected **false**
- No fourth provider call unless explicitly authorized

---

## Distinction preserved in audit lineage

| Audit | Scope | Proves |
|---|---|---|
| **#616 / first-turn** | B-B2 thin history, opening-only assistant | No real primary in-scene exemplar existed to transport |
| **Mid-chat benchmark (this task)** | T1+T2 real Gemini prose → T3 refusal handoff | Whether existing primary RAW survives into DeepSeek wire |

These are **different questions**. #616 must not be over-generalized to mid-chat transport.

---

## No prompt experiment (reconfirmed)

This STOP report made **no** changes to:

- `DEEPSEEK_HANDOFF_CONTINUATION_INSTRUCTION`
- DeepSeek style-only reminder
- USER_TAIL 3200 owner
- terminal dialogue owner
- SceneContinuityPacket
- current-user/coauthor owner
- #615 shared 19+ INTIMACY owner
- provider/model/temperature/max_tokens
- routing/refusal detector
- DeepSeek target / next-turn recovery

---

## STOP for human / ChatGPT review

**Next action for humans:** provide a safe read-only production or staging DB copy (or environment URL) with:

1. A home-listable character row
2. An administrator-owned persona row

Then re-run the frozen 3-turn mid-chat benchmark on current `main` behavior.

No implementation. No provider calls were made in this blocked run.
