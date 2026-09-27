# PR620 real capsule — prompt/runtime behavior quality verification

**Date:** 2026-09-27 (correction pass)  
**Task:** PROMPT/RUNTIME BEHAVIOR QUALITY VERIFICATION — **correction / review packaging**  
**Draft PR:** #1124 (same PR; no new PR)  
**Prior attempt:** PR #1121 closed (no production DB). **Not reopened.**

## Git baseline

| Field | Value |
|--------|--------|
| **EXACT MAIN (`origin/main`)** | `7a7ba46a9222f828fbdab6ce2b9d166ec4f604ed` |
| **EXACT HEAD** | _(see latest commit on branch `cursor/pr620-real-capsule-quality-verification-cea0`)_ |
| **BEHIND_MAIN** | `0` (at benchmark run) |
| **PRODUCTION DIFF (`src/`)** | **0** |
| **NEW PROVIDER CALLS (correction)** | **0** — existing 12 raw reused |

## Review packet (GitHub-readable)

**Path:** `docs/audits/pr620-real-capsule-quality-verification-2026-09-27/review-packet/`

- [`REVIEW_INDEX.md`](review-packet/REVIEW_INDEX.md) — links to all 12 complete raw files + meta
- [`STYLE_OCCURRENCE_MATRIX.json`](review-packet/STYLE_OCCURRENCE_MATRIX.json) — **authoritative style-only** HIT/NO HIT (manual read)
- [`CLASSIFICATION.json`](review-packet/CLASSIFICATION.json)
- 12× raw under `review-packet/raw/`, 12× meta under `review-packet/meta/`
- Supporting JSON: `raw-output-index.json`, `REAL_CAPSULE_SOURCE_MAP.json`, `CURRENT_OWNER_MAP.json`, `input-parity.json`
- Legacy regex: `OCCURRENCE_MATRIX.json` (**not authoritative**)

Original Cloud Agent path (mirror): `/opt/cursor/artifacts/pr620-real-capsule-quality/`

## Historical proof (not scored)

- **PR #255:** char 18 × persona 61 — existence proof only (~4496 visible Gemini 3.1 historical avg).
- **PR #620 HEAD:** `b92100326e56d726eb9040f9cf1b01c7bc11db4e` — imported production **라이크 / 렌** capsule.

## Real capsule provenance

| Item | Value |
|------|--------|
| Source PR | #620 |
| Capsule root | `docs/audits/real-production-mid-chat-style-handoff-benchmark/` |
| Capsule hash | `251ae04247be8ac62c66e8af3b58c0797c94e4938cb3a7a5dec92893da7ab03e` |
| Character / persona | **라이크** / **렌** |
| T3 | Out of scope |

Reconstruction: PR620 frozen source → current main `buildContext` → `assemblePrimaryRpRequest` (12 calls completed earlier; not re-run in correction).

## Benchmark matrix (unchanged)

| | DeepSeek n=3 | Gemini 3.7 n=3 |
|--|--------------|----------------|
| Snapshot A | ✓ | ✓ |
| Snapshot B | ✓ | ✓ |

Each sample: **providerCallCount = 1**, **finish_reason = stop**, no retry/continuation/recovery.

## Current owner map (summary)

- Shared `[COMMON PROSE]` × **1** per model (`commonProseShaPrefix`: `7d9992715736`)
- DeepSeek bottom style / `[DEEPSEEK LENGTH — SINGLE CALL]` probes: **0** on system+last user
- Full wire: [`review-packet/CURRENT_OWNER_MAP.json`](review-packet/CURRENT_OWNER_MAP.json)

## 12 raw output links

See [`review-packet/REVIEW_INDEX.md`](review-packet/REVIEW_INDEX.md).

**Length:** visible chars in meta/index — **observation only**; not used for classification.

## Style occurrence matrix

Manual prose review: [`review-packet/STYLE_OCCURRENCE_MATRIX.json`](review-packet/STYLE_OCCURRENCE_MATRIX.json)

## DeepSeek historical concern review

| Concern | Evidence for (Snapshot B) | Evidence against |
|---------|---------------------------|------------------|
| Micro-action loop | DS B r1, r3 — gaze/breath/hand cycle without scene step | DS B r2 advances; DS A food scenes progress |
| Explanation after showing | DS B r1, r3 — feelings/relationship re-stated after kiss | DS A mostly action-led |
| Inner monologue overuse | DS B r1, r3 introspective blocks | DS A r2/r3 dialogue-heavy |
| Semantic repetition | DS B r1 “장난 vs 진심”; DS B r3 “쳐다본 이유” | DS B r2 tighter |
| Relationship stall | DS B r1, r3 | DS B r2, Gemini B r2 physical progression |

## Gemini 3.7 contrast (not winner)

- **Shared:** ornate narrator / guidespeak intros (especially A and B openings); some post-kiss meaning-check lines.
- **DeepSeek-skewed on B:** micro-action loop + relationship stall cluster on **2/3** DeepSeek B reps; **Gemini B r2** progresses with less stall.
- **Gemini-skewed:** pseudo-clinical neuro/guiding exposition (B r1/r3).

## Style-only variance analysis

- **Not** `MODEL_VARIANCE_TOO_HIGH`: DeepSeek Snapshot A length spread (1219–2752) is **out of scope**; prose mode stays 능청/반말 across reps with different plot branches (국 vs 샤워 vs 치킨).
- DeepSeek B: 2/3 reps share intimacy-beat stall family; 1/3 (r2) is cleaner — sampling variance, not opposite voice modes.

## Final classification (style only)

**`DEEPSEEK_STYLE_COMPLIANCE_GAP`**

Recurring on **Snapshot B** DeepSeek (r1/r3): explanation-after-showing, micro-action loop, relationship stall — **less pronounced** on Gemini B r2 progression. Gemini shows overlapping ornate narration (possible shared COMMON PROSE pressure) but **not** the same micro-loop/stall signature.

If confirmed in human review, likely owner hypothesis (record only — **no patch in #1124**):

| | |
|--|--|
| **BEFORE** | Shared COMMON PROSE ×1; DeepSeek adapter layout (opening remap) active; no bottom style/length block on wire |
| **PROBLEM** | Post-intimacy re-explanation and non-progressive micro-gesture loops on DeepSeek B |
| **GEMINI CONTRAST** | Ornate/clinical narration vs DeepSeek interpretive stall |
| **LIKELY OWNER** | Model compliance + adapter pacing on DeepSeek; partial shared narrator weight on both |

## No production patch

**PRODUCTION DIFF = 0.** No changes to COMMON PROSE, USER_TAIL, adapters, length, retry, billing, or model registry in this correction.

## STOP

GPT/user: read 12 raw files in `review-packet/raw/` for final prose judgment. Bounded fix is a **separate follow-up** after raw review.
